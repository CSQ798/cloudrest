// 云卷云舒 · 账号、额度与付费认领的接口
//
// 规则（按站长定的）：
//   · 注册用户免费 5 次
//   · 工具栏里输入密钥（默认 798798）→ 无限次
//   · 每次支付 1 元可再得 10 次
//
// 关于「能不能自动识别用户扫码付款」——
// **不能**。个人微信收款码没有任何回调，微信不会通知任何服务器。
// 想要自动到账，只有拿到微信支付商户号（要有营业执照）才有 API 与回调。
// 所以这里做成两条**诚实**的路径：
//
//   1. 兑换码（推荐）：站长先批量生成一批码，收到钱以后把码发给对方。
//      用户在「兑换码」框里填，立刻到账。站长的工作量是复制粘贴一次。
//   2. 付款认领：用户点「我已支付 1 元」并留一句备注（付款时间/单号后几位），
//      进入待审列表；站长在 admin.html 里点一下「通过」，额度立刻到账。
//
// 两条路都不需要商户号，也不需要任何第三方「码支付」服务。
// （第三方码支付平台多数在灰产地带、随时跑路，不建议用。）
//
// 邮件的部分：**不发邮件**。注册只要邮箱 + 密码，不做邮箱验证，
// 因为发信需要一个外部服务（Resend/SendGrid 之类），本站没有。
// 代价写在 README 的已知局限里：邮箱不验证 = 邮箱只是账号名，
// 也意味着「忘记密码」暂时没有自助找回的路。

import {
  THROTTLE,
  checkPassword,
  cleanEmail,
  clientIp,
  cookieHeader,
  hashPassword,
  readCookie,
  signSession,
  timingSafeEqual,
  toB64u,
  verifyPassword,
  verifySession,
} from './account.mjs';
import { FREE_LIMIT } from './store.mjs';

export const COOKIE_SESSION = 'qy_session';
export const COOKIE_KEY = 'qy_key';
export const CREDITS_PER_YUAN = 10; // 每支付 1 元得 10 次

const DEFAULT_ACCESS_KEY = '798798';

export function accessKey(env) {
  return String(env.ACCESS_KEY || DEFAULT_ACCESS_KEY);
}
export function sessionSecret(env) {
  return String(env.SESSION_SECRET || '');
}

/**
 * 密钥 Cookie 的值：HMAC(ACCESS_KEY, 固定串)。
 * 用 ACCESS_KEY 本身当 HMAC 密钥就够了 —— 想伪造这个 Cookie 就得先知道密钥，
 * 而我们本来就是在验证「你知道密钥吗」。这样密钥这条路不依赖 SESSION_SECRET，
 * 站长只配一个 ACCESS_KEY 也能用。
 *
 * 导出是为了让测试能自己造一张合法的凭据（测「密钥不限次」这条路），
 * 生产代码里只有本模块用得到。
 */
export async function keyCookieValue(env) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(accessKey(env)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toB64u(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode('qiyun-access-v1')));
}

/** 解析这一次请求的身份与权限。不写任何东西，纯读。 */
export async function resolveAccess(request, env, store) {
  const accountsEnabled = Boolean(store && store.persistent);

  // 密钥（不需要登录）
  let keyValid = false;
  const kc = readCookie(request, COOKIE_KEY);
  if (kc) keyValid = timingSafeEqual(kc, await keyCookieValue(env));

  // 会话
  let user = null;
  let session = null;
  const secret = sessionSecret(env);
  if (secret) {
    const tok = readCookie(request, COOKIE_SESSION);
    if (tok) {
      session = await verifySession(tok, secret);
      if (session && accountsEnabled) user = await store.getUserById(session.uid);
    }
  }

  const left = user ? Math.max(0, FREE_LIMIT - user.free_used) + Math.max(0, user.credits) : 0;
  // 没绑数据库时**只有密钥**能过。第一版这里是「没绑库就一律放行」，
  // 结果是：站长看到「额度未启用」却以为限额开着，而所有人都无限次 ——
  // 正是「次数限制没落实」的根因。宁可拦住并说清楚，也不静默放行。
  const allowed = keyValid || (accountsEnabled && Boolean(user) && left > 0);
  return {
    keyValid,
    user,
    session,
    accountsEnabled,
    sessionReady: Boolean(secret),
    /** 还能不能用 */
    allowed,
    freeLeft: user ? Math.max(0, FREE_LIMIT - user.free_used) : 0,
    credits: user ? Math.max(0, user.credits) : 0,
  };
}

