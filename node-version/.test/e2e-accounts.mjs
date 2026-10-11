// 账号 + 额度 + 密钥 + 兑换 + 认领：走真实 HTTP 的端到端验收
//
// 与 account-test.mjs 的分工：
//   account-test.mjs  直接调 store / 路由函数，快，覆盖分支多
//   这个脚本          起真服务、发真请求、带真 Cookie，验证「拼起来是通的」
//
// 用法（先起服务）：
//   node .test/serve-local.mjs 8791
//   node .test/e2e-accounts.mjs http://127.0.0.1:8791
//
// 只做**一次**真实成诗 —— 每一次都要花钱调模型，其余都靠直接改库把场景造出来。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = (process.argv[2] || 'http://127.0.0.1:8791').replace(/\/$/, '');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DB_FILE = path.join(ROOT, '.local-data', 'qiyun.sqlite');
const ACCESS_KEY = process.env.ACCESS_KEY || '798798';

let bad = 0;
const ok = (c, label, extra = '') => {
  if (!c) bad++;
  console.log(`  ${c ? '✓' : '✗'} ${label}${extra ? '　' + extra : ''}`);
};

/* ---------- 一个最小的 Cookie 罐 ---------- */
const jar = new Map();
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');

async function call(method, p, body, extraHeaders = {}) {
  const headers = { ...extraHeaders };
  if (jar.size) headers.cookie = cookieHeader();
  if (body !== undefined) headers['content-type'] = 'application/json';
  const r = await fetch(BASE + p, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(180000),
  });
  const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')].filter(Boolean);
  for (const c of set) {
    const [kv] = String(c).split(';');
    const i = kv.indexOf('=');
    const name = kv.slice(0, i).trim();
    const val = decodeURIComponent(kv.slice(i + 1).trim());
    if (!val) jar.delete(name);
    else jar.set(name, val);
  }
  const text = await r.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* 不是 JSON（静态页或流） */
  }
  return { status: r.status, text, json, headers: r.headers };
}

/* ---------- 直接改库，用来造场景（不改服务） ---------- */
async function withDb(fn) {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(DB_FILE);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}
const setFreeUsed = (email, n) => withDb((db) => db.prepare('UPDATE users SET free_used = ? WHERE email = ?').run(n, email));
const creditsOf = (email) => withDb((db) => db.prepare('SELECT credits, free_used FROM users WHERE email = ?').get(email));

const email = `e2e-${Date.now()}@test.local`;

console.log(`目标：${BASE}\n`);

/* ---------- 1. 健康检查：账号功能开没开 ---------- */
console.log('— 服务状态 —');
let r = await call('GET', '/api/health');
ok(r.status === 200, '/api/health 可达', String(r.status));
ok(r.json?.accounts === true, '账号与额度已启用（本地接了 SQLite）', JSON.stringify({ accounts: r.json?.accounts, sessionReady: r.json?.sessionReady }));
if (r.json?.accounts !== true) {
  console.log('\n账号功能没启用，后面的用例没法跑。先确认 .local-data/qiyun.sqlite 建起来了。');
  process.exit(1);
}
ok(r.json?.keyReady === true, 'DeepSeek 密钥就绪');

/* ---------- 2. 没登录：拦住 ---------- */
console.log('\n— 未登录 —');
r = await call('POST', '/api/compose', { scene: '窗外的梧桐叶落了一地。', form: '五言绝句', mode: 'compose' });
ok(r.status === 401, '未登录成诗被拦（401）', String(r.status));
ok(/注册|密钥/.test(r.json?.error || ''), '提示里给了两条出路', (r.json?.error || '').slice(0, 30) + '…');
r = await call('POST', '/api/choose', { scene: '窗外的梧桐叶落了一地。' });
ok(r.status === 401, '未登录择体也被拦（不给白蹭模型）', String(r.status));

/* ---------- 3. 注册 ---------- */
console.log('\n— 注册 —');
r = await call('POST', '/api/register', { email, password: 'e2e-pass-123' });
ok(r.status === 200, '注册成功', String(r.status));
ok(jar.has('qy_session'), '拿到了会话 Cookie');
r = await call('GET', '/api/me');
ok(r.json?.loggedIn === true && r.json?.email === email, '/api/me 认出身份', r.json?.email);
ok(r.json?.freeLeft === 5 && r.json?.left === 5, '新账号 5 次免费', `freeLeft=${r.json?.freeLeft}`);

/* ---------- 4. 密钥 ---------- */
console.log('\n— 密钥 —');
r = await call('POST', '/api/key', { key: '123456' });
ok(r.status === 401, '错密钥被拒', String(r.status));
r = await call('POST', '/api/key', { key: ACCESS_KEY });
ok(r.status === 200, '对密钥通过', String(r.status));
r = await call('GET', '/api/me');
ok(r.json?.unlimited === true && r.json?.left === -1, '密钥 = 不限次', JSON.stringify({ key: r.json?.key, left: r.json?.left }));

