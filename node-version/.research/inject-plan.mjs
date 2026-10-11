// 把实测出的韵组结构写进 qiyun/server/tunes.mjs 的 rhymePlan 字段。
// rhymePlan：每片的「韵组规模」，如 [1,1] 表示该片韵脚各自成组，[3] 表示该片三个韵脚互押。
// 由各片实测的分组个数，把该片韵位数等分得到。
import fs from 'node:fs/promises';

const parsed = JSON.parse(await fs.readFile(new URL('./parsed.json', import.meta.url), 'utf8'));
const structures = JSON.parse(await fs.readFile(new URL('./group-structure.json', import.meta.url), 'utf8'));

const plan = {};
for (const r of parsed) {
  if (r.error || !r.sentences) continue;
  const s = structures[r.name];
  if (!s) continue;
  const rhymesPerStanza = [];
  let cur = 0;
  for (const n of s.stanzas) {
    let count = 0;
    for (let i = cur; i < cur + n; i++) if (r.sentences[i].rhyme) count++;
    rhymesPerStanza.push(count);
    cur += n;
  }
  // 每片的组数（实测），再把该片韵位规模等分
  const groupNums = s.perStanza.map((g) => Math.max(1, g.length));
  const sizes = rhymesPerStanza.map((n, i) => {
    const g = Math.min(groupNums[i] || 1, n || 1);
    const base = Math.floor(n / g);
    const rest = n % g;
    return Array.from({ length: g }, (_, k) => base + (k < rest ? 1 : 0)).filter((x) => x > 0);
  });
  plan[r.name] = { stanzas: s.stanzas, rhymesPerStanza, groupNums, sizes };
}

// 读现有 tunes.mjs，注入 rhymePlan
const path = new URL('../server/tunes.mjs', import.meta.url);
let src = await fs.readFile(path, 'utf8');
let changed = 0;
for (const [name, p] of Object.entries(plan)) {
  const re = new RegExp(`(name: '${name}',[\\s\\S]*?)(\\n  \\},)`);
  const m = src.match(re);
  if (!m) {
    console.log(`⚠ 未找到 ${name}`);
    continue;
  }
  if (m[1].includes('rhymePlan')) continue;
  const inject = `\n    // 每片韵组规模（实测：同组互押）\n    rhymePlan: ${JSON.stringify(p.sizes)},`;
  src = src.replace(re, `$1${inject}$2`);
  changed++;
}
await fs.writeFile(path, src, 'utf8');
console.log(`已为 ${changed} 个词牌注入 rhymePlan`);
for (const [name, p] of Object.entries(plan)) {
  console.log(`  ${name.padEnd(5, '　')} 片 ${p.stanzas.join('+')}　每片韵数 ${p.rhymesPerStanza.join('+')}　组数 ${p.groupNums.join('+')}　规模 ${JSON.stringify(p.sizes)}`);
}
