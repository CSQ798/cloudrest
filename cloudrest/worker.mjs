// 云卷云舒 · Cloudflare Worker 入口
//
// 为什么必须是 Worker 而不是 Pages（纯静态）：
//   这个站的诗是**服务端调用大模型生成的**，纯静态托管上没有任何东西能响应 /api/*，
//   所以传上去只能打开页面、一点「落笔」就废。
//   Worker 既能托管静态页面（assets 绑定），又能在同一个域名下处理 /api/*，
//   还能把 API Key 存成 Secret（浏览器接触不到），并支持流式返回。
//
// 逻辑与 Node 版共用 server/core.mjs —— 只有「怎么拿密钥」「怎么把流写回去」不同。

import { choose, compose, health } from './server/core.mjs';
import { DEFAULT_ENDPOINT, DEFAULT_MODEL } from './server/deepseek.mjs';
import { TUNE_NAMES } from './server/prompt.mjs';
import { SHI_NAMES } from './server/shi.mjs';
import { POET_NAMES } from './server/poets.mjs';
import { hasRhymeBook, hasPingShui } from './server/validator.mjs';
import { createD1Store } from './server/store.mjs';
import { handleAccountRoutes, resolveAccess, accessSummary, chargeOnce, denyReason, refundOnce } from './server/api-auth.mjs';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };

function json(status, obj) {
  return new Response(JSON.stringify(obj), { status, headers: JSON_HEADERS });
}

