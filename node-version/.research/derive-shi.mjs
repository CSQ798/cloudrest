// 粘对律：全篇由「对」唯一推出
// 基本律句（五言四种）：
//   A 仄仄平平仄   B 平平仄仄平   C 平平平仄仄   D 仄仄仄平平
// 规则：
//   对 —— 同一联出句与对句平仄相反；下联出句亦与上联对句相反
//   押韵 —— 对句必收平声；出句（除首句可入韵外）收仄声
// 实现：每步用「对」推出理想式，若理想式不存在于四种律句里，
//       则取与该理想式汉明距离最小的律句，并按押韵要求收尾。
const A5 = '仄仄平平仄';
const B5 = '平平仄仄平';
const C5 = '平平平仄仄';
const D5 = '仄仄仄平平';
const WU = [A5, B5, C5, D5];

const flip = (l) => [...l].map((c) => (c === '平' ? '仄' : '平')).join('');
const qi = (l) => flip(l.slice(0, 2)) + l;
const baseOf = (size) => (size === 5 ? WU : WU.map(qi));

/** 取与『对』推出的理想式最接近的律句，并要求指定的收尾声调（'平'=押韵, '仄'=不押韵, null=不限） */
function pick(ideal, size, ending) {
  const cands = baseOf(size).slice();
  const scored = cands.map((c) => {
    let d = 0;
    for (let i = 0; i < size; i++) if (c[i] !== ideal[i]) d++;
    if (ending && !c.endsWith(ending)) d += 0.5; // 收尾不合要求者加罚
    return { c, d };
  });
  scored.sort((a, b) => a.d - b.d);
  return scored[0].c.slice(0, size);
}

function build(first, couplets, size) {
  const lines = [first];
  for (let c = 0; c < couplets; c++) {
    const chu = lines[lines.length - 1];
    lines.push(pick(flip(chu), size, '平')); // 对句必押韵，收平声
    if (c < couplets - 1) {
      const dui = lines[lines.length - 1];
      lines.push(pick(flip(dui), size, '仄')); // 下联出句与上联对句相反，不押韵
    }
  }
  return lines;
}

const CHUNWANG = ['仄仄平平仄', '平平仄仄平', '平平平仄仄', '仄仄仄平平', '仄仄平平仄', '平平仄仄平', '平平平仄仄', '平平仄仄平'];
const SHANJU = ['平平平仄仄', '仄仄仄平平', '仄仄平平仄', '平平仄仄平', '平平平仄仄', '仄仄仄平平', '仄仄平平仄', '平平仄仄平'];
const WANGLUESHAN = ['仄仄平平仄', '平平仄仄平', '平平平仄仄', '仄仄仄平平', '仄仄平平仄', '平平仄仄平', '平平平仄仄', '平平仄仄平'];
const QIJUE = ['仄仄平平平仄仄', '平平仄仄仄平平', '平平仄仄平平仄', '仄仄平平仄仄平'];

let bad = 0;
function checkAnchor(name, want) {
  const got = build(want[0], want.length / 2, want[0].length);
  const same = JSON.stringify(got) === JSON.stringify(want);
  if (!same) bad++;
  console.log(`${same ? '✓' : '✗'} ${name}`);
  console.log(`    推出 ${got.join(' / ')}`);
  if (!same) console.log(`    应为 ${want.join(' / ')}`);
}

console.log('=== 锚点（公认名作的格律）===');
checkAnchor('五律·仄起不入韵（杜甫《春望》）', CHUNWANG);
checkAnchor('五律·平起不入韵（王维《山居秋暝》）', SHANJU);
checkAnchor('七绝·仄起不入韵', QIJUE);

console.log('\n=== 全部四式各族 ===');
for (const size of [5, 7]) {
  for (const first of baseOf(size)) {
    for (const couplets of [2, 4]) {
      const lines = build(first, couplets, size);
      const rhymes = lines.map((l, i) => (l.endsWith('平') && (i % 2 === 1 || i === 0) ? '韵' : '·')).join('');
      // 自检：对句收平、出句（非首句）收仄
      const problems = [];
      lines.forEach((l, i) => {
        if (i % 2 === 1 && !l.endsWith('平')) problems.push(`第${i + 1}句对句未收平`);
        if (i > 0 && i % 2 === 0 && l.endsWith('平')) problems.push(`第${i + 1}句出句收平（不当押韵）`);
      });
      if (problems.length) bad++;
      console.log(
        `${problems.length ? '✗' : '✓'} ${size}言${couplets}联 首句「${first}」\n    ${lines.join(' / ')}\n    韵位 ${rhymes}` +
          (problems.length ? `\n    ⚠ ${problems.join('；')}` : '')
      );
    }
  }
}
console.log(bad === 0 ? '\n全部通过' : `\n${bad} 处不通过`);
process.exit(bad === 0 ? 0 : 1);
