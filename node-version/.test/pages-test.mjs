// 验证 Pages Functions 适配层：用 Pages 风格的 context 调用它
// 与 worker-test.mjs 同样用假 env，不联网到 Cloudflare。
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Windows 下必须用 file:// URL 才能动态 import 绝对路径
const adapterUrl = pathToFileURL(path.join(HERE, '..', 'functions', 'api', '[[path]].js')).href;
const mod = await import(adapterUrl);
import { keyCookieValue } from '../server/api-auth.mjs';

// Pages Functions 与 Worker 两种入口都兼容
const entry = mod.onRequest
  ? async (request, env, waitUntil) => {
      const url = new URL(request.url);
      const ctx = {
        request,
        env,
        waitUntil: (p) => {
          pending.push(p);
        },
        params: {},
        data: {},
        next: () => new Response('__NEXT__', { status: 404 }),
      };
      void url;
      return mod.onRequest(ctx);
    }
  : null;

if (!entry) {
  console.log('✗ 适配层没有导出 onRequest');
  process.exit(1);
}

let key = process.env.DEEPSEEK_API_KEY;
if (!key) {
  const t = await fs.readFile(path.join(os.homedir(), '.dsh', '.credentials.yaml'), 'utf8');
  key = t.match(/DEEPSEEK_API_KEY:\s*(\S+)/)[1];
}

const PUBLIC = new URL('../public/', import.meta.url);
const env = {
  DEEPSEEK_API_KEY: key,
  ASSETS: {
    fetch: async (req) => {
      const p = new URL(req.url).pathname === '/' ? '/index.html' : new URL(req.url).pathname;
      try {
        const body = await fs.readFile(new URL('.' + p, PUBLIC));
        const type = p.endsWith('.css') ? 'text/css' : p.endsWith('.js') ? 'text/javascript' : 'text/html';
        return new Response(body, { status: 200, headers: { 'Content-Type': type + '; charset=utf-8' } });
      } catch {
        return new Response('404', { status: 404 });
      }
    },
  },
};

const pending = [];
let bad = 0;
const ok = (c, label, extra = '') => {
  if (!c) bad++;
  console.log(`${c ? '✓' : '✗'} ${label}${extra ? '　' + extra : ''}`);
};

// 这个套件没配数据库，免费那条路是关着的（没有账本就不承诺额度），
// 所以要调 /api/compose 得用密钥身份 —— 自己造一张合法凭据。
const AUTH = { cookie: `qy_key=${await keyCookieValue(env)}` };

const BASE = 'https://cloudrest.pages.dev';

console.log('Pages Functions 适配层验证\n' + '─'.repeat(52));

// 1. /api/health
let health = null;
{
  const res = await entry(new Request(BASE + '/api/health'), env);
  const ct = res.headers.get('content-type') || '';
  health = await res.json();
  ok(res.status === 200 && ct.includes('json'), '/api/health 返回 JSON（适配层接管成功）', ct);
  console.log(
    `   体裁 ${health.forms?.length}　诗人 ${health.poets?.length}　典故 ${health.allusions?.total}　韵书 ${health.rhymeBook}/${health.pingShui}　Key ${health.keyReady}`
  );
}

// 2. 非 /api 路径应交给 next()（即静态资源），而不是被适配层接管
{
  const res = await entry(new Request(BASE + '/style.css'), env);
  const body = await res.text();
  ok(res.status === 404 && body === '__NEXT__', '非 /api 路径交给静态资源层（未被误接管）');
}

// 3. 方法校验
{
  const res = await entry(new Request(BASE + '/api/compose'), env);
  ok(res.status === 405, 'GET /api/compose 应 405', String(res.status));
}

// 4. 真写一首（走流式）
{
  const SCENE = '傍晚在江边散步，风把水面的灯影吹碎了。';
  const cr = await entry(
    new Request(BASE + '/api/choose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...AUTH },
      body: JSON.stringify({ scene: SCENE }),
    }),
    env
  );
  const chosen = await cr.json();
  ok(cr.status === 200 && chosen.form, '/api/choose', `择《${chosen.form}》`);

  const res = await entry(
    new Request(BASE + '/api/compose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...AUTH },
      body: JSON.stringify({ scene: SCENE, form: chosen.form, allusions: chosen.allusions || [], mode: 'compose' }),
    }),
    env
  );
  ok((res.headers.get('content-type') || '').includes('ndjson'), 'compose 返回流');

  const rd = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let payload = null;
  for (;;) {
    const { value, done } = await rd.read();
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
  await Promise.all(pending);
  ok(Boolean(payload), 'compose 拿到结果');
  if (payload) {
    const lines = payload.body.split('\n').filter((l) => l.trim());
    ok(
      lines.every((l) => !/^[平仄中]+$/.test(l)),
      '正文无平仄谱'
    );
    ok(payload.verdict.level !== 'error', `校律 ${payload.verdict.level}`, JSON.stringify(payload.verdict.stats));
    console.log(`\n〔${payload.title}〕<${payload.form}>　第 ${payload.tries} 稿`);
    for (const l of lines) console.log('   ' + l);
    console.log(`   用典：${payload.allusion}`);
  }
}

console.log('\n' + '─'.repeat(52));
console.log(bad === 0 ? 'Pages 适配层全部通过' : `${bad} 项未通过`);
process.exit(bad === 0 ? 0 : 1);
