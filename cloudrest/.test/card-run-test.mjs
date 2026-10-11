// 纸笺「真的画一遍」的自证
//
// 为什么必须真跑一次：
//   上一步我把版式算式拆出去之后，`downloadCard` 里引用了 `PAD` 却忘了 import
//   （只 import 了 `PAD as CARD_PAD`）。这类错误**只在运行时炸**，
//   而且被那段 `try { downloadCard() } catch { toast('这张纸笺画不出来') }` 吞掉，
//   页面上只留下一句含糊的提示，看不出是 ReferenceError。
//   静态检查查不出「未声明的标识符」，只有真执行一遍才知道。
//
// 所以这里：造一个 DOM 桩 + 记录型 canvas 上下文，真的把 app.js 载进来、
// 真的点一下「存为纸笺」，然后
//   一、不许抛错（catch 到就打印栈）；
//   二、记下每一次 fillText，断言没有一个字画出纸面之外。
//
// 量宽用与 card-layout-test.mjs 同一套近似规则（汉字 1em、其它 0.55em）。

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve('.');
let bad = 0;
const ok = (c, label, extra = '') => {
  if (!c) bad++;
  console.log(`  ${c ? '✓' : '✗'} ${label}${extra ? '　' + extra : ''}`);
};

/* ---------------- 假量宽 ---------------- */
/**
 * 假的量宽：**保守估计** —— 汉字与全角标点（U+2E80 以上，含，。！？「」等）一律按 1em，
 * 其余按 0.55em。宁可估宽，也不估窄：测试若比浏览器宽松，就会出现
 * 「测试过了、浏览器里却溢出」这种最没用的绿灯。
 */
const measure = (text, font) => {
  // 字号要取「px 前面那个数」——名章的字体串是 600 22px …（600 是字重），
  // 早先直接 parseFloat 会把 600 当成字号，量出 2 字 1200px 宽，把好端端的印章判成越界。
  const size = Number((String(font).match(/(\d+(?:\.\d+)?)px/) || [, 16])[1]) || 16;
  let w = 0;
  for (const ch of String(text)) w += ch.codePointAt(0) >= 0x2e80 ? size : size * 0.55;
  return w;
};

/* ---------------- 记录型 canvas 2D 上下文 ---------------- */
const drawn = [];
let canvasSize = { w: 0, h: 0 };
const ctxStub = {
  font: '10px sans-serif',
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 1,
  textAlign: 'left',
  letterSpacing: '0px',
  measureText: (t) => ({ width: measure(t, ctxStub.font) }),
  fillText: (t, x, y) => drawn.push({ t: String(t), x, y, font: ctxStub.font, align: ctxStub.textAlign }),
  fillRect: () => {},
  strokeRect: () => {},
  beginPath: () => {},
  closePath: () => {},
  moveTo: () => {},
  lineTo: () => {},
  quadraticCurveTo: () => {},
  arc: () => {},   // 圆印那一式要用（默认是方印，但两式都得能跑）
  stroke: () => {},
  fill: () => {},
  createLinearGradient: () => ({ addColorStop: () => {} }),
  createRadialGradient: () => ({ addColorStop: () => {} }),
};

