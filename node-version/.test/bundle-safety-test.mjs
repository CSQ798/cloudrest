// 打包安全自证：这套源码必须能被 esbuild 打成 workerd 认得的 bundle
//
// 为什么要有这个文件：
//   2026-10-05 的 Pages 部署死在这里 ——
//     X [ERROR] Deployment failed!
//       Failed to publish your Function. Got error:
//       Uncaught SyntaxError: Unexpected reserved word
//       at functionsWorker-0.373272764727409.js:19:4
//   把 wrangler 留在 .wrangler/tmp 里的产物摊开看，第 19 行长这样：
//     var init_tunes = __esm({
//       "../server/tunes.mjs"() {
//         await init_functionsRoutes_0_9860598396379495();
//   而 __esm 的包装函数是同步的：
//     var __esm = (fn, res) => function __init() { return fn && (...), res; };
//   —— 同步函数里出现 await，workerd 解析即报 SyntaxError。
//
//   根因是 server/validator.mjs 与 server/allusions.mjs 里的 **动态 import()**：
//   esbuild 为了保持 import() 的惰性语义，会把整张模块图改写成 __esm 惰性初始化，
//   于是每个模块的 init 里都被插进 `await init_xxx()`，而包装函数并没有被标成 async。
//
//   这个检查不依赖 esbuild，纯扫源码，因此可以在任何地方跑、也不会因为
//   工具版本变化而失效：
//     一、禁止动态 import()（就是它引出上面那串连锁反应）
//     二、禁止顶层 await（同样的连锁反应还能被真正的 TLA 触发）
//
//   注：这是启发式扫描，不是完整解析器。它宁可漏报也不误报 ——
//   误报会让好代码改坏，比漏报更糟。所以「顶层 await」只认**花括号深度 0**
//   的那种，且先剥掉注释与字符串，避免把说明文字里的 await 当真代码。

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

/**
 * Node 专用模块：允许用 node: 内置模块、允许用动态 import()，
 * 但**绝不能被 worker.mjs / pages-entry.mjs 那条链 import 到**。
 * 所以它们既不在下面的扫描范围里，又要被反向检查「有没有人引用它」。
 */
const NODE_ONLY = ['server/d1-sqlite.mjs'];

let bad = 0;
const ok = (c, label, extra = '') => {
  if (!c) bad++;
  console.log(`${c ? '✓' : '✗'} ${label}${extra ? '　' + extra : ''}`);
};

/**
 * 会进 bundle 的源码：worker.mjs、pages-entry.mjs、server/*.mjs、functions 下的所有 js。
 *
 * 注意**不**扫 build-dashboard.mjs 之类：它们是构建期在 Node 里跑的工具，
 * 永远不会被 esbuild 打进产物（pages-entry.mjs 不 import 它们）。
 * 把不相干的文件拉进来只会制造误报，而误报会让人开始怀疑规则、进而把它关掉，
 * 比漏报更糟。
 */
async function collect() {
  const out = [path.join(ROOT, 'worker.mjs'), path.join(ROOT, 'pages-entry.mjs')];
  // 路径比较一律用「相对 ROOT 的正斜杠小写路径」，别拿绝对路径去比 ——
  // 当前目录、盘符大小写、分隔符都能让绝对路径比较悄悄失配
  const skip = new Set(NODE_ONLY.map((n) => n.toLowerCase()));
  const relOf = (p) => path.relative(ROOT, p).split(path.sep).join('/').toLowerCase();
  for (const d of ['server', 'functions']) {
    const dir = path.join(ROOT, d);
    let names = [];
    try {
      names = await fs.readdir(dir, { recursive: true });
    } catch {
      continue;
    }
    for (const n of names) {
      const full = path.join(dir, String(n));
      if (skip.has(relOf(full))) continue;
      if (/\.(mjs|js)$/.test(full)) {
        const st = await fs.stat(full).catch(() => null);
        if (st?.isFile()) out.push(full);
      }
    }
  }
  return out;
}

/**
 * 剥掉注释与字符串字面量，只留下真正的代码。
 * 返回 { code, lineOf }：code 是逐字符替换后的文本（保留换行，位置不变），
 * lineOf[i] 给出第 i 个字符所在的行号。
 */