// 同一个处理函数，两个平台共用：
//   Worker  -> default.fetch(request, env, ctx)
//   Pages   -> ./functions/api/[[path]].js 里 import { onRequest }
export async function onRequest({ request, env, ctx }) {
  {
    const url = new URL(request.url);

    // 静态资源交给 assets 绑定；只有 /api/* 才走这个 Worker
    if (!url.pathname.startsWith('/api/')) {
      if (env.ASSETS) return env.ASSETS.fetch(request);
      return new Response('静态资源未绑定', { status: 500 });
    }

    const apiKey = (env.DEEPSEEK_API_KEY || '').trim();
    const model = env.DEEPSEEK_MODEL || DEFAULT_MODEL;
    const endpoint = env.DEEPSEEK_ENDPOINT || DEFAULT_ENDPOINT;

    // 账号与额度需要一块能跨请求存放状态的地方。线上是 D1（绑定名 DB）；
    // 没绑就退回旧行为（不设闸），并在 /api/health 里如实说明 ——
    // 悄悄放行比明说不设闸更糟，因为站长会以为自己开了额度。
    const store = env.DB ? createD1Store(env.DB) : null;
    // 表结构由站点自己在第一次用到时建好（幂等），免掉「去 D1 的 Console 粘 SQL」
    // 那一步 —— 那是整个部署里最容易出错、也最劝退的一步。
    if (store) await store.ensureSchema();

    if (url.pathname === '/api/health') {
      const access = await resolveAccess(request, env, store);
      return json(
        200,
        {
          ...health({
            model,
            keyReady: Boolean(apiKey),
            rhymeBook: hasRhymeBook,
            pingShui: hasPingShui,
            tuneNames: TUNE_NAMES,
            shiNames: SHI_NAMES,
            poetNames: POET_NAMES,
          }),
          ...accessSummary(access),
          schemaError: store?.schemaError?.() || '',
        }
      );
    }

    // ---- 账号相关（注册 / 登录 / 密钥 / 兑换 / 认领 / 管理）----
    const accountRes = await handleAccountRoutes({ pathname: url.pathname, request, env, store });
    if (accountRes) return accountRes;

    if (url.pathname !== '/api/choose' && url.pathname !== '/api/compose') {
      return json(404, { error: '没有这个接口' });
    }

    if (request.method !== 'POST') return json(405, { error: '只接受 POST' });

    if (!apiKey) {
      return json(500, {
        error:
          '服务端没有配置 DeepSeek API Key。请在本项目目录执行：\n' +
          '  npx wrangler secret put DEEPSEEK_API_KEY\n然后重新部署。',
      });
    }

    // ---- 闸门：密钥 → 无限；否则必须登录且还有额度 ----
    const access = await resolveAccess(request, env, store);
    if (url.pathname === '/api/compose') {
      // 择体不扣次数（一次成诗可能择一次体，也可能用户已指定体裁），
      // 扣在 compose 上，一处扣、一处退，账目才清。
      const charged0 = await chargeOnce(access, store);
      if (!charged0.ok) return json(charged0.status, { error: charged0.error });
      access.charged = charged0.charged;
    } else {
      // 择体也要过闸：**它同样花一次模型调用**。
      // 这里原先写的是 `access.accountsEnabled && !access.allowed`，于是没绑数据库时
      // 择体照跑 —— 线上实测就是这样：compose 已经 503，而 /api/choose 仍然 200
      // 并且真的去调了模型。闸门必须两边一致，否则「关掉免费」只是关了一半。
      const deny = denyReason(access);
      if (deny) return json(deny.status, { error: deny.error });
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      await refundOnce(access, store, access.charged);
      return json(400, { error: '请求体不是合法 JSON' });
    }

    const config = { apiKey, model, endpoint };

    // ---- 择体：一次性 JSON ----
    if (url.pathname === '/api/choose') {
      const out = await choose({ payload, config, signal: request.signal });
      return json(out.status || 200, out.json || { error: '择体未返回结果' });
    }

    // ---- 成诗 / 润色：流式 NDJSON ----
    const encoder = new TextEncoder();
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const io = {
      write: (s) => {
        try {
          writer.write(encoder.encode(s));
        } catch {
          /* 客户端已断开 */
        }
      },
      close: () => {
        try {
          writer.close();
        } catch {
          /* 已关闭 */
        }
      },
    };

    // 在后台把诗写完，同时把流交回给浏览器 —— 这样诗句是逐块浮现的。
    // 扣掉的次数在这里结算：真的出了诗才算数，中途失败就退回去。
    ctx.waitUntil(
      compose({ payload, config, signal: request.signal, io })
        .then(async (r) => {
          // 先说清楚「没成」的两种形态：
          //   r.json.error —— 还没开始流就退回的校验错（体裁没定、润色没写要求…）
          //   r.ok === false —— 流走完了，但一个字都没落下
          if (r && r.json && r.json.error) {
            await refundOnce(access, store, access.charged);
            io.write(JSON.stringify({ type: 'error', message: r.json.error }) + '\n');
            return;
          }
          if (!r || !r.ok) {
            await refundOnce(access, store, access.charged);
            io.write(JSON.stringify({ type: 'error', message: '这次没有成诗，次数已退回' }) + '\n');
            return;
          }
          if (access.user && store) {
            try {
              await store.logUsage(access.user.id, payload.mode === 'refine' ? 'refine' : 'compose', r.form);
            } catch {
              /* 记账失败不影响出诗 */
            }
          }
          io.write(JSON.stringify({ type: 'usage', ...(await usageAfter(access, store)) }) + '\n');
        })
        .catch(async (err) => {
          await refundOnce(access, store, access.charged);
          io.write(JSON.stringify({ type: 'error', message: String(err?.message || err) }) + '\n');
        })
        .finally(() => io.close())
    );

    return new Response(readable, {
      status: 200,
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
      },
    });
  }
}

/** 出诗之后回报最新余额，前端据此更新「还剩几次」 */
async function usageAfter(access, store) {
  // 密钥身份先判：它是不限次的，跟这个账号自己还剩几次无关。
  // （第一版漏了这一层，密钥用户成诗后被告知「还剩 5 次」——数字没错，但答非所问。）
  if (access.keyValid) return { key: true, unlimited: true, left: -1 };
  if (!access.user || !store) return { key: false, left: 0 };
  try {
    const u = await store.getUserById(access.user.id);
    const free = Math.max(0, 5 - (u?.free_used ?? 0));
    const credits = Math.max(0, u?.credits ?? 0);
    return { key: false, freeLeft: free, credits, left: free + credits };
  } catch {
    return { key: false };
  }
}

// Cloudflare Worker 的入口（Pages 走上面的 onRequest）
export default {
  fetch: (request, env, ctx) => onRequest({ request, env, ctx }),
};
