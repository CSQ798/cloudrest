// 云卷云舒 · 表结构（唯一的真源）
//
// 为什么把它写成 JS 而不是只留一份 .sql：
//   建表这一步原来是「打开 D1 的 Console，把 migrations/0001_init.sql 整段粘进去执行」。
//   对不写代码的人来说，这是整个部署里最容易出错的一步 —— 粘错、漏粘、
//   或者根本找不到那个 Console。所以现在**站点第一次用到数据库时会自己把表建好**，
//   手工那一步变成「可选的备查路径」。
//
//   Worker 运行时读不到磁盘上的 .sql 文件，所以 DDL 必须以字符串的形式进 bundle。
//   于是真源放在这里，migrations/0001_init.sql 只是它的一份抄本，
//   由 .test/schema-test.mjs 逐句比对，防止两边说法不一致。
//
// 全部用 IF NOT EXISTS：这个函数每次 isolate 启动可能被调用，
// 必须可以反复执行而不会报错。

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    email      TEXT    NOT NULL UNIQUE,
    pw_hash    TEXT    NOT NULL,
    pw_salt    TEXT    NOT NULL,
    created_at INTEGER NOT NULL,
    free_used  INTEGER NOT NULL DEFAULT 0,
    credits    INTEGER NOT NULL DEFAULT 0
  )`,

  `CREATE TABLE IF NOT EXISTS usage_log (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id  INTEGER NOT NULL,
    at       INTEGER NOT NULL,
    kind     TEXT    NOT NULL,
    form     TEXT,
    refunded INTEGER NOT NULL DEFAULT 0
  )`,

  `CREATE TABLE IF NOT EXISTS claims (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    at         INTEGER NOT NULL,
    note       TEXT,
    status     TEXT    NOT NULL DEFAULT 'pending',
    decided_at INTEGER,
    credits    INTEGER
  )`,

  `CREATE TABLE IF NOT EXISTS redeem_codes (
    code       TEXT    PRIMARY KEY,
    credits    INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    used_by    INTEGER,
    used_at    INTEGER,
    note       TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS key_tries (
    ip   TEXT    PRIMARY KEY,
    at   INTEGER NOT NULL,
    n    INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS auth_tries (
    ip   TEXT    PRIMARY KEY,
    at   INTEGER NOT NULL,
    n    INTEGER NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_usage_user  ON usage_log(user_id, at)`,
  `CREATE INDEX IF NOT EXISTS idx_claims_stat ON claims(status, at)`,
];