function strip(src) {
  const chars = [...src];
  const out = chars.slice();
  const blank = (i) => {
    if (out[i] !== '\n') out[i] = ' ';
  };
  let i = 0;
  const n = chars.length;
  while (i < n) {
    const c = chars[i];
    const c2 = chars[i + 1];
    // 行注释
    if (c === '/' && c2 === '/') {
      while (i < n && chars[i] !== '\n') blank(i++);
      continue;
    }
    // 块注释
    if (c === '/' && c2 === '*') {
      blank(i++);
      blank(i++);
      while (i < n && !(chars[i] === '*' && chars[i + 1] === '/')) blank(i++);
      blank(i++);
      blank(i++);
      continue;
    }
    // 正则字面量：不剥掉的话，/await init_/g 这种会被当成真正的 await
    // （第一次写这个扫描器就栽在这儿：它把 build-dashboard.mjs 里的
    //   `bundle.match(/await init_/g)` 判成了顶层 await）。
    // 区分「除号」与「正则」是经典难题，这里用保守的启发式：
    // 前一个非空白字符属于 ( , = : [ ! & | ? { } ; 之一，或前一个词是 return，
    // 才认为 / 开始一个正则。宁可漏剥也不误剥 —— 误剥会把真代码吞掉。
    if (c === '/') {
      const prev = (() => {
        let k = i - 1;
        while (k >= 0 && /\s/.test(chars[k])) k--;
        return k >= 0 ? chars[k] : '';
      })();
      const prevWord = (() => {
        const m = /([A-Za-z_$][\w$]*)\s*$/.exec(src.slice(Math.max(0, i - 12), i));
        return m ? m[1] : '';
      })();
      const looksLikeRegex =
        '(,=:[!&|?{};'.includes(prev) || prev === '' || ['return', 'typeof', 'case', 'in', 'of'].includes(prevWord);
      if (looksLikeRegex) {
        let k = i + 1;
        let closed = false;
        while (k < n && chars[k] !== '\n') {
          if (chars[k] === '\\') {
            k += 2;
            continue;
          }
          if (chars[k] === '[') {
            // 字符组里可以有裸的 /
            while (k < n && chars[k] !== ']' && chars[k] !== '\n') k++;
            k++;
            continue;
          }
          if (chars[k] === '/') {
            closed = true;
            break;
          }
          k++;
        }
        if (closed) {
          for (let j = i; j <= k; j++) blank(j);
          // 标志位
          let j = k + 1;
          while (j < n && /[a-z]/.test(chars[j])) blank(j++);
          i = j;
          continue;
        }
      }
    }
    // 字符串与模板串（模板串里的 ${} 也一并当字符串剥掉——够用了）
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      blank(i++);
      while (i < n) {
        if (chars[i] === '\\') {
          blank(i++);
          blank(i++);
          continue;
        }
        if (chars[i] === q) {
          blank(i++);
          break;
        }
        blank(i++);
      }
      continue;
    }
    i++;
  }

  const lineOf = new Array(n).fill(1);
  let line = 1;
  for (let k = 0; k < n; k++) {
    lineOf[k] = line;
    if (chars[k] === '\n') line++;
  }
  return { code: out.join(''), lineOf };
}

/** 花括号深度 0 处出现的 await（真正的顶层 await） */
function topLevelAwaits(code, lineOf) {
  const hits = [];
  let depth = 0;
  const re = /\bawait\b/g;
  let m;
  while ((m = re.exec(code))) {
    // 该位置的深度：数它之前的 { 与 }
    // 直接边扫边算，避免二次遍历
    let d = 0;
    for (let k = 0; k < m.index; k++) {
      const ch = code[k];
      if (ch === '{') d++;
      else if (ch === '}') d--;
    }
    if (d <= 0) hits.push(lineOf[m.index]);
  }
  return hits;
}

const files = await collect();
console.log('扫描会进 bundle 的源码：' + files.length + ' 个文件\n');

