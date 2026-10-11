// 用假 env / ctx 在 Node 里直接跑 worker.mjs 的真实代码
// Worker 只用到 Web 标准 API（fetch / TransformStream / TextEncoder / Request / Response），
// 这些 Node 18+ 都有，所以无需 wrangler 就能验证路由与流式逻辑。
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const worker = (await import('../worker.mjs')).default;
import { keyCookieValue } from '../server/api-auth.mjs';
import { layoutPoem } from '../server/format.mjs';
import { getMarks } from '../server/tunes.mjs';

// 读密钥
let key = process.env.DEEPSEEK_API_KEY;
if (!key) {
  const t = await fs.readFile(path.join(os.homedir(), '.dsh', '.credentials.yaml'), 'utf8');
  key = t.match(/DEEPSEEK_API_KEY:\s*(\S+)/)[1];
}

const PUBLIC = new URL('../public/', import.meta.url);
// 假的 assets 绑定：从 public/ 读文件
const env = {
  DEEPSEEK_API_KEY: key,
  ASSETS: {
    fetch: async (req) => {
      const p = new URL(req.url).pathname === '/' ? '/index.html' : new URL(req.url).pathname;
      try {
        const body = await fs.readFile(new URL('.' + p, PUBLIC));
        const type = p.endsWith('.css')
          ? 'text/css; charset=utf-8'
          : p.endsWith('.js')
            ? 'text/javascript; charset=utf-8'
            : 'text/html; charset=utf-8';
        return new Response(body, { status: 200, headers: { 'Content-Type': type } });
      } catch {
        return new Response('404', { status: 404 });
      }
    },
  },
};

const pending = [];
const ctx = { waitUntil: (pr) => pending.push(pr) };

// 这个套件只配了 DeepSeek 密钥、没配数据库，所以免费那条路是关着的
// （见 server/api-auth.mjs 里 chargeOnce 的说明：没有账本就不承诺额度）。
// 想调 /api/compose 就得拿密钥身份 —— 这里自己造一张合法的密钥凭据。
const KEY_COOKIE = `qy_key=${await keyCookieValue(env)}`;
const authed = (init = {}) => ({
  ...init,
  headers: { ...(init.headers || {}), cookie: KEY_COOKIE },
});

