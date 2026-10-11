// 验证 build-dashboard.mjs 造出来的 dist-upload/_worker.js 真的能用
//
// 为什么必须验：
//   这个产物是给「拖拽上传」用的，用户拖上去之后平台**不会**再编译它。
//   所以它的正确性完全由本地这一刻决定 —— 不在这里跑通，就等于把没验过的东西
//   交出去。而且高级模式的 `_worker.js` 有一个特殊的坑：
//   它**必须自己把静态资源转发出去**（env.ASSETS.fetch），
//   否则整个站除了 /api 之外全是坏的。这条最容易漏，所以专门测。

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';

import { keyCookieValue } from '../server/api-auth.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(ROOT, 'dist-upload');

let bad = 0;
const ok = (c, label, extra = '') => {
  if (!c) bad++;
  console.log(`${c ? '✓' : '✗'} ${label}${extra ? '　' + extra : ''}`);
};

if (!(await fs.stat(OUT).catch(() => null))) {
  console.error('没有 dist-upload/。先跑：node build-dashboard.mjs');
  process.exit(2);
}

/* ---------- 密钥：与 serve-local 同一套顺序 ---------- */
async function readKey() {
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY.trim();
  for (const f of [path.join(ROOT, '.dev.vars'), path.resolve(ROOT, '..', 'qiyun', '.env')]) {
    try {
      const m = (await fs.readFile(f, 'utf8')).match(/DEEPSEEK_API_KEY\s*=\s*["']?([^"'\s]+)/);
      if (m) return m[1];
    } catch {
      /* 跳过 */
    }
  }
  try {
    const m = (await fs.readFile(path.join(os.homedir(), '.dsh', '.credentials.yaml'), 'utf8'))
      .match(/DEEPSEEK_API_KEY:\s*(\S+)/);
    if (m) return m[1];
  } catch {
    /* 跳过 */
  }
  return '';
}

/* ---------- 假的 ASSETS 绑定：把 dist-upload 当静态资源层 ---------- */
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

let assetsHits = 0;
const ASSETS = {
  async fetch(request) {
    assetsHits++;
    const url = new URL(request.url);
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    // _worker.js 是给平台用的，不该被当成资源发出去 —— 这里也照此模拟
    if (rel === '/_worker.js') return new Response('not found', { status: 404 });
    const abs = path.join(OUT, path.normalize(rel).replace(/^([/\\])+/, ''));
    if (!abs.startsWith(OUT)) return new Response('forbidden', { status: 403 });
    try {
      const body = await fs.readFile(abs);
      return new Response(body, {
        status: 200,
        headers: { 'Content-Type': TYPES[path.extname(abs).toLowerCase()] || 'application/octet-stream' },
      });
    } catch {
      return new Response('not found', { status: 404 });
    }
  },
};

/* ---------- 载入产物（就是用户要拖上去的那个文件） ---------- */
const mod = await import(pathToFileURL(path.join(OUT, '_worker.js')).href);
ok(typeof mod.default?.fetch === 'function', '_worker.js 导出 default.fetch', typeof mod.default?.fetch);

const KEY = await readKey();
const env = { DEEPSEEK_API_KEY: KEY, ASSETS };
const ctx = { waitUntil: (p) => p?.catch?.(() => {}) };
// 这个套件没配数据库，免费那条路是关着的（没有账本就不承诺额度），
// 所以要调 /api/compose 得用密钥身份 —— 自己造一张合法凭据。
const AUTH = { cookie: `qy_key=${await keyCookieValue(env)}` };
const call = (p, init) => mod.default.fetch(new Request('https://x.test' + p, init), env, ctx);

/* ---------- 静态资源必须被转发出去 ---------- */
console.log('\n— 静态资源（高级模式最容易漏的一条）—');
for (const [p, want, needle] of [
  ['/', 200, '云卷云舒'],
  ['/style.css', 200, '--'],
  ['/app.js', 200, 'api/health'],
  ['/nope.txt', 404, ''],
]) {
  const r = await call(p);
  const text = r.status === 200 ? await r.text() : '';
  ok(r.status === want, `${p} → ${want}`, `实为 ${r.status}`);
  if (needle) ok(text.includes(needle), `  ${p} 内容里含「${needle}」`);
}
ok(assetsHits >= 3, '静态请求确实转发给了 env.ASSETS', `${assetsHits} 次`);

/* ---------- API ---------- */
console.log('\n— /api/* —');
const h = await call('/api/health');
const ct = h.headers.get('content-type') || '';
const health = await h.json();
ok(h.status === 200 && ct.includes('json'), '/api/health 返回 JSON', ct);
ok(health.forms?.length === 30, '体裁 30 种', String(health.forms?.length));
ok(health.allusions?.total === 164, '典故 164 条', String(health.allusions?.total));
ok(health.keyReady === true, 'API Key 读到（keyReady）', health.keyReady ? '' : '← 本机没读到密钥，下面的写诗会跳过');

const m = await call('/api/compose', { method: 'GET' });
ok(m.status === 405, 'GET /api/compose → 405', String(m.status));

const n = await call('/api/nope', { method: 'POST', body: '{}' });
ok(n.status === 404, '未知 /api → 404', String(n.status));

/* ---------- 真写一首（可选，取决于本机有没有密钥） ---------- */
if (health.keyReady) {
  console.log('\n— 真写一首（走的就是用户拖上去的那个文件）—');
  const t0 = Date.now();
  const cr = await call('/api/choose', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...AUTH },
    body: JSON.stringify({ scene: '傍晚在江边散步，风把水面的灯影吹碎了。' }),
  });
  const chosen = await cr.json();
  ok(cr.status === 200 && Boolean(chosen.form), `/api/choose 择《${chosen.form}》`);

  const res = await call('/api/compose', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...AUTH },
    body: JSON.stringify({ scene: '傍晚在江边散步，风把水面的灯影吹碎了。', form: chosen.form, allusions: chosen.allusions || [], mode: 'compose' }),
  });
  ok((res.headers.get('content-type') || '').includes('ndjson'), 'compose 返回 NDJSON 流');

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let payload = null;
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
      if (ev.type === 'result') payload = ev;
      if (ev.type === 'error') console.log('   ⚠ ' + ev.message);
    }
  }
  ok(Boolean(payload), 'compose 拿到结果', `总 ${Date.now() - t0}ms`);
  if (payload) {
    const lines = payload.body.split('\n').filter((l) => l.trim());
    ok(lines.every((l) => !/^[平仄中]+$/.test(l)), '正文无平仄谱');
    console.log(`\n〔${payload.title}〕<${payload.form}>　第 ${payload.tries} 稿`);
    for (const l of lines) console.log('   ' + l);
  }
} else {
  console.log('\n· 本机没读到密钥，跳过真实成诗（不影响产物正确性的判断）');
}

console.log('\n' + '─'.repeat(56));
console.log(bad === 0 ? '拖拽上传用的 _worker.js 验证通过 —— 静态与后端都在' : `${bad} 项未通过`);
process.exit(bad === 0 ? 0 : 1);
