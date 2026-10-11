// 搜韵钦谱 → 词牌格律表
// 例词用全角空格分句；谱串是「平仄字 + 句/韵标记」的流，按每句字数切片，切点见「韵」即为韵脚。
// 硬校验：例词总字数必须等于词谱声明的字数，且谱串长度必须等于例词总字数。
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
    .replace(/協/g, '协').replace(/聲/g, '声').replace(/疊/g, '叠').replace(/閒/g, '闲');

function parseTune(html, tuneName) {
  const i = html.indexOf('钦谱') >= 0 ? html.indexOf('钦谱') : html.indexOf('欽譜');
  if (i < 0) return { error: '找不到钦谱' };
  const j = html.search(/龙谱|龍譜/);
  const block = decode(j > i ? html.slice(i, j) : html.slice(i));

  const itemRe =
    /<span class='tuneFormatDesc'>([^<]*)<\/span>|<span class='indentLabel'>([^<]*)<\/span>|<p class='mSize'>([\s\S]*?)<\/p>/g;
  const items = [];
  let m;
  while ((m = itemRe.exec(block))) {
    if (m[1] !== undefined) items.push({ t: 'desc', v: SIMP(stripTags(m[1])).trim() });
    else if (m[2] !== undefined) items.push({ t: 'author', v: SIMP(stripTags(m[2])).trim() });
    else items.push({ t: 'verse', v: m[3] });
  }

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
  const author = (ge.find((x) => x.t === 'author') || {}).v || '';
  const verses = ge.filter((x) => x.t === 'verse').map((x) => x.v);

  const sentences = [];
  const errors = [];
  for (const v of verses) {
    const poemPart = v.split(/<span class='comment'>/)[0];
    const commentPart = (v.match(/<span class='comment'>([\s\S]*)$/) || ['', ''])[1];

    const plain = stripTags(poemPart).replace(/\s+/g, ' ');
    const segs = plain
      .split(/[\u3000 ]+/)
      .map((s) => cjk(s).join(''))
      .filter(Boolean);

    // 线性扫描 comment：一边累积平仄串，一边记录每个 span.rhythm 出现在哪个平仄位置。
    // 一个句末可能有多个标记段（如「平」「韵」两段），所以不能按句消费标记，
    // 只能看标记落在哪个位置 —— 落在第 n 字之后，就属于第 n 字所在的那一句。
    let pz = '';
    const markAt = []; // { at, kinds:Set, changed }
    const re = /<span class='rhythm'>([\s\S]*?)<\/span>|([^<]+)/g;
    let mm;
    while ((mm = re.exec(commentPart))) {
      if (mm[1] !== undefined) {
        const text = SIMP(stripTags(mm[1]));
        let cur = markAt[markAt.length - 1];
        if (!cur || cur.at !== pz.length) {
          cur = { at: pz.length, kinds: new Set(), changed: false };
          markAt.push(cur);
        }
        for (const c of text) {
          if ('韵叶协'.includes(c)) cur.kinds.add('韵');
          else if ('句读豆'.includes(c)) cur.kinds.add('句');
          else if (c === '换') cur.changed = true;
        }
      } else {
        for (const ch of SIMP(stripTags(mm[2]))) if ('中仄平'.includes(ch)) pz += ch;
      }
    }

    let cursor = 0;
    for (const text of segs) {
      const len = [...text].length;
      const tones = pz.slice(cursor, cursor + len);
      cursor += len;
      const merged = markAt.filter((x) => x.at === cursor);
      const rhyme = merged.some((x) => x.kinds.has('韵'));
      const changed = merged.some((x) => x.changed);
      sentences.push({ text, len, tones, rhyme, changed });
    }
    if (cursor !== pz.length) errors.push(`谱长 ${pz.length} ≠ 例词 ${cursor}`);
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
    okAlign: errors.length === 0 && sentences.every((s) => s.tones.length === s.len),
    errors,
  };
}

const names = (await fs.readdir(HTML_DIR)).filter((f) => f.endsWith('.html')).map((f) => f.replace(/\.html$/, ''));
const out = [];
for (const n of names) {
  const html = await fs.readFile(new URL(`${n}.html`, HTML_DIR), 'utf8');
  out.push({ name: n, ...parseTune(html, n) });
}
out.sort((a, b) => (a.sum || 999) - (b.sum || 999));

let bad = 0;
for (const r of out) {
  console.log('='.repeat(74));
  if (r.error) {
    console.log(`✗ ${r.name}：${r.error}`);
    bad++;
    continue;
  }
  const ok = r.okTotal && r.okAlign;
  if (!ok) bad++;
  console.log(`${ok ? '✓' : '✗'} ${r.name} · ${r.desc} · 例词 ${r.author}`);
  console.log(`    ${r.sentences.length} 句 · 共 ${r.sum} 字（声明 ${r.declared}）${r.errors.length ? ' ⚠ ' + r.errors.join('；') : ''}`);
  console.log(`    句长 ${r.sentences.map((s) => s.len).join('/')}`);
  console.log(`    韵位 ${r.sentences.map((s) => (s.rhyme ? '韵' : '·')).join('')}`);
  console.log(`    平仄 ${r.sentences.map((s) => s.tones).join('|')}`);
  console.log(`    例词 ${r.sentences.map((s) => s.text).join(' / ')}`);
}
console.log(`\n${out.length - bad}/${out.length} 自洽`);
await fs.writeFile(new URL('./parsed.json', import.meta.url), JSON.stringify(out, null, 2), 'utf8');