/* ---------------- 最小 DOM 桩 ---------------- */
class El {
  constructor(tag = 'div') {
    this.tagName = tag;
    this.children = [];
    this.style = {};
    this.dataset = {};
    this.attrs = {};
    this._text = '';
    this._cls = new Set();
    this.value = '';
    this.placeholder = '';
    this.hidden = false;
    this.disabled = false;
    this.parentNode = null;
    this.listeners = {};
    this.scrollTop = 0;
  }
  get firstChild() { return this.children[0] || null; }
  get offsetWidth() { return 600; }
  get classList() {
    const self = this;
    return {
      add: (...c) => c.forEach((x) => self._cls.add(x)),
      remove: (...c) => c.forEach((x) => self._cls.delete(x)),
      toggle: (c, on) => (on === undefined ? (self._cls.has(c) ? self._cls.delete(c) : self._cls.add(c)) : on ? self._cls.add(c) : self._cls.delete(c)),
      contains: (c) => self._cls.has(c),
    };
  }
  set className(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get className() { return [...this._cls].join(' '); }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  set innerHTML(v) { this._html = String(v); }
  get innerHTML() { return this._html || ''; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k]; }
  removeAttribute(k) { delete this.attrs[k]; }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  append(...cs) { cs.forEach((c) => c && this.appendChild(c)); }
  replaceChildren(...n) {
    this.children = [];
    for (const x of n) {
      if (!x) continue;
      if (x.tagName === '#fragment') x.children.forEach((c) => this.appendChild(c));
      else this.appendChild(x);
    }
  }
  addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }
  querySelectorAll(sel) {
    const isId = sel.startsWith('#');
    const isTag = /^[a-z]+$/.test(sel);
    const want = sel.replace(/^[.#]/, '');
    const out = [];
    const walk = (n) => {
      for (const c of n.children) {
        const hit = isId ? c.attrs.id === want : isTag ? c.tagName === sel : c._cls?.has(want);
        if (hit) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  closest() { return null; }
  getBoundingClientRect() { return { top: 0, bottom: 100, left: 0, right: 700, width: 700, height: 100 }; }
  select() {}
  remove() {}
  focus() {}
  scrollIntoView() {}
  click() { (this.listeners.click || []).forEach((f) => f()); }
  toBlob(cb) { QUEUE.toBlobMode === 'null' ? cb(null) : cb({ size: 1, type: 'image/png' }); }
  toDataURL() { return 'data:image/png;base64,AAAA'; }
  getContext() { return ctxStub; }
  set width(v) { canvasSize.w = v; }
  get width() { return canvasSize.w; }
  set height(v) { canvasSize.h = v; }
  get height() { return canvasSize.h; }
}

const registry = new Map();
const document = {
  createElement: (t) => new El(t),
  createDocumentFragment: () => new El('#fragment'),
  querySelector: (sel) => {
    if (!registry.has(sel)) registry.set(sel, new El('div'));
    return registry.get(sel);
  },
  addEventListener: () => {},
  body: new El('body'),
  documentElement: new El('html'),
  execCommand: () => true,
  getElementById: (id) => document.querySelector('#' + id),
};

for (const sel of [
  '#scene', '#wish', '#compose', '#refine', '#hint', '#hint2', '#status', '#formNote', '#clearForm',
  '#forms', '#poemWrap', '.poem-scene', '.poem-title', '.poem-body', '.seal', '#verdict', '#actions',
  '#toast', '#mind', '#copy', '#again', '#save', '#ownForm', '#ownFormNote', '#poets', '#poetNote',
]) {
  document.querySelector(sel);
}

globalThis.document = document;
globalThis.window = { innerHeight: 900, scrollBy: () => {} };
// 真浏览器里纸笺的字体是从 CSS 变量 --serif 读的（与中栏的诗同一套）。
// 桩里也得给一个，否则测不出「有没有真的去读那个变量」。
globalThis.getComputedStyle = () => ({
  getPropertyValue: (k) =>
    k === '--serif' ? '"Source Han Serif SC", "Songti SC", "SimSun", "宋体", serif' : '',
});
globalThis.location = { protocol: 'http:', hostname: '127.0.0.1', hash: '' };
globalThis.requestAnimationFrame = (fn) => fn();
globalThis.URL.createObjectURL = () => 'blob:stub';
globalThis.URL.revokeObjectURL = () => {};
Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: async () => {} } }, configurable: true });

const RESULT = {
  type: 'result',
  scene: '江楼独倚，夕阳熔金铺在江面，一闪一闪像鱼的鳞。栏杆上握着一只凉了的酒杯，日头一沉，杯沿也凉透了。',
  title: '江楼晚眺',
  allusion: '无用典',
  devices: '比喻、通感',
  body: '江楼衔落照\n片片跃金鳞\n杯倚栏杆侧\n风来酒面皴',
  lines: ['江楼衔落照，片片跃金鳞。', '杯倚栏杆侧，风来酒面皴。'],
  notes: '跃金鳞｜夕阳照水，波纹如金鳞跳动。',
  translation: '在江楼上倚栏，落日照着水面，波光像一片片跳动的金鳞；手里握着酒杯靠在栏杆上，风吹过来，酒面起了细纹。',
  appraisal: '诗眼在「跃」字。',
  form: '五言绝句',
  tries: 1,
  verified: true,
  verdict: { level: 'ok', issues: [], stats: {} },
};

