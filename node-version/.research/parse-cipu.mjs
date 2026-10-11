// 从搜韵钦谱页面解析出词牌格律（句式、韵位、平仄），并做自洽校验
import fs from 'node:fs/promises';
import path from 'node:path';

const HTML_DIR = new URL('./html/', import.meta.url);

const CJK = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;
const isCJK = (c) => CJK.test(c);

function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '');
}

function decode(s) {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));
}

// 取钦谱的第一段（「钦谱」到「龙谱」之间）。页面有简繁两版，都要认。
function qinpuBlock(html) {
  const text = decode(stripTags(html));
  const starts = ['钦谱', '欽譜'].map((m) => text.indexOf(m)).filter((i) => i >= 0);
  if (!starts.length) return null;
  const i = Math.min(...starts);
  const ends = ['龙谱', '龍譜'].map((m) => text.indexOf(m, i)).filter((j) => j > i);
  const j = ends.length ? Math.min(...ends) : -1;
  return j > i ? text.slice(i, j) : text.slice(i);
}

// 只折叠连续空白，不动全角空格——它是例词里的句读标记
function lines(block) {
  return block
    .split('\n')
    .map((s) => s.replace(/[\t ]+/g, ' ').replace(/\u3000+/g, '\u3000').trim())
    .filter((s) => s.length);
}

// 谱行几乎只由这些字构成（简繁兼容）
const META_CHARS = '中仄平句韵韻叶叶協协换換读讀豆、。，';
const isPatternLine = (line) => {
  const cjk = cjkCount(line);
  if (!cjk) return false;
  const rest = [...line].filter((c) => isCJK(c) && !META_CHARS.includes(c));
  return rest.length === 0;
};


// 行里汉字数
const cjkCount = (s) => [...s].filter(isCJK).length;

// 把钦谱块解析成格。格的起点是「声律说明行/谱行」，例词紧跟在它后面。
// 硬校验：例词总字数必须等于说明行声明的字数，否则丢弃。
function parseBlock(block, tuneName) {
  const ls = lines(block);
  const SIMP = (s) =>
    s
      .replace(/欽/g, '钦')
      .replace(/譜/g, '谱')
      .replace(/韻/g, '韵')
      .replace(/葉/g, '叶')
      .replace(/換/g, '换')
      .replace(/讀/g, '读')
      .replace(/雙/g, '双')
      .replace(/調/g, '调')
      .replace(/後/g, '后')
      .replace(/詞/g, '词')
      .replace(/龍/g, '龙')
      .replace(/闋/g, '阕');
  const norm = ls.map(SIMP);

  const isPattern = (line) => {
    const cjk = cjkCount(line);
    if (!cjk) return false;
    return [...line].every((c) => !isCJK(c) || META_CHARS.includes(c));
  };
  const isEnding = (l) =>
    /^格[二三四五六七八九十]/.test(l) || /^(此调|此詞|此词|按|又|龙谱|历代)/.test(l);

  // 声律说明行：含「N字」与「韵」，且不是解释性的长句
  const isRunLine = (l) => {
    const m = l.match(/([一二三四五六七八九十百]+)字/);
    if (!m) return false;
    if (!/韵/.test(l)) return false;
    return l.length <= 40;
  };

  let start = -1;
  let declared = null;
  for (let i = 0; i < norm.length; i++) {
    if (isRunLine(norm[i])) {
      start = i;
      declared = cnNum(norm[i].match(/([一二三四五六七八九十百]+)字/)[1]);
      break;
    }
  }
  if (start < 0) return null;

  const titleIdx = start - 1;
  const authorIdx = start + 1;
  const tune = titleIdx >= 0 && cjkCount(ls[titleIdx]) <= 6 ? ls[titleIdx] : tuneName;
  const author =
    authorIdx < ls.length && cjkCount(ls[authorIdx]) <= 5 && !isRunLine(norm[authorIdx]) && !isPattern(ls[authorIdx])
      ? ls[authorIdx]
      : '';

  // 钦谱的正文是「谱行 → 例词 → 谱行 → 例词」严格交替，
  // 所以只收「紧跟在谱行之后」或「开头第一段」的例词，其余全是说明文字。
  const COMMENTARY =
    /(词|詞|別首|别首)(前段|后段|前片|后片|第[一二三四五六七八九]|起句|结句|上句|下句)|[字句](平声|仄声|俱平|俱仄)|此调|此詞|此词|谱内|可平可仄|悉同|与.{0,6}(同|异)|填入|据之|按《|见《|一名/;

  const poemLines = [];
  const patLines = [];
  let expectPoem = true; // 开头先来一段例词
  const DBG = process.env.DBG && process.env.DBG === tuneName;
  for (let i = start + (author ? 2 : 1); i < ls.length; i++) {
    const raw = ls[i];
    const l = norm[i];
    if (DBG) {
      console.log(
        `[DBG] ${i} pattern=${isPattern(raw)} expectPoem=${expectPoem} len=${l.length} ` +
          `endPunct=${/[。，、！？；]$/.test(raw)} comm=${COMMENTARY.test(raw)} 「${raw.slice(0, 26)}」`
      );
    }
    if (/^格[二三四五六七八九十]/.test(l)) break;
    if (l.length > 60) break;
    if (isPattern(raw)) {
      patLines.push(raw.replace(/\s/g, ''));
      expectPoem = true;
      continue;
    }
    if (!expectPoem) break;
    // 例词行：搜韵用全角空格分隔诗句（等同逗号），先归一化再收
    const poem = raw.replace(/[\u3000 ]+/g, '，');
    if (/[。，、！？；]$/.test(poem) && poem.length <= 34 && !COMMENTARY.test(poem)) {
      poemLines.push(poem);
      expectPoem = false;
      continue;
    }
    break;
  }
  if (!poemLines.length || !patLines.length) {
    if (process.env.DBG) {
      console.log(`[DBG ${tuneName}] start=${start} author=「${author}」 poem=${poemLines.length} pat=${patLines.length}`);
      console.log(`[DBG ${tuneName}] poem: ${JSON.stringify(poemLines.slice(0, 3))}`);
      console.log(`[DBG ${tuneName}] pat : ${JSON.stringify(patLines.slice(0, 3))}`);
    }
    return null;
  }

  const sentences = [];
  for (const pl of poemLines) for (const s of splitPoem(pl)) sentences.push(s);
  const sum = sentences.reduce((a, s) => a + [...s.text].length, 0);

  const patSegs = patLines.flatMap((p) => splitPattern(SIMP(p)));
  sentences.forEach((s, idx) => {
    const seg = patSegs[idx];
    s.rhyme = seg ? seg.rhyme : null;
    s.tones = seg ? seg.tones : null;
  });

  return {
    tune,
    run: SIMP(ls[start]).replace(tuneName, '').trim() || SIMP(ls[start]),
    author,
    declared,
    sum,
    okTotal: declared === sum,
    sentences,
    patSegs: patSegs.length,
    okAlign: patSegs.length === sentences.length && sentences.every((s) => s.tones && s.tones.length === [...s.text].length),
  };
}

