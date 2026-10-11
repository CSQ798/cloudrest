import fs from 'node:fs/promises';
const CJK = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;
const cjk = (s) => [...s].filter((c) => CJK.test(c));
const decode = (s) => s.replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d));
const stripTags = (s) => decode(s.replace(/<[^>]+>/g, ''));
const SIMP = (s) => s.replace(/韻/g, '韵').replace(/葉/g, '叶').replace(/換/g, '换').replace(/讀/g, '读').replace(/閒/g, '闲');

const name = process.argv[2] || '定风波';
const html = await fs.readFile(new URL(`./html/${name}.html`, import.meta.url), 'utf8');
const i = html.indexOf('钦谱');
const j = html.search(/龙谱|龍譜/);
const block = html.slice(i, j);
const re = /<p class='mSize'>([\s\S]*?)<\/p>/g;
let m, k = 0;
while ((m = re.exec(block)) && k < 2) {
  k++;
  const v = m[1];
  const poemPart = v.split(/<span class='comment'>/)[0];
  const commentPart = (v.match(/<span class='comment'>([\s\S]*)$/) || ['', ''])[1];

  const segs = stripTags(poemPart).replace(/\s+/g, ' ').split(/[\u3000 ]+/).map((s) => cjk(s).join('')).filter(Boolean);

  // 逐个 rhythm 段列出
  const spans = [];
  const noMarks = commentPart.replace(/<span class='rhythm'>([^<]*)<\/span>/g, (_, inner) => {
    spans.push(SIMP(stripTags(inner)));
    return '';
  });
  const raw = SIMP(stripTags(noMarks)).replace(/\s+/g, '');
  let pz = '';
  for (const ch of raw) if ('中仄平'.includes(ch)) pz += ch;

  console.log(`句数 ${segs.length} / rhythm段数 ${spans.length} / 平仄长 ${pz.length}`);
  console.log('  rhythm 段：', JSON.stringify(spans));
  console.log('  例词：', segs.map((s) => `${s}(${[...s].length})`).join(' '));
  // 按平仄累计位置找每个 span 的锚点
  let cursor = 0;
  for (const text of segs) {
    const len = [...text].length;
    cursor += len;
    console.log(`   句「${text}」结束于平仄位置 ${cursor}`);
  }
  // 把残留的 句/韵 标记也标出来（它们在 noMarks 里被删掉了，所以这里重算一遍）
  const marks = [];
  let p2 = '';
  for (const ch of raw) {
    if ('中仄平'.includes(ch)) p2 += ch;
    else if ('句读豆'.includes(ch)) marks.push({ at: p2.length, kind: '句' });
    else if ('韵叶协'.includes(ch)) marks.push({ at: p2.length, kind: '韵' });
    else if ('换'.includes(ch)) marks.push({ at: p2.length, kind: '换' });
  }
  console.log('  残留标记：', JSON.stringify(marks));
  console.log('  平仄串：', pz);
}
