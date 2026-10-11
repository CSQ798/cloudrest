// 栖云 · 典故库 A 批自测
//
// 运行：node qiyun/.research/test-allusions-a.mjs
// 通过则 exit 0；任一硬性检查失败则 exit 1 并列出全部问题。

import { ALLUSIONS_A, ALLUSION_SENTIMENTS, allusionsById } from '../server/allusions-a.mjs';

const REQUIRED_FIELDS = [
  'id', 'name', 'era', 'source', 'figures', 'gist',
  'meaning', 'sentiment', 'usage', 'avoid', 'exampleInClassics',
];

const MIN_COUNT = 55;
const SENTIMENT_SET = new Set(ALLUSION_SENTIMENTS);
const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// 字数：去掉空白后计数（含中文标点）
const charCount = (s) => String(s).replace(/\s/g, '').length;

const errors = [];
const fail = (msg) => errors.push(msg);

if (!Array.isArray(ALLUSIONS_A)) {
  fail('ALLUSIONS_A 不是数组');
}

const list = Array.isArray(ALLUSIONS_A) ? ALLUSIONS_A : [];

// 1. 条数
if (list.length < MIN_COUNT) {
  fail(`条数不足：${list.length} < ${MIN_COUNT}`);
}

// 2. 逐条字段
const seenIds = new Map();
for (let i = 0; i < list.length; i++) {
  const it = list[i];
  const tag = `#${i} ${it && it.id ? it.id : '(无 id)'}`;

  if (it === null || typeof it !== 'object') {
    fail(`${tag}：条目不是对象`);
    continue;
  }

  // 字段齐全 + 类型
  for (const f of REQUIRED_FIELDS) {
    if (!(f in it)) fail(`${tag}：缺字段 ${f}`);
  }

  if (typeof it.id !== 'string' || !it.id) {
    fail(`${tag}：id 必须是非空字符串`);
  } else {
    if (!ID_RE.test(it.id)) fail(`${tag}：id 不是小写短横线格式：${it.id}`);
    if (seenIds.has(it.id)) fail(`${tag}：id 重复，与 #${seenIds.get(it.id)} 相同`);
    else seenIds.set(it.id, i);
  }

  if (typeof it.name !== 'string' || !it.name.trim()) fail(`${tag}：name 为空`);
  if (typeof it.era !== 'string' || !it.era.trim()) fail(`${tag}：era 为空`);

  // source 非空且以《》包裹
  if (typeof it.source !== 'string' || !it.source.trim()) {
    fail(`${tag}：source 为空`);
  } else if (!/^《.+》$/.test(it.source.trim())) {
    fail(`${tag}：source 未用《》包裹：${it.source}`);
  }

  if (!Array.isArray(it.figures) || it.figures.length === 0) {
    fail(`${tag}：figures 必须是非空数组`);
  } else if (it.figures.some((x) => typeof x !== 'string' || !x.trim())) {
    fail(`${tag}：figures 含空项`);
  }

  // sentiment 取值与个数
  if (!Array.isArray(it.sentiment) || it.sentiment.length === 0) {
    fail(`${tag}：sentiment 必须是非空数组`);
  } else {
    if (it.sentiment.length > 3) fail(`${tag}：sentiment 超过 3 个（${it.sentiment.length}）`);
    for (const s of it.sentiment) {
      if (!SENTIMENT_SET.has(s)) fail(`${tag}：sentiment 取值非法「${s}」`);
    }
    if (new Set(it.sentiment).size !== it.sentiment.length) {
      fail(`${tag}：sentiment 有重复项`);
    }
  }

  // 文本字段非空
  for (const f of ['gist', 'meaning', 'usage', 'avoid', 'exampleInClassics']) {
    if (typeof it[f] !== 'string' || !it[f].trim()) fail(`${tag}：${f} 为空`);
  }

  // 字数区间（规范：gist 30-60 / meaning 20-50 / usage 30-70）
  if (typeof it.gist === 'string') {
    const n = charCount(it.gist);
    if (n < 30 || n > 60) fail(`${tag}：gist 字数 ${n} 不在 30-60`);
  }
  if (typeof it.meaning === 'string') {
    const n = charCount(it.meaning);
    if (n < 20 || n > 50) fail(`${tag}：meaning 字数 ${n} 不在 20-50`);
  }
  if (typeof it.usage === 'string') {
    const n = charCount(it.usage);
    if (n < 30 || n > 70) fail(`${tag}：usage 字数 ${n} 不在 30-70`);
  }
  // 用例须带书名号或引号，便于人读
  if (typeof it.exampleInClassics === 'string' && !/《.+》/.test(it.exampleInClassics)) {
    fail(`${tag}：exampleInClassics 未含《》诗题：${it.exampleInClassics}`);
  }
}

// 3. 索引函数自洽
const byId = allusionsById();
if (byId.size !== list.length) {
  fail(`allusionsById 大小 ${byId.size} 与条数 ${list.length} 不一致`);
}

// 4. 情感覆盖（提示性，不构成失败）
const used = new Set(list.flatMap((x) => (Array.isArray(x.sentiment) ? x.sentiment : [])));
const unused = ALLUSION_SENTIMENTS.filter((s) => !used.has(s));

if (errors.length) {
  console.error(`✗ 典故库 A 批自测失败，${errors.length} 处问题：`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}

console.log('✓ 典故库 A 批自测通过');
console.log(`  条数：${list.length}（要求 ≥ ${MIN_COUNT}）`);
console.log(`  唯一 id：${byId.size}`);
console.log(`  情感标签覆盖：${used.size}/${ALLUSION_SENTIMENTS.length}` +
  (unused.length ? `（未用到：${unused.join('、')}）` : ''));
process.exit(0);