function cnNum(s) {
  const map = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (s === '十') return 10;
  if (s === '百') return 100;
  let n = 0;
  const m = s.match(/^([一二三四五六七八九])?十([一二三四五六七八九])?$/);
  if (m) {
    n = (m[1] ? map[m[1]] : 1) * 10 + (m[2] ? map[m[2]] : 0);
    return n;
  }
  if (/^[一二三四五六七八九]百/.test(s)) {
    const mm = s.match(/^([一二三四五六七八九])百([一二三四五六七八九十]*)$/);
    n = map[mm[1]] * 100 + (mm[2] ? cnNum(mm[2]) : 0);
    return n;
  }
  for (const c of s) n = n * 10 + (map[c] || 0);
  return n;
}

async function parseFile(name) {
  const html = await fs.readFile(new URL(`${name}.html`, HTML_DIR), 'utf8');
  const block = qinpuBlock(html);
  if (!block) return { name, error: '找不到钦谱块' };
  const ge = parseBlock(block, name);
  if (!ge) return { name, error: '没解析出格' };
  return { name, ...ge };
}

/** 把例词拆成一句一句（按句读），返回每句字数 */
function splitPoem(text) {
  const chars = [...text];
  const out = [];
  let buf = [];
  for (const c of chars) {
    if (isCJK(c)) {
      buf.push(c);
    } else if ('。，、！？；：'.includes(c)) {
      if (buf.length) {
        out.push({ text: buf.join(''), punct: c });
        buf = [];
      }
    }
  }
  if (buf.length) out.push({ text: buf.join(''), punct: '' });
  return out;
}

/** 谱行按 句/韻/叶/換 等标记切段，得到每段的平仄串与是否押韵 */
function splitPattern(pattern) {
  const segs = [];
  let buf = '';
  let rhyme = false;
  for (const c of [...pattern]) {
    if (c === '句' || c === '讀' || c === '豆') {
      if (buf) segs.push({ tones: buf, rhyme });
      buf = '';
      rhyme = false;
    } else if (c === '韻' || c === '叶' || c === '協') {
      rhyme = true; // 韵脚标记在段末
    } else if (c === '換') {
      // 換韻：下一个标记起换韵，这里只记录
      buf += '';
    } else if ('中仄平'.includes(c)) {
      buf += c;
    }
    // 其余（換仄韻 之类）忽略
  }
  if (buf) segs.push({ tones: buf, rhyme });
  return segs;
}

const names = (await fs.readdir(HTML_DIR))
  .filter((f) => f.endsWith('.html'))
  .map((f) => f.replace(/\.html$/, ''));

const report = [];
for (const n of names) report.push(await parseFile(n));
report.sort((a, b) => (a.sum || 999) - (b.sum || 999));

let bad = 0;
for (const r of report) {
  console.log('='.repeat(72));
  if (r.error) {
    console.log(`✗ ${r.name}：${r.error}`);
    bad++;
    continue;
  }
  const lens = r.sentences.map((s) => [...s.text].length);
  const rhymes = r.sentences.map((s) => (s.rhyme ? '韵' : '·')).join('');
  const aligned = r.sentences.every((s) => s.tones && s.tones.length === [...s.text].length);
  const flag = r.okTotal && aligned ? '✓' : '✗';
  if (flag === '✗') bad++;
  console.log(`${flag} ${r.name} · ${r.run}`);
  console.log(`    例词作者 ${r.author || '?'} · ${r.sentences.length} 句 · 共 ${r.sum} 字（声明 ${r.declared}）`);
  console.log(`    句长 ${lens.join('/')}`);
  console.log(`    韵位 ${rhymes}`);
  console.log(`    谱段 ${r.patSegs} · 逐句对齐 ${aligned ? '✓' : '✗'}`);
  if (!aligned) {
    r.sentences.forEach((s) => {
      console.log(`      「${s.text}」${[...s.text].length}字  谱=${s.tones}(${s.tones ? s.tones.length : 0})`);
    });
  }
}
console.log(`\n${report.length - bad}/${report.length} 个词牌解析自洽`);

await fs.writeFile(new URL('./parsed.json', import.meta.url), JSON.stringify(report, null, 2), 'utf8');
console.log('已写出 parsed.json');
