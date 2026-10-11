// 端到端：择体（含挑典）→ 成诗（含诗人风格）→ 看用典与校律
const HOST = 'http://127.0.0.1:7788';

async function choose(scene, poet) {
  const r = await fetch(HOST + '/api/choose', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scene, poet }),
  });
  return r.ok ? r.json() : { error: (await r.json().catch(() => ({}))).error };
}

async function compose(scene, form, poet, allusions) {
  const res = await fetch(HOST + '/api/compose', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scene, form, poet, allusions, mode: 'compose' }),
  });
  if (!res.ok) return { error: (await res.json().catch(() => ({}))).error || res.status };
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
      if (ev.type === 'error') return { error: ev.message };
    }
  }
  return payload || { error: '无结果' };
}

const CASES = [
  ['深夜的医院走廊，长椅上有人抱着外套睡着了。', '杜甫'],
  ['登上一座古塔，看下面的旧城遗址，风很大。', ''],
  ['送朋友上火车，站台上风很大。', '王维'],
  ['清晨的菜市场，老人在挑青菜，秤杆翘了一下。', '白居易'],
];

for (const [scene, poet] of CASES) {
  console.log('='.repeat(70));
  console.log(`场景：${scene}${poet ? `　笔法：${poet}` : ''}`);
  const d = await choose(scene, poet);
  if (d.error) {
    console.log('  择体失败：' + d.error);
    continue;
  }
  console.log(`  择体：《${d.form}》　${d.reason}`);
  console.log(`  挑典：${d.allusions && d.allusions.length ? d.allusions.join('、') : '（未挑）'}`);

  const p = await compose(scene, d.form, poet, d.allusions || []);
  if (p.error) {
    console.log('  成诗失败：' + p.error);
    continue;
  }
  console.log(`  第 ${p.tries} 稿　校律 ${p.verdict.level}　${JSON.stringify(p.verdict.stats)}`);
  for (const l of p.body.split('\n')) console.log('     ' + l);
  console.log(`  用典：${p.allusion}`);
  console.log(`  修辞：${p.devices}`);
  for (const i of p.verdict.issues.filter((x) => x.severity === 'error')) console.log('     ✗ ' + i.text);
}
