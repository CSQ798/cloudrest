// 栖云 · 典故库 B 卷自测
//
// 运行：node qiyun/.research/test-allusions-b.mjs
// 逐条硬校验：字段齐全、id 唯一、source 以《》包裹、sentiment 取值合法、
// 条数 ≥ 55，并顺带做「id 全库唯一」与「疑似同源重复」的软检查。
//
// 退出码 0 表示全部通过，非 0 表示有失败项（失败项逐条打印）。

import { ALLUSIONS_B, SENTIMENTS } from '../server/allusions-b.mjs';

const REQUIRED = [
  'id', 'name', 'era', 'source', 'figures', 'gist',
  'meaning', 'sentiment', 'usage', 'avoid', 'exampleInClassics',
];

const MIN_COUNT = 55;

const problems = [];
const fail = (id, msg) => problems.push(`[${id || '?'}] ${msg}`);

// ── 字段与取值 ──────────────────────────────────────────────
const seenIds = new Map();
const seenNames = new Map();

for (const a of ALLUSIONS_B) {
  const id = a && a.id;

  // 1) 字段齐全且类型正确
  for (const k of REQUIRED) {
    if (!(k in a)) { fail(id, `缺字段 ${k}`); continue; }
    if (k === 'figures' || k === 'sentiment') {
      if (!Array.isArray(a[k]) || a[k].length === 0) fail(id, `${k} 必须是非空数组`);
      else if (a[k].some((s) => typeof s !== 'string' || !s.trim())) fail(id, `${k} 含空元素`);
    } else if (typeof a[k] !== 'string' || !a[k].trim()) {
      fail(id, `${k} 必须是非空字符串`);
    }
  }

  // 2) 多余的字段名（防止拼错字段名而悄悄掉数据）
  for (const k of Object.keys(a)) {
    if (!REQUIRED.includes(k)) fail(id, `出现未声明的字段 ${k}`);
  }

  // 3) id 形态与唯一
  if (typeof id === 'string') {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) fail(id, 'id 不是小写短横线形式');
    if (seenIds.has(id)) fail(id, `id 与第 ${seenIds.get(id)} 条重复`);
    else seenIds.set(id, ALLUSIONS_B.indexOf(a) + 1);
  }

  // 4) name 唯一（同名词头会让写作检索时歧义）
  if (typeof a.name === 'string') {
    if (seenNames.has(a.name)) fail(id, `name「${a.name}」与第 ${seenNames.get(a.name)} 条重名`);
    else seenNames.set(a.name, ALLUSIONS_B.indexOf(a) + 1);
  }

  // 5) source 非空且以《》包裹
  if (typeof a.source === 'string') {
    if (!a.source.includes('《') || !a.source.includes('》')) {
      fail(id, `source 未用《》包裹：${a.source}`);
    } else if (!/《[^《》]+》/.test(a.source)) {
      fail(id, `source 中《》为空：${a.source}`);
    }
  }

  // 6) sentiment 取值在允许集合内，且 1-3 个
  if (Array.isArray(a.sentiment)) {
    for (const s of a.sentiment) {
      if (!SENTIMENTS.includes(s)) fail(id, `sentiment「${s}」不在允许集合内`);
    }
    if (a.sentiment.length < 1 || a.sentiment.length > 3) {
      fail(id, `sentiment 数量应为 1-3，实为 ${a.sentiment.length}`);
    }
    if (new Set(a.sentiment).size !== a.sentiment.length) fail(id, 'sentiment 有重复项');
  }

  // 7) figures 非空
  if (Array.isArray(a.figures) && a.figures.length === 0) fail(id, 'figures 为空');
}

// ── 条数 ────────────────────────────────────────────────────
if (ALLUSIONS_B.length < MIN_COUNT) {
  fail('(库)', `条数 ${ALLUSIONS_B.length} < ${MIN_COUNT}`);
}

// ── 软检查：疑似同源重复（source 首部书名+篇名相同）────────
const srcKey = (s) => (s.match(/《[^《》]+》/g) || []).join('|');
const bySrc = new Map();
for (const a of ALLUSIONS_B) {
  const k = srcKey(a.source);
  if (!k) continue;
  if (!bySrc.has(k)) bySrc.set(k, []);
  bySrc.get(k).push(a.id);
}
const sameSourcelist = [...bySrc.entries()].filter(([, ids]) => ids.length > 1);

// ── 报告 ────────────────────────────────────────────────────
const emoCount = {};
for (const a of ALLUSIONS_B) for (const s of a.sentiment) emoCount[s] = (emoCount[s] || 0) + 1;

const eraCount = {};
for (const a of ALLUSIONS_B) {
  const e = a.era.includes('·') ? a.era.split('·')[0] : a.era;
  eraCount[e] = (eraCount[e] || 0) + 1;
}

console.log('栖云 · 典故库 B 卷自测');
console.log('='.repeat(52));
console.log(`条数            : ${ALLUSIONS_B.length}（下限 ${MIN_COUNT}）`);
console.log(`id 唯一         : ${seenIds.size} / ${ALLUSIONS_B.length}`);
console.log(`情感标签分布    : ${Object.entries(emoCount).map(([k, v]) => `${k}${v}`).join(' ')}`);
console.log(`朝代分布        : ${Object.entries(eraCount).map(([k, v]) => `${k}${v}`).join(' ')}`);
console.log(`允许标签         : ${SENTIMENTS.join(' ')}`);
const unused = SENTIMENTS.filter((s) => !emoCount[s]);
console.log(`未用到的标签    : ${unused.length ? unused.join(' ') : '（无）'}`);

if (sameSourcelist.length) {
  console.log('\n提示（非失败）：以下条目共享同一出处首部，请人工确认非同源重复');
  for (const [k, ids] of sameSourcelist) console.log(`  ${k} → ${ids.join(', ')}`);
}

if (problems.length) {
  console.log(`\n失败 ${problems.length} 项：`);
  for (const p of problems) console.log('  ' + p);
  process.exit(1);
}

console.log('\n全部通过 ✓');
process.exit(0);
