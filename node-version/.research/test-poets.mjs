// 同一场景、不同诗人笔法，看风格是否真的分得开
const HOST = 'http://127.0.0.1:7788';

async function compose(scene, form, poet) {
  const res = await fetch(HOST + '/api/compose', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scene, form, poet, mode: 'compose' }),
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

const SCENE = '深夜的医院走廊，长椅上有人抱着外套睡着了，输液管在暗处轻轻晃。';
const POETS = process.argv.slice(2).length ? process.argv.slice(2) : ['王维', '杜甫', '李白', '毛泽东', '鲁迅'];
const FORM = '七言绝句';

console.log(`场景：${SCENE}\n体裁：${FORM}\n`);
const results = [];
for (const poet of POETS) {
  const p = await compose(SCENE, FORM, poet);
  if (p.error) {
    console.log(`✗ ${poet}：${p.error}`);
    continue;
  }
  results.push({ poet, p });
  console.log(`【${poet}】〔${p.title}〕 第 ${p.tries} 稿  校律 ${p.verdict.level}`);
  for (const l of p.body.split('\n')) console.log('    ' + l);
  console.log(`    修辞：${p.devices}`);
  console.log('');
}

// 粗看：不同诗人的产出是否真的不同（去重后完全相同即视为没分开）
const bodies = results.map((r) => r.p.body);
const uniq = new Set(bodies);
console.log(`不同诗人产出 ${results.length} 首，去重后 ${uniq.size} 首` + (uniq.size === results.length ? '（各不相同）' : '（有重复）'));

// 逐位报告首句特征
for (const { poet, p } of results) {
  const first = p.body.split('\n')[0] || '';
  console.log(`  ${poet.padEnd(4, '　')} 首句：${first}`);
}