/** 概要信息，给 /api/health 与 /api/me 用 */
export function accessSummary(access) {
  return {
    accounts: access.accountsEnabled,
    sessionReady: access.sessionReady,
    loggedIn: Boolean(access.user),
    email: access.user ? access.user.email : null,
    key: access.keyValid,
    unlimited: access.keyValid,
    freeLimit: FREE_LIMIT,
    freeLeft: access.freeLeft,
    credits: access.credits,
    left: access.keyValid ? -1 : access.freeLeft + access.credits,
  };
}

/**
 * 这次请求该不该放行？（只看，不扣）
 * @returns {null | {status:number, error:string}} null 表示放行
 */
export function denyReason(access) {
  if (access.keyValid) return null;
  if (!access.accountsEnabled) {
    // 没绑数据库就没法记账，也就没法守「免费 5 次」这条线。
    // 这时候**不能放行** —— 放行等于对外承诺了一个守不住的额度。
    //
    // 措辞注意：这句话是给**访客**看的，别在里面讲 D1、绑定、变量名。
    // 那些是站长要解决的事，写在页面顶部那条只有站长看得到的告警条里。
    return {
      status: 503,
      error: '这个站暂时还不能写诗：额度功能还没配好。想要一把可以一直用的钥匙，请看页面右下角那个「小启」。',
    };
  }
  if (!access.user) {
    return {
      status: 401,
      error: '还没有登录。注册一个账号就有 5 次免费；想要一直用下去，请看页面右下角那个「小启」。',
    };
  }
  if (access.freeLeft + access.credits <= 0) {
    return {
      status: 402,
      error: `免费次数已用完（每个账号 ${FREE_LIMIT} 次）。想要一直用下去，请看页面右下角那个「小启」。`,
    };
  }
  return null;
}

/**
 * 为一次成诗扣额度。
 * @returns {{ok:true, charged:'free'|'credits'|null} | {ok:false, status:number, error:string}}
 */
export async function chargeOnce(access, store) {
  const deny = denyReason(access);
  if (deny) return { ok: false, ...deny };
  if (access.keyValid) return { ok: true, charged: null }; // 密钥：无限次
  const charged = await store.spendOne(access.user.id);
  if (!charged) {
    // 理论到不了这儿（denyReason 已经查过），但并发下可能刚好被别人扣走最后一次
    return { ok: false, status: 402, error: `免费次数已用完（每个账号 ${FREE_LIMIT} 次）。` };
  }
  return { ok: true, charged };
}

export async function refundOnce(access, store, charged) {
  if (!charged || !access.user || !store) return;
  try {
    await store.refundOne(access.user.id, charged);
  } catch {
    /* 退款失败不该再把错误抛给用户 */
  }
}

/* ============================================================
 * 路由
 * ============================================================ */

const json = (status, obj, headers = {}) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

/**
 * 处理账号相关的接口。
 * @returns {Promise<Response|null>} null 表示这个路径不归它管
 */
