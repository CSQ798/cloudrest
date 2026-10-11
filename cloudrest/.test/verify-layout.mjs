// 验收：新排版（词的连排、诗的每两句一行）、词语注释、白话翻译、标题形式
//
// 走真实 HTTP —— 因为这几件事的链路是「模型输出 → 服务端排版 → 前端渲染」，
// 只看前端的桩测不出来中间的排版。
//
// 用法（先起本地服务）：
//   node .test/serve-local.mjs 8802
//   node .test/verify-layout.mjs http://127.0.0.1:8802
//
// 只做**两次**真实成诗（诗一次、词一次），每次都要花钱调模型。

const BASE = (process.argv[2] || 'http://127.0.0.1:8802').replace(/\/$/, '');

let bad = 0;
const ok = (c, label, extra = '') => {
  if (!c) bad++;
  console.log(`  ${c ? '✓' : '✗'} ${label}${extra ? '　' + extra : ''}`);
};

// 密钥身份：本地服务认 ACCESS_KEY（默认 798798）
const jar = new Map();
const cookies = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');

const call = async (method, path, body) => {
  const headers = {};
  if (jar.size) headers.cookie = cookies();
  if (body !== undefined) headers['content-type'] = 'application/json';
  const r = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  for (const c of set) {
    const [kv] = String(c).split(';');
    const i = kv.indexOf('=');
    jar.set(kv.slice(0, i).trim(), decodeURIComponent(kv.slice(i + 1).trim()));
  }
  return r;
};

/** 跑一次成诗，把流里的 result 事件取回来 */
async function compose(scene, form) {
  const res = await call('POST', '/api/compose', { scene, form, mode: 'compose' });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error || `HTTP ${res.status}`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let out = null;
  let err = null;
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
      if (ev.type === 'result') out = ev;
      else if (ev.type === 'error') err = ev.message;
    }
  }
  if (err) throw new Error(err);
  if (!out) throw new Error('没有结果');
  return out;
}

console.log(`目标：${BASE}\n`);

// 用密钥身份，免得被额度拦住
let r = await call('POST', '/api/key', { key: process.env.ACCESS_KEY || '798798' });
console.log(r.ok ? '（已用密钥身份）\n' : '（密钥没通过，可能后面会被额度拦住）\n');

/* ---------- 一、诗 ---------- */
console.log('— 近体诗：每两句一行、加标点、标题下不标诗体 —');
try {
  const p = await compose('深秋傍晚，一个人在山中旧院听泉。', '七言律诗');
  const lines = p.lines || [];
  console.log(`\n   〔${p.title}〕`);
  for (const l of lines) console.log('     ' + (l || '·'));

  ok(lines.length === 4, '律诗八句排成四行（每两句一行）', String(lines.length));
  ok(lines.every((l) => /[，。？！]$/.test(l)), '每一行都以标点收尾');
  ok(lines.every((l) => (l.match(/[，。？！]/g) || []).length === 2 || lines.length <= 1), '每行两句、两个标点');
  ok(!/（.*）/.test(p.title) && !p.title.includes('·'), '诗的标题不带诗体、不带间隔点', p.title);
  ok(Boolean(p.notes), '有词语注释字段');
  ok(Boolean(p.translation), '有白话翻译字段');
  console.log(`\n   注释：${(p.notes || '').split('\n').slice(0, 3).join(' / ')}`);
  console.log(`   白话：${(p.translation || '').slice(0, 70)}…`);
} catch (e) {
  ok(false, '诗的那一轮', e.message);
}

/* ---------- 二、词 ---------- */
console.log('\n— 词：按韵位连排、上下阕空行、标题作「词牌·题」—');
try {
  const p = await compose('深秋傍晚，一个人在山中旧院听泉。', '水调歌头');
  const lines = p.lines || [];
  console.log(`\n   〔${p.title}〕`);
  for (const l of lines) console.log('     ' + (l || '·'));

  const gaps = lines.filter((l) => l === '').length;
  ok(gaps === 1, '上下阕之间恰好一个空行', String(gaps));
  ok(lines.length < 19, `没有逐句换行（19 句排成了 ${lines.filter(Boolean).length} 行）`);
  ok(p.title.startsWith('水调歌头·'), '标题是「词牌·题」的形式', p.title);
  ok(lines.filter(Boolean).every((l) => /[，。？！]$/.test(l)), '每一行都以标点收尾');
} catch (e) {
  ok(false, '词的那一轮', e.message);
}

/* ---------- 三、页面 ---------- */
console.log('\n— 页面 —');
for (const [path, needle, who] of [
  ['/', 'tbAsk', '主页'],
  ['/account.html', 'auEmail', '账号页'],
  ['/fx.js', 'data-spot', '柔光脚本'],
]) {
  const rr = await fetch(BASE + path);
  const t = await rr.text();
  ok(rr.status === 200 && t.includes(needle), `${who} ${path}`, `${rr.status}`);
}

console.log('\n' + '─'.repeat(58));
console.log(bad === 0 ? '排版验收全部通过' : `${bad} 项未通过`);
process.exit(bad ? 1 : 0);
