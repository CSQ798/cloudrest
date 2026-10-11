// 云卷云舒 · 主页工具栏（登录状态、剩余次数、密钥）
//
// 登录与小启**不在这里开弹窗了** —— 它们改成跳 /account.html。
// 站长说那个「卡在内容中间、还要在里面滚」的弹窗很别扭，所以：
//   · 未登录时，「登录 / 注册」是一个链接，跳到独立页面；
//   · 小启也是一个链接，跳到 /account.html#ask；
//   · 只有密钥还在这一行里直接填（它即时生效，值得留在原地）。
//
// 主页只负责显示状态；注册、登录、看身份那套都在 account-page.js 里。

const $ = (sel) => document.querySelector(sel);

const els = {
  user: $('#tbUser'),
  quota: $('#tbQuota'),
  login: $('#tbLogin'),
  logout: $('#tbLogout'),
  key: $('#tbKey'),
  keyGo: $('#tbKeyGo'),
  ask: $('#tbAsk'),
};

// 页面没带工具栏（比如被嵌进别处）就什么都不做
if (els.user && els.login) start();

function start() {
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

  /* ---------------- 显示 ---------------- */

  function render() {
    const s = state;
    if (!s) {
      els.user.textContent = '……';
      els.quota.textContent = '';
      return;
    }

    // 顺序要紧：先判密钥，再判账号功能开没开。
    // （反过来会把「密钥已应用」盖掉，用户点了「应用」界面纹丝不动。）
    if (s.key) {
      els.user.textContent = '密钥已应用';
      els.quota.textContent = s.accounts ? '不限次' : '不限次（额度功能仍未启用）';
      els.quota.className = 'tb-quota ok';
      els.key.value = '';
      els.key.hidden = true;
      els.keyGo.hidden = true;
      els.login.hidden = true;
      els.logout.hidden = false;
      setBanner(s.accounts ? '' : BANNER_NO_DB, BANNER_NO_DB_STEPS);
      return;
    }

    els.key.hidden = false;
    els.keyGo.hidden = false;
    els.keyGo.disabled = false;
    els.key.placeholder = '密钥';

    if (!s.accounts) {
      els.user.textContent = s.localOnly ? '本地版' : '未登录';
      els.quota.textContent = s.localOnly ? '账号功能只在线上启用' : '额度功能还没开通';
      els.quota.className = 'tb-quota warn';
      els.login.hidden = false;
      els.logout.hidden = true;
      setBanner(s.localOnly ? '' : BANNER_NO_DB, BANNER_NO_DB_STEPS);
      return;
    }

    setBanner(s.sessionReady ? '' : BANNER_NO_SECRET);
    els.login.hidden = Boolean(s.loggedIn);
    els.logout.hidden = !s.loggedIn;
    els.login.classList.toggle('primary', !s.loggedIn);

    if (!s.loggedIn) {
      els.user.textContent = '未登录';
      els.quota.textContent = `登录后免费 ${s.freeLimit || 5} 次`;
      els.quota.className = 'tb-quota';
      return;
    }

    els.user.textContent = s.email;
    const left = Number(s.left) || 0;
    const parts = [];
    if (s.freeLeft > 0) parts.push(`免费 ${s.freeLeft}/${s.freeLimit}`);
    if (s.credits > 0) parts.push(`余额 ${s.credits}`);
    els.quota.textContent = left > 0 ? parts.join('　') : '次数已用完';
    els.quota.className = 'tb-quota' + (left > 0 ? (s.freeLeft > 0 ? '' : ' paid') : ' out');
    // 次数见底时把「小启」点亮 —— 那正是他该点它的时候
    els.ask.classList.toggle('strong', left <= 0);
  }

  /* ---------------- 顶部告警条 ---------------- */

  const BANNER_NO_DB =
    '这个站的额度功能还没开通：注册、免费 5 次暂时都不能用，现在只有输入过密钥的人能写诗。';
  const BANNER_NO_DB_STEPS = [
    '开通两步，都在 Cloudflare 控制台：',
    '',
    '① 左边菜单 Storage & Databases → D1 → Create，名字随便起（例如 yunjuan）。',
    '② 回到本项目的 Settings → Functions，找到 D1 那一栏，把这个库加进去，',
    '   名称填 DB（代码认的就是这三个字符）。表结构不用管，站点第一次用到时会自己建好。',
    '',
    '做完重新部署一次即可。详见 ACCOUNTS.md。',
  ].join('\n');
  const BANNER_NO_SECRET =
    '登录暂时还不能用：服务端少配了一项（SESSION_SECRET），详见 ACCOUNTS.md。在这之前，有密钥的人仍然可以正常写。';

  function setBanner(text, detail) {
    let bar = document.getElementById('tbBanner');
    if (!text) {
      if (bar) bar.hidden = true;
      return;
    }
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'tbBanner';
      bar.className = 'tb-banner';
      bar.innerHTML =
        '<span class="tb-banner-text"></span>' +
        '<button type="button" class="tb-banner-more" hidden></button>' +
        '<pre class="tb-banner-detail" hidden></pre>';
      document.getElementById('toolbar').insertAdjacentElement('afterend', bar);
    }
    bar.querySelector('.tb-banner-text').textContent = text;
    const more = bar.querySelector('.tb-banner-more');
    const pre = bar.querySelector('.tb-banner-detail');
    if (detail) {
      pre.textContent = detail;
      more.hidden = false;
      more.textContent = '怎么开通？';
      more.onclick = () => {
        pre.hidden = !pre.hidden;
        more.textContent = pre.hidden ? '怎么开通？' : '收起';
      };
    } else {
      more.hidden = true;
      pre.hidden = true;
    }
    bar.hidden = false;
  }

  /* ---------------- 动作 ---------------- */

  async function refresh() {
    const { status, ok, d } = await api('GET', '/api/me');
    if (status === 404) {
      state = { accounts: false, localOnly: true };
      render();
      return state;
    }
    if (ok) {
      state = d;
      render();
    }
    return state;
  }

  async function applyKey() {
    const key = els.key.value.trim();
    if (!key) {
      els.key.focus();
      return;
    }
    els.keyGo.disabled = true;
    els.keyGo.textContent = '…';
    const { status, d } = await api('POST', '/api/key', { key });
    els.keyGo.textContent = '应用';
    if (status === 200) {
      els.key.value = '';
      // 立刻按「密钥已生效」显示，不等 /api/me 回来 —— 点了要有反应
      state = { ...(state || {}), key: true, unlimited: true, left: -1 };
      render();
      await refresh();
      return;
    }
    els.keyGo.disabled = false;
    hint(d.error || `密钥不对（${status}）`);
  }

  /** 主页没有面板可开了，所以把话写在中间那行提示上 */
  function hint(text) {
    const el = document.getElementById('hint');
    if (!el) return;
    el.textContent = text;
    el.classList.add('warn');
  }

  els.logout.addEventListener('click', async () => {
    await api('DELETE', '/api/key');
    await api('POST', '/api/logout');
    state = null;
    await refresh();
  });
  els.keyGo.addEventListener('click', applyKey);
  els.key.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') applyKey();
  });

  /* ---------------- 给 app.js 的接口 ---------------- */

  globalThis.QYAccount = {
    refresh,
    /**
     * app.js 撞上 401 / 402 / 503 时叫它。
     * 现在不再弹面板（没有面板了）：把原因写进提示行、把「登录 / 注册」点亮，
     * 并把原因暂存起来 —— 用户点进 /account.html 时会看到它。
     */
    needAuth(reason) {
      if (reason) {
        hint(reason);
        try {
          sessionStorage.setItem('qy.reason', reason);
        } catch {
          /* 隐私模式 */
        }
      }
      els.login.classList.add('primary', 'strong');
      els.login.hidden = false;
    },
    /** 出一首诗之后同步最新余额 */
    onUsage(u) {
      if (state && u && typeof u.left === 'number' && u.left >= 0) {
        state.freeLeft = u.freeLeft ?? state.freeLeft;
        state.credits = u.credits ?? state.credits;
        state.left = u.left;
        render();
      }
    },
  };

  refresh();
}
