// 端到端：模拟浏览器消费 NDJSON，并用 public/app.js 里真实的分行函数渲染
import fs from 'node:fs';

const src = fs.readFileSync(new URL('./public/app.js', import.meta.url), 'utf8');
const pickSrc = src.match(/function pickSize[\s\S]*?\n}/)?.[0];
const normSrc = src.match(/function normalizeBody[\s\S]*?\n}/)?.[0];
if (!pickSrc || !normSrc) throw new Error('没能从 app.js 里取到分行函数');
const { normalizeBody } = await import(
  'data:text/javascript,' + encodeURIComponent(pickSrc + '\n' + normSrc + '\nexport { normalizeBody };')
);
console.log('已载入 app.js 中真实的分行实现\n');

const CASES = [
  { scene: '夏末傍晚，祖母在灶前煮面，我在门边看她弯腰。', form: 'auto' },
  { scene: '很累。', form: 'auto' },
  { scene: '深夜的医院走廊，长椅上有人抱着外套睡着了。', form: '浣溪沙' },
];

function strip(raw) {
  return raw.replace(/[\s，。、；：！？·「」『』（）()]/g, '');
}

for (const c of CASES) {
  const res = await fetch('http://127.0.0.1:7788/api/compose', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(c),
  });
  if (!res.ok) {
    console.log('HTTP', res.status, await res.text());
    continue;
  }
  const fields = { scene: '', title: '', form: '', body: '', note: '' };
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let evs = 0;
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
      evs++;
      if (ev.type === 'delta') fields[ev.field] = (fields[ev.field] || '') + ev.text;
      if (ev.type === 'error') console.log('  ⚠', ev.message);
    }
  }

  const lines = normalizeBody(fields.body);
  const rawLen = strip(fields.body).length;
  const badLines = lines.filter((l) => [...l].length < 4 || [...l].length > 8);

  console.log('─'.repeat(60));
  console.log('场景：' + c.scene + '   指定：' + c.form);
  console.log('所写：' + fields.scene.trim());
  console.log(`〔${fields.title.trim()}〕 <${fields.form.trim()}>`);
  for (const l of lines) console.log('   ' + l);
  console.log('落款：' + fields.note.trim());
  console.log(
    `   解析：${evs} 个事件 · 正文 ${rawLen} 字 → ${lines.length} 句 ` +
      `${lines.map((l) => [...l].length).join('/')} 字` +
      (badLines.length ? ` ⚠ 异常句长 ${badLines.join('|')}` : ' ✓')
  );
  const expected = lines.every((l) => [...l].length === [...lines[0]].length);
  console.log(`   句长统一：${expected ? '是' : '否（词或长短句，正常）'}`);
}