const dynamicImports = [];
const tla = [];
for (const f of files) {
  const src = await fs.readFile(f, 'utf8');
  const { code, lineOf } = strip(src);
  const rel = path.relative(ROOT, f);

  if (/\bimport\s*\(/.test(code)) {
    const lines = [];
    const re = /\bimport\s*\(/g;
    let m;
    while ((m = re.exec(code))) lines.push(lineOf[m.index]);
    dynamicImports.push([rel, lines]);
  }
  for (const ln of topLevelAwaits(code, lineOf)) tla.push([rel, ln]);
}

console.log('=== 一、不许有动态 import() ===');
if (dynamicImports.length) {
  for (const [rel, lines] of dynamicImports) console.log(`  ✗ ${rel} 第 ${lines.join('、')} 行`);
  console.log('     → 动态 import() 会让 esbuild 把整张模块图改成 __esm 惰性初始化，');
  console.log('       产出「同步函数里带 await」的代码，workerd 直接 SyntaxError。');
  console.log('       改成文件顶部的静态 import。');
  bad += dynamicImports.length;
} else {
  console.log(`  ✓ ${files.length} 个文件里没有动态 import()`);
}

console.log('\n=== 二、不许有顶层 await ===');
if (tla.length) {
  for (const [rel, ln] of tla) console.log(`  ✗ ${rel} 第 ${ln} 行`);
  console.log('     → 顶层 await 同样会引出惰性初始化包装。挪进 async 函数里。');
  bad += tla.length;
} else {
  console.log(`  ✓ ${files.length} 个文件里没有花括号深度 0 的 await`);
}

console.log('\n=== 二之三、不许碰 process（Workers 里没有这个全局）===');
// 2026 年 10 月站长截图「process is not defined」：我为了做对照实验，在 prompt.mjs 里
// 直接写了 process.env.CIHUA_OFF。node: 引用、动态 import、顶层 await 都查过，
// 可 process 是**全局引用**，从旧检查的眼皮底下过去了。
// 现在的规矩只有一条：bundle 链上只许 server/flags.mjs 出现 process（且必须是 typeof 试探）。
{
  const offenders = [];
  for (const f of files) {
    const src = await fs.readFile(f, 'utf8');
    const rel = path.relative(ROOT, f).split(path.sep).join('/');
    if (rel === 'server/flags.mjs') continue;
    if (/\bprocess\s*\./.test(src)) offenders.push(rel);
  }
  ok(offenders.length === 0, 'bundle 链上除 server/flags.mjs 外没人引用 process', offenders.join('、'));
  ok(/typeof process/.test(await fs.readFile(path.join(ROOT, 'server/flags.mjs'), 'utf8')), 'flags.mjs 用 typeof 试探，不是直接引用');
}
console.log('\n=== 三、不许 import node: 内置模块 ===');
// 一旦 bundle 里出现 node:fs 之类，esbuild 打不出来，或者打出来在 workerd 里直接失败。
// Node 专用的那几个文件已在 collect() 里排除，这里扫的就是真正会进 bundle 的那些。
const nodeImports = [];
for (const f of files) {
  const src = await fs.readFile(f, 'utf8');
  const rel = path.relative(ROOT, f).split(path.sep).join('/');
  const m = src.match(/from\s+['"]node:[^'"]+['"]/g);
  if (m) nodeImports.push([rel, m.join('、')]);
}
if (nodeImports.length) {
  for (const [rel, what] of nodeImports) console.log(`  ✗ ${rel} 引用了 ${what}`);
  console.log('     → 这些模块会被打进 workerd bundle，Node 内置模块在那里不存在。');
  bad += nodeImports.length;
} else {
  console.log(`  ✓ ${files.length} 个会进 bundle 的文件都没有 node: 引用`);
}

// Node 专用文件不许被 bundle 链 import 到
let touched = 0;
for (const f of files) {
  const rel = path.relative(ROOT, f).split(path.sep).join('/');
  const src = await fs.readFile(f, 'utf8');
  for (const n of NODE_ONLY) {
    const base = path.basename(n);
    if (rel !== n && new RegExp(`from\\s+['"][^'"]*${base.replace('.', '\\.')}['"]`).test(src)) {
      touched++;
      console.log(`  ✗ ${rel} 引用了 Node 专用模块 ${n}`);
    }
  }
}
ok(touched === 0, 'Node 专用模块没有被 bundle 链引用', touched ? `${touched} 处` : NODE_ONLY.join('、'));

console.log('\n=== 四、确认守望者自己在看着的东西是对的 ===');
// 这两个文件正是出问题的地方，单独点名，防止有人「顺手改回去」
const MUST_BE_STATIC = [
  ['server/validator.mjs', ['./rhyme.mjs', './pingshui.mjs']],
  ['server/allusions.mjs', ['./allusions-a.mjs', './allusions-b.mjs']],
];
let staticBad = 0;
for (const [rel, deps] of MUST_BE_STATIC) {
  const src = await fs.readFile(path.join(ROOT, rel), 'utf8');
  for (const dep of deps) {
    const staticForm = new RegExp(`^\\s*import\\s+\\*\\s+as\\s+\\w+\\s+from\\s+'${dep.replace('.', '\\.')}'`, 'm');
    if (!staticForm.test(src)) {
      staticBad++;
      console.log(`  ✗ ${rel} 没有静态 import '${dep}'`);
    }
  }
}
ok(staticBad === 0, '韵书与典故数据都是静态 import', staticBad ? `${staticBad} 处不合` : '共 4 处');

console.log('\n=== 五、扫描器自证：拿当初出事的那两段代码喂给它，必须报错 ===');
const FIXTURES = [
  {
    name: '当初 validator.mjs 的写法（动态 import 包在 try 里）',
    src: `let rhymeMod = null;\ntry {\n  rhymeMod = await import('./rhyme.mjs');\n} catch {\n}\nexport const hasRhymeBook = Boolean(rhymeMod);\n`,
    wantDynamic: 1,
    wantTla: 0, // 它在花括号里，深度 1；靠第一条规则抓
  },
  {
    name: '真正的顶层 await',
    src: `import { x } from './x.mjs';\nconst data = await fetch('https://example.com');\nexport const y = data;\n`,
    wantDynamic: 0,
    wantTla: 1,
  },
  {
    name: '合法的 async 函数里的 await（不该报）',
    src: `export async function go() {\n  const r = await fetch('https://example.com');\n  return r;\n}\n`,
    wantDynamic: 0,
    wantTla: 0,
  },
  {
    name: '正则字面量里的 await / import(（不该报）',
    src: `const a = (s.match(/await init_/g) || []).length;\nconst b = /import\\(/.test(s);\nconst c = s.replace(/\\//g, '-');\nconst d = n / 2;\nexport { a, b, c, d };\n`,
    wantDynamic: 0,
    wantTla: 0,
  },
  {
    name: '注释与字符串里的 await / import(（不该报）',
    src: `// 这里说明一下 await import('./x.mjs') 为什么不能写\nconst s = "await import('./y.mjs')";\nconst t = \`await import('./z.mjs')\`;\nexport const u = s + t;\n`,
    wantDynamic: 0,
    wantTla: 0,
  },
];
let scannerBad = 0;
for (const fx of FIXTURES) {
  const { code, lineOf } = strip(fx.src);
  const gotDynamic = (code.match(/\bimport\s*\(/g) || []).length;
  const gotTla = topLevelAwaits(code, lineOf).length;
  const pass = gotDynamic === fx.wantDynamic && gotTla === fx.wantTla;
  if (!pass) scannerBad++;
  console.log(
    `${pass ? '✓' : '✗'} ${fx.name}　动态 import=${gotDynamic}（期望 ${fx.wantDynamic}）顶层 await=${gotTla}（期望 ${fx.wantTla}）`
  );
}
ok(scannerBad === 0, `扫描器对 ${FIXTURES.length} 个样例判断都正确`, scannerBad ? `${scannerBad} 处判错` : '含正例与反例');

console.log('\n' + '─'.repeat(56));
console.log(bad === 0 ? '打包安全检查通过：这份源码能安全地打成 workerd bundle' : `${bad} 项未通过 —— 部署会在 workerd 里解析失败`);
process.exit(bad === 0 ? 0 : 1);
