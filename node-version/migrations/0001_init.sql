-- 栖云 · 账号与额度的表结构（Cloudflare D1 / SQLite）
--
-- 为什么要落库：额度必须**跨请求、跨实例**算数。
-- Workers 是无状态的，同一个用户的下一次请求可能落在另一个实例上，
-- 内存里记的计数下一秒就没了。所以免费次数、充值额度、兑换码、付款认领
-- 全部放 D1（SQLite），靠单条 UPDATE 的原子性保证不超发。
--
-- 建库（三选一，从省事到麻烦）：
--   1) 控制台：Storage & Databases → D1 → Create → 名字填 qiyun
--      然后 Workers & Pages → cloudrest → Settings → Functions
--      → D1 database bindings → 变量名填 DB，选刚建的库
--   2) 命令行：npx wrangler d1 create qiyun
--      再 npx wrangler d1 execute qiyun --remote --file=./migrations/0001_init.sql
--   3) 本地调试：node .test/serve-local.mjs 用的是文件存储，不需要 D1

CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT    NOT NULL UNIQUE,
  pw_hash    TEXT    NOT NULL,
  pw_salt    TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  -- 已经用掉的免费次数。免费额度是 FREE_LIMIT（现在是 5），写成列而不是常量表，
  -- 是为了以后改额度时老用户不会被追溯扣掉。
  free_used  INTEGER NOT NULL DEFAULT 0,
  -- 充值余额（次）。每支付 1 元加 10。
  credits    INTEGER NOT NULL DEFAULT 0
);

-- 每次真正成诗记一条。用途有两个：对账，以及以后排查「为什么我的次数少了」。
CREATE TABLE IF NOT EXISTS usage_log (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  at      INTEGER NOT NULL,
  kind    TEXT    NOT NULL,          -- compose / refine
  form    TEXT,
  refunded INTEGER NOT NULL DEFAULT 0
);

-- 付款认领：用户说「我付了 1 元」，等站长确认。
-- 个人收款码没有任何回调，所以这一步只能是人来确认 —— 见 DEPLOY 文档里的说明。
CREATE TABLE IF NOT EXISTS claims (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  at         INTEGER NOT NULL,
  note       TEXT,                   -- 用户自己填的备注（付款时间、单号后几位等）
  status     TEXT    NOT NULL DEFAULT 'pending',   -- pending / approved / rejected
  decided_at INTEGER,
  credits    INTEGER
);

-- 兑换码：站长先批量生成，收款后把码给用户。适合「不想每次手动审批」的玩法。
CREATE TABLE IF NOT EXISTS redeem_codes (
  code       TEXT    PRIMARY KEY,
  credits    INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  used_by    INTEGER,
  used_at    INTEGER,
  note       TEXT
);

-- 密钥尝试次数（按 IP）。密钥只有 6 位，不限速能被穷举。
CREATE TABLE IF NOT EXISTS key_tries (
  ip   TEXT    PRIMARY KEY,
  at   INTEGER NOT NULL,
  n    INTEGER NOT NULL
);

-- 登录/注册的频率限制，同样按 IP。
CREATE TABLE IF NOT EXISTS auth_tries (
  ip   TEXT    PRIMARY KEY,
  at   INTEGER NOT NULL,
  n    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_usage_user  ON usage_log(user_id, at);
CREATE INDEX IF NOT EXISTS idx_claims_stat ON claims(status, at);
