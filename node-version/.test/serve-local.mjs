// 本地起服务：不用 wrangler，直接跑这份 Cloudflare 代码
//
// 用法：
//     node .test/serve-local.mjs            # → http://127.0.0.1:7788
//     node .test/serve-local.mjs 9000       # 换端口
//
// 为什么有这个脚本：
//   wrangler dev 要先装依赖、有时还连不上网；
//   而 worker.mjs 只用 Web 标准 API，Node 18+ 直接就能跑。
//   所以这里用一个 ~50 行的 Node HTTP 服务器把它托起来，
//   走的是**和线上完全相同**的那份代码与那份密钥读取顺序。
//
// 它同时伪造了 env.ASSETS，把 public/ 当成静态资源层，
// 所以「静态页面 + /api/* 后端」在本地就是完整可用的。

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { onRequest } from '../worker.mjs';
import { d1FromSqlite } from '../server/d1-sqlite.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PUBLIC = path.join(ROOT, 'public');

const PORT = Number(process.argv[2] || process.env.PORT || 7788);
const HOST = process.env.HOST || '127.0.0.1';

/* ---------- 密钥：与 Node 版同一套顺序 ---------- */
async function readKey() {
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY.trim();

  for (const f of [path.join(ROOT, '.dev.vars'), path.resolve(ROOT, '..', 'qiyun', '.env')]) {
    try {
      const m = (await fs.readFile(f, 'utf8')).match(/DEEPSEEK_API_KEY\s*=\s*["']?([^"'\s]+)/);
      if (m) return m[1];
    } catch {
      /* 没有这个文件就跳过 */
    }
  }

  try {
    const m = (await fs.readFile(path.join(os.homedir(), '.dsh', '.credentials.yaml'), 'utf8'))
      .match(/DEEPSEEK_API_KEY:\s*(\S+)/);
    if (m) return m[1];
  } catch {
    /* 同上 */
  }

  return '';
}

/* ---------- 假静态资源层：把 public/ 当 ASSETS 绑定 ---------- */
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const ASSETS = {
  async fetch(request) {
    const url = new URL(request.url);
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || rel === '') rel = '/index.html';

    // 挡住 ../ 之类的越权读取
    const abs = path.join(PUBLIC, path.normalize(rel).replace(/^([/\\])+/, ''));
    if (!abs.startsWith(PUBLIC)) return new Response('禁止访问', { status: 403 });

    try {
      const body = await fs.readFile(abs);
      return new Response(body, {
        status: 200,
        headers: { 'Content-Type': TYPES[path.extname(abs).toLowerCase()] || 'application/octet-stream' },
      });
    } catch {
      return new Response('找不到这个文件', { status: 404 });
    }
  },
};

/* ---------- 本地数据库：把 node:sqlite 当成 D1 ---------- */
// 用真 SQLite 而不是 JSON 文件，是为了让本地跑的 SQL 与线上**逐字相同**
// （额度扣减靠 `UPDATE ... WHERE 还有额度` 的 affected rows，那段逻辑不跑真 SQL 就不算验过）
const DATA_DIR = path.join(ROOT, '.local-data');
let DB = null;
let dbNote = '';
try {
  DB = await d1FromSqlite({
    file: path.join(DATA_DIR, 'qiyun.sqlite'),
    migrations: [path.join(ROOT, 'migrations', '0001_init.sql')],
  });
  dbNote = `SQLite（${path.relative(ROOT, path.join(DATA_DIR, 'qiyun.sqlite'))}）—— 本地也跑真 SQL`;
} catch (e) {
  dbNote = '未启用（' + String(e.message).split('\n')[0] + '）';
}

/* ---------- HTTP → Web Request → worker.mjs → HTTP ---------- */
const KEY = await readKey();
const SESSION_SECRET = process.env.SESSION_SECRET || 'local-dev-secret-not-for-production';
const ACCESS_KEY = process.env.ACCESS_KEY || '798798';

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);

  const init = { method: req.method, headers: req.headers };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = Readable.toWeb(req); // POST 的 JSON 体
    init.duplex = 'half';
  }

  let out;
  try {
    out = await onRequest({
      request: new Request(url, init),
      env: {
        DEEPSEEK_API_KEY: KEY,
        ASSETS,
        DB,
        SESSION_SECRET,
        ACCESS_KEY,
      },
      // 本地没有 waitUntil，直接执行；流已经在写，不会丢内容
      ctx: { waitUntil: (p) => p.catch(() => {}) },
    });
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`服务端出错：${err?.stack || err}`);
    return;
  }

  res.writeHead(out.status, Object.fromEntries(out.headers));
  if (!out.body) return res.end();
  Readable.fromWeb(out.body).pipe(res);
});

server.listen(PORT, HOST, () => {
  console.log(`\n云卷云舒（本地 · 跑的是 Cloudflare 那份代码）`);
  console.log(`  http://${HOST}:${PORT}`);
  console.log(`  密钥：${KEY ? '已读到' : '没读到 —— 点「落笔」会提示去配 DEEPSEEK_API_KEY'}`);
  console.log(`  账号数据库：${dbNote}`);
  console.log(`  站点密钥（工具栏用）：${ACCESS_KEY}`);
  console.log(`  静态资源目录：${PUBLIC}\n`);
});
