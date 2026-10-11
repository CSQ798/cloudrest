// 走 HTTP 实测：正文里是否还会混进平仄谱
const HOST = 'http://127.0.0.1:7788';

async function compose(scene, form) {
  const res = await fetch(HOST + '/api/compose', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scene, form, mode: 'compose' }),
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
  ['夜行的末班车，车窗上都是雨，我在最后一排睡着了。', '七言律诗'],
  ['夜行的末班车，车窗上都是雨，我在最后一排睡着了。', '七言绝句'],
  ['清晨的菜市场，老人在挑青菜，秤杆翘了一下。', '五言律诗'],
];

let bad = 0;
for (const [scene, form] of CASES) {
  const p = await compose(scene, form);
  if (p.error) {
    console.log(`✗ ${form}：${p.error}`);
    bad++;
    continue;
  }
  const lines = p.body.split('\n').filter((l) => l.trim());
  const patternLines = lines.filter((l) => /^[平仄中]+$/.test(l));
  const lens = lines.map((l) => [...l].filter((c) => /[\u4e00-\u9fff]/.test(c)).length);
  const ok = patternLines.length === 0;
  if (!ok) bad++;
  console.log(`\n${ok ? '✓' : '✗'} ${form}　第 ${p.tries} 稿　${lines.length} 句　句长 ${lens.join('/')}`);
  for (const l of lines) console.log('   ' + l);
  console.log(`   校律 ${p.verdict.level}　${JSON.stringify(p.verdict.stats)}`);
  for (const i of p.verdict.issues.filter((x) => x.severity === 'error')) console.log('   ✗ ' + i.text);
  if (patternLines.length) console.log(`   ✗ 正文里仍有 ${patternLines.length} 行平仄谱`);
}

console.log(bad === 0 ? '\n全部通过：正文无平仄谱' : `\n${bad} 例仍有问题`);
process.exit(bad === 0 ? 0 : 1);
