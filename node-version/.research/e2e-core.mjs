// 端到端：择体 → 成诗（走共享内核）→ 看校律
const HOST = process.env.HOST_URL || 'http://127.0.0.1:7788';

async function choose(scene, poet = '') {
  const r = await fetch(HOST + '/api/choose', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scene, poet }),
  });
  return r.ok ? r.json() : { error: (await r.json().catch(() => ({}))).error || r.status };
}

async function compose(scene, form, allusions = [], poet = '') {
  const res = await fetch(HOST + '/api/compose', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scene, form, allusions, poet, mode: 'compose' }),
  });
  if (!res.ok) return { error: (await res.json().catch(() => ({}))).error || res.status };
  const rd = res.body.getReader();
  const d = new TextDecoder();
  let b = '';
  let p = null;
  const st = [];
  for (;;) {
    const { value, done } = await rd.read();
    if (done) break;
    b += d.decode(value, { stream: true });
    let i;
    while ((i = b.indexOf('\n')) >= 0) {
      const l = b.slice(0, i).trim();
      b = b.slice(i + 1);
      if (!l) continue;
      const e = JSON.parse(l);
      if (e.type === 'status') st.push(e.hint);
      if (e.type === 'result') p = e;
      if (e.type === 'error') return { error: e.message };
    }
  }
  return p ? { ...p, statuses: st } : { error: '无结果' };
}

const CASES = [
  ['深秋傍晚，一个人在山中旧院听泉。', ''],
  ['晚上在闵行的长街上走，两边都是灯，我和同车的人一路说话。', ''],
  ['深夜的医院走廊，长椅上有人抱着外套睡着了。', '杜甫'],
];

let bad = 0;
for (const [scene, poet] of CASES) {
  console.log('='.repeat(68));
  console.log(`场景：${scene}${poet ? `　笔法：${poet}` : ''}`);
  const c = await choose(scene, poet);
  if (c.error) {
    console.log('  ✗ 择体失败：' + c.error);
    bad++;
    continue;
  }
  console.log(`  择体：《${c.form}》　${c.reason}`);
  const p = await compose(scene, c.form, c.allusions || [], poet);
  if (p.error) {
    console.log('  ✗ 成诗失败：' + p.error);
    bad++;
    continue;
  }
  console.log(`  第 ${p.tries} 稿　润色重写=${p.revised}　校律 ${p.verdict.level}　${JSON.stringify(p.verdict.stats)}`);
  for (const l of p.body.split('\n')) console.log('     ' + l);
  console.log(`  用典：${p.allusion}`);
  if (p.selfCritique) console.log(`  润色自批：${p.selfCritique.slice(0, 80)}…`);
}
console.log(bad === 0 ? '\n全部通过' : `\n${bad} 例失败`);
process.exit(bad === 0 ? 0 : 1);
