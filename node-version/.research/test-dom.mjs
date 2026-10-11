// 用 DOM 桩真实执行 public/app.js，抓运行时异常；覆盖择体→成诗→润色三条路径
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
      add: (c) => self._cls.add(c),
      remove: (c) => self._cls.delete(c),
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
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  append(...cs) { for (const c of cs) this.appendChild(c); }
  replaceChildren(...n) {
    this.children = [];
    for (const x of n) {
      if (!x) continue;
      // DocumentFragment 展开
      if (x.tagName === '#fragment') for (const c of x.children) this.appendChild(c);
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
  getBoundingClientRect() { return { top: 0, bottom: 100, left: 0, right: 700, width: 700, height: 100 }; }
  select() {}
  remove() {}
  focus() {}
  click() { for (const f of this.listeners.click || []) f(); }
}

const registry = new Map();
const document = {
  createElement: (t) => new El(t),
  createDocumentFragment: () => new El('#fragment'),
  querySelector: (sel) => { if (!registry.has(sel)) registry.set(sel, new El('div')); return registry.get(sel); },
  addEventListener: () => {},
  body: new El('body'),
  documentElement: new El('html'),
  execCommand: () => true,
};
const els = {};
for (const sel of ['#scene', '#wish', '#compose', '#refine', '#hint', '#hint2', '#status', '#formNote', '#clearForm', '#forms', '#poemWrap', '.poem-scene', '.poem-title', '.poem-form', '.poem-body', '.seal', '#verdict', '#actions', '#toast', '#mind', '#copy', '#again', '#save']) {
  els[sel] = document.querySelector(sel);
}

globalThis.document = document;
globalThis.window = { innerHeight: 900, scrollBy: () => {} };
globalThis.location = { protocol: 'http:' };
globalThis.requestAnimationFrame = (fn) => fn();
Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: async () => {} } }, configurable: true });

const RESULT = {
  type: 'result',
  scene: '深宵医院廊下，灯昏如豆，一人抱衣蜷卧长椅。',
  title: '廊灯抱衣',
  allusion: '无用典',
  devices: '比喻、通感、以动写静',
  change: '照你说的写冷了一些',
  body: '素壁立清宵\n人卧长椅窄\n影抱单衣一寸凉\n暗滴悬微白\n\n廊转夜三更\n药气凝虚白\n谁向空阶数履声\n露重灯花黑',
  appraisal: '立意落在一「守」字，诗眼在「影抱单衣一寸凉」。',
  form: '卜算子',
  tries: 1,
  verdict: { level: 'ok', issues: [], stats: { 句数: 8, 字数: 44, 平仄出入: 0 } },
};
let lastCompose = null;

globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.includes('/api/health')) {
    return { ok: true, json: async () => ({ ok: true, keyReady: true, forms: ['五言绝句', '七言绝句', '五言律诗', '七言律诗', '浣溪沙', '卜算子'], shi: ['五言绝句', '七言绝句', '五言律诗', '七言律诗'], tunes: ['浣溪沙', '卜算子'], rhymeBook: true, pingShui: true }) };
  }
  if (u.includes('/api/choose')) {
    return { ok: true, json: async () => ({ form: '卜算子', reason: '此景一瞬而暗涌，宜短调仄韵。' }) };
  }
  if (u.includes('/api/compose')) {
    lastCompose = JSON.parse(opts.body || '{}');
    const payload = JSON.stringify({ type: 'start', form: lastCompose.form }) + '\n' + JSON.stringify(RESULT) + '\n';
    const enc = new TextEncoder();
    const chunks = payload.match(/[\s\S]{1,60}/g).map((s) => enc.encode(s));
    let i = 0;
    return { ok: true, status: 200, body: { getReader: () => ({ read: async () => (i < chunks.length ? { value: chunks[i++], done: false } : { value: undefined, done: true }) }) }, json: async () => ({}) };
  }
  return { ok: false, status: 404, json: async () => ({ error: 'not found' }) };
};

process.on('unhandledRejection', (e) => { console.log('✗ 未处理拒绝：', e?.stack || e); process.exitCode = 1; });

// 用文件 URL 载入 app.js（而不是 data: URL）——
// app.js 现在会 import './card-layout.mjs'，而 data: URL 不是「层级的」基址，
// 相对 import 在它下面无法解析（ERR_UNSUPPORTED_RESOLVE_REQUEST）。
await import(new URL('../public/app.js', import.meta.url).href);
await new Promise((r) => setTimeout(r, 60));

console.log('· 载入完成，落笔处理器：', els['#compose'].listeners.click?.length || 0);
console.log('  体裁按钮：', els['#forms'].querySelectorAll('button').length, '个');
console.log('  状态栏：', els['#status'].textContent);

els['#scene'].value = '深夜的医院走廊，长椅上有人抱着外套睡着了。';
await els['#compose'].listeners.click[0]();
await new Promise((r) => setTimeout(r, 80));

console.log('\n— 成诗后 —');
console.log('  择体提示：', els['#hint'].textContent);
console.log('  体裁注：  ', els['#formNote'].innerHTML);
console.log('  标题：    ', els['.poem-title'].textContent);
console.log('  正文行：  ', els['.poem-body'].children.map((c) => c.textContent).join(' / '));
console.log('  校律：    ', els['#verdict'].textContent.slice(0, 60));
console.log('  左栏段数：', els['#mind'].children.length);
console.log('  左栏标题：', els['#mind'].children.map((c) => c.children[0]?.textContent).join('、'));
console.log('  按钮组可见：', !els['#actions'].hidden, ' 润色可用：', !els['#refine'].disabled);

// 润色路径
els['#wish'].value = '再冷一些';
await els['#refine'].listeners.click[0]();
await new Promise((r) => setTimeout(r, 80));
console.log('\n— 润色后 —');
console.log('  请求 mode：', lastCompose.mode, ' wish：', lastCompose.wish);
console.log('  上一稿带上：', Boolean(lastCompose.previous && lastCompose.previous.body));
console.log('  润色提示：', els['#hint2'].textContent);

const probe = els['#scene'].listeners.keydown?.[0];
console.log('\n  Ctrl+Enter 已绑定：', Boolean(probe));
