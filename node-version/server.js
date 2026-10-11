// 栖云 · Node 服务端
//
// 这个文件只管平台相关的事：读 .env、找 API Key、限流、静态文件、把流写回响应。
// 择体／成诗／校律／润色的全部逻辑在 server/core.mjs —— 与 Cloudflare Worker 共用同一份。

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import { choose, compose, health, LIMITS, ALL_FORMS } from './server/core.mjs';
import { DEFAULT_ENDPOINT, DEFAULT_MODEL } from './server/deepseek.mjs';
import { TUNE_NAMES } from './server/prompt.mjs';
import { SHI_NAMES } from './server/shi.mjs';
import { POET_NAMES } from './server/poets.mjs';
import { hasRhymeBook, hasPingShui } from './server/validator.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 7788);
const HOST = process.env.HOST || '127.0.0.1';
const ENDPOINT = process.env.DEEPSEEK_ENDPOINT || DEFAULT_ENDPOINT;
const MODEL = process.env.DEEPSEEK_MODEL || DEFAULT_MODEL;
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;

/* ---------------- .env 与 API Key ---------------- */
function loadDotEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const k = line.slice(0, eq).trim();
    const v = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[k]) process.env[k] = v;
  }
}
loadDotEnv();

function resolveApiKey() {
  const env = (process.env.DEEPSEEK_API_KEY || '').trim();
  if (env) return { key: env, from: '环境变量 / .env' };
  for (const file of [path.join(os.homedir(), '.dsh', '.credentials.yaml'), path.join(ROOT, 'credentials.yaml')]) {
    try {
      const m = fs.readFileSync(file, 'utf8').match(/^\s*DEEPSEEK_API_KEY:\s*(\S+)\s*$/m);
      if (m) return { key: m[1], from: file };
    } catch {
      /* 继续找 */
    }
  }
  return { key: '', from: null };
}
const resolved = resolveApiKey();
const API_KEY = resolved.key;

/* ---------------- 限流 ---------------- */
const buckets = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const hits = (buckets.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (hits.length >= RATE_LIMIT) return true;
  hits.push(now);
  buckets.set(ip, hits);
  if (buckets.size > 500) {
    for (const [k, v] of buckets) if (!v.some((t) => now - t < RATE_WINDOW_MS)) buckets.delete(k);
  }
  return false;
}

/* ---------------- 静态文件 ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
};

async function serveStatic(res, urlPath) {
  let rel = decodeURIComponent(urlPath);
  if (rel === '/' || rel === '') rel = '/index.html';
  const target = path.resolve(PUBLIC_DIR, '.' + rel);
  if (!target.startsWith(PUBLIC_DIR + path.sep) && target !== PUBLIC_DIR) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('403');
  }
  try {
    const st = await fsp.stat(target);
    if (st.isDirectory()) throw new Error('dir');
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(target).pipe(res);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 · 此路不通');
  }
}

/* ---------------- 请求体 ---------------- */
async function readJson(req, limit = 256 * 1024) {
  let raw = '';
  for await (const c of req) {
    raw += c;
    if (raw.length > limit) throw new Error('too-large');
  }
  return JSON.parse(raw || '{}');
}

function json(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

/* ---------------- 路由 ---------------- */
const config = { apiKey: API_KEY, model: MODEL, endpoint: ENDPOINT };

async function handleApi(req, res, ip, url) {
  if (!API_KEY) {
    return json(res, 500, {
      error: '没有找到 DeepSeek API Key。请在 .env 里写一行 DEEPSEEK_API_KEY=sk-... 后重启服务。',
    });
  }
  if (req.method !== 'POST') return json(res, 405, { error: '只接受 POST' });

  let payload;
  try {
    payload = await readJson(req);
  } catch {
    return json(res, 400, { error: '请求体不是合法 JSON' });
  }

  if (url.pathname === '/api/choose') {
    if (rateLimited(ip)) return json(res, 429, { error: '落笔太急了，歇一会儿再写' });
    const out = await choose({ payload, config });
    if (out.json) return json(res, out.status, out.json);
    return json(res, 500, { error: '择体未返回结果' });
  }

  // /api/compose —— 流式返回 NDJSON
  if (rateLimited(ip)) return json(res, 429, { error: '落笔太急了，歇一会儿再写' });

  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
    Connection: 'keep-alive',
  });

  const ac = new AbortController();
  req.on('close', () => ac.abort());
  const ka = setInterval(() => {
    if (!res.writableEnded) res.write('\n');
  }, 15_000);

  try {
    await compose({
      payload,
      config,
      signal: ac.signal,
      io: {
        write: (s) => {
          if (!res.writableEnded) res.write(s);
        },
        close: () => {
          if (!res.writableEnded) res.end();
        },
      },
    });
  } finally {
    clearInterval(ka);
    if (!res.writableEnded) res.end();
  }
}

const server = http.createServer(async (req, res) => {
  const ip = req.socket.remoteAddress || 'local';
  const url = new URL(req.url || '/', `http://${req.headers.host || HOST}`);

  try {
    if (url.pathname === '/api/choose' || url.pathname === '/api/compose') {
      return await handleApi(req, res, ip, url);
    }

    if (url.pathname === '/api/health') {
      return json(
        res,
        200,
        health({
          model: MODEL,
          keyReady: Boolean(API_KEY),
          rhymeBook: hasRhymeBook,
          pingShui: hasPingShui,
          tuneNames: TUNE_NAMES,
          shiNames: SHI_NAMES,
          poetNames: POET_NAMES,
        })
      );
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('405');
    }
    return await serveStatic(res, url.pathname);
  } catch (err) {
    console.error('[server]', err);
    if (!res.writableEnded) return json(res, 500, { error: '服务端出错：' + (err?.message || err) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`栖云 · http://${HOST}:${PORT}`);
  console.log(`模型 ${MODEL}`);
  console.log(`已核验体裁 ${ALL_FORMS.length} 种（近体诗 ${SHI_NAMES.length} + 词牌 ${TUNE_NAMES.length}）`);
  console.log(`韵书：词林正韵 ${hasRhymeBook ? '✓' : '✗'}　平水韵 ${hasPingShui ? '✓' : '✗'}`);
  if (API_KEY) console.log(`密钥来源 ${resolved.from}`);
  else console.warn('未找到 DEEPSEEK_API_KEY —— 页面能打开，但写不了诗。');
});

export { server };
