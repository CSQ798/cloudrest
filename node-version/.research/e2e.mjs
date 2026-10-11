// 端到端：择体 → 成诗（合律重写）→ 看校验结果
const HOST = 'http://127.0.0.1:7788';

async function post(path, payload) {
  const res = await fetch(HOST + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    console.log(`HTTP ${res.status}`, await res.text());
    return null;
  }
  return res;
}

async function choose(scene, wish = '') {
  const res = await post('/api/choose', { scene, wish });
  if (!res) return null;
  const d = await res.json();
  console.log(`择体：《${d.form}》　${d.reason}`);
  return d.form;
}

async function compose(scene, form, mode = 'compose', extra = {}) {
  const t0 = Date.now();
  const res = await post('/api/compose', { scene, form, mode, ...extra });
  if (!res) return null;
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
      if (ev.type === 'error') console.log('  ⚠', ev.message);
      if (ev.type === 'result') payload = ev;
    }
  }
  const ms = Date.now() - t0;
  if (!payload) return null;

  console.log(`\n〔${payload.title}〕<${payload.form}>　（第 ${payload.tries} 稿，${ms}ms）`);
  console.log(`  取景：${payload.scene}`);
  for (const l of payload.body.split('\n')) console.log('   ' + l);
  console.log(`  用典：${payload.allusion}`);
  console.log(`  修辞：${payload.devices}`);
  console.log(`  自评：${payload.appraisal}`);
  const v = payload.verdict;
  console.log(`  校律：${v.level}　${JSON.stringify(v.stats)}`);
  const errs = v.issues.filter((i) => i.severity === 'error');
  const warns = v.issues.filter((i) => i.severity === 'warn');
  for (const e of errs) console.log('    ✗ ' + e.text);
  for (const w of warns) console.log('    · ' + w.text);
  return payload;
}

const SCENE = process.argv[2] || '夏末傍晚，祖母在灶前煮面，我在门边看她弯腰。';
console.log('场景：' + SCENE + '\n');
const form = await choose(SCENE);
const first = await compose(SCENE, form);
if (first && process.argv[3]) {
  console.log('\n=== 润色：' + process.argv[3] + ' ===');
  await compose(SCENE, form, 'refine', { wish: process.argv[3], previous: first });
}
