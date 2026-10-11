// 用最小 DOM 桩把 public/app.js 真的跑一遍，抓浏览器里的运行时异常
class El {
  constructor(tag = 'div') {
    this.tagName = tag;
    this.children = [];
    this.style = {};
    this.dataset = {};
    this.attrs = {};
    this._text = '';
    this.value = '';
    this.placeholder = '';
    this.hidden = false;
    this.parentNode = null;
    this.listeners = {};
    this._cls = new Set();
  }
  get firstChild() {
    return this.children[0] || null;
  }
  get offsetWidth() {
    return 600;
  }
  get classList() {
    const self = this;
    return {
      add: (c) => self._cls.add(c),
      remove: (c) => self._cls.delete(c),
      toggle: (c, on) => (on === undefined ? (self._cls.has(c) ? self._cls.delete(c) : self._cls.add(c)) : on ? self._cls.add(c) : self._cls.delete(c)),
      contains: (c) => self._cls.has(c),
    };
  }
  set className(v) {
    this._cls = new Set(String(v).split(/\s+/).filter(Boolean));
  }
  get className() {
    return [...this._cls].join(' ');
  }
  set textContent(v) {
    this._text = String(v);
    this.children = [];
  }
  get textContent() {
    return this._text + this.children.map((c) => c.textContent).join('');
  }
  set innerHTML(v) {
    this._html = String(v);
  }
  get innerHTML() {
    return this._html || '';
  }
  setAttribute(k, v) {
    this.attrs[k] = String(v);
  }
  getAttribute(k) {
    return this.attrs[k];
  }
  appendChild(c) {
    c.parentNode = this;
    this.children.push(c);
    return c;
  }
  replaceChildren(...nodes) {
    this.children = [];
    for (const n of nodes) this.appendChild(n);
  }
  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }
  querySelectorAll(sel) {
    const want = sel.replace(/^\./, '');
    const out = [];
    const walk = (n) => {
      for (const c of n.children) {
        if (c._cls?.has(want)) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  querySelector(sel) {
    return this.querySelectorAll(sel)[0] || null;
  }
  getBoundingClientRect() {
    return { top: 0, bottom: 100, left: 0, right: 700, width: 700, height: 100 };
  }
  select() {}
  remove() {}
  focus() {}
}

const registry = new Map();
const document = {
  createElement: (t) => new El(t),
  querySelector: (sel) => {
    if (!registry.has(sel)) registry.set(sel, new El('div'));
    return registry.get(sel);
  },
  addEventListener: () => {},
  body: new El('body'),
  documentElement: new El('html'),
  execCommand: () => true,
};
const window = { innerHeight: 900, scrollBy: () => {} };
const location = { protocol: process.env.AS_FILE ? 'file:' : 'http:' };
const requestAnimationFrame = (fn) => fn();

const els = {};
for (const sel of [
  '#scene',
  '#forms',
  '#formCustom',
  '#compose',
  '#hint',
  '#result',
  '#poem',
  '.poem-scene',
  '.poem-title',
  '.poem-form',
  '.poem-body',
  '.poem-note',
  '.seal',
  '#actions',
  '#toast',
  '#copy',
  '#again',
  '#save',
]) {
  els[sel] = document.querySelector(sel);
}

// 假的 NDJSON 流：内容取自真实的一次成功响应
const NDJSON = [
  '{"type":"start","model":"deepseek-chat"}',
  '{"type":"delta","field":"scene","text":"雨夜深巷"}',
  '{"type":"delta","field":"scene","text":"，楼下便利店的灯亮着。"}',
  '{"type":"end","field":"scene"}',
  '{"type":"delta","field":"title","text":"雨夜收衣"}',
  '{"type":"end","field":"title"}',
  '{"type":"delta","field":"form","text":"七言绝句"}',
  '{"type":"end","field":"form"}',
  '{"type":"delta","field":"body","text":"雨脚斜时灯正明\\n一窗白透到衣绳\\n"}',
  '{"type":"delta","field":"body","text":"抬头手取微湿袖\\n滴水阶前未作声"}',
  '{"type":"end","field":"body"}',
  '{"type":"delta","field":"note","text":"写时留意到袖口的水一直滴。"}',
  '{"type":"end","field":"note"}',
  '{"type":"done","ms":1200}',
].join('\n');

globalThis.document = document;
globalThis.window = window;
globalThis.location = location;
globalThis.requestAnimationFrame = requestAnimationFrame;
Object.defineProperty(globalThis, 'navigator', {
  value: { clipboard: { writeText: async () => {} } },
  configurable: true,
});
globalThis.fetch = async (url, opts) => {
  if (String(url).includes('/api/health')) {
    return { ok: true, json: async () => ({ ok: true, keyReady: true, forms: ['auto', '五言绝句', '七言绝句'] }) };
  }
  // 模拟浏览器收到分块的 NDJSON
  const encoder = new TextEncoder();
  let i = 0;
  const chunks = NDJSON.match(/.{1,40}/gs).map((s) => encoder.encode(s));
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () => (i < chunks.length ? { value: chunks[i++], done: false } : { value: undefined, done: true }),
      }),
    },
    json: async () => ({}),
  };
};

process.on('unhandledRejection', (e) => {
  console.log('✗ 未处理的 Promise 拒绝：', e?.stack || e);
  process.exitCode = 1;
});

const src = (await import('node:fs')).readFileSync(new URL('./public/app.js', import.meta.url), 'utf8');
await import('data:text/javascript,' + encodeURIComponent(src));

if (location.protocol === 'file:') {
  const html = document.documentElement.innerHTML;
  const ok = html.includes('不能直接双击打开') && html.includes('node server.js');
  console.log(ok ? '✓ file:// 打开时显示了拦截页' : '✗ file:// 拦截页不对');
  console.log('  内容片段：', html.slice(0, 120).replace(/\s+/g, ' '));
  process.exit(ok ? 0 : 1);
}

console.log('· app.js 载入完成，登记的点击监听器：', els['#compose'].listeners.click?.length || 0);

els['#scene'].value = '下雨的傍晚，楼下便利店亮着灯，我在阳台收衣服。';
const click = els['#compose'].listeners.click?.[0];
if (!click) {
  console.log('✗ 落笔按钮没有绑定点击处理器');
  process.exit(1);
}

try {
  await click();
  // 等流读完
  await new Promise((r) => setTimeout(r, 200));
  console.log('· 点击「落笔」未抛异常');
  console.log('  提示语：', els['#hint'].textContent);
  console.log('  标题：  ', els['.poem-title'].textContent);
  console.log('  体裁：  ', els['.poem-form'].textContent);
  console.log('  正文：  ', els['.poem-body'].children.map((c) => c.textContent).join(' / '));
  console.log('  落款：  ', els['.poem-note'].textContent);
  console.log('  所写：  ', els['.poem-scene'].textContent);
  console.log('  按钮组可见：', !els['#actions'].hidden, ' 结果区可见：', !els['#result'].hidden);
  console.log('  体裁按钮：', els['#forms'].children.map((b) => b.textContent).join(' '));
} catch (e) {
  console.log('✗ 点击抛异常：', e?.stack || e);
  process.exitCode = 1;
}
