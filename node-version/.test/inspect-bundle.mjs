// 查看一份 bundle：里面有没有「同步包装函数里带 await」这种 workerd 解析不了的写法
//
// 用法：
//   node .test/inspect-bundle.mjs <bundle.js> [<bundle2.js> ...]
//
// 为什么要看这个：
//   esbuild 为了保持动态 import() 的惰性语义，会生成
//     var __esm = (fn, res) => function __init() { ... };   ← 同步包装
//     var init_x = __esm({ "x.mjs"() { await init_y(); ... } });  ← 里面却有 await
//   workerd 一解析就报 Uncaught SyntaxError: Unexpected reserved word，
//   Pages 直接 Deployment failed，Workers 则是运行时才炸。
//
//   健康的 bundle：__esm 0 次、await init_ 0 次。

import fs from 'node:fs';

const files = process.argv.slice(2);
if (!files.length) {
  console.log('用法：node .test/inspect-bundle.mjs <bundle.js> [...]');
  process.exit(2);
}

let bad = 0;
for (const f of files) {
  if (!fs.existsSync(f)) {
    console.log(`✗ 找不到 ${f}`);
    bad++;
    continue;
  }
  const t = fs.readFileSync(f, 'utf8');
  const lines = t.split('\n');
  const esm = (t.match(/__esm/g) || []).length;
  const awaits = (t.match(/await init_/g) || []).length;

  // 找出「包装函数没写 async，里面却 await」的地方
  const offenders = [];
  lines.forEach((l, i) => {
    // 形如：  "path"() {      ← 没有 async
    if (/^\s*"[^"]*"\(\)\s*\{\s*$/.test(l)) {
      // 往后看 6 行，若有 await 就是出事的写法
      for (let k = i + 1; k < Math.min(i + 7, lines.length); k++) {
        if (lines[k].includes('await ')) {
          offenders.push([i + 1, l.trim(), k + 1, lines[k].trim()]);
          break;
        }
      }
    }
  });

  const healthy = esm === 0 && awaits === 0 && offenders.length === 0;
  if (!healthy) bad++;

  console.log(`\n=== ${f} ===`);
  console.log(`  ${t.length} 字节，${lines.length} 行`);
  console.log(`  __esm ${esm} 次；await init_ ${awaits} 次；同步包装里带 await ${offenders.length} 处`);
  for (const [n1, l1, n2, l2] of offenders) {
    console.log(`    ✗ 第 ${n1} 行 ${l1}`);
    console.log(`      第 ${n2} 行 ${l2}`);
  }
  console.log(healthy ? '  ✓ 健康：workerd 能直接解析' : '  ✗ 有问题：workerd 解析会报 Unexpected reserved word');
}

process.exit(bad === 0 ? 0 : 1);
