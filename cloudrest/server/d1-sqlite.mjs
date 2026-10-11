// 云卷云舒 · 本地把 node:sqlite 伪装成 D1（**只有 Node 会 import 它**）
//
// 为什么这么做，而不是写个 JSON 文件存储：
//   线上额度的关键逻辑全在 store.mjs 那几句 SQL 上 ——
//   尤其是 `UPDATE users SET free_used = free_used + 1 WHERE id = ? AND free_used < 5`
//   加 affected rows 判断。这套东西**只有真跑过 SQL 才算验过**。
//   而 node:sqlite 的 `.run().changes` 语义与 D1 一致，所以本地这一遍是有意义的，
//   不是「在内存里模拟一下」。
//
// 于是本地开发与线上跑的是同一段 SQL、同一个 store 实现，只有底层引擎不同。
//
// ⚠ 这个文件里出现了 `node:sqlite`，所以**绝不能**被 worker.mjs / pages-entry.mjs
//   那条链 import —— 一进 bundle 就打成 workerd 解析不了的产物。
//   .test/bundle-safety-test.mjs 会把这条规矩当硬检查。
//
// node:sqlite 是实验特性，需要 Node 22.5+。没有它会明确抛错，不静默降级 ——
// 静默降级会让人以为「本地测过了」，其实测的是另一套东西。

import fs from 'node:fs';
import path from 'node:path';

export async function d1FromSqlite({ file, migrations }) {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import('node:sqlite'));
  } catch {
    throw new Error(
      '这台机器的 Node 没有 node:sqlite（需要 22.5+），本地无法模拟 D1。\n' +
        '升级 Node，或把 env.DB 留空来跳过账号功能（线上仍用真 D1）。'
    );
  }

  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  for (const m of migrations) {
    db.exec(fs.readFileSync(m, 'utf8'));
  }

  // D1 的最小可用子集：prepare(sql).bind(...).first()/all()/run()
  // 也要支持不带 bind 直接 .run() —— store.ensureSchema() 就是这么建表的
  const wrap = (sql, args) => ({
    async first() {
      return db.prepare(sql).get(...args) ?? null;
    },
    async all() {
      return { results: db.prepare(sql).all(...args) };
    },
    async run() {
      const r = db.prepare(sql).run(...args);
      return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
    },
  });

  return {
    prepare(sql) {
      return {
        ...wrap(sql, []),
        bind: (...args) => wrap(sql, args),
      };
    },
    /** 仅供本地查看/清理，线上 D1 没有这个 */
    __sqlite: db,
  };
}
