// 线上验收：直接打 cloudrest 的线上接口，确认真的能写诗
const BASE = process.argv[2] || 'https://cloudrest.2640172486.workers.dev';

async function main() {
  let bad = 0;
  let unreachable = false;
  const ok = (c, label, extra = '') => {
    if (!c) bad++;
    console.log(`${c ? '✓' : '✗'} ${label}${extra ? '　' + extra : ''}`);
  };
  // 区分「连不上」与「服务端答错」——两者结论完全不同，不能混为一谈
  const reach = async (url, init = {}) => {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(init.timeout || 60000) });
    } catch (e) {
      const code = e.cause?.code || e.name;
      const net = /TIMEOUT|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|CERT|UND_ERR/i.test(String(code));
      if (net) {
        unreachable = true;
        console.log(`✗ 连不上：${url}`);
        console.log(`   底层原因：${code} ${e.cause?.message || e.message}`);
        console.log('   这多半是本机网络/防火墙/代理到 *.workers.dev 的路由问题，');
        console.log('   与部署本身无关。请用浏览器直接打开该网址确认。');
      } else {
        ok(false, url, e.message);
      }
      return null;
    }
  };

  console.log(`目标：${BASE}\n` + '─'.repeat(56));

  // 1. 静态页面
  const r0 = await reach(BASE + '/', { timeout: 30000 });
  if (r0) {
    const html = await r0.text();
    ok(
      r0.status === 200 && html.includes('云卷云舒') && html.includes('col-left'),
      '静态首页',
      `${r0.status}　${html.length} 字节`
    );
  }

  // 2. /api/health —— 关键：看 keyReady
  let health = null;
  const r1 = await reach(BASE + '/api/health', { timeout: 30000 });
  if (r1) {
    const ct = r1.headers.get('content-type') || '';
    health = await r1.json();
    ok(ct.includes('json'), '/api/health 返回 JSON（说明 Worker 真的在处理 /api）', ct);
    console.log(
      `   体裁 ${health.forms?.length}　诗人 ${health.poets?.length}　典故 ${health.allusions?.total}　韵书 ${health.rhymeBook}/${health.pingShui}`
    );
    ok(health.keyReady === true, 'API Key 已配置（keyReady）', health.keyReady ? '' : '← 这一步没过，写不了诗');
  }

  if (unreachable) {
    console.log('\n' + '─'.repeat(56));
    console.log('连不上该域名，无法从这台机器完成验收。');
    console.log('请改用浏览器打开，或换一台网络可达的机器再跑本脚本：');
    console.log(`  node .test/verify-live.mjs ${BASE}`);
    process.exit(2);
  }

  if (health && health.keyReady !== true) {
    console.log('\n' + '─'.repeat(56));
    console.log('Worker 能访问，但 Key 没配上。请执行：');
    console.log('  npx wrangler secret put DEEPSEEK_API_KEY');
    console.log('  npx wrangler deploy');
    process.exit(1);
  }

  // 3. 真写一首
  const SCENE = '傍晚在江边散步，风把水面的灯影吹碎了。';
  try {
    console.log('\n' + '─'.repeat(56));
    const t0 = Date.now();
    const cr = await fetch(BASE + '/api/choose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scene: SCENE }),
      signal: AbortSignal.timeout(120000),
    });
    const chosen = await cr.json();
    ok(cr.status === 200 && Boolean(chosen.form), '/api/choose', `择《${chosen.form}》：${(chosen.reason || '').slice(0, 40)}`);

    const res = await fetch(BASE + '/api/compose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scene: SCENE, form: chosen.form, allusions: chosen.allusions || [], mode: 'compose' }),
      signal: AbortSignal.timeout(180000),
    });
    ok((res.headers.get('content-type') || '').includes('ndjson'), 'compose 返回流');

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let payload = null;
    let firstAt = 0;
    let chunks = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks++;
      if (!firstAt) firstAt = Date.now() - t0;
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
    ok(Boolean(payload), 'compose 拿到结果', `首块 ${firstAt}ms，共 ${chunks} 块，总 ${Date.now() - t0}ms`);
    if (payload) {
      const lines = payload.body.split('\n').filter((l) => l.trim());
      ok(lines.every((l) => !/^[平仄中]+$/.test(l)), '正文无平仄谱');
      ok(payload.verdict.level !== 'error', `校律 ${payload.verdict.level}`, JSON.stringify(payload.verdict.stats));
      console.log(`\n〔${payload.title}〕<${payload.form}>　第 ${payload.tries} 稿　润色重写=${payload.revised}`);
      for (const l of lines) console.log('   ' + l);
      console.log(`   取景：${payload.scene}`);
      console.log(`   用典：${payload.allusion}`);
      console.log(`   修辞：${payload.devices}`);
      if (payload.selfCritique) console.log(`   润色自批：${payload.selfCritique.slice(0, 90)}…`);
    }
  } catch (e) {
    ok(false, '写诗流程', e.message);
  }

  console.log('\n' + '─'.repeat(56));
  console.log(bad === 0 ? '线上验收全部通过 —— 可以用了' : `${bad} 项未通过`);
  process.exit(bad === 0 ? 0 : 1);
}

await main();
