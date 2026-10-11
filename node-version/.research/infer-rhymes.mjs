// 词牌韵位的另一条独立推法：用《词林正韵》反推
// 例词每句末字若与已知韵脚同部，则该句押韵。两种方法交叉验证。
import fs from 'node:fs/promises';

const dir = new URL('./', import.meta.url);
const cilin = JSON.parse(await fs.readFile(new URL('raw-Cilin_Rhyme.json', dir), 'utf8'));

// 部号 → { 平:Set, 仄:Set }；一个字的声调若为「多」，两处都收
const BU = [];
const charToPing = new Map();
const charToZe = new Map();
Object.entries(cilin).forEach(([name, groups], idx) => {
  const ping = new Set();
  const ze = new Set();
  for (const [tone, chars] of Object.entries(groups)) {
    const isPing = tone.includes('平');
    for (const c of chars) (isPing ? ping : ze).add(c);
  }
  BU.push({ name, ping, ze });
  for (const c of ping) if (!charToPing.has(c)) charToPing.set(c, idx);
  for (const c of ze) if (!charToZe.has(c)) charToZe.set(c, idx);
});
const buPing = (c) => charToPing.get(c);
const buZe = (c) => charToZe.get(c);
console.log(`词林正韵载入 ${BU.length} 部；平声字 ${charToPing.size}，仄声字 ${charToZe.size}`);

const parsed = JSON.parse(await fs.readFile(new URL('parsed.json', dir), 'utf8'));

let mismatch = 0;
for (const r of parsed) {
  if (r.error || !r.sentences) continue;
  const sents = r.sentences;
  const ends = sents.map((s) => s.text.slice(-1));

  // 找出「至少出现两次同部」的末字作为韵脚核心
  const keyCount = new Map();
  for (const c of ends) {
    const key = `${buPing(c) ?? '-'}|${buZe(c) ?? '-'}`;
    if (key === '-|-') continue;
    keyCount.set(key, (keyCount.get(key) || 0) + 1);
  }
  const coreKeys = new Set([...keyCount.entries()].filter(([, n]) => n >= 2).map(([k]) => k));
  if (!coreKeys.size) coreKeys.add([...keyCount.keys()][0]);

  const inferred = ends.map((c) => {
    const p = buPing(c);
    const z = buZe(c);
    return coreKeys.has(`${p ?? '-'}|${z ?? '-'}`);
  });

  const marked = sents.map((s) => Boolean(s.rhyme));
  const same = JSON.stringify(inferred) === JSON.stringify(marked);
  if (!same) mismatch++;
  const show = (m) => m.map((x) => (x ? '韵' : '·')).join('');
  console.log(
    `${same ? '✓' : '✗'} ${r.name.padEnd(4, '　')} 标记 ${show(marked)}  推断 ${show(inferred)}  末字 ${ends.join('')}`
  );
}
console.log(`\n${parsed.filter((r) => !r.error).length - mismatch} / ${parsed.filter((r) => !r.error).length} 两种方法一致`);
