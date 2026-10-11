import fs from 'node:fs/promises';
const name = process.argv[2] || '浣溪沙';
const html = await fs.readFile(new URL(`./html/${name}.html`, import.meta.url), 'utf8');
const CJK = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;
const cjk = (s) => [...s].filter((c) => CJK.test(c));
const decode = (s) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d));
const stripTags = (s) => decode(s.replace(/<[^>]+>/g, ''));

const i = html.indexOf('钦谱');
const j = html.search(/龙谱|龍譜/);
const block = decode(html.slice(i, j));
const re = /<p class='mSize'>([\s\S]*?)<\/p>/g;
let m;
let n = 0;
while ((m = re.exec(block)) && n < 2) {
  n++;
  const v = m[1];
  const poemPart = v.split(/<span class='comment'>/)[0];
  const commentPart = (v.match(/<span class='comment'>([\s\S]*)$/) || ['', ''])[1];
  const plain = stripTags(poemPart).replace(/\s+/g, ' ');
  const segs = plain.split(/[\u3000 ]+/).map((s) => cjk(s).join('')).filter(Boolean);
  console.log('例词段:', segs, '字数', segs.map((s) => [...s].length));

  const raw = stripTags(commentPart).replace(/\s+/g, '');
  console.log('谱串  :', JSON.stringify(raw));
  const marks = [];
  let pz = '';
  for (const ch of raw) {
    if ('中仄平'.includes(ch)) pz += ch;
    else if ('句读豆。，'.includes(ch)) marks.push({ at: pz.length, kind: '句' });
    else if ('韵叶协'.includes(ch)) marks.push({ at: pz.length, kind: '韵' });
    else if (ch === '换') marks.push({ at: pz.length, kind: '换' });
  }
  console.log('平仄  :', pz, '(', pz.length, ')');
  console.log('标记  :', JSON.stringify(marks));
  let cursor = 0;
  for (const text of segs) {
    const len = [...text].length;
    console.log(`  句「${text}」len=${len} 谱=${pz.slice(cursor, cursor + len)} 标记=${JSON.stringify(marks.filter((x) => x.at === cursor + len))}`);
    cursor += len;
  }
  console.log('');
}