// 第二首：一首《定风波》—— 有上下阕（展示行里夹着一个空行）、有 16 字的长行。
// 五绝那首两条都不占，纸笺恰好在它身上看不出问题，所以必须再跑一首词。
const RESULT_CI = {
  ...RESULT,
  title: '定风波·槐下看云',
  form: '定风波',
  body: '小庭深树自盘桓\n一角青山俯画栏\n不语看花花尽落\n庭寒\n北风卷地送微澜\n纵有鲲鹏九万转\n应咽\n劫痕累累我自安\n铁干已生千尺蒜\n谁伴\n半竿斜照满江山',
  lines: [
    '小庭深树自盘桓，一角青山俯画栏。',
    '不语看花花尽落，庭寒，北风卷地送微澜。',
    '',
    '纵有鲲鹏九万转，应咽，劫痕累累我自安。',
    '铁干已生千尺蒜，谁伴，半竿斜照满江山。',
  ],
};

/** 让 /api/compose 依次吐出这两首；toBlobMode='null' 用来验证「toBlob 给 null」的退路 */
const QUEUE = { list: [RESULT, RESULT_CI], toBlobMode: 'ok' };

globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes('/api/health')) {
    return {
      ok: true,
      json: async () => ({
        ok: true, keyReady: true, forms: ['五言绝句'], shi: ['五言绝句'], tunes: [],
        poets: [], rhymeBook: true, pingShui: true,
      }),
    };
  }
  if (u.includes('/api/choose')) return { ok: true, json: async () => ({ form: '五言绝句', reason: '宜短调' }) };
  if (u.includes('/api/compose')) {
    const one = QUEUE.list.length > 1 ? QUEUE.list.shift() : QUEUE.list[0];
    const payload = JSON.stringify({ type: 'start', form: one.form }) + '\n' + JSON.stringify(one) + '\n';
    const enc = new TextEncoder();
    const chunks = payload.match(/[\s\S]{1,64}/g).map((s) => enc.encode(s));
    let i = 0;
    return {
      ok: true,
      status: 200,
      body: { getReader: () => ({ read: async () => (i < chunks.length ? { value: chunks[i++], done: false } : { value: undefined, done: true }) }) },
      json: async () => ({}),
    };
  }
  return { ok: false, status: 404, json: async () => ({}) };
};

process.on('unhandledRejection', (e) => {
  console.log('  ✗ 未处理的拒绝：', e?.stack || e);
  bad++;
});

/* ---------------- 真跑一遍 ---------------- */
const src = await fs.promises.readFile(path.join(ROOT, 'public', 'app.js'), 'utf8');
if (!src.includes("from './card-layout.mjs'")) {
  console.log('  ✗ app.js 没有以相对路径 import card-layout.mjs（测试无法执行它）');
  bad++;
}
await import(pathToFileURL(path.join(ROOT, 'public', 'app.js')).href);
await new Promise((r) => setTimeout(r, 60));

const scene = document.querySelector('#scene');
scene.value = '江楼独倚，夕阳熔金铺在江面。';

console.log('— 先成一首，再存纸笺 —');
const composeBtn = document.querySelector('#compose');
let composeThrew = null;
try {
  await composeBtn.listeners.click[0]();
} catch (e) {
  composeThrew = e;
}
await new Promise((r) => setTimeout(r, 80));
ok(!composeThrew, '成诗没有抛错', composeThrew ? String(composeThrew.message) : '');

const bodyEl = document.querySelector('.poem-body');
ok(bodyEl.children.length === 2, '五绝排成两行（每两句一行）', `${bodyEl.children.length} 行`);

// 中栏比纸笺窄，一行十几个字免不了折行。每个小句各自包一层 inline-block 之后，
// 折行只会发生在标点之后 —— 这是在真 DOM 桩里数出来的，不是静态看代码。
const ju = [];
for (const lineEl of bodyEl.children) for (const s of lineEl.children) if (s.className === 'ju') ju.push(s.textContent);
ok(ju.length === 4, '每个小句都单独包了一层（折行不会把一句从中间劈开）', `共 ${ju.length} 个小句`);
ok(ju.join('') === RESULT.lines.join(''), '拆成小句之后拼回去与整行逐字一致');
ok(ju.every((s) => /[，、。？！]$/.test(s)), '每个小句都停在标点之后');

