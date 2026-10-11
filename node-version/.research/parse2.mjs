// 按 HTML 结构解析搜韵钦谱：p.mSize 是例词，span.comment 是平仄谱，span.rhythm 标韵脚
import fs from 'node:fs/promises';

const HTML_DIR = new URL('./html/', import.meta.url);
const CJK = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;
const cjk = (s) => [...s].filter((c) => CJK.test(c));
const decode = (s) =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d));
const stripTags = (s) => decode(s.replace(/<[^>]+>/g, ''));

function cnNum(s) {
  const map = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (s === '十') return 10;
  if (s === '百') return 100;
  let m = s.match(/^([一二三四五六七八九])?十([一二三四五六七八九])?$/);
  if (m) return (m[1] ? map[m[1]] : 1) * 10 + (m[2] ? map[m[2]] : 0);
  m = s.match(/^([一二三四五六七八九])百([一二三四五六七八九十]*)$/);
  if (m) return map[m[1]] * 100 + (m[2] ? cnNum(m[2]) : 0);
  let n = 0;
  for (const ch of s) n = n * 10 + (map[ch] || 0);
  return n;
}

const SIMP = (s) =>
  s
    .replace(/欽/g, '钦').replace(/譜/g, '谱').replace(/韻/g, '韵').replace(/葉/g, '叶')
    .replace(/換/g, '换').replace(/讀/g, '读').replace(/雙/g, '双').replace(/調/g, '调')
    .replace(/後/g, '后').replace(/詞/g, '词').replace(/龍/g, '龙').replace(/闋/g, '阕')
    .replace(/協/g, '协').replace(/聲/g, '声').replace(/疊/g, '叠');

// 从 pattern 串里切出每一句的平仄与是否押韵
function splitPattern(pattern) {
  const segs = [];
  let buf = '';
  let rhyme = false;
  for (const c of [...pattern]) {
    if (c === '句' || c === '读' || c === '豆' || c === '。' || c === '，') {
      if (buf) segs.push({ tones: buf, rhyme });
      buf = '';
      rhyme = false;
    } else if (c === '韵' || c === '叶' || c === '协') {
      rhyme = true;
    } else if (c === '中' || c === '仄' || c === '平') {
      buf += c;
    }
  }
  if (buf) segs.push({ tones: buf, rhyme });
  return segs;
}

function parseHtml(html, tuneName) {
  // 钦谱区间
  const i = html.indexOf('钦谱') >= 0 ? html.indexOf('钦谱') : html.indexOf('欽譜');
  if (i < 0) return { error: '找不到钦谱' };
  const j = html.search(/龙谱|龍譜/);
  const block = j > i ? html.slice(i, j) : html.slice(i);

  const norm = SIMP(decode(block));

  // 每个格：先是一段声律说明，随后若干 <p class='mSize'> 例词+谱
  const geRe =
    /<span class='tuneFormatDesc'>([^<]*)<\/span>|<p class='mSize'>([\s\S]*?)<\/p>|<span class='indentLabel'>([^<]*)<\/span>/g;
  const items = [];
  let m;
  while ((m = geRe.exec(norm))) {
    if (m[1] !== undefined) items.push({ t: 'desc', v: stripTags(m[1]).trim() });
    else if (m[3] !== undefined) items.push({ t: 'author', v: stripTags(m[3]).trim() });
    else items.push({ t: 'verse', v: m[2] });
  }

  // 取第一格：从第一个 desc 开始，到第二个 desc 之前
  const first = items.findIndex((x) => x.t === 'desc');
  if (first < 0) return { error: '找不到声律说明' };
  const ge = [];
  for (let k = first; k < items.length; k++) {
    if (k > first && items[k].t === 'desc') break;
    ge.push(items[k]);
  }

  const desc = ge[0].v;
  const dm = desc.match(/([一二三四五六七八九十百]+)字/);
  const declared = dm ? cnNum(dm[1]) : null;

  const verses = ge.filter((x) => x.t === 'verse').map((x) => x.v);
  const author = (ge.find((x) => x.t === 'author') || {}).v || '';

  const sentences = [];
  const patSegs = [];
  for (const v of verses) {
    const poemPart = v.split(/<span class='comment'>/)[0];
    const commentPart = (v.match(/<span class='comment'>([\s\S]*)$/) || ['', ''])[1];

    // 例词：去掉所有标签后取汉字
    const chars = cjk(stripTags(poemPart));
    // 谱：先按 rhythm 标记切段
    const marked = commentPart.replace(
      /<span class='rhythm'>([^<]*)<\/span>/g,
      (_, mark) => `\u0001${stripTags(mark)}\u0001`
    );
    const plain = stripTags(marked).replace(/\s+/g, '');
    const rhymes = [];
    {
      let idx = 0;
      for (const piece of plain.split('\u0001')) {
        if (piece === '韵' || piece === '叶' || piece === '协') rhymes[idx - 1] = true;
        else if (piece === '句' || piece === '读' || piece === '豆') rhymes[idx - 1] = rhymes[idx - 1] || false;
        idx++;
      }
    }
    const segs = splitPattern(plain);

    // 谱段与例词逐字对齐，逐句配对
    let ci = 0;
    for (const s of segs) {
      const len = s.tones.length;
      const text = chars.slice(ci, ci + len).join('');
      ci += len;
      sentences.push({ text, len, tones: s.tones, rhyme: s.rhyme });
      patSegs.push(s);
    }
    if (ci < chars.length) {
      // 谱段比例词短：把剩下的字并到最后一句（罕见，记录下来）
      sentences[sentences.length - 1].text += chars.slice(ci).join('');
      sentences[sentences.length - 1].len += chars.length - ci;
    }
  }

  const sum = sentences.reduce((a, s) => a + s.len, 0);
  return {
    tune: tuneName,
    desc,
    author,
    declared,
    sum,
    sentences,
    okTotal: declared === sum,
    okAlign: sentences.every((s) => s.tones.length === s.len),
  };
}

const names = (await fs.readdir(HTML_DIR)).filter((f) => f.endsWith('.html')).map((f) => f.replace(/\.html$/, ''));
const out = [];
for (const n of names) {
  const html = await fs.readFile(new URL(`${n}.html`, HTML_DIR), 'utf8');
  const r = parseHtml(html, n);
  out.push({ name: n, ...r });
}
out.sort((a, b) => (a.sum || 999) - (b.sum || 999));

let bad = 0;
for (const r of out) {
  console.log('='.repeat(72));
  if (r.error) {
    console.log(`✗ ${r.name}：${r.error}`);
    bad++;
    continue;
  }
  const ok = r.okTotal && r.okAlign;
  if (!ok) bad++;
  console.log(`${ok ? '✓' : '✗'} ${r.name} · ${r.desc} · 例词 ${r.author}`);
  console.log(`    ${r.sentences.length} 句 · 共 ${r.sum} 字（声明 ${r.declared}）`);
  console.log(`    句长 ${r.sentences.map((s) => s.len).join('/')}`);
  console.log(`    韵位 ${r.sentences.map((s) => (s.rhyme ? '韵' : '·')).join('')}`);
  console.log(`    平仄 ${r.sentences.map((s) => s.tones).join(' | ')}`);
  console.log(`    例词 ${r.sentences.map((s) => s.text).join(' / ')}`);
}
console.log(`\n${out.length - bad}/${out.length} 自洽`);
await fs.writeFile(new URL('./parsed.json', import.meta.url), JSON.stringify(out, null, 2), 'utf8');
