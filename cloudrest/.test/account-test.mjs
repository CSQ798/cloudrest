// 账号、额度、密钥、兑换码、付款认领 —— 端到端自证
//
// 这个测试有一个特别的安排：**同一套用例跑两遍**，
// 一遍打内存实现，一遍打 D1 实现（用 node:sqlite 起一个真的 SQLite，
// 把 store.mjs 里那些 SQL 原样喂进去）。
//
// 为什么值得这么做：D1 版的关键逻辑全在 SQL 的 `UPDATE ... WHERE <还有额度>`
// 加 affected rows 上 —— 那句到底会不会超发，只有真跑过 SQLite 才知道。
// 而 node:sqlite 的 `changes` 语义与 D1 一致，所以本地这一遍是有意义的，
// 不是「在内存里模拟一下就算数」。
//
// 注意 node:sqlite 是实验特性，Node 22.5+ 才有。没有它会明确跳过 D1 那轮，
// 不假装跑过了。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createMemoryStore, FREE_LIMIT } from '../server/store.mjs';
import { createD1Store } from '../server/store.mjs';
import { hashPassword, verifyPassword, signSession, verifySession, timingSafeEqual } from '../server/account.mjs';
import { handleAccountRoutes, resolveAccess, chargeOnce, refundOnce, CREDITS_PER_YUAN, COOKIE_SESSION, COOKIE_KEY } from '../server/api-auth.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

let bad = 0;
const ok = (c, label, extra = '') => {
  if (!c) bad++;
  console.log(`  ${c ? '✓' : '✗'} ${label}${extra ? '　' + extra : ''}`);
};

const ENV = { ACCESS_KEY: '798798', SESSION_SECRET: 'test-secret-please-change' };

/* ---------- 把 node:sqlite 包成 D1 的样子 ---------- */
function d1Shim(db) {
  // 与 server/d1-sqlite.mjs 同一套最小子集：既要支持 .bind() 链，
  // 也要支持不带 bind 直接 .run()（自动建表就是这么调用的）
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
      return { ...wrap(sql, []), bind: (...args) => wrap(sql, args) };
    },
  };
}

let DatabaseSyncForTest = null;
async function makeSqliteStore({ migrate = false } = {}) {
  let DatabaseSync;
  try {
    // 注意：这里是**测试文件**，不在 bundle 里，所以可以用动态 import。
    // （worker.mjs / server/ 下面一律不许用 —— 见 .test/bundle-safety-test.mjs）
    ({ DatabaseSync } = await import('node:sqlite'));
    DatabaseSyncForTest = DatabaseSync;
  } catch {
    return null;
  }
  const db = new DatabaseSync(':memory:');
  // 默认**不**手工执行建表脚本：让 createD1Store().ensureSchema() 自己建。
  // 这正是线上第一次跑的真实路径 —— 站长不必去 Console 粘 SQL。
  // （migrations/0001_init.sql 本身由 .test/schema-test.mjs 单独验。）
  if (migrate) db.exec(fs.readFileSync(path.join(ROOT, 'migrations', '0001_init.sql'), 'utf8'));
  return createD1Store(d1Shim(db));
}