const saveBtn = document.querySelector('#save');
const INNER = 38;

/** 点一次「存为纸笺」：不许抛错、不许出现兜底提示、落字不许压到内框之外 */
const cardOnce = async (label) => {
  drawn.length = 0;
  let threw = null;
  try {
    // 点击处理器现在是 async（存纸笺要先弹「另存为」），所以要 await
    await saveBtn.listeners.click[0]();
  } catch (e) {
    threw = e;
  }
  const t = document.querySelector('#toast').textContent;
  ok(!threw, `${label}：「存为纸笺」没有抛错`, threw ? String(threw.message) : '');
  ok(!/画不出来/.test(t), `${label}：没有出现「画不出来」`, t || '(无提示)');
  ok(/已存为纸笺/.test(t), `${label}：提示是「已存为纸笺」`, t);

  // 越界检查：按落字方式（左对齐/居中）算出实际占的横向范围。
  // 上下限用**内框**（外框内缩 38px）而不是画布边缘 —— 压到框上就已经难看了。
  const over = [];
  for (const d of drawn) {
    const w = measure(d.t, d.font);
    const left = d.align === 'center' ? d.x - w / 2 : d.x;
    const right = left + w;
    if (left < INNER || right > canvasSize.w - INNER) over.push(`${d.t.slice(0, 12)}… [${Math.round(left)},${Math.round(right)}]`);
  }
  ok(over.length === 0, `${label}：没有字压到内框之外（内框 ${INNER}~${canvasSize.w - INNER}）`, over.length ? over.join(' / ') : '全部收住');
  return { toast: t, w: canvasSize.w, h: canvasSize.h };
};

console.log('\n— 第一首：五言绝句 —');
const shiCard = await cardOnce('五绝');
// 纸上的字必须与页面上中栏那套一模一样 —— 从前写的是 '27px -serif'（少一个字母），
// 浏览器当成不存在的字体名，回退成默认字体，于是屏幕一个样、纸笺另一个样。
{
  const used = [...new Set(drawn.map((d) => d.font))];
  ok(used.every((f) => /\d+px/.test(f) && !/\d+px\s+-/.test(f) && /serif\s*$/.test(f)), '每一种落字都带了字号、且以 serif 收尾', used.join(' / '));
  ok(used.some((f) => f.includes('Source Han Serif SC')), '字体是从 CSS 变量 --serif 读来的那一套');
  ok(used.some((f) => f.startsWith('27px')) && used.some((f) => f.startsWith('44px')), '正文 27px、标题 44px');
}
ok(drawn.some((d) => d.t.includes('江楼晚眺')), '标题画上了');
ok(drawn.filter((d) => /云卷|云舒/.test(d.t)).length === 2, '名章两行两字，且只有一处「云卷云舒」');
ok(!drawn.some((d) => /^云卷云舒$/.test(d.t)), '没有第二处落款');

// 第二首是**词**：展示行里夹着上下阕之间的空行，行也长得多。
// 五绝那首两条都不占 —— 纸笺恰好在它身上看不出问题，所以必须再跑一首词。
console.log('\n— 第二首：《定风波》（有上下阕、有长行）—');
document.querySelector('#again').listeners.click[0]();
await new Promise((r) => setTimeout(r, 80));
const ciKids = bodyEl.children.map((c) => c.className);
ok(ciKids.length === 5, '定风波排成 4 行 + 1 个分片空行', ciKids.join(','));
ok(ciKids.filter((c) => c === 'stanza-gap').length === 1, '上下阕之间只有一个空行');

console.log('\n— 画在纸上的每一个字（定风波）—');
const ciCard = await cardOnce('定风波');
console.log(`     纸：${ciCard.w}×${ciCard.h}　共 ${drawn.length} 次落字`);
for (const d of drawn) console.log(`     ${String(Math.round(d.x)).padStart(4)},${String(Math.round(d.y)).padStart(4)}  ${d.t}`);
ok(drawn.some((d) => d.t.includes('定风波·槐下看云')), '词牌·题画上了');
ok(drawn.some((d) => d.t.includes('铁干已生千尺蒜，谁伴，半竿斜照满江山。')), '最长的那一行整行画上了（没被裁掉）');
ok(ciCard.h > shiCard.h, '有上下阕空行时纸会跟着变高', `${shiCard.h} → ${ciCard.h}`);

