// 云卷云舒 · 登录 / 注册 与小启（独立页面）
//
// 为什么单独一页，而不是主页上那个居中弹窗：
//   弹窗卡在内容中间、内容长了还要在弹窗里滚，站长说别扭。
//   拆成独立页之后：一屏放得下，不必滚；主页也不再被盖住；
//   而且可以直接把 /account.html#ask 当成「怎么拿钥匙」的固定地址发出去。
//
// 这一页不碰诗词逻辑，只做三件事：注册、登录、看当前身份。

const $ = (sel) => document.querySelector(sel);

const els = {
  email: $('#auEmail'),
  pass: $('#auPass'),
  msg: $('#auMsg'),
  login: $('#auLogin'),
  register: $('#auRegister'),
  who: $('#who'),
  whoSub: $('#whoSub'),
  logout: $('#auLogout'),
  unkey: $('#auUnkey'),
};

let state = null;

const api = async (method, path, body) => {
  const r = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({}));
  return { status: r.status, ok: r.ok, d };
};

function say(text, warn = false) {
  els.msg.textContent = text || '';
  els.msg.className = 'card-msg' + (text ? (warn ? ' warn' : ' ok') : '');
}

/* ---------------- 身份 ---------------- */

async function refresh() {
  const { status, ok, d } = await api('GET', '/api/me');
  if (status === 404) {
    // Node 版没有账号接口
    state = { accounts: false, localOnly: true };
  } else if (ok) {
    state = d;
  }
  render();
}

function render() {
  const s = state || {};
  const bits = [];
  if (s.key) bits.push('密钥已应用 · 不限次');
  else if (s.loggedIn) bits.push(s.email, `免费还剩 ${s.freeLeft} 次` + (s.credits ? `，余额 ${s.credits} 次` : ''));
  else if (s.localOnly) bits.push('本地版：账号功能只在线上启用');
  else if (!s.accounts) bits.push('这个站的额度功能还没开通');
  else bits.push('未登录');

  if (s.loggedIn || s.key) {
    els.who.hidden = false;
    els.whoSub.textContent = bits.join('　·　');
    els.unkey.hidden = !s.key;
  } else {
    els.who.hidden = true;
  }
}

/* ---------------- 动作 ---------------- */

async function doAuth(which) {
  const email = els.email.value.trim();
  const password = els.pass.value;
  if (!email || !password) return say('邮箱和密码都要填', true);
  say('处理中……');
  const { status, d } = await api('POST', which === 'register' ? '/api/register' : '/api/login', { email, password });
  if (status !== 200) return say(d.error || `失败（${status}）`, true);
  els.pass.value = '';
  say(which === 'register' ? '注册好了，可以回去写诗了' : '登录成功');
  await refresh();
  // 回主页去写 —— 来这一页的目的就是解锁写诗
  setTimeout(() => {
    location.href = '/';
  }, 700);
}

els.login.addEventListener('click', () => doAuth('login'));
els.register.addEventListener('click', () => doAuth('register'));
els.pass.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doAuth('login');
});
els.email.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') els.pass.focus();
});
els.logout.addEventListener('click', async () => {
  await api('POST', '/api/logout');
  say('已退出登录');
  await refresh();
});
els.unkey.addEventListener('click', async () => {
  await api('DELETE', '/api/key');
  say('已取消密钥');
  await refresh();
});

// 从主页被 401/402 推过来时，把原因显示出来（主页把原因塞进了 sessionStorage）
try {
  const why = sessionStorage.getItem('qy.reason');
  if (why) {
    sessionStorage.removeItem('qy.reason');
    say(why, true);
  }
} catch {
  /* 隐私模式 */
}

refresh();

// 直接落在 #ask 上时，把它滚进视野（否则用户会以为没找到）
if (location.hash === '#ask') {
  const ask = document.getElementById('ask');
  requestAnimationFrame(() => ask?.scrollIntoView?.({ block: 'nearest' }));
}