/* ---------- 5. 真成一首（密钥身份，不扣次数） ---------- */
console.log('\n— 真成一首（唯一一次花钱的调用）—');
const t0 = Date.now();
r = await fetch(BASE + '/api/compose', {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie: cookieHeader() },
  body: JSON.stringify({ scene: '傍晚在江边散步，风把水面的灯影吹碎了。', form: '浣溪沙', mode: 'compose' }),
  signal: AbortSignal.timeout(300000),
});
ok(r.status === 200, 'compose 返回 200', String(r.status));
ok((r.headers.get('content-type') || '').includes('ndjson'), '是 NDJSON 流');
const reader = r.body.getReader();
const dec = new TextDecoder();
let buf = '';
let result = null;
let usage = null;
let err = null;
for (;;) {
  const { value, done } = await reader.read();
  if (done) break;
  buf += dec.decode(value, { stream: true });
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    const ev = JSON.parse(line);
    if (ev.type === 'result') result = ev;
    else if (ev.type === 'usage') usage = ev;
    else if (ev.type === 'error') err = ev.message;
  }
}
ok(Boolean(result) && !err, '拿到了成诗结果', err ? `错误：${err}` : `${Date.now() - t0}ms`);
ok(Boolean(usage) && usage.left === -1, '成诗后回报「不限次」', JSON.stringify(usage));
if (result) {
  console.log(`\n    〔${result.title}〕<${result.form}>`);
  for (const l of result.body.split('\n').filter(Boolean)) console.log('      ' + l);
}

/* ---------- 6. 去掉密钥，免费次数用光 → 402 ---------- */
console.log('\n— 免费次数用光 —');
r = await call('DELETE', '/api/key');
ok(r.status === 200, '清掉了密钥', String(r.status));
r = await call('GET', '/api/me');
ok(r.json?.key === false, '回到普通用户身份');

await setFreeUsed(email, 5);
r = await call('GET', '/api/me');
ok(r.json?.left === 0, '把免费次数改成已用完', `left=${r.json?.left}`);
r = await call('POST', '/api/compose', { scene: '窗外的梧桐叶落了一地。', form: '五言绝句', mode: 'compose' });
ok(r.status === 402, '再成诗被拦（402）', String(r.status));
ok(!/支付|1 元|10 次/.test(r.json?.error || ''), '提示里不再提钱（买额度已撤掉）', (r.json?.error || '').slice(0, 40) + '…');
ok(/小启/.test(r.json?.error || ''), '指向页面上那个「小启」标签');

/* ---------- 7. 兑换码 ---------- */
console.log('\n— 兑换码 —');
r = await call('POST', '/api/admin/codes', { count: 2, credits: 10, note: 'e2e' }, { 'x-access-key': ACCESS_KEY });
ok(r.status === 200, '站长生成兑换码', String(r.status));
const code = r.json.codes[0];
r = await call('POST', '/api/admin/codes', { count: 1 }, { 'x-access-key': '000000' });
ok(r.status === 401, '错口令不能生成', String(r.status));
r = await call('POST', '/api/redeem', { code });
ok(r.status === 200, '用户兑换成功', r.json?.message);
ok((await creditsOf(email)).credits === 10, '库里余额变成 10', JSON.stringify(await creditsOf(email)));
r = await call('POST', '/api/redeem', { code });
ok(r.status === 400, '同码不能重复兑换', String(r.status));
r = await call('GET', '/api/me');
ok(r.json?.left === 10, '此时可用次数 = 余额 10', `left=${r.json?.left}`);

/* ---------- 8. 付款认领 → 站长确认 ---------- */
console.log('\n— 付款认领 —');
r = await call('POST', '/api/claim', { note: 'e2e 20:31 微信 1 元' });
ok(r.status === 200, '用户提交认领', String(r.status));
r = await call('GET', '/api/admin/claims', undefined, { 'x-access-key': ACCESS_KEY });
const mine = (r.json?.claims || []).filter((c) => c.email === email);
ok(mine.length === 1, '站长在待审列表里看到它', `${mine.length} 条`);
r = await call('POST', '/api/admin/claims', { id: mine[0].id, approve: true, credits: 10 }, { 'x-access-key': ACCESS_KEY });
ok(r.status === 200, '站长点通过', String(r.status));
ok((await creditsOf(email)).credits === 20, '额度到账（10 → 20）', JSON.stringify(await creditsOf(email)));

/* ---------- 9. 静态页面 ---------- */
console.log('\n— 前端页面 —');
for (const [p, needle] of [
  ['/', 'tbAsk'], // 小启的入口在工具栏上
  ['/fx.js', 'data-spot'], // 鼠标柔光那一层
  ['/account.js', 'QYAccount'],
  ['/admin.html', '兑换码'],
]) {
  const rr = await fetch(BASE + p, { signal: AbortSignal.timeout(20000) });
  const t = await rr.text();
  ok(rr.status === 200 && (!needle || t.includes(needle)), `${p} 可访问`, `${rr.status}　${t.length} 字节`);
}

console.log('\n' + '─'.repeat(58));
console.log(bad === 0 ? '端到端全部通过' : `${bad} 项未通过`);
process.exit(bad === 0 ? 0 : 1);
