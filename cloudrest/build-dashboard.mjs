// 生成「拖拽上传」用的那个文件夹与 zip
//
// 用法（在 cloudrest 目录）：
//   node build-dashboard.mjs
//
// 为什么要有这个东西：
//   控制台的拖拽上传只收静态文件，**不会编译 functions/ 目录**
//   （Cloudflare 官方文档："Drag and drop deployments made from the Cloudflare
//    dashboard do not currently support compiling a `functions` folder"）。
//   所以「必须用 wrangler」这件事，对只想在浏览器里点几下的人来说是个死结。
//
//   Pages 的高级模式给了另一条路：把后端写成**单个 `_worker.js`** 放在输出目录根上，
//   平台不需要编译它，拖拽上传也支持。于是这里做两件事：
//     1. 用 esbuild 把 pages-entry.mjs 打成自包含的 dist-upload/_worker.js
//     2. 把 index.html / style.css / app.js 一起放进 dist-upload/
//   然后打包成 zip。用户拖那个 zip 到控制台，选 Production，保存即可 ——
//   不用装 wrangler、不用命令行、不用配分支、不用配配置文件。
//
// 产物里**只放四个文件**，因为上传目录里的任何东西都会被公开访问。
// 说明文字一律写在本脚本的输出里，不写进上传目录。

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'dist-upload');
const ZIP = path.join(HERE, 'cloudrest-拖拽上传.zip');

const ok = (m) => console.log(`  ✓ ${m}`);
const step = (m) => console.log(`\n${m}`);

