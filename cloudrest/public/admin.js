// 云卷云舒 · 管理页（付款确认与兑换码）
//
// 口令就是站点密钥。存在 localStorage，请求时放在 X-Access-Key 头里 ——
// 不放网址里（会进浏览器历史与服务器访问日志），也不放 Cookie（会和用户的密钥凭证混淆）。

const $ = (s) => document.querySelector(s);
const KEY_STORE = 'qiyun.admin.key';

const el = {
  key: $('#akey'),
  save: $('#asave'),
  msg: $('#amsg'),
  refresh: $('#arefresh'),
  cmsg: $('#cmsg'),
  claims: $('#claims'),
  count: $('#ncount'),
  credits: $('#ncredits'),
  note: $('#nnote'),
  gen: $('#agen'),
  codes: $('#codes'),
};

el.key.value = localStorage.getItem(KEY_STORE) || '';

function say(node, text, warn = false) {
  node.textContent = text || '';
  node.className = node.className.replace(/\s*(warn|ok)\b/g, '') + (text ? (warn ? ' warn' : ' ok') : '');
}

async function api(method, path, body) {
  const r = await fetch(path, {
    method,
    headers: {
      'X-Access-Key': el.key.value.trim(),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({}));
  return { status: r.status, ok: r.ok, d };
}

const when = (ms) => (ms ? new Date(ms).toLocaleString('zh-CN', { hour12: false }) : '');

/* ---------------- 待审认领 ---------------- */

async function loadClaims() {
  say(el.cmsg, '读取中……');
  const { ok, status, d } = await api('GET', '/api/admin/claims?status=pending');
  if (!ok) {
    el.claims.replaceChildren();
    return say(el.cmsg, d.error || `读取失败（${status}）`, true);
  }
  const rows = d.claims || [];
  say(el.cmsg, rows.length ? `${rows.length} 条待审` : '没有待审的');

  if (!rows.length) {
    el.claims.replaceChildren(Object.assign(document.createElement('p'), { className: 'sheet-sub', textContent: '（空）' }));
    return;
  }

  const table = document.createElement('table');
  table.innerHTML = '<thead><tr><th>时间</th><th>账号</th><th>备注</th><th>操作</th></tr></thead>';
  const tb = document.createElement('tbody');
  for (const c of rows) {
    const tr = document.createElement('tr');
    const td1 = document.createElement('td');
    td1.textContent = when(c.at);
    const td2 = document.createElement('td');
    td2.textContent = c.email;
    const td3 = document.createElement('td');
    td3.textContent = c.note || '（无）';
    const td4 = document.createElement('td');

    const yes = document.createElement('button');
    yes.className = 'tb-btn primary';
    yes.type = 'button';
    yes.textContent = '通过 +10';
    yes.addEventListener('click', async () => {
      yes.disabled = true;
      const r = await api('POST', '/api/admin/claims', { id: c.id, approve: true, credits: 10 });
      say(el.cmsg, r.ok ? `已给 ${c.email} 加 10 次` : r.d.error || '操作失败', !r.ok);
      if (r.ok) loadClaims();
      else yes.disabled = false;
    });

    const no = document.createElement('button');
    no.className = 'tb-btn ghost';
    no.type = 'button';
    no.textContent = '否掉';
    no.addEventListener('click', async () => {
      no.disabled = true;
      const r = await api('POST', '/api/admin/claims', { id: c.id, approve: false });
      say(el.cmsg, r.ok ? '已否掉' : r.d.error || '操作失败', !r.ok);
      if (r.ok) loadClaims();
      else no.disabled = false;
    });

    td4.append(yes, no);
    tr.append(td1, td2, td3, td4);
    tb.appendChild(tr);
  }
  table.appendChild(tb);
  el.claims.replaceChildren(table);
}

/* ---------------- 兑换码 ---------------- */

async function loadCodes() {
  const { ok, d } = await api('GET', '/api/admin/codes');
  if (!ok) return;
  const rows = d.codes || [];
  if (!rows.length) {
    el.codes.replaceChildren();
    return;
  }
  const table = document.createElement('table');
  table.innerHTML = '<thead><tr><th>码</th><th>次数</th><th>状态</th><th>生成时间</th></tr></thead>';
  const tb = document.createElement('tbody');
  for (const c of rows) {
    const tr = document.createElement('tr');
    const td1 = document.createElement('td');
    const code = document.createElement('code');
    code.textContent = c.code;
    td1.appendChild(code);
    const td2 = document.createElement('td');
    td2.textContent = String(c.credits);
    const td3 = document.createElement('td');
    td3.textContent = c.used_by ? `已用（用户 #${c.used_by}，${when(c.used_at)}）` : '未用';
    const td4 = document.createElement('td');
    td4.textContent = when(c.created_at);
    tr.append(td1, td2, td3, td4);
    tb.appendChild(tr);
  }
  table.appendChild(tb);
  el.codes.replaceChildren(table);
}

async function generate() {
  say(el.cmsg, '生成中……');
  const { ok, status, d } = await api('POST', '/api/admin/codes', {
    count: Number(el.count.value) || 10,
    credits: Number(el.credits.value) || 10,
    note: el.note.value.trim(),
  });
  if (!ok) return say(el.cmsg, d.error || `生成失败（${status}）`, true);
  say(el.cmsg, `生成了 ${d.codes.length} 个码，每码 ${d.credits} 次`);
  loadCodes();
}

/* ---------------- 事件 ---------------- */

el.save.addEventListener('click', async () => {
  localStorage.setItem(KEY_STORE, el.key.value.trim());
  const { ok, d } = await api('GET', '/api/admin/claims');
  if (ok) {
    say(el.msg, '口令可用');
    loadClaims();
    loadCodes();
  } else {
    say(el.msg, d.error || '口令不对', true);
  }
});
el.key.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') el.save.click();
});
el.refresh.addEventListener('click', loadClaims);
el.gen.addEventListener('click', generate);

// 打开就用记住的口令试一次
if (el.key.value) el.save.click();
