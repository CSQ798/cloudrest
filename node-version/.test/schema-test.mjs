// 表结构的「单一真源」自证
//
// 现在有两份 DDL：
//   server/schema.mjs            —— 真源。站点启动时用它自动建表（Worker 读不到磁盘文件）
//   migrations/0001_init.sql     —— 抄本。留给「想手工执行 / 想读一遍」的人
//
// 两份说法一旦不一致，就会出现最难查的一类故障：自动建的表少一列，
// 手工执行的路径却是对的（或反过来）。所以这里逐句比对，谁改了不同步谁就红。
//
// 比对方式：把 .sql 按分号切成语句，去掉注释与多余空白，与 schema.mjs 的数组逐条比。
// 不做完整 SQL 解析 —— 只需要「两边说的是同一件事」这个强度。

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SCHEMA } from '../server/schema.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

let bad = 0;
const ok = (c, label, extra = '') => {
  if (!c) bad++;
  console.log(`${c ? '✓' : '✗'} ${label}${extra ? '　' + extra : ''}`);
};

/** 归一化：删注释、把连续空白压成一个空格、去掉首尾分号与空白 */
const norm = (s) =>
  String(s)
    .replace(/--[^\n]*/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/;\s*$/, '')
    .trim()
    .toLowerCase();

const sql = await fs.readFile(path.join(ROOT, 'migrations', '0001_init.sql'), 'utf8');
const fromFile = sql
  .split(';')
  .map(norm)
  .filter(Boolean);

const fromCode = SCHEMA.map(norm);

console.log(`schema.mjs：${fromCode.length} 条语句`);
console.log(`0001_init.sql：${fromFile.length} 条语句\n`);

ok(fromCode.length > 0, 'schema.mjs 里有语句');

// 逐条比对：真源里的每一条都必须能在 .sql 里找到一模一样的
const missing = fromCode.filter((x) => !fromFile.includes(x));
ok(missing.length === 0, 'schema.mjs 的每一条都出现在 0001_init.sql 里', missing.length ? `${missing.length} 条缺失` : `${fromCode.length} 条全中`);
for (const m of missing) console.log(`    ✗ 抄本里找不到：${m.slice(0, 70)}…`);

// 反向：.sql 里不该有 schema.mjs 不知道的语句（否则手工执行会多建东西）
const extra = fromFile.filter((x) => !fromCode.includes(x));
ok(extra.length === 0, '0001_init.sql 里没有 schema.mjs 之外的语句', extra.length ? `${extra.length} 条多余` : '两边一致');
for (const e of extra) console.log(`    ✗ 真源里没有：${e.slice(0, 70)}…`);

// 幂等性：自动建表要能反复跑，所以每条都必须带 IF NOT EXISTS
const notIdempotent = SCHEMA.filter((s) => !/if\s+not\s+exists/i.test(s));
ok(notIdempotent.length === 0, '每条 DDL 都带 IF NOT EXISTS（可以反复执行）', notIdempotent.length ? `${notIdempotent.length} 条会炸` : `${SCHEMA.length} 条`);

// 真跑一遍：用真 SQLite 把 schema.mjs 执行两次，第二次不能报错
let DatabaseSync;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
  const db = new DatabaseSync(':memory:');
  for (const s of SCHEMA) db.prepare(s).run();
  let twiceOk = true;
  try {
    for (const s of SCHEMA) db.prepare(s).run();
  } catch (e) {
    twiceOk = false;
    console.log('    ✗ 第二次执行失败：' + e.message);
  }
  ok(twiceOk, '真 SQLite 上连建两次都不报错（幂等）');

  // 建完之后表要真的能用：插一个用户再读回来
  const ins = db.prepare('INSERT INTO users (email, pw_hash, pw_salt, created_at) VALUES (?, ?, ?, ?)').run('t@t.com', 'h', 's', 1);
  const row = db.prepare('SELECT email, free_used, credits FROM users WHERE id = ?').get(Number(ins.lastInsertRowid));
  ok(row?.email === 't@t.com' && row.free_used === 0 && row.credits === 0, '表能插能读，默认值正确', JSON.stringify(row));
} catch {
  console.log('· 这台机器的 Node 没有 node:sqlite，跳过「真跑一遍」那两条。');
}

console.log('\n' + '─'.repeat(56));
console.log(bad === 0 ? '表结构自证通过：真源与抄本一致，且幂等可执行' : `${bad} 项未通过`);
process.exit(bad === 0 ? 0 : 1);
