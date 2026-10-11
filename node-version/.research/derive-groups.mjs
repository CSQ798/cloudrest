// 由钦谱例词「实测」出每个词牌每片的韵组结构，写进 tunes.mjs
// 原理：同组之字必然两两同部；用并查集把例词韵脚按「同部」合并，得到的连通分量就是韵组。
import fs from 'node:fs/promises';
import { buOf } from '../server/rhyme.mjs';

const parsed = JSON.parse(await fs.readFile(new URL('./parsed.json', import.meta.url), 'utf8'));

function groupPartition(items) {
  const n = items.length;
  const parent = [...Array(n).keys()];
  const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = items[i].bu;
      const b = items[j].bu;
      if (a.length && b.length && a.some((x) => b.includes(x))) union(i, j);
    }
  }
  const map = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!map.has(r)) map.set(r, []);
    map.get(r).push(i);
  }
  // 按原顺序返回
  return [...map.values()].sort((a, b) => a[0] - b[0]);
}

const structures = {};
for (const r of parsed) {
  if (r.error || !r.sentences) continue;
  const name = r.name;
  const tuneStanzas = r.stanzas || null;
  const lines = r.sentences.map((s) => s.text);
  const rhymeIdx = r.sentences.map((s, i) => (s.rhyme ? i : -1)).filter((i) => i >= 0);

  // 用钦谱声律说明里的分片（从 desc 解析）
  const desc = r.desc;
  function cn(s) {
    const m = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
    if (s === '十') return 10;
    const mm = s.match(/^([一二三四五六七八九])?十([一二三四五六七八九])?$/);
    if (mm) return (mm[1] ? m[mm[1]] : 1) * 10 + (mm[2] ? m[mm[2]] : 0);
    return m[s] || 0;
  }
  let stanzas = [r.sentences.length];
  const m1 = desc.match(/前(?:段|片)([一二三四五六七八九十]+)句[\s\S]*?后(?:段|片)([一二三四五六七八九十]+)句/);
  const m2 = desc.match(/前后(?:段|片)各([一二三四五六七八九十]+)句/);
  if (m1) stanzas = [cn(m1[1]), cn(m1[2])];
  else if (m2) stanzas = [cn(m2[1]), cn(m2[1])];

  const perStanza = [];
  let cur = 0;
  for (const n of stanzas) {
    const idxs = rhymeIdx.filter((i) => i >= cur && i < cur + n);
    cur += n;
    const items = idxs.map((i) => ({ i, ch: lines[i].slice(-1), bu: buOf(lines[i].slice(-1)) }));
    perStanza.push(groupPartition(items).map((g) => g.map((k) => idxs[k])));
  }
  structures[name] = { desc, stanzas, rhymeIdx, perStanza };
}

// 与 tunes.mjs 现有的 groupCounts 对照
const { TUNES } = await import('../server/tunes.mjs');
console.log('词牌　　分片　　　实测韵组（例词）');
for (const t of TUNES) {
  const s = structures[t.name];
  if (!s) continue;
  const counts = s.perStanza.map((g) => g.length).join('+');
  const chars = s.perStanza.map((g) => g.map((idx) => structures[t.name].rhymeIdx.indexOf(idx) >= 0 ? '' : '').join('')).join('');
  const shown = s.perStanza
    .map((groups) => groups.map((idxs) => idxs.map((i) => structures[t.name].desc && '').join('')).join(''))
    .join('');
  const labels = s.perStanza
    .map((groups) => groups.map((idxs) => idxs.map((i) => (s.desc, '')).join('')).join(''))
    .join('');
  console.log(
    `${t.name.padEnd(5, '　')} ${String(s.stanzas.join('+')).padEnd(8)} ${counts}` +
      `　（现有声明 ${JSON.stringify(t.groupCounts)}）`
  );
}

// 逐片打印各组包含第几句
console.log('\n明细：');
for (const t of TUNES) {
  const s = structures[t.name];
  if (!s) continue;
  const detail = s.perStanza
    .map((groups, si) => `片${si + 1}: ` + groups.map((g) => `[${g.map((i) => i + 1).join(',')}]`).join(' '))
    .join('　');
  console.log(`${t.name.padEnd(5, '　')} ${detail}`);
}

await fs.writeFile(new URL('./group-structure.json', import.meta.url), JSON.stringify(structures, null, 2), 'utf8');
console.log('\n已写出 group-structure.json');