// 第三关：toBlob 回 null 时**不能**只留一句「画不出来」。
// 真实浏览器在大画布上偶有这么一下，退路是 toDataURL。
console.log('\n— 第三关：toBlob 不给图 —');
QUEUE.toBlobMode = 'null';
await cardOnce('toBlob 给 null 时');
QUEUE.toBlobMode = 'ok';


// 存到哪里：浏览器不许网页往任意路径写文件，能做到的是「另存为」对话框。
// 桩里没有 showSaveFilePicker，所以要验证的是**退回普通下载**这条路仍然通；
// 有 showSaveFilePicker 时的行为另用一个最小桩验证（取消要静默、正常要写盘）。
console.log('\n— 存到哪里 —');
{
  ok(typeof globalThis.window.showSaveFilePicker !== 'function', '桩里没有「另存为」接口 —— 走的正是退回下载那条路（上面三关验的就是它）');

  // 有接口时：用户取消 → 不许出声，也不许下载
  const threw = [];
  let wrote = 0;
  globalThis.window.showSaveFilePicker = async () => {
    const e = new Error('cancel');
    e.name = 'AbortError';
    throw e;
  };
  const before = document.querySelector('#toast').textContent;
  await saveBtn.listeners.click[0]();
  ok(document.querySelector('#toast').textContent === before, '用户按取消 → 不弹任何提示');

  // 有接口且选了文件夹 → 写到那个句柄里
  globalThis.window.showSaveFilePicker = async () => ({
    createWritable: async () => ({
      write: async () => { wrote++; },
      close: async () => {},
    }),
  });
  await saveBtn.listeners.click[0]();
  ok(wrote === 1, '选了文件夹 → 图片写进了那个句柄（一次）');
  ok(/已存为纸笺/.test(document.querySelector('#toast').textContent), '提示仍是「已存为纸笺」');
  delete globalThis.window.showSaveFilePicker;
}

// 名章（站长：「和图一比太糙」）。旧版直角＋2px 硬边，现在照网页那枚的语言重画：
// 圆角、发丝边、里层再一圈（朱文印的双线）、600 字重宋体、字距 2。
console.log('\n— 名章（纸笺上那枚）—');
{
  const { SEAL_SHAPE, M, FONT } = await import('../public/card-layout.mjs');
  // 只看最后这一次落字（前面几关的落字还留在 drawn 里）
  const sealTexts = drawn.slice(-2).filter((d) => /^云[卷舒]$/.test(d.t));
  ok(sealTexts.length === 2, '恰两行两字（云卷／云舒）', sealTexts.map((x) => x.t).join(''));
  // 字体串里的衬线栈来自 CSS 变量 --serif（桩里给的是短的那一份），所以只比前缀与族尾
  ok(sealTexts.every((d) => d.font.startsWith('600 22px ') && /serif\s*$/.test(d.font)), '用的是名章那套字体（600 字重、22px、衬线族）', sealTexts[0] && sealTexts[0].font.slice(0, 26) + '…');
  // 印面与字都必须落在内框之内（内框 38 ~ W-38）
  const IN = 38;
  const inFrame = sealTexts.every((d) => {
    const w = measure(d.t, d.font);
    const left = d.align === 'center' ? d.x - w / 2 : d.x;
    return left >= IN && left + w <= canvasSize.w - IN;
  });
  ok(inFrame, '印上的两个字都在内框之内');
  ok(['square', 'round'].includes(SEAL_SHAPE) && M.SEAL_RADIUS > 0, '方印或圆印任一式都成立（SEAL_SHAPE 可切）', 'shape=' + SEAL_SHAPE + ' radius=' + M.SEAL_RADIUS);
  ok(M.SEAL_INNER > 0, '外框里还有一圈发丝（双线才像印）', `inset=${M.SEAL_INNER}`);
}
console.log('\n' + '─'.repeat(58));
console.log(bad === 0 ? '纸笺真跑一遍：通过' : `${bad} 项未通过`);
process.exit(bad ? 1 : 0);
