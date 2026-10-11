// 线上到底跑的是哪一版后端？问一句话就知道。
//
// 判据：没绑 D1 时
//   旧版（第一版）：一律放行 —— 不带任何凭据调 /api/choose 会返回 200 并真的去调模型
//   新版（已改）：关掉免费那条路 —— 返回 503，并说明缺 D1 绑定
//
// 用法：node .test/probe-gate.mjs [base]

const BASE = (process.argv[2] || 'https://cloudrest.pages.dev').replace(/\/$/, '');

const show = async (p, init = {}) => {
  try {
    const r = await fetch(BASE + p, { ...init, signal: AbortSignal.timeout(60000) });
    const t = await r.text();
    return { status: r.status, ct: r.headers.get('content-type') || '', body: t };
  } catch (e) {
    return { status: 0, ct: '', body: '连不上：' + (e.cause?.code || e.name) };
  }
};

console.log(`目标：${BASE}\n`);

const h = await show('/api/health');
let health = {};
try {
  health = JSON.parse(h.body);
} catch {}
console.log(`/api/health  ${h.status}`);
console.log(`  accounts=${health.accounts}  sessionReady=${health.sessionReady}  keyReady=${health.keyReady}`);
console.log(`  （accounts=false 表示没绑 D1；sessionReady=false 表示没设 SESSION_SECRET）\n`);

const probe = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scene: '深秋傍晚，一个人在山中旧院听泉。' }) };

const c = await show('/api/choose', probe);
console.log(`/api/choose（不带任何凭据）  ${c.status}`);
console.log(`  ${c.body.slice(0, 220)}\n`);

console.log('─'.repeat(56));
if (c.status === 503) {
  console.log('判读：**新版**后端已上线 —— 没绑库时免费那条路已关闭，只有密钥能过。');
  console.log('      → 页面顶部那条红色告警条里如果还写着「任何人都不限次」，那句话是旧的，要改。');
} else if (c.status === 200) {
  console.log('判读：**旧版**后端 —— 没绑库时一律放行，任何人都能无限次用它。');
  console.log('      → 线上还是旧的 _worker.js，需要用新包重新部署一次。');
} else if (c.status === 401) {
  console.log('判读：新版且免费路径已关，但用的是 401 而不是 503（看你部署的是哪个小版本）。');
} else {
  console.log(`判读：状态码 ${c.status}，不是预期中的任何一种，看上面的响应体。`);
}
