// 探针：直接看某个网址的若干路径到底返回了什么
//
// 用法：
//   node .test/probe-api.mjs https://cloudrest.pages.dev [更多网址...]
//
// 为什么要有它：
//   verify-live.mjs 是「验收」，它会直接 r.json()，一旦返回的不是 JSON 就抛异常，
//   反而看不到服务端到底说了什么。排查阶段需要的是**原样看到状态码与响应体**。
//   这个脚本就是干这个的：不解析、不判断，只如实打印。

const ARGS = process.argv.slice(2);
const BASES = (ARGS.length ? ARGS : []).filter((a) => /^https?:/.test(a));
const EXTRA_PATHS = ARGS.filter((a) => !/^https?:/.test(a));
if (!BASES.length) BASES.push('https://cloudrest.pages.dev', 'https://main.cloudrest.pages.dev');
// 默认看这几个：首页（判断前端是不是新版）、账号脚本、健康检查、当前身份
const PATHS = EXTRA_PATHS.length ? EXTRA_PATHS : ['/', '/account.js', '/api/health', '/api/me'];

for (const base of BASES) {
  console.log('\n' + '='.repeat(60));
  console.log(base);
  console.log('='.repeat(60));
  for (const p of PATHS) {
    const url = base.replace(/\/$/, '') + p;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(25000) });
      const ct = r.headers.get('content-type') || '(无)';
      const body = await r.text();
      console.log(`\n${p}`);
      console.log(`  HTTP ${r.status}　${ct}　${body.length} 字节`);
      // 关键响应头，判断请求到底被谁接走了
      for (const h of ['cf-cache-status', 'cf-ray', 'server', 'x-served-by']) {
        const v = r.headers.get(h);
        if (v) console.log(`  ${h}: ${v}`);
      }
      const show = body.length > 700 ? body.slice(0, 700) + '\n  …（截断）' : body;
      console.log('  ' + show.split('\n').join('\n  '));
      // 顺手判断前端是不是新版：工具栏与账号脚本都在新版里
      if (p === '/') {
        console.log(`  ▸ 含新工具栏 tbKey：${body.includes('tbKey')}　含 account.js：${body.includes('account.js')}`);
      }
      if (p === '/account.js') {
        console.log(`  ▸ 是账号脚本：${body.includes('QYAccount')}`);
      }
    } catch (e) {
      console.log(`\n${p}`);
      console.log(`  连不上：${e.cause?.code || e.name}　${e.cause?.message || e.message}`);
    }
  }
}