export async function handleAccountRoutes(ctx) {
  const { pathname, request, env, store } = ctx;
  if (!pathname.startsWith('/api/')) return null;

  const P = pathname;

  /* ---------- 当前身份 ---------- */
  if (P === '/api/me' && request.method === 'GET') {
    const access = await resolveAccess(request, env, store);
    return json(200, accessSummary(access));
  }

  /* ---------- 注册 ---------- */
  if (P === '/api/register' && request.method === 'POST') {
    if (!store?.persistent) return json(503, { error: '账号功能未启用：还没有绑定 D1 数据库。' });
    const secret = sessionSecret(env);
    if (!secret) return json(503, { error: '服务端还没设置 SESSION_SECRET，无法安全地签发登录状态。' });

    const ip = clientIp(request);
    const gate = await store.bumpTry('auth_tries', ip, THROTTLE.auth);
    if (!gate.allowed) return json(429, { error: THROTTLE.auth.msg });

    const body = await readJson(request);
    const email = cleanEmail(body.email);
    if (!email) return json(400, { error: '邮箱格式不对' });
    const pwErr = checkPassword(body.password);
    if (pwErr) return json(400, { error: pwErr });

    const exists = await store.getUserByEmail(email);
    if (exists) return json(409, { error: '这个邮箱已经注册过了，直接登录吧' });

    const { salt, hash } = await hashPassword(body.password);
    let user;
    try {
      user = await store.createUser({ email, hash, salt });
    } catch (e) {
      if (e?.code === 'DUPLICATE') return json(409, { error: '这个邮箱已经注册过了，直接登录吧' });
      throw e;
    }
    const token = await signSession({ uid: user.id, email }, secret);
    // 刚注册的用户：免费次数是满的，密钥当然还没应用
    const fresh = {
      accounts: true,
      sessionReady: true,
      loggedIn: true,
      email: user.email,
      key: false,
      unlimited: false,
      freeLimit: FREE_LIMIT,
      freeLeft: FREE_LIMIT,
      credits: 0,
      left: FREE_LIMIT,
      pay: { yuan: 1, credits: CREDITS_PER_YUAN },
    };
    return json(200, { ok: true, ...fresh }, { 'Set-Cookie': cookieHeader(COOKIE_SESSION, token) });
  }

  /* ---------- 登录 ---------- */
  if (P === '/api/login' && request.method === 'POST') {
    if (!store?.persistent) return json(503, { error: '账号功能未启用：还没有绑定 D1 数据库。' });
    const secret = sessionSecret(env);
    if (!secret) return json(503, { error: '服务端还没设置 SESSION_SECRET，无法安全地签发登录状态。' });

    const ip = clientIp(request);
    const gate = await store.bumpTry('auth_tries', ip, THROTTLE.auth);
    if (!gate.allowed) return json(429, { error: THROTTLE.auth.msg });

    const body = await readJson(request);
    const email = cleanEmail(body.email);
    const user = email ? await store.getUserByEmail(email) : null;
    // 邮箱不存在与密码错给同一句话，不告诉外面哪个邮箱注册过
    const bad = { error: '邮箱或密码不对' };
    if (!user) return json(401, bad);
    if (!(await verifyPassword(String(body.password || ''), user.pw_salt, user.pw_hash))) return json(401, bad);

    const token = await signSession({ uid: user.id, email: user.email }, secret);
    return json(
      200,
      {
        ok: true,
        accounts: true,
        sessionReady: true,
        loggedIn: true,
        email: user.email,
        key: false,
        unlimited: false,
        freeLimit: FREE_LIMIT,
        freeLeft: Math.max(0, FREE_LIMIT - user.free_used),
        credits: Math.max(0, user.credits),
        left: Math.max(0, FREE_LIMIT - user.free_used) + Math.max(0, user.credits),
        pay: { yuan: 1, credits: CREDITS_PER_YUAN },
      },
      { 'Set-Cookie': cookieHeader(COOKIE_SESSION, token) }
    );
  }

  /* ---------- 退出 ---------- */
  if (P === '/api/logout' && request.method === 'POST') {
    return json(200, { ok: true }, { 'Set-Cookie': cookieHeader(COOKIE_SESSION, '', { maxAge: 0 }) });
  }

  /* ---------- 输入 / 清除密钥 ---------- */
  if (P === '/api/key' && request.method === 'POST') {
    const ip = clientIp(request);
    const gate = store?.persistent
      ? await store.bumpTry('key_tries', ip, THROTTLE.key)
      : { allowed: true };
    if (!gate.allowed) return json(429, { error: THROTTLE.key.msg });

    const body = await readJson(request);
    if (!timingSafeEqual(String(body.key || '').trim(), accessKey(env))) {
      return json(401, { error: '密钥不对' });
    }
    const value = await keyCookieValue(env);
    return json(200, { ok: true, key: true, unlimited: true, left: -1 }, { 'Set-Cookie': cookieHeader(COOKIE_KEY, value) });
  }
  if (P === '/api/key' && request.method === 'DELETE') {
    return json(200, { ok: true, key: false }, { 'Set-Cookie': cookieHeader(COOKIE_KEY, '', { maxAge: 0 }) });
  }

  /* ---------- 兑换码 ---------- */
  if (P === '/api/redeem' && request.method === 'POST') {
    const access = await resolveAccess(request, env, store);
    if (!access.user) return json(401, { error: '请先登录再兑换' });
    const body = await readJson(request);
    const code = String(body.code || '').trim().toUpperCase();
    if (!code) return json(400, { error: '请填兑换码' });
    const r = await store.redeem(code, access.user.id);
    if (!r.ok) return json(400, { error: r.reason });
    return json(200, { ok: true, credits: r.credits, balance: r.balance, message: `兑换成功，得到 ${r.credits} 次` });
  }

  /* ---------- 付款认领 ---------- */
  if (P === '/api/claim' && request.method === 'POST') {
    const access = await resolveAccess(request, env, store);
    if (!access.user) return json(401, { error: '请先登录再提交付款信息' });
    const body = await readJson(request);
    const note = String(body.note || '').slice(0, 200);
    const id = await store.createClaim(access.user.id, note);
    return json(200, {
      ok: true,
      id,
      message: '已提交。站长核对到账后会给你加额度（1 元 = 10 次）。',
    });
  }
  if (P === '/api/my/claims' && request.method === 'GET') {
    const access = await resolveAccess(request, env, store);
    if (!access.user) return json(401, { error: '请先登录' });
    const pending = (await store.listClaims('pending')).filter((c) => c.user_id === access.user.id);
    const approved = (await store.listClaims('approved')).filter((c) => c.user_id === access.user.id);
    return json(200, { ok: true, pending, approved, usage: await store.listUsage(access.user.id, 20) });
  }

  /* ---------- 管理（用同一个密钥，站长自己知道） ---------- */
  if (P.startsWith('/api/admin/')) {
    const ip = clientIp(request);
    const gate = store?.persistent ? await store.bumpTry('key_tries', ip, THROTTLE.key) : { allowed: true };
    if (!gate.allowed) return json(429, { error: THROTTLE.key.msg });

    // 管理接口认两样：请求头里的密钥，或已经验过的密钥 Cookie
    const given = request.headers.get('x-access-key') || '';
    const kc = readCookie(request, COOKIE_KEY);
    const isAdmin = timingSafeEqual(String(given), accessKey(env)) || (kc && timingSafeEqual(kc, await keyCookieValue(env)));
    if (!isAdmin) return json(401, { error: '需要密钥' });
    if (!store?.persistent) return json(503, { error: '还没有绑定 D1 数据库' });

    if (P === '/api/admin/claims' && request.method === 'GET') {
      const status = new URL(request.url).searchParams.get('status') || 'pending';
      return json(200, { ok: true, claims: await store.listClaims(status) });
    }
    if (P === '/api/admin/claims' && request.method === 'POST') {
      const body = await readJson(request);
      const id = Number(body.id);
      const credits = Number(body.credits) || CREDITS_PER_YUAN;
      const uid = await store.decideClaim(id, Boolean(body.approve), credits);
      if (uid == null) return json(404, { error: '没有这条待审记录（可能已经处理过了）' });
      return json(200, { ok: true, userId: uid, credits: body.approve ? credits : 0 });
    }
    if (P === '/api/admin/codes' && request.method === 'GET') {
      return json(200, { ok: true, codes: await store.listCodes(100) });
    }
    if (P === '/api/admin/codes' && request.method === 'POST') {
      const body = await readJson(request);
      const count = Math.min(200, Math.max(1, Number(body.count) || 10));
      const credits = Math.min(1000, Math.max(1, Number(body.credits) || CREDITS_PER_YUAN));
      const list = Array.from({ length: count }, () => ({ code: makeCode(), credits, note: String(body.note || '').slice(0, 60) }));
      await store.createCodes(list);
      return json(200, { ok: true, credits, codes: list.map((c) => c.code) });
    }
    return json(404, { error: '没有这个管理接口' });
  }

  return null;
}

/** 兑换码：去掉了容易看错的 0/O/1/I */
function makeCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  const rnd = crypto.getRandomValues(new Uint8Array(12));
  for (let i = 0; i < 12; i++) {
    if (i === 4 || i === 8) s += '-';
    s += A[rnd[i] % A.length];
  }
  return s;
}
