// 试诗：把几段场景依次交给栖云，打印成诗与关键指标
const CASES = [
  { scene: '搬家那天，房间空了，阳台的晾衣杆上还留着一个旧衣架，风一吹就晃。', form: '七言绝句' },
  { scene: '很累，心情很低落。', form: 'auto' },
  { scene: '周末早上被雨声吵醒，不想起床，猫在脚边睡着。', form: 'auto' },
  { scene: '在异乡的超市听见有人用家乡话说话，回头却发现不认识。', form: '七言律诗' },
];

const HOST = process.env.HOST || 'http://127.0.0.1:7788';

async function one({ scene, form }, i) {
  const t0 = Date.now();
  const res = await fetch(HOST + '/api/compose', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scene, form }),
  });
  if (!res.ok) {
    console.log(`#${i + 1} HTTP ${res.status}`, await res.text());
    return;
  }
  const fields = { scene: '', title: '', form: '', body: '', note: '' };
  let deltas = 0;
  let err = null;
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let c;
    while ((c = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, c).trim();
      buf = buf.slice(c + 1);
      if (!line) continue;
      const ev = JSON.parse(line);
      if (ev.type === 'delta') {
        fields[ev.field] += ev.text;
        deltas++;
      } else if (ev.type === 'error') err = ev.message;
    }
  }

  const body = fields.body.trim();
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
  console.log('─'.repeat(64));
  console.log(`#${i + 1} 场景：${scene}`);
  console.log(`指定体裁：${form}`);
  console.log(`   所写：${fields.scene.trim()}`);
  console.log(`〔${fields.title.trim()}〕 <${fields.form.trim()}>`);
  for (const l of lines) console.log('   ' + l);
  console.log('   落款：' + fields.note.trim());
  console.log(
    `   [${Date.now() - t0}ms · ${deltas} 块 · 正文 ${lines.length} 句 / ${[...lines.join('')].length} 字]` +
      (err ? ` ⚠ ${err}` : '')
  );
  // 粗略体检：现成意象、标点、长度
  const cliche = '落花|流水|残月|孤灯|归鸿|西风|烟雨|红尘|芳华|流年|时光|缱绻|阑珊|氤氲|断肠|天涯|梦回';
  const hit = [...new Set(body.match(new RegExp(cliche, 'g')) || [])];
  if (hit.length) console.log('   ⚠ 陈词：' + hit.join('、'));
  const junk = body.replace(/[，。？！；：、\u4e00-\u9fff\s]/g, '');
  if (junk) console.log('   ⚠ 异常字符：' + junk);
}

for (let i = 0; i < CASES.length; i++) {
  try {
    await one(CASES[i], i);
  } catch (e) {
    console.log(`#${i + 1} 失败：`, e.message);
  }
}