/* ---------- 1. 找 esbuild ---------- */
function findEsbuild() {
  const base = path.join(HERE, 'node_modules', '@esbuild');
  if (!fs.existsSync(base)) return null;
  for (const d of fs.readdirSync(base)) {
    for (const name of ['esbuild', 'esbuild.exe']) {
      const p = path.join(base, d, name);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

const esbuild = findEsbuild();
if (!esbuild) {
  console.error('找不到 esbuild。先在项目目录执行：npm install');
  process.exit(1);
}
console.log(`esbuild：${path.relative(HERE, esbuild)}`);

/* ---------- 2. 打包 ---------- */
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const workerOut = path.join(OUT, '_worker.js');
step('打包后端 → dist-upload/_worker.js');
try {
  execFileSync(
    esbuild,
    [
      path.join(HERE, 'pages-entry.mjs'),
      '--bundle',
      '--format=esm',
      '--platform=neutral',
      '--target=es2022',
      `--outfile=${workerOut}`,
    ],
    // stdio 必须是 inherit：管道的父子进程通信在受限环境里会被拒（EPERM）
    { stdio: 'inherit', cwd: HERE }
  );
} catch (e) {
  console.error('esbuild 失败：', e.message);
  process.exit(1);
}
ok(`_worker.js　${(fs.statSync(workerOut).size / 1024).toFixed(0)} KB`);

/* ---------- 3. 拷静态文件 ---------- */
// 这个清单就是「上传目录里应该有的东西」。多一个文件都会被公开访问，
// 所以下面第 4 步会反过来检查目录里没有多余的。
// 上传目录里应该有的东西。收款码不在这里了 —— 买额度已撤，
// 没有任何页面引用它，就不必再把它公开出去。
const STATIC = [
  'index.html', 'style.css', 'fx.js',
  'app.js', 'card-layout.mjs', // 纸笺的版式算式，app.js 会 import 它
  'account.js', 'account.html', 'account-page.js',
  'admin.html', 'admin.js',
];

step('拷静态文件');
for (const f of STATIC) {
  fs.copyFileSync(path.join(HERE, 'public', f), path.join(OUT, f));
  ok(`${f}　${(fs.statSync(path.join(OUT, f)).size / 1024).toFixed(1)} KB`);
}

/* ---------- 4. 出厂自检：那份产物必须是 workerd 能解析的 ---------- */
step('出厂自检');
const bundle = fs.readFileSync(workerOut, 'utf8');
const esm = (bundle.match(/__esm/g) || []).length;
const awaits = (bundle.match(/await init_/g) || []).length;
if (esm || awaits) {
  console.error(`  ✗ 产物里有惰性初始化包装（__esm ${esm} 次、await init_ ${awaits} 次）——`);
  console.error('    workerd 会报 Uncaught SyntaxError: Unexpected reserved word。');
  console.error('    多半是源码里又出现了动态 import()，跑 node .test/bundle-safety-test.mjs 看详情。');
  process.exit(1);
}
ok('产物无 __esm / await init_（workerd 能直接解析）');

if (!/export\s*\{/.test(bundle) && !/export default/.test(bundle)) {
  console.error('  ✗ 产物里没有 export，不是合法的 Module Worker');
  process.exit(1);
}
ok('产物是 ESM 模块（有 export）');

// 目录里只许多出允许的那几个文件
const allow = new Set(['_worker.js', ...STATIC]);
const extra = fs.readdirSync(OUT).filter((f) => !allow.has(f));
if (extra.length) {
  console.error(`  ✗ 上传目录里多出了东西：${extra.join('、')}（它们会被公开访问）`);
  process.exit(1);
}
ok(`上传目录只含 ${allow.size} 个文件（里面任何东西都会公开可访问）`);

/* ---------- 5. 打 zip（条名一律正斜杠；存储方式，不压缩） ---------- */
step('打 zip');
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};

const entries = ['_worker.js', ...STATIC].map((name) => ({
  name,
  data: fs.readFileSync(path.join(OUT, name)),
}));

const locals = [];
const central = [];
let offset = 0;
// 固定时间戳，保证同一份源码打出来的 zip 逐字节一致（便于比对）
const dosTime = 0;
const dosDate = (2026 - 1980) * 512 + 1 * 32 + 1;

for (const e of entries) {
  const name = Buffer.from(e.name, 'utf8');
  const crc = crc32(e.data);
  const size = e.data.length;
  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0);
  lh.writeUInt16LE(20, 4); // version needed
  lh.writeUInt16LE(0, 6); // flags
  lh.writeUInt16LE(0, 8); // method = stored
  lh.writeUInt16LE(dosTime, 10);
  lh.writeUInt16LE(dosDate, 12);
  lh.writeUInt32LE(crc, 14);
  lh.writeUInt32LE(size, 18);
  lh.writeUInt32LE(size, 22);
  lh.writeUInt16LE(name.length, 26);
  lh.writeUInt16LE(0, 28);
  locals.push(lh, name, e.data);

  const ch = Buffer.alloc(46);
  ch.writeUInt32LE(0x02014b50, 0);
  ch.writeUInt16LE(20, 4); // version made by
  ch.writeUInt16LE(20, 6); // version needed
  ch.writeUInt16LE(0, 8);
  ch.writeUInt16LE(0, 10);
  ch.writeUInt16LE(dosTime, 12);
  ch.writeUInt16LE(dosDate, 14);
  ch.writeUInt32LE(crc, 16);
  ch.writeUInt32LE(size, 20);
  ch.writeUInt32LE(size, 24);
  ch.writeUInt16LE(name.length, 28);
  ch.writeUInt16LE(0, 30);
  ch.writeUInt16LE(0, 32);
  ch.writeUInt16LE(0, 34);
  ch.writeUInt16LE(0, 36);
  ch.writeUInt32LE(0, 38);
  ch.writeUInt32LE(offset, 42);
  central.push(ch, name);

  offset += lh.length + name.length + size;
}

const cdBuf = Buffer.concat(central);
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);
eocd.writeUInt16LE(0, 4);
eocd.writeUInt16LE(0, 6);
eocd.writeUInt16LE(entries.length, 8);
eocd.writeUInt16LE(entries.length, 10);
eocd.writeUInt32LE(cdBuf.length, 12);
eocd.writeUInt32LE(offset, 16);
eocd.writeUInt16LE(0, 20);

fs.writeFileSync(ZIP, Buffer.concat([...locals, cdBuf, eocd]));
ok(`${path.basename(ZIP)}　${(fs.statSync(ZIP).size / 1024).toFixed(0)} KB　（${entries.length} 个条目，全部正斜杠）`);

/* ---------- 6. 怎么用 ---------- */
console.log('\n' + '─'.repeat(58));
console.log('好了。两条路，选一条：\n');
console.log('【路一】把整个 zip 拖到控制台（推荐，不用命令行）');
console.log('  1. Cloudflare 控制台 → Workers & Pages → cloudrest → Create deployment');
console.log('  2. 环境选 Production');
console.log(`  3. 把 ${path.basename(ZIP)} 拖进去（注意：是这个名字，不是 cloudrest.zip）`);
console.log('  4. Save and deploy');
console.log('  5. 再去 Settings → Variables and Secrets，给 Production 加一条');
console.log('     DEEPSEEK_API_KEY，然后 Retry deployment');
console.log('\n【路二】先把密钥配好再传，省一次重传');
console.log('  1. 先照上面第 5 步把 DEEPSEEK_API_KEY 配上（Production 环境）');
console.log('  2. 再拖 zip 部署');
console.log('\n想先在本地看效果：node .test/serve-local.mjs   → http://127.0.0.1:7788');
console.log('传完想知道成没成：node .test/probe-api.mjs https://cloudrest.pages.dev');
console.log('  /api/health 返回 200 JSON 就成了；404 空响应说明后端还是没带上。');
console.log('─'.repeat(58) + '\n');
