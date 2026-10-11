// 云卷云舒 · 前端
//
// 纸笺的版式算式在 card-layout.mjs 里（纯函数，可被测试驱动）——
// 之所以拆出去，是因为量错字体导致整行溢出纸面那种 bug，混在 canvas 绘制里
// 根本测不出来，只能靠肉眼。
// ⚠ 这里用**相对路径**，不是 '/card-layout.mjs'：绝对路径在浏览器里也对，
//   但在 Node 里执行 app.js 时会解析不到，于是测试跑不起来。
//   而这条 import 一旦漏掉某个名字（比如 PAD），只会在运行时炸，
//   又被「存为纸笺」那个 catch 吞成一句「画不出来」—— 所以它必须可被真跑一遍。
import { layoutCard, RULES_COLS, M, PAD, SEAL_SHAPE } from './card-layout.mjs';
//
// 用 file:// 直接双击打开时，浏览器会拦掉 ES 模块与 /api，表现是「页面对着、点落笔没反应」，
// 所以先拦一道把话说明白。
// （这段是内联样式，不走 CSS 变量，所以换配色时要单独跟着改。）
if (globalThis.location?.protocol === 'file:') {
  globalThis.document.documentElement.innerHTML =
    '<body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#f5f9ff;' +
    'color:#0e1c30;font-family:system-ui,sans-serif;text-align:center;padding:24px;line-height:1.9">' +
    '<div>' +
    '<div style="font-family:serif;font-size:30px;letter-spacing:.16em;color:#3d7ff0">云卷云舒</div>' +
    '<p style="margin:22px 0 0;font-size:15px">这个页面要走服务端才能写诗，不能直接双击打开。</p>' +
    '<p style="margin:14px 0 0;font-size:14px;color:#5b6b83">先启动服务：' +
    '<code style="background:#e2ecfa;padding:2px 6px;border-radius:3px">node server.js</code><br>' +
    '再访问 <a href="http://127.0.0.1:7788" style="color:#3d7ff0">http://127.0.0.1:7788</a></p>' +
    '</div></body>';
} else {
  start();
}

