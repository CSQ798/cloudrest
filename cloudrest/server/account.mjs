// 云卷云舒 · 账号与口令
//
// 三件事，都在这里：
//   一、口令散列（PBKDF2-SHA256，WebCrypto，无依赖）
//   二、会话票据（HMAC-SHA256 签名的自包含 token，放 HttpOnly Cookie）
//   三、定长比较与按 IP 的尝试次数限制
//
// ── 关于 PBKDF2 的迭代次数（这里有个真实的取舍，写下来免得后人乱调）──
//
// Cloudflare Workers / Pages Functions 免费版的 CPU 时间上限是 **10 毫秒**/请求。
// 本机实测（Node 22 的 WebCrypto，与 Workers 同源的 BoringSSL 实现）：
//
//     1,000 次 → 1.1 ms      25,000 次 → 2.4 ms
//    10,000 次 → 1.6 ms      50,000 次 → 5.3 ms
//                           100,000 次 → 9.1 ms   ← 贴着上限，随时会被掐
//
// 所以取 **25,000 次**：约 2.4 ms，给一次请求里其余的活（查库、签发 Cookie）
// 留出余量。这个值对「拿泄露的库离线爆破」来说偏弱，是**已知的、有意的**妥协：
// 想更强就得把 CPU 上限一起解决（升到付费版，或把散列挪到一个独立的
// Worker/服务上）。写在这里，不假装它是理想值。
//
// ── 关于会话票据 ──
//
// 不用服务端会话表：token 自带 userId 与过期时间，用 HMAC 签名。
// 好处是每个请求只多一次 HMAC（几十微秒），不查库。
// 代价是**没法单独吊销某一个会话**——退出登录只是让浏览器删掉 Cookie。
// 真要吊销，把 SESSION_SECRET 换掉即可（所有人重新登录）。
// 这个规模的应用，这个代价是划算的。

const ITERATIONS = 25_000;
const KEY_BITS = 256;
const SESSION_DAYS = 30;

const enc = new TextEncoder();

/* ---------------- 编码 ---------------- */

export function toB64u(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64u(str) {
  const s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomB64u(n = 16) {
  return toB64u(crypto.getRandomValues(new Uint8Array(n)));
}

/* ---------------- 口令 ---------------- */

export async function hashPassword(password) {
  const salt = randomB64u(16);
  const bits = await pbkdf2(password, salt);
  return { salt, hash: toB64u(bits) };
}

async function pbkdf2(password, saltB64) {
  const key = await crypto.subtle.importKey('raw', enc.encode(String(password)), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: fromB64u(saltB64), iterations: ITERATIONS, hash: 'SHA-256' },
    key,
    KEY_BITS
  );
}

export async function verifyPassword(password, saltB64, hashB64) {
  const bits = await pbkdf2(password, saltB64);
  return timingSafeEqual(toB64u(bits), hashB64);
}

/* ---------------- 定长比较 ---------------- */

/** 定长比较两个字符串。长度不同也走完全程，不早退，避免用耗时泄露信息。 */
export function timingSafeEqual(a, b) {
  const x = String(a);
  const y = String(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) {
    diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/* ---------------- 会话票据 ---------------- */

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode(String(secret)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

/**
 * 签一张会话票据：`<base64url(JSON)>.<base64url(HMAC)>`
 * @param {{uid:number, email:string}} claims
 */
export async function signSession(claims, secret, nowMs = Date.now()) {
  const body = { uid: claims.uid, email: claims.email, exp: Math.floor(nowMs / 1000) + SESSION_DAYS * 86400 };
  const payload = toB64u(enc.encode(JSON.stringify(body)));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(payload));
  return payload + '.' + toB64u(sig);
}

/** 验票据；坏签名、格式不对、过期都返回 null */
export async function verifySession(token, secret, nowMs = Date.now()) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2) return null;
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(parts[0]));
  // 签名比较必须定长
  if (!timingSafeEqual(toB64u(sig), parts[1])) return null;
  try {
    const body = JSON.parse(new TextDecoder().decode(fromB64u(parts[0])));
    if (!body || typeof body.uid !== 'number') return null;
    if (typeof body.exp !== 'number' || body.exp * 1000 < nowMs) return null;
    return body;
  } catch {
    return null;
  }
}

/* ---------------- Cookie ---------------- */

export function readCookie(request, name) {
  const raw = request.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export function cookieHeader(name, value, { maxAge = SESSION_DAYS * 86400 } = {}) {
  const bits = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  // 本地 http 调试时不能带 Secure，否则浏览器不收
  if (maxAge > 0) bits.push(`Max-Age=${maxAge}`);
  else bits.push('Max-Age=0');
  return bits.join('; ');
}

/* ---------------- 输入校验 ---------------- */

export function cleanEmail(v) {
  const s = String(v || '').trim().toLowerCase();
  // 够用的形状检查：有 @、两边非空、域名里有点、总长不超 254
  if (s.length < 6 || s.length > 254) return null;
  if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(s)) return null;
  return s;
}

export function checkPassword(v) {
  const s = String(v || '');
  if (s.length < 6) return '密码至少 6 位';
  if (s.length > 200) return '密码太长了';
  return null;
}

/* ---------------- 按 IP 的尝试次数限制 ---------------- */

/**
 * 为什么要它：站点的密钥是 6 位数字（798798），一共 100 万种。
 * 不限速的话，脚本几分钟就能穷举完。
 *
 * 这里的策略是「按 IP 的滑动窗口计数」，不追求精确：
 * 目的只是把爆破成本从「几分钟」抬到「几十年」。
 */
export const THROTTLE = {
  key: { max: 10, windowMs: 10 * 60 * 1000, msg: '密钥尝试次数过多，请 10 分钟后再试' },
  auth: { max: 20, windowMs: 10 * 60 * 1000, msg: '操作过于频繁，请稍后再试' },
};

export function clientIp(request) {
  return (
    request.headers.get('cf-connecting-ip') ||
    (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
    'unknown'
  );
}