/* ---------- 假的请求 ---------- */
function req(method, p, { body, cookies = {}, headers = {} } = {}) {
  const h = { ...headers };
  const jar = Object.entries(cookies)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('; ');
  if (jar) h.cookie = jar;
  if (body !== undefined) h['content-type'] = 'application/json';
  return new Request('https://x.test' + p, {
    method,
    headers: h,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const call = (store, method, p, opts) => handleAccountRoutes({ pathname: p, request: req(method, p, opts), env: ENV, store });

/** 从响应的 Set-Cookie 里抠出 cookie 值 */
function cookieOf(res, name) {
  const raw = res.headers.get('set-cookie') || '';
  const m = new RegExp(`${name}=([^;]*)`).exec(raw);
  return m ? decodeURIComponent(m[1]) : null;
}

/* ============================================================
 * 一套用例，两个后端各跑一遍
 * ============================================================ */
async function suite(label, store) {
  console.log(`\n${'='.repeat(58)}\n${label}\n${'='.repeat(58)}`);

  /* ---- 0. 自动建表：空库也必须能直接用 ---- */
  // 这条对着站长真实的处境：他建了 D1 库、绑上了，但不知道该不该去 Console 粘 SQL。
  // 现在的答案是「不用」—— 站点自己建。所以这里拿一个**完全空**的库来验。
  console.log('\n— 自动建表（空库）—');
  const built = await store.ensureSchema();
  ok(built === true, 'ensureSchema 在空库上成功', store.kind);
  const again = await store.ensureSchema();
  ok(again === true, '再调一次也不报错（幂等）');
  ok((store.schemaError?.() || '') === '', '没有留下 schemaError', store.schemaError?.() || '');

  /* ---- 1. 额度：免费 5 次，然后吃余额 ---- */
  console.log('\n— 额度扣减 —');
  const { salt, hash } = await hashPassword('hunter2!');
  const u = await store.createUser({ email: 'a@b.com', hash, salt });

  const seen = [];
  for (let i = 0; i < FREE_LIMIT + 1; i++) seen.push(await store.spendOne(u.id));
  ok(
    JSON.stringify(seen) === JSON.stringify([...Array(FREE_LIMIT).fill('free'), null]),
    `连续扣 ${FREE_LIMIT + 1} 次：前 ${FREE_LIMIT} 次走免费，第 ${FREE_LIMIT + 1} 次拒绝`,
    seen.join(',')
  );

  const afterFree = await store.getUserById(u.id);
  ok(afterFree.free_used === FREE_LIMIT, `免费计数停在 ${FREE_LIMIT}`, String(afterFree.free_used));

  await store.addCredits(u.id, CREDITS_PER_YUAN);
  const paid = await store.spendOne(u.id);
  ok(paid === 'credits', '充值后改为扣余额', String(paid));
  ok((await store.getUserById(u.id)).credits === CREDITS_PER_YUAN - 1, '余额减 1', String((await store.getUserById(u.id)).credits));

  await store.refundOne(u.id, 'credits');
  ok((await store.getUserById(u.id)).credits === CREDITS_PER_YUAN, '失败退回：余额还原', String((await store.getUserById(u.id)).credits));

  // 并发：一次把余额扣到只剩 1，然后同时发起 5 个扣减，只能成功 1 个
  const u2 = await store.createUser({ email: 'race@b.com', hash, salt });
  for (let i = 0; i < FREE_LIMIT; i++) await store.spendOne(u2.id);
  await store.addCredits(u2.id, 1);
  const race = await Promise.all([0, 1, 2, 3, 4].map(() => store.spendOne(u2.id)));
  ok(race.filter(Boolean).length === 1, '并发扣减：只剩 1 次时 5 个请求只成功 1 个', race.map((x) => x || '-').join(','));

  /* ---- 2. 口令与会话 ---- */
  console.log('\n— 口令与会话 —');
  ok(await verifyPassword('hunter2!', salt, hash), '正确口令通过');
  ok(!(await verifyPassword('hunter2?', salt, hash)), '错误口令不通过');
  ok(!(await verifyPassword('', salt, hash)), '空口令不通过');

  const tok = await signSession({ uid: 7, email: 'a@b.com' }, ENV.SESSION_SECRET);
  const parsed = await verifySession(tok, ENV.SESSION_SECRET);
  ok(parsed?.uid === 7, '会话票据可验签', JSON.stringify(parsed));
  ok((await verifySession(tok, 'wrong-secret')) === null, '换密钥就验不过（签名有效）');
  ok((await verifySession(tok.split('.')[0] + '.AAAA', ENV.SESSION_SECRET)) === null, '改了签名就验不过');
  ok((await verifySession('garbage', ENV.SESSION_SECRET)) === null, '格式不对返回 null');
  const expired = await signSession({ uid: 7, email: 'a@b.com' }, ENV.SESSION_SECRET, Date.now() - 31 * 86400 * 1000);
  ok((await verifySession(expired, ENV.SESSION_SECRET)) === null, '过期票据验不过');
  ok(timingSafeEqual('abc', 'abc') && !timingSafeEqual('abc', 'abd') && !timingSafeEqual('abc', 'abcd'), '定长比较');

  /* ---- 3. 注册 / 登录 / 我 ---- */
  console.log('\n— 注册 · 登录 · /api/me —');
  let r = await call(store, 'POST', '/api/register', { body: { email: 'New@Example.COM', password: 'sixchars' } });
  ok(r.status === 200, '注册成功', String(r.status));
  const cookie1 = cookieOf(r, COOKIE_SESSION);
  ok(Boolean(cookie1), '注册后直接给了会话 Cookie');
  const me1 = await (await call(store, 'GET', '/api/me', { cookies: { [COOKIE_SESSION]: cookie1 } })).json();
  ok(me1.loggedIn && me1.email === 'new@example.com', '邮箱被规范成小写并可读取', me1.email);
  ok(me1.freeLeft === FREE_LIMIT && me1.left === FREE_LIMIT, `新用户可用 ${FREE_LIMIT} 次`, String(me1.left));

  r = await call(store, 'POST', '/api/register', { body: { email: 'new@example.com', password: 'sixchars' } });
  ok(r.status === 409, '重复注册被拒', String(r.status));

  r = await call(store, 'POST', '/api/register', { body: { email: 'bad-email', password: 'sixchars' } });
  ok(r.status === 400, '邮箱格式不对被拒', String(r.status));

  r = await call(store, 'POST', '/api/register', { body: { email: 'x@y.com', password: '123' } });
  ok(r.status === 400, '密码太短被拒', String(r.status));

  r = await call(store, 'POST', '/api/login', { body: { email: 'new@example.com', password: 'wrong' } });
  ok(r.status === 401, '密码错被拒', String(r.status));
  r = await call(store, 'POST', '/api/login', { body: { email: 'nobody@example.com', password: 'sixchars' } });
  ok(r.status === 401, '邮箱不存在也是同一句话（不泄露谁注册过）', String(r.status));
  r = await call(store, 'POST', '/api/login', { body: { email: 'new@example.com', password: 'sixchars' } });
  ok(r.status === 200, '正确密码登录成功', String(r.status));
  const cookie2 = cookieOf(r, COOKIE_SESSION);
  ok(Boolean(cookie2), '登录给了新会话');

  /* ---- 4. 密钥 ---- */
  console.log('\n— 密钥（工具栏那个）—');
  r = await call(store, 'POST', '/api/key', { body: { key: '000000' } });
  ok(r.status === 401, '错密钥被拒', String(r.status));
  r = await call(store, 'POST', '/api/key', { body: { key: '798798' } });
  ok(r.status === 200, '对密钥通过', String(r.status));
  const cookieK = cookieOf(r, COOKIE_KEY);
  ok(Boolean(cookieK), '通过后发了一张密钥凭证 Cookie');

  const anon = await resolveAccess(req('GET', '/api/me', { cookies: { [COOKIE_KEY]: cookieK } }), ENV, store);
  ok(anon.keyValid === true, '带这张 Cookie 就是无限次', JSON.stringify({ key: anon.keyValid, allowed: anon.allowed }));

  const anonBad = await resolveAccess(req('GET', '/api/me', { cookies: { [COOKIE_KEY]: 'forged-value' } }), ENV, store);
  ok(anonBad.keyValid === false, '伪造的密钥凭证无效');

  const noKey = await resolveAccess(req('GET', '/api/me'), ENV, store);
  const gated = await chargeOnce(noKey, store);
  ok(gated.ok === false && gated.status === 401, '没登录又没密钥：扣费被拦（401）', JSON.stringify(gated));

  // 密钥不受额度限制：把免费次数用光，再扣
  const keyUser = await resolveAccess(req('GET', '/api/me', { cookies: { [COOKIE_KEY]: cookieK } }), ENV, store);
  for (let i = 0; i < FREE_LIMIT + 3; i++) {
    const g = await chargeOnce(keyUser, store);
    if (!g.ok) {
      ok(false, '密钥用户不该被额度拦住');
      break;
    }
    if (i === FREE_LIMIT + 2) ok(true, `密钥用户可以一直用（试了 ${FREE_LIMIT + 3} 次都没被拦）`);
  }

  /* ---- 5. 用完之后的提示 ---- */
  console.log('\n— 额度用尽 —');
  const poor = await store.createUser({ email: 'poor@b.com', hash, salt });
  const poorCookie = await signSession({ uid: poor.id, email: 'poor@b.com' }, ENV.SESSION_SECRET);
  const poorAccess0 = await resolveAccess(req('GET', '/api/me', { cookies: { [COOKIE_SESSION]: poorCookie } }), ENV, store);
  for (let i = 0; i < FREE_LIMIT; i++) await chargeOnce(poorAccess0, store);
  const poorAccess = await resolveAccess(req('GET', '/api/me', { cookies: { [COOKIE_SESSION]: poorCookie } }), ENV, store);
  const poorGate = await chargeOnce(poorAccess, store);
  ok(poorGate.ok === false && poorGate.status === 402, '额度用尽返回 402', String(poorGate.status));
  // 站长取消了买额度，所以这里要断言「不再提钱」，并指向角落里那个「小启」。
  ok(!/支付|1 元|10 次/.test(poorGate.error), '提示里不再提钱（买额度已撤掉）', poorGate.error.slice(0, 34) + '…');
  ok(/小启/.test(poorGate.error), '指向页面上那个「小启」标签');

  /* ---- 6. 兑换码 ---- */
  console.log('\n— 兑换码 —');
  r = await call(store, 'POST', '/api/admin/codes', { headers: { 'x-access-key': '798798' }, body: { count: 3, credits: 10, note: '测试' } });
  ok(r.status === 200, '管理员生成 3 个码', String(r.status));
  const codes = (await r.json()).codes;
  ok(codes.length === 3 && /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(codes[0]), '码的格式统一', codes[0]);

  r = await call(store, 'POST', '/api/admin/codes', { body: { count: 3 } });
  ok(r.status === 401, '不带密钥不能生成码', String(r.status));

  r = await call(store, 'POST', '/api/redeem', { cookies: { [COOKIE_SESSION]: cookie2 }, body: { code: codes[0] } });
  ok(r.status === 200, '登录用户可以兑换', String(r.status));
  const red = await r.json();
  ok(red.credits === 10, '兑换得到 10 次', String(red.credits));

  r = await call(store, 'POST', '/api/redeem', { cookies: { [COOKIE_SESSION]: cookie2 }, body: { code: codes[0] } });
  ok(r.status === 400, '同一个码不能用两次', String(r.status));
  r = await call(store, 'POST', '/api/redeem', { cookies: { [COOKIE_SESSION]: cookie2 }, body: { code: 'AAAA-BBBB-CCCC' } });
  ok(r.status === 400, '不存在的码被拒', String(r.status));
  r = await call(store, 'POST', '/api/redeem', { body: { code: codes[1] } });
  ok(r.status === 401, '没登录不能兑换', String(r.status));

  /* ---- 7. 付款认领 → 管理员通过 ---- */
  console.log('\n— 付款认领（个人收款码只能人工确认，见 DEPLOY 说明）—');
  r = await call(store, 'POST', '/api/claim', { cookies: { [COOKIE_SESSION]: cookie2 }, body: { note: '20:31 微信 1 元，尾号 4321' } });
  ok(r.status === 200, '用户提交认领', String(r.status));

  r = await call(store, 'GET', '/api/admin/claims', { headers: { 'x-access-key': '798798' } });
  const pending = (await r.json()).claims;
  ok(pending.length >= 1, '管理员看到待审列表', `${pending.length} 条`);
  ok(pending.some((c) => c.note && c.note.includes('4321')), '备注带过来了（站长据此核对到账）');

  const before = (await store.getUserById((await store.getUserByEmail('new@example.com')).id)).credits;
  r = await call(store, 'POST', '/api/admin/claims', {
    headers: { 'x-access-key': '798798' },
    body: { id: pending[0].id, approve: true, credits: 10 },
  });
  ok(r.status === 200, '管理员点通过', String(r.status));
  const after = (await store.getUserById((await store.getUserByEmail('new@example.com')).id)).credits;
  ok(after === before + 10, '通过后额度到账（+10）', `${before} → ${after}`);

  r = await call(store, 'POST', '/api/admin/claims', { headers: { 'x-access-key': '798798' }, body: { id: pending[0].id, approve: true } });
  ok(r.status === 404, '同一条不能审两次', String(r.status));

  /* ---- 8. 限速 ---- */
  console.log('\n— 密钥爆破的限速 —');
  let limited = false;
  for (let i = 0; i < 40 && !limited; i++) {
    const rr = await call(store, 'POST', '/api/key', { body: { key: String(100000 + i) } });
    if (rr.status === 429) limited = true;
  }
  ok(limited, '连续猜错密钥会被限速（429）');
}

/* ---------- 跑 ---------- */
await suite('第一轮：内存实现', createMemoryStore());

const sqliteStore = await makeSqliteStore();
if (sqliteStore) {
  await suite(`第二轮：D1 实现（真 SQLite 跑 store.mjs 里的 SQL）`, sqliteStore);
} else {
  console.log('\n· 这台机器的 Node 没有 node:sqlite（需要 22.5+），跳过 D1 那一轮。');
  console.log('  注意：这意味着 D1 版的 SQL 这一轮**没有**被验证，不要当成跑过了。');
}

/* ---------- 9. 没绑数据库时必须拦住，而不是悄悄放行 ---------- */
// 这一条是被真实反馈打出来的：第一版「没绑库就一律放行」，
// 结果站长看到「额度未启用」却以为限额开着，而所有人都无限次。
console.log('\n— 没绑 D1 时（store = null）—');
{
  const none = null;
  const noDb = await resolveAccess(req('GET', '/api/me'), ENV, none);
  ok(noDb.accountsEnabled === false, 'accountsEnabled = false');
  ok(noDb.allowed === false, '没登录没密钥时**不允许**（第一版这里是放行的）');
  const g = await chargeOnce(noDb, none);
  ok(g.ok === false && g.status === 503, '扣费返回 503 并说明原因', String(g.status));
  // 这句话是给**访客**看的，所以不许出现 D1 / 绑定 / 变量名 这类词 ——
  // 站长看了说「看不懂」，而且访客也不该看到这站的内部缺什么。
  ok(!/D1|绑定|变量名|数据库/.test(g.error), '访客看到的提示里不含任何术语', g.error.slice(0, 26) + '…');
  ok(/小启/.test(g.error), '指向页面上那个「小启」标签（那里有站长邮箱）');

  // 但有密钥的人还能用 —— 站长自己得进得去
  const withKey = await resolveAccess(req('GET', '/api/me', { cookies: { [COOKIE_KEY]: 'x' } }), ENV, none);
  ok(withKey.keyValid === false, '伪造的密钥凭据不算数');
  const r2 = await call(none, 'GET', '/api/me');
  ok(r2.status === 200 && (await r2.json()).accounts === false, '/api/me 如实报告 accounts=false');
}

console.log('\n' + '─'.repeat(58));
console.log(bad === 0 ? '账号与额度系统全部通过' : `${bad} 项未通过`);
process.exit(bad === 0 ? 0 : 1);