let bad = 0;
const check = (ok, label, extra = '') => {
  if (!ok) bad++;
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? '　' + extra : ''}`);
};

/* ---- 1. 静态资源 ---- */
{
  const res = await worker.fetch(new Request('https://cloudrest.example/'), env, ctx);
  const html = await res.text();
  check(res.status === 200 && html.includes('云卷云舒') && html.includes('col-left'), '静态首页', `${res.status} ${html.length} 字节`);
}
{
  const res = await worker.fetch(new Request('https://cloudrest.example/app.js'), env, ctx);
  check(res.status === 200 && res.headers.get('content-type').includes('javascript'), '静态 app.js');
}

/* ---- 2. /api/health ---- */
let healthJson = null;
{
  const res = await worker.fetch(new Request('https://cloudrest.example/api/health'), env, ctx);
  healthJson = await res.json();
  check(res.status === 200 && healthJson.ok, '/api/health', `体裁 ${healthJson.forms.length}　诗人 ${healthJson.poets.length}　典故 ${healthJson.allusions.total}　韵书 ${healthJson.rhymeBook}/${healthJson.pingShui}`);
}

/* ---- 3. 方法校验与未知接口 ---- */
{
  const res = await worker.fetch(new Request('https://cloudrest.example/api/compose'), env, ctx);
  check(res.status === 405, 'GET /api/compose 应 405', String(res.status));
}
{
  const res = await worker.fetch(new Request('https://cloudrest.example/api/nope'), env, ctx);
  check(res.status === 404, '未知 /api 应 404', String(res.status));
}
{
  const res = await worker.fetch(
    new Request(
      'https://cloudrest.example/api/choose',
      authed({ method: 'POST', body: 'not json' })
    ),
    env,
    ctx
  );
  check(res.status === 400, '非 JSON 请求体应 400', String(res.status));
}
{
  const res = await worker.fetch(
    new Request(
      'https://cloudrest.example/api/choose',
      authed({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scene: '一' }),
      })
    ),
    env,
    ctx
  );
  check(res.status === 400, '场景过短应 400', String(res.status));
}

/* ---- 4. 无密钥时的提示 ---- */
{
  const res = await worker.fetch(
    new Request('https://cloudrest.example/api/choose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scene: '深秋傍晚，一个人在山中旧院听泉。' }),
    }),
    { ASSETS: env.ASSETS },
    ctx
  );
  const j = await res.json();
  check(res.status === 500 && /wrangler secret put/.test(j.error), '无密钥时给出正确的部署提示');
}

/* ---- 4b. 没绑数据库时，择体也必须被挡住 ---- */
// 这一条是线上实测打出来的：compose 已经 503，而 /api/choose 仍然 200
// 并且真的去调了模型 —— 因为闸门原先多写了一个 `accountsEnabled &&`。
// 择体同样花钱，两边必须一致。
{
  const noDbEnv = { DEEPSEEK_API_KEY: key, ASSETS: env.ASSETS };
  const res = await worker.fetch(
    new Request('https://cloudrest.example/api/choose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scene: '深秋傍晚，一个人在山中旧院听泉。' }),
    }),
    noDbEnv,
    ctx
  );
  const j = await res.json();
  check(res.status === 503, '没绑库时 /api/choose 被挡（503）', String(res.status));
  // 这句话访客会看到，所以不该出现 D1 / 绑定 之类的词（站长那句提示在页面告警条里）
  check(!/D1|绑定|变量名/.test(j.error || ''), '访客提示里不含术语', (j.error || '').slice(0, 24) + '…');

  const res2 = await worker.fetch(
    new Request(
      'https://cloudrest.example/api/choose',
      authed({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scene: '深秋傍晚，一个人在山中旧院听泉。' }),
      })
    ),
    noDbEnv,
    ctx
  );
  check(res2.status === 200, '但带密钥的照常能过（站长自己进得去）', String(res2.status));
}

/* ---- 5. /api/choose 真调用 ---- */
const SCENE = '深秋傍晚，一个人在山中旧院听泉。';
let chosen = null;
{
  const res = await worker.fetch(
    new Request(
      'https://cloudrest.example/api/choose',
      authed({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scene: SCENE }),
      })
    ),
    env,
    ctx
  );
  chosen = await res.json();
  check(res.status === 200 && chosen.form, '/api/choose 真调用', `择《${chosen.form}》`);
}

/* ---- 6. /api/compose 流式 ---- */
{
  const res = await worker.fetch(
    new Request(
      'https://cloudrest.example/api/compose',
      authed({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scene: SCENE, form: chosen.form, allusions: chosen.allusions || [], mode: 'compose' }),
      })
    ),
    env,
    ctx
  );
  const ct = res.headers.get('content-type') || '';
  check(ct.includes('ndjson'), 'compose 返回 NDJSON 流', ct);

  // 边读边记账：确认是流出来的
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let payload = null;
  let firstChunkAt = 0;
  const t0 = Date.now();
  let chunks = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks++;
    if (!firstChunkAt) firstChunkAt = Date.now() - t0;
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
  await Promise.all(pending); // 等 waitUntil 的后台任务收尾
  check(Boolean(payload), 'compose 拿到 result');
  if (payload) {
    const lines = payload.body.split('\n').filter((l) => l.trim());
    const patternLines = lines.filter((l) => /^[平仄中]+$/.test(l));
    check(patternLines.length === 0, '正文无平仄谱');
    check(payload.verdict.level !== 'error', `校律 ${payload.verdict.level}`, JSON.stringify(payload.verdict.stats));

    // 展示版式：服务端算好的 lines —— 词按句读加标点、不逐句换行，诗两句一行。
    // 这一条是端到端的：模型输出 → cleanBody → fixLines → layoutPoem，
    // 站长报的「《定风波》每句都是句号」就在这条链路的最后一环上。
    const bodyLines = payload.body.split('\n').filter((l) => l.trim());
    check(
      JSON.stringify(payload.lines) === JSON.stringify(layoutPoem(payload.form, bodyLines)),
      '`lines` 与排版模块逐字一致'
    );
    const flat = payload.lines.filter((l) => l !== '');
    check(flat.length > 0 && flat.every((l) => /[。？]$/.test(l)), '每一行都以句号或问号收尾（没有断在逗号上）');
    check(typeof payload.insight === 'string', '立意（insight）字段随结果返回');
    if (getMarks(payload.form)) {
      const joined = flat.join('');
      const commas = (joined.match(/，/g) || []).length;
      const periods = (joined.match(/。/g) || []).length;
      check(commas >= 1, `《${payload.form}》的句子之间有逗号`, `逗号 ${commas} 个、句号 ${periods} 个`);
    }
    console.log(`   首块到达 ${firstChunkAt}ms，共 ${chunks} 块`);
    console.log(`   〔${payload.title}〕<${payload.form}>  第 ${payload.tries} 稿  润色重写=${payload.revised}`);
    console.log('   原稿（一句一行）：');
    for (const l of lines) console.log('      ' + l);
    console.log('   版式（给人看的）：');
    for (const l of payload.lines) console.log('      ' + (l === '' ? '␍ 分段' : l));
    console.log(`   用典：${payload.allusion}`);
    console.log(`   立意：${payload.insight || '（模型没写，左栏就不显示这一条）'}`);
  }
}

console.log(bad === 0 ? '\nWorker 全部检查通过' : `\n${bad} 项未通过`);
process.exit(bad === 0 ? 0 : 1);