function start() {
  const $ = (sel) => document.querySelector(sel);

  const sceneEl = $('#scene');
  const wishEl = $('#wish');
  const composeBtn = $('#compose');
  const refineBtn = $('#refine');
  const hintEl = $('#hint');
  const hint2El = $('#hint2');
  const statusEl = $('#status');
  const formNoteEl = $('#formNote');
  const clearFormBtn = $('#clearForm');
  const formsEl = $('#forms');
  const ownFormEl = $('#ownForm');  const ownFormNoteEl = $('#ownFormNote');
  const poetsEl = $('#poets');
  const poetNoteEl = $('#poetNote');
  const poemWrap = $('#poemWrap');
  const sceneLineEl = $('.poem-scene');
  const titleEl = $('.poem-title');
  const bodyEl = $('.poem-body');
  const sealEl = $('.seal');
  const verdictEl = $('#verdict');
  const actionsEl = $('#actions');
  const toastEl = $('#toast');
  const mindEl = $('#mind');

  const PLACEHOLDERS = [
    '比如：夏末傍晚，祖母在灶前煮面，我在门边看她弯腰。',
    '比如：加班到十一点，出楼时风把梧桐叶吹得很响。',
    '比如：搬家那天，房间空了，阳台的晾衣杆上还挂着一个旧衣架。',
    '比如：深夜的医院走廊，长椅上有人抱着外套睡着了。',
    '比如：在异乡的超市听见有人用家乡话说话，回头却不认识。',
    '比如：周末早上被雨声吵醒，不想起床，猫在脚边睡着。',
  ];

  const state = {
    form: null, // 用户指定的体裁；null 表示由模型自选
    poet: null, // 借用的诗人笔法；null 表示不借
    busy: false,
    controller: null,
    poem: null, // 上一稿，供润色
  };

  let allForms = [];
  let shiForms = [];
  let tuneForms = [];
  let verifiedForms = [];
  let poetNames = [];

  /* ---------------- 右栏诗人 ---------------- */
  function renderPoets() {
    poetsEl.replaceChildren(
      ...poetNames.map((name) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = name;
        b.dataset.id = name;
        b.setAttribute('aria-pressed', String(state.poet === name));
        b.addEventListener('click', () => selectPoet(state.poet === name ? null : name));
        return b;
      })
    );
  }

  function selectPoet(name) {
    state.poet = name;
    for (const b of poetsEl.querySelectorAll('button')) {
      b.setAttribute('aria-pressed', String(b.dataset.id === state.poet));
    }
    poetNoteEl.textContent = state.poet
      ? `借${state.poet}的笔法：只看他怎么取景、怎么落句；成句绝不相袭。`
      : '选了诗人，它就用那位的眼睛与句法写你眼前的场景——但绝不套用其成句。';
  }

  /* ---------------- 右栏体裁 ---------------- */
  function renderForms() {
    if (!allForms.length) return;
    const groups = [
      { label: '近体诗', items: shiForms },
      { label: '词牌', items: tuneForms },
    ];
    const frag = document.createDocumentFragment();
    for (const g of groups) {
      if (!g.items.length) continue;
      const wrap = document.createElement('div');
      wrap.className = 'form-group';
      const lab = document.createElement('span');
      lab.className = 'quick-label';
      lab.textContent = g.label;
      wrap.appendChild(lab);
      const box = document.createElement('div');
      box.className = 'forms';
      for (const name of g.items) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = name;
        b.dataset.id = name;
        b.setAttribute('aria-pressed', String(state.form === name));
        b.addEventListener('click', () => selectForm(state.form === name ? null : name));
        box.appendChild(b);
      }
      wrap.appendChild(box);
      frag.appendChild(wrap);
    }
    formsEl.replaceChildren(frag);
  }

  function selectForm(name) {
    state.form = name;
    for (const b of formsEl.querySelectorAll('button')) {
      b.setAttribute('aria-pressed', String(b.dataset.id === state.form));
    }
    if (name && !verifiedForms.includes(name)) ownFormEl.value = name;
    else if (name) ownFormEl.value = '';
    renderFormNote();
    renderOwnFormNote();
    clearFormBtn.hidden = !state.form;
  }

  /**
   * 体裁提示。
   * @param {string} [picked] 这次成诗实际用的体裁
   * @param {'user'|'model'} [source] 谁定的：用户点的，还是它自己择的
   *
   * 这个 source 参数是补上来的。第一版只有一个参数，于是**它自己择的体裁
   * 也被写成「你指定的」** —— 用户明明没点任何词牌，却被告知是自己指定的，
   * 这是个会让人怀疑按钮坏了的假象。归属必须说清。
   */
  function renderFormNote(picked, source) {
    const f = picked || state.form;
    if (!f) {
      formNoteEl.innerHTML = '体裁：待它自选';
      return;
    }
    const mine = source ? source === 'user' : state.form === f;
    formNoteEl.innerHTML = mine ? `体裁：<b>${f}</b>（你指定的）` : `体裁：<b>${f}</b>（它自选）`;
  }

  /** 自填词牌：已核验的会严格校律；未核验的如实说明只能校句式 */
  function renderOwnFormNote() {
    const v = (state.form || '').trim();
    if (!v) {
      ownFormNoteEl.textContent = '';
      return;
    }
    if (verifiedForms.includes(v)) {
      ownFormNoteEl.innerHTML = `《${v}》已核验词谱，会逐字校平仄与押韵。`;
    } else {
      ownFormNoteEl.innerHTML =
        `《${v}》我没有核验过的词谱：会请你先声明句式，再核对正文与声明是否一致，` +
        `但平仄与押韵只能靠它自己把握。想要严格校律，请从上表点选。`;
    }
  }

  /* ---------------- 提示 ---------------- */
  function say(text, warn = false) {
    hintEl.textContent = text;
    hintEl.classList.toggle('warn', warn);
  }

  let toastTimer = 0;
  function toast(text) {
    toastEl.textContent = text;
    toastEl.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('on'), 2200);
  }

  /* ---------------- 左栏渲染 ---------------- */
  function renderMind(parts) {
    const shown = parts.filter((p) => p && p.text && p.text.trim());
    if (!shown.length) {
      mindEl.replaceChildren(Object.assign(document.createElement('p'), { className: 'empty', textContent: '（这一稿没有留下说明）' }));
      return;
    }
    const frag = document.createDocumentFragment();
    for (const p of shown) {
      const box = document.createElement('div');
      box.className = 'part';
      const lab = document.createElement('p');
      lab.className = 'part-label';
      lab.textContent = p.label;
      const txt = document.createElement('p');
      txt.className = 'part-text' + (p.strong ? ' strong' : '');
      txt.textContent = p.text.trim();
      box.append(lab, txt);
      frag.appendChild(box);
    }
    mindEl.replaceChildren(frag);
    mindEl.scrollTop = 0;
  }

  /* ---------------- 中栏渲染 ---------------- */
  /**
   * @param {object} data 服务端的 result 事件
   *
   * 换行由**服务端**决定（data.lines）：诗每两句一行、词按句读连排并加标点、
   * 片与片之间空一行。前端不自己分组 —— 哪几个小句合成一句只有服务端知道
   * （server/tunes.mjs 的 MARKS 与 lens），前端手里只有体裁名字，猜不出该在哪里断行。
   */
  function renderPoem(data) {
    sceneLineEl.textContent = data.scene || '';
    titleEl.textContent = data.title || '';
    bodyEl.replaceChildren();

    // 没有 lines（老版本服务端）时退回到「一句一行」，至少不会白屏
    const display = Array.isArray(data.lines) && data.lines.length
      ? data.lines
      : String(data.body || '').split('\n').map((l) => l.trim());

    for (const line of display) {
      const text = String(line);
      const d = document.createElement('div');
      if (!text.trim()) {
        d.className = 'stanza-gap';
      } else {
        d.className = 'line';
        // 中栏比纸笺窄，一行十几个字免不了折行。中文允许在任意字之间折，可诗里
        // 「不语看花花尽落，」被劈成两半就难看了。所以把每一个**小句**（到逗号/顿号/
        // 句号/问号为止）各自包成一个 inline-block —— 折行只发生在标点之后。
        // 不用后行断言（(?<=…)），老 Safari 会直接语法报错，整份 app.js 都跑不起来。
        for (const ju of text.match(/[^，、。？！]*[，、。？！]|[^，、。？！]+/g) || [text]) {
          const s = document.createElement('span');
          s.className = 'ju';
          s.textContent = ju;
          d.appendChild(s);
        }
      }
      bodyEl.appendChild(d);
    }

    sealEl.classList.add('on');
    actionsEl.hidden = false;
    poemWrap.hidden = false;
  }

  /** 词语注释：服务端给的是「词｜注」的若干行 */
  function parseNotes(raw) {
    return String(raw || '')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !/^无须注/.test(l))
      .map((l) => {
        const i = l.search(/[｜|]/);
        return i > 0 ? { word: l.slice(0, i).trim(), note: l.slice(i + 1).trim() } : { word: '', note: l };
      });
  }

  function renderVerdict(form, verdict, tries, verified = true, meter = '') {
    verdictEl.replaceChildren();
    if (!verdict) return;
    const head = document.createElement('div');
    const toneMiss = verdict.stats && verdict.stats.平仄出入 ? verdict.stats.平仄出入 : 0;
    const triesNote = tries > 1 ? `（共斟酌 ${tries} 遍）` : '';

    if (!verified) {
      const pattern = verdict.stats && verdict.stats.句式 ? verdict.stats.句式 : '';
      head.innerHTML =
        `<span class="warn-line">未核验词谱</span>：我没有《${form}》的权威词谱，` +
        `故只能核对正文与它自述的句式是否一致${pattern ? `（实际句式 ${pattern}）` : ''}${triesNote}；` +
        `平仄与押韵未经校对。要严格校律，请点选左表已核验的词牌。`;
      verdictEl.appendChild(head);
      const issues0 = (verdict.issues || []).filter((i) => i.severity === 'warn');
      if (issues0.length) {
        const ul0 = document.createElement('ul');
        for (const i of issues0) {
          const li = document.createElement('li');
          li.textContent = i.text;
          ul0.appendChild(li);
        }
        verdictEl.appendChild(ul0);
      }
      return;
    }

    if (verdict.level === 'ok') {
      head.innerHTML = `<span class="ok">合律</span>：句数、字数、平仄与押韵均依《${form}》谱校过${triesNote}。`;
    } else if (verdict.level === 'warn') {
      head.innerHTML = toneMiss
        ? `<span class="warn-line">大体合律</span>：句数、字数与押韵已合；平仄尚有 ${toneMiss} 处出入${triesNote}，此为几稿中最合者。`
        : `<span class="warn-line">大体合律</span>：句数、字数与押韵已合，个别处平仄未安${triesNote}。`;
    } else {
      head.innerHTML = `<span class="err-line">尚有不合</span>：此稿未能完全合《${form}》之律${triesNote}，已尽力重写。`;
    }
    verdictEl.appendChild(head);

    const issues = (verdict.issues || []).filter((i) => i.severity === 'warn');
    if (issues.length) {
      const ul = document.createElement('ul');
      for (const i of issues) {
        const li = document.createElement('li');
        li.textContent = i.text;
        ul.appendChild(li);
      }
      verdictEl.appendChild(ul);
    }
  }

  /* ---------------- 流程 ---------------- */
  async function compose({ skipChoose = false } = {}) {
    const scene = sceneEl.value.trim();
    if (scene.length < 2) {
      say('再写一点点吧，一两个词也好。', true);
      sceneEl.focus();
      return;
    }
    if (state.busy) return;

    state.busy = true;
    composeBtn.textContent = '停笔';
    refineBtn.disabled = true;
    say('正在读你的场景……');
    hint2El.textContent = '';

    let form = state.form;
    let allusionIds = [];
    try {
      if (!form && !skipChoose) {
        const r = await fetch('/api/choose', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scene, wish: wishEl.value.trim(), poet: state.poet || '' }),
        });
        const d = await r.json();
        if (!r.ok) {
          if (r.status === 401 || r.status === 402) globalThis.QYAccount?.needAuth?.(d.error);
          throw new Error(d.error || `择体失败（${r.status}）`);
        }
        form = d.form;
        allusionIds = Array.isArray(d.allusions) ? d.allusions : [];
        renderFormNote(form, 'model');
        say(`它择了《${form}》：${d.reason || ''}`);
      }
      await runCompose({ scene, form, mode: 'compose', allusionIds });
    } catch (err) {
      say(err?.message || '出了点岔子，再试一次。', true);
    } finally {
      state.busy = false;
      composeBtn.textContent = '落笔';
      refineBtn.disabled = !state.poem;
    }
  }

  async function refine() {
    const wish = wishEl.value.trim();
    if (!wish) {
      hint2El.textContent = '请先写下你的新要求。';
      wishEl.focus();
      return;
    }
    if (!state.poem) {
      hint2El.textContent = '还没有成诗，先落笔一次。';
      return;
    }
    if (state.busy) return;

    state.busy = true;
    refineBtn.disabled = true;
    composeBtn.disabled = true;
    hint2El.textContent = '正在照你的要求改……';

    try {
      const form = state.form || state.poem.form;
      await runCompose({ scene: sceneEl.value.trim(), form, mode: 'refine', wish, previous: state.poem });
    } catch (err) {
      hint2El.textContent = err?.message || '润色失败，再试一次。';
    } finally {
      state.busy = false;
      refineBtn.disabled = false;
      composeBtn.disabled = false;
    }
  }

  async function runCompose({ scene, form, mode, wish = '', previous = null, allusionIds = [] }) {
    const controller = new AbortController();
    state.controller = controller;
    const res = await fetch('/api/compose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scene, form, mode, wish, poet: state.poet || '', allusions: allusionIds, previous }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      // 401 没登录 / 402 额度用完：顺手把账号面板打开，别让用户对着红字猜
      if (res.status === 401 || res.status === 402) globalThis.QYAccount?.needAuth?.(d.error);
      throw new Error(d.error || `请求失败（${res.status}）`);
    }

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let payload = null;
    let failed = null;

    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let cut;
      while ((cut = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, cut).trim();
        buf = buf.slice(cut + 1);
        if (!line) continue;
        let ev;
        try {
          ev = JSON.parse(line);
        } catch {
          continue;
        }
        if (ev.type === 'start') {
          say(`正在按《${ev.form}》的格律落笔……它可能反复斟酌几遍。`);
        } else if (ev.type === 'status') {
          say(ev.hint || '正在重写……');
        } else if (ev.type === 'result') {
          payload = ev;
        } else if (ev.type === 'usage') {
          // 服务端回报最新余额（账号系统没启用时不会发这个事件）
          globalThis.QYAccount?.onUsage?.(ev);
        } else if (ev.type === 'error') {
          failed = ev.message;
        }
      }
    }
    if (failed) throw new Error(failed);
    if (!payload) throw new Error('这次没有结果返回，可再试一次');

    // 落定
    state.poem = {
      form: payload.form,
      body: payload.body,
      lines: payload.lines,
      scene: payload.scene,
      title: payload.title || '',
      meter: payload.meter || '',
      allusion: payload.allusion,
      devices: payload.devices,
      notes: payload.notes,
      translation: payload.translation,
      appraisal: payload.appraisal,
      change: payload.change,
    };
    renderPoem(payload);
    const notes = parseNotes(payload.notes);
    renderMind([
      payload.poet ? { label: '笔法', text: `借${payload.poet}的笔法（只学取景与句法，成句不相袭）` } : null,
      { label: '取景', text: payload.scene },
      // 立意：站长要「诗里要有哲思」，所以这一条既是对它的要求，也是给他核对的地方 ——
      // 说清那一层想头落在哪一句、由哪一处景生出。
      // 境界：《人间词话》的判据。服务端按「物是否著我之色彩」判，它自己也报一份，
      // 两栏并排摆着 —— 写的是哪一境、有没有说着一种写着另一种，一眼看得出。
      payload.realm || payload.realmNote
        ? {
            label: '境界（有我之境 / 无我之境）',
            text:
              (payload.realm
                ? '此稿判为「' +
                  payload.realm.type +
                  '」' +
                  (payload.realm.type === '无我之境'
                    ? '（以物观物：通篇无情绪字、无「我」字）'
                    : '（物皆著我之色彩：' +
                      ((payload.realm.feelings || []).slice(0, 4).join('、') || '有「我」字') +
                      '）')
                : '') +
              (payload.realm && payload.realm.make
                ? '\n造境/写境：证据更像「' +
                  payload.realm.make +
                  '」（与场景相接的实字 ' +
                  payload.realm.overlap +
                  ' 个' +
                  (payload.realm.virtual.length + payload.realm.hyperbole.length
                    ? '，虚拟/夸张词 ' +
                      payload.realm.virtual.concat(payload.realm.hyperbole).join('、')
                    : '') +
                  '）'
                : '') +
              (payload.realmNote ? '\n它的说法：' + payload.realmNote : ''),
          }
        : null,
      payload.insight ? { label: '立意（诗里的那一层想头）', text: payload.insight } : null,
      // 选韵：韵部与声情由**服务端**算出（词用词林正韵、诗用平水韵），
      // 它自己那句话并列摆着，一比就知道它说的和实际用的是不是一回事。
      payload.rhymePlan || payload.rhymeNote
        ? {
            label: '选韵（声情）',
            text:
              (payload.rhymePlan ? payload.rhymePlan.text : '') +
              (payload.rhymeNote ? `${payload.rhymePlan ? '\n' : ''}它的说法：${payload.rhymeNote}` : '') +
              (payload.voiceTip ? `\n⚠ ${payload.voiceTip}` : ''),
          }
        : null,
      // 白话翻译：给看不懂文言的人。放在取景之后、注释之前 ——
      // 先知道「写了什么」，再看「哪个字要解释」。
      payload.translation ? { label: '白话', text: payload.translation } : null,
      notes.length
        ? { label: '词语注释', text: notes.map((n) => (n.word ? `${n.word}：${n.note}` : n.note)).join('\n') }
        : null,
      !payload.verified && payload.meter ? { label: '所用句式', text: payload.meter } : null,
      { label: '用典', text: payload.allusion },
      { label: '修辞', text: payload.devices },
      payload.change ? { label: '这一稿改了什么', text: payload.change } : null,
      // 自省：它对自己这一稿的批评，以及是否据此改过
      payload.selfCritique
        ? {
            label: payload.revised ? '润色：它对自己上一稿的批评（据此改成了现在这首）' : '润色：它自觉尚欠，但未能改成',
            text:
              (payload.revisedFrom ? `上一稿：\n${payload.revisedFrom.split('\n').map((l) => '　' + l).join('\n')}\n\n` : '') +
              payload.selfCritique +
              (payload.reviseNote ? `\n改的方向：${payload.reviseNote}` : ''),
          }
        : null,
      // 诗病自检：格律之外那一层。「宜改」的已经在上面退回去重写过，
      // 还留在这里的是这一稿自己没法再改的 —— 摊给你看，你决定要不要让它接着改。
      payload.diagnosis && payload.diagnosis.findings.length
        ? {
            label: `诗病自检（${payload.diagnosis.findings.length} 处）`,
            text: payload.diagnosis.findings
              .map((fd) => `${fd.severity === 'warn' ? '【宜改】' : '【提示】'}${fd.name}：${fd.text}`)
              .join('\n'),
          }
        : null,
      { label: '这一稿的得意处', text: payload.appraisal, strong: true },
    ]);
    renderVerdict(payload.form, payload.verdict, payload.tries, payload.verified !== false, payload.meter);
    if (mode === 'refine') {
      hint2El.textContent = '改好了。还想改什么，继续写。';
      say('已照你的要求改过。');
    } else {
      say('诗成了。右边可以继续提要求，它会接着改。');
    }
    wishEl.value = mode === 'refine' ? '' : wishEl.value;
  }

  /* ---------------- 抄录 / 存图 ---------------- */
  function poemText() {
    const p = state.poem;
    if (!p) return '';
    // 抄出去也要是排好版的：诗两句一行、词按韵连排。
    // 服务端已经算好了（p.lines），这里不再自己拆句。
    const lines = Array.isArray(p.lines) && p.lines.length
      ? p.lines
      : String(p.body || '').split('\n').map((l) => l.trim());
    const notes = parseNotes(p.notes);
    return [
      p.title,
      '',
      ...lines,
      '',
      p.translation ? `白话：${p.translation}` : '',
      ...(notes.length ? ['', '注释：', ...notes.map((n) => (n.word ? `　${n.word}：${n.note}` : `　${n.note}`))] : []),
      '',
      p.scene ? `所写：${p.scene}` : '',
      '',
      '—— 云卷云舒',
    ]
      .filter((l, i, a) => !(l === '' && a[i - 1] === ''))
      .join('\n')
      .trim();
  }

  $('#copy').addEventListener('click', async () => {
    const text = poemText();
    try {
      await navigator.clipboard.writeText(text);
      toast('已抄入剪贴板');
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      toast('已抄入剪贴板');
    }
  });

  $('#again').addEventListener('click', () => {
    if (!state.busy) compose({ skipChoose: true });
  });

  $('#save').addEventListener('click', async () => {
    try {
      await downloadCard();
    } catch (e) {
      // 站长报过两次「这张纸笺画不出来」。这句兜底以前把真实原因吞了，
      // 页面上只剩一句含糊的话，我这边完全看不出是哪儿炸的。现在：
      //   一、真原因打进控制台（F12 能直接看到栈）；
      //   二、提示里带一句人话的原因，站长截图给我就够定位了。
      console.error('纸笺绘制失败：', e);
      toast(`这张纸笺画不出来（${(e && e.message) || '未知原因'}），先抄一份吧`);
    }
  });

  function wrapCJK(ctx, text, maxWidth) {
    const out = [];
    let line = '';
    for (const ch of text) {
      if (ctx.measureText(line + ch).width > maxWidth && line) {
        out.push(line);
        line = ch;
      } else line += ch;
    }
    if (line) out.push(line);
    return out.length ? out : [''];
  }

  /**
   * 纸笺。
   *
   * 重做过一版，因为站长说「太丑」。这一版的做法是把它当成**真的笺纸**来排：
   *   · 乌丝栏：正文区打上等距的淡蓝竖格 —— 这是诗笺最认得出的一处形制；
   *   · 双线框：外框细、内框更细，中间留气口；
   *   · 两句一行（p.lines 已由服务端按此排好），行距放宽，整块居中；
   *   · 取景与诗之间留一大段空白，让诗「落」下来，不挤在说明后面；
   *   · 全笺只出现一处「云卷云舒」—— 就是右下角那方两行两字的名章。
   */
  async function downloadCard() {
    const p = state.poem;
    if (!p) return;

    const canvas = document.createElement('canvas');
    const ctx0 = canvas.getContext('2d');

    // ⚠ 量宽度必须**连字体一起设**。
    // 第一版是 `wrapCJK(ctx0, ..., W - PAD*2 - 46)`，而那时 ctx0 还是默认的 10px，
    // 实际却按 18px 画 —— 于是取景那行只算出一行，画出来宽出纸面三分之一，
    // 右边被整段裁掉。这个闭包把「设字体」和「量宽」绑在一起，从根上绝掉这类错误。
    const measure = (text, font) => {
      ctx0.font = font;
      return ctx0.measureText(String(text)).width;
    };

    const display = Array.isArray(p.lines) && p.lines.length
      ? p.lines
      : String(p.body || '').split('\n').map((s) => s.trim());

    // 纸笺上的字必须与页面上中栏那套一模一样 —— 不然同一首诗在屏幕上看是一个样、
    // 存成纸笺又是另一个样。所以字体栈不在两处各写一份，直接读 CSS 变量 --serif
    // （中栏的 .poem-body 用的就是它）。读不到就让 card-layout.mjs 里的 SERIF 兜底。
    const serifStack = () => {
      try {
        return getComputedStyle(document.documentElement).getPropertyValue('--serif').trim();
      } catch {
        return '';
      }
    };

    // 版式全部由 card-layout.mjs 这个纯函数算出来（它可被测试驱动，
    // 见 .test/card-layout-test.mjs），这里只负责照着数字画。
    // fonts 也从它那儿拿回来 —— 量宽与绘制同出一处，才不会各说各话。
    const L = layoutCard(measure, { title: p.title, scene: p.scene, rows: display, serif: serifStack() });
    const { W, H, sceneLines, bodyRows, rulesTop, rulesBottom, colW, fonts } = L;

    // 尺寸算错（NaN、0、或大得离谱）时 canvas 会静默变成一张空图，
    // toBlob 直接回 null，页面上只留下「画不出来」四个字，看不出所以然。
    // 所以先自检，把原因说成人话。
    if (!Number.isFinite(W) || !Number.isFinite(H) || W < 200 || H < 200) {
      throw new Error(`纸面尺寸没算对（${W}×${H}）`);
    }
    if (H > 12000 || W > 4000) {
      throw new Error(`纸面太长了（${W}×${H}）`);
    }

    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    // 字距（Chrome 99+ 支持；不支持就退化成没有字距，不影响可读）
    const tracking = (px) => {
      if ('letterSpacing' in ctx) ctx.letterSpacing = `${px}px`;
    };

    /* ---------- 纸 ---------- */
    ctx.fillStyle = '#fbfdff';
    ctx.fillRect(0, 0, W, H);
    const paper = ctx.createLinearGradient(0, 0, 0, H);
    paper.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
    paper.addColorStop(0.45, 'rgba(240, 246, 255, 0.55)');
    paper.addColorStop(1, 'rgba(228, 238, 252, 0.75)');
    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, W, H);

    /* ---------- 乌丝栏：正文区的等距竖格 ---------- */
    // rulesTop / rulesBottom / colW 都来自 card-layout.mjs，不再在这儿手算
    ctx.lineWidth = 1;
    for (let i = 0; i <= RULES_COLS; i++) {
      const x = Math.round(PAD + colW * i) + 0.5;
      // 最外两条稍显，中间的更淡 —— 格子在，但不抢字
      ctx.strokeStyle = i === 0 || i === RULES_COLS ? 'rgba(61, 127, 240, 0.16)' : 'rgba(61, 127, 240, 0.07)';
      ctx.beginPath();
      ctx.moveTo(x, rulesTop);
      ctx.lineTo(x, rulesBottom);
      ctx.stroke();
    }

    /* ---------- 双线框 ---------- */
    ctx.strokeStyle = 'rgba(20, 50, 90, 0.22)';
    ctx.lineWidth = 1;
    ctx.strokeRect(M.FRAME + 0.5, M.FRAME + 0.5, W - M.FRAME * 2 - 1, H - M.FRAME * 2 - 1);
    ctx.strokeStyle = 'rgba(20, 50, 90, 0.11)';
    ctx.strokeRect(M.FRAME_INNER + 0.5, M.FRAME_INNER + 0.5, W - M.FRAME_INNER * 2 - 1, H - M.FRAME_INNER * 2 - 1);

    /* ---------- 取景（小字，左侧一道细蓝竖线） ---------- */
    let y = M.TOP;
    if (sceneLines.length) {
      ctx.textAlign = 'left';
      ctx.font = fonts.scene;
      ctx.fillStyle = '#5b6b83';
      tracking(1);
      const barTop = y - 22;
      for (const line of sceneLines) {
        ctx.fillText(line, PAD + 26, y);
        y += M.SCENE_LH;
      }
      tracking(0);
      ctx.strokeStyle = 'rgba(61, 127, 240, 0.45)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(PAD + 6, barTop);
      ctx.lineTo(PAD + 6, y - 24);
      ctx.stroke();
    }

    /* ---------- 标题 ---------- */
    y += M.GAP_SCENE_TO_TITLE;
    if (p.title) {
      ctx.textAlign = 'center';
      ctx.font = fonts.title;
      ctx.fillStyle = '#0e1c30';
      tracking(6);
      ctx.fillText(p.title, W / 2, y);
      tracking(0);
      y += M.TITLE_LH;
    }

    /* ---------- 正文：两句一行 ---------- */
    y += M.GAP_TITLE_TO_BODY;
    ctx.textAlign = 'center';
    ctx.font = fonts.body;
    ctx.fillStyle = '#0e1c30';
    tracking(4);
    for (const row of bodyRows) {
      if (!row) {
        y += M.GAP_ROW;
        continue;
      }
      ctx.fillText(row, W / 2, y);
      y += M.BODY_LH;
    }
    tracking(0);

    /* ---------- 名章：全笺唯一的「云卷云舒」，两行两字 ----------
       重做过一版（站长说纸笺上这枚「和图一比太糙」）。旧版的毛病很具体：
       直角、2px 硬边、平涂底色、字距只有 1 —— 那是「画了个框」，不是印章。
       新版照网页上那枚的语言来（圆角、发丝边、半透明底、字要压得住），
       再加两处纸笺才有的讲究：外层一圈发丝、里层再一圈（朱文印的双线），
       底色用极淡的竖向渐变，字用 600 字重的宋体、字距 2。 */
    {
      const size = M.SEAL;
      const sx = W - M.FRAME_INNER - M.SEAL_MARGIN - size;
      const sy = H - M.FRAME_INNER - M.SEAL_MARGIN - size;
      const cx = sx + size / 2;
      const cy = sy + size / 2;

      // 圆角路径：优先用原生 roundRect，没有就手画（老 Safari 没有这个 API）
      const rrect = (x, y, w, h, r) => {
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(x, y, w, h, r);
          return;
        }
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
      };

      // 一、底：极淡的竖向渐变（平涂会显得像贴纸）
      const ink = ctx.createLinearGradient(0, sy, 0, sy + size);
      ink.addColorStop(0, 'rgba(61, 127, 240, 0.11)');
      ink.addColorStop(1, 'rgba(61, 127, 240, 0.045)');
      ctx.fillStyle = ink;
      if (SEAL_SHAPE === 'round') {
        ctx.beginPath();
        ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        rrect(sx, sy, size, size, M.SEAL_RADIUS);
        ctx.fill();
      }

      // 二、外圈：发丝（旧版是 2px @0.7，那是「描边」不是「边」）
      ctx.strokeStyle = 'rgba(61, 127, 240, 0.55)';
      ctx.lineWidth = 1.2;
      if (SEAL_SHAPE === 'round') {
        ctx.beginPath();
        ctx.arc(cx, cy, size / 2 - 0.6, 0, Math.PI * 2);
        ctx.stroke();
        // 里圈：圆印的内环
        ctx.strokeStyle = 'rgba(61, 127, 240, 0.16)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cx, cy, size / 2 - M.SEAL_INNER - 1, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        rrect(sx + 0.6, sy + 0.6, size - 1.2, size - 1.2, M.SEAL_RADIUS - 0.6);
        ctx.stroke();
        // 里圈：朱文印的双线
        ctx.strokeStyle = 'rgba(61, 127, 240, 0.16)';
        ctx.lineWidth = 1;
        rrect(sx + M.SEAL_INNER, sy + M.SEAL_INNER, size - M.SEAL_INNER * 2, size - M.SEAL_INNER * 2, M.SEAL_RADIUS - M.SEAL_INNER);
        ctx.stroke();
      }

      // 三、字：两行两字。行距与基线都按印面算，不再用「±2、+26」这类魔数
      ctx.fillStyle = '#3d7ff0';
      ctx.font = fonts.seal;
      ctx.textAlign = 'center';
      tracking(2);
      const lineGap = size * 0.30;
      ctx.fillText('云卷', cx, cy - lineGap / 2 + 4);
      ctx.fillText('云舒', cx, cy + lineGap / 2 + 4);
      tracking(0);
    }
    // 出图：优先 toBlob；它给了 null（个别浏览器在大画布上会这样）就退回 dataURL。
    // 两条路都走不通才认输，且认输时把原因说出来。
    const fileName = `${(p.title || p.form || '云卷云舒').replace(/[\\/:*?"<>|]/g, '')}.png`;
    const download = (href, revoke) => {
      const a = document.createElement('a');
      a.href = href;
      a.download = fileName;
      a.click();
      if (revoke) setTimeout(() => URL.revokeObjectURL(href), 4000);
      toast('已存为纸笺');
    };
    const byDataUrl = () => {
      let url = '';
      try {
        url = canvas.toDataURL('image/png');
      } catch {
        throw new Error('浏览器不给导出图片');
      }
      if (!url || !url.startsWith('data:image')) throw new Error('浏览器不给导出图片');
      download(url, false);
    };
    const blobOf = () =>
      new Promise((resolve, reject) => {
        if (typeof canvas.toBlob !== 'function') return resolve(null);
        try {
          canvas.toBlob((b) => resolve(b || null), 'image/png');
        } catch (e) {
          reject(e);
        }
      });

    // ── 存到哪里：浏览器不许网页自己往 D:\云卷云舒 写文件（这是安全边界，谁都一样）。
    //    能做到的是「另存为」对话框：**第一次让你选一次文件夹**，Chrome/Edge 会记住
    //    这个位置（同一个 id），以后就默认从这里开。若浏览器不支持（Firefox/Safari），
    //    只能存到浏览器的下载目录 —— 那种情况下面会给一句该怎么办的提示。
    let handle = null;
    if (typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function') {
      try {
        handle = await window.showSaveFilePicker({
          id: 'yunjuanshuyu-card',
          suggestedName: fileName,
          types: [{ description: '纸笺 PNG 图片', accept: { 'image/png': ['.png'] } }],
        });
      } catch (e) {
        if (e && e.name === 'AbortError') return; // 他自己按了取消，不出声
        handle = null; // 不给用就退回普通下载
      }
    }

    const blob = await blobOf();
    if (handle) {
      const w = await handle.createWritable();
      await w.write(blob || (await (await fetch(canvas.toDataURL('image/png'))).blob()));
      await w.close();
      toast('已存为纸笺');
      return;
    }
    if (blob) download(URL.createObjectURL(blob), true);
    else byDataUrl();
  }
  /* ---------------- 启动 ---------------- */
  composeBtn.addEventListener('click', () => compose());
  refineBtn.addEventListener('click', refine);
  clearFormBtn.addEventListener('click', () => {
    ownFormEl.value = '';
    selectForm(null);
  });

  ownFormEl.addEventListener('input', () => {
    const v = ownFormEl.value.trim();
    if (v) selectForm(v);
    else selectForm(null);
  });

  sceneEl.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      compose();
    }
  });
  wishEl.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      refine();
    }
  });

  sceneEl.placeholder = PLACEHOLDERS[Math.floor(Math.random() * PLACEHOLDERS.length)];
  sceneEl.focus();

  fetch('/api/health')
    .then((r) => r.json())
    .then((d) => {
      allForms = Array.isArray(d.forms) ? d.forms : [];
      shiForms = Array.isArray(d.shi) ? d.shi : [];
      tuneForms = Array.isArray(d.tunes) ? d.tunes : [];
      poetNames = Array.isArray(d.poets) ? d.poets : [];
      verifiedForms = allForms.slice();
      renderForms();
      renderPoets();
      statusEl.textContent =
        `格律：钦定词谱（${tuneForms.length} 调）· 词林正韵 · 平水韵` +
        (d.rhymeBook && d.pingShui ? '' : '（韵书未就绪）');
      if (!d.keyReady) say('服务端还没有配置 API Key，暂时写不了诗。', true);
    })
    .catch(() => {
      // 这句以前只写了本地跑法，结果部署到线上的人看到「请确认 node server.js 还在运行」，
      // 完全指错方向。现在按当前打开方式给不同的说法。
      const local = ['127.0.0.1', 'localhost', '::1'].includes(location.hostname);
      say(
        local
          ? '连不上服务端。请确认 node server.js 还在运行，并从这个地址打开：http://127.0.0.1:7788'
          : '连不上服务端：这个网址下的 /api/health 没有回应。' +
            '多半是这次部署里没带上后端（Pages Functions）—— 重新部署一次，' +
            '注意终端里必须出现「Uploading Functions bundle」这一行；' +
            '若没有，说明命令不是在 cloudrest 目录里跑的。',
        true
      );
    });
}
