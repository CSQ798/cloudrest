// 近体诗格律推导（自证版）
// 四种基本律句（五言）：
//   A 仄仄平平仄   B 平平仄仄平   C 平平平仄仄   D 仄仄仄平平
// 粘对律：
//   对 —— 同一联内，对句与出句平仄相反
//   粘 —— 下联出句的第二字，与上联对句的第二字相同（平仄同类）
//   韵 —— 对句必收平声（押韵）；出句除首句外不收平声（不押韵）
// 每步在四种律句里挑：先满足粘与收尾要求，再取与「对」推出的理想式最接近者。
const A5 = '仄仄平平仄';
const B5 = '平平仄仄平';
const C5 = '平平平仄仄';
const D5 = '仄仄仄平平';
const WU = [A5, B5, C5, D5];

const flip = (l) => [...l].map((c) => (c === '平' ? '仄' : '平')).join('');
const qi = (l) => flip(l.slice(0, 2)) + l;
const baseOf = (size) => (size === 5 ? WU : WU.map(qi));

function choose(ideal, size, { ending, sticky }) {
  const scored = baseOf(size).map((full) => {
    const c = full.slice(0, size);
    let d = 0;
    for (let i = 0; i < size; i++) if (c[i] !== ideal[i]) d++;
    if (ending && !c.endsWith(ending)) d += 0.5;
    if (sticky && c[1] !== sticky) d += 100; // 失粘：直接排除
    return { c, d };
  });
  scored.sort((a, b) => a.d - b.d);
  return scored[0].c;
}

/** 由首句推出全篇。首句决定入韵与否，其后每句由粘对决定 */
function build(first, couplets, size) {
  const lines = [first];
  for (let i = 1; i < couplets * 2; i++) {
    const isDui = i % 2 === 1; // 对句（偶数句位）
    const ideal = flip(lines[i - 1]);
    if (isDui) {
      lines.push(choose(ideal, size, { ending: '平' }));
    } else {
      const sticky = lines[i - 1][1]; // 与上联对句第二字相粘
      lines.push(choose(ideal, size, { ending: '仄', sticky }));
    }
  }
  return lines;
}

const ANCHORS = [
  ['五律·仄起不入韵（杜甫《春望》）', ['仄仄平平仄', '平平仄仄平', '平平平仄仄', '仄仄仄平平', '仄仄平平仄', '平平仄仄平', '平平平仄仄', '平平仄仄平']],
  ['五律·平起不入韵（王维《山居秋暝》）', ['平平平仄仄', '仄仄仄平平', '仄仄平平仄', '平平仄仄平', '平平平仄仄', '仄仄仄平平', '仄仄平平仄', '平平仄仄平']],
  ['七绝·仄起不入韵', ['仄仄平平平仄仄', '平平仄仄仄平平', '平平仄仄平平仄', '仄仄平平仄仄平']],
  ['七绝·平起入韵', ['平平仄仄仄平平', '仄仄平平仄仄平', '仄仄平平平仄仄', '平平仄仄仄平平']],
  ['五绝·仄起不入韵', ['仄仄平平仄', '平平仄仄平', '平平平仄仄', '仄仄仄平平']],
];

let bad = 0;
console.log('=== 锚点核对 ===');
for (const [name, want] of ANCHORS) {
  const got = build(want[0], want.length / 2, want[0].length);
  const same = JSON.stringify(got) === JSON.stringify(want);
  if (!same) bad++;
  console.log(`${same ? '✓' : '✗'} ${name}`);
  console.log(`    ${got.join(' / ')}`);
  if (!same) console.log(`    应为 ${want.join(' / ')}`);
}

console.log('\n=== 四种首式 × 绝句/律诗 ===');
for (const size of [5, 7]) {
  for (const full of baseOf(size)) {
    const first = full.slice(0, size);
    for (const couplets of [2, 4]) {
      const lines = build(first, couplets, size);
      const problems = [];
      lines.forEach((l, i) => {
        const isDui = i % 2 === 1;
        if (isDui && !l.endsWith('平')) problems.push(`第${i + 1}句对句未收平`);
        if (!isDui && i > 0 && l.endsWith('平')) problems.push(`第${i + 1}句出句收平`);
        if (i > 0 && !isDui && l[1] !== lines[i - 1][1]) problems.push(`第${i + 1}句失粘`);
      });
      if (problems.length) bad++;
      const rhymes = lines.map((l, i) => (!(i % 2) && i > 0 ? '·' : l.endsWith('平') ? '韵' : '·')).join('');
      console.log(`${problems.length ? '✗' : '✓'} ${size}言${couplets === 2 ? '绝句' : '律诗'} 首句「${first}」 韵位 ${rhymes}`);
      console.log(`    ${lines.join(' / ')}`);
      if (problems.length) console.log(`    ⚠ ${problems.join('；')}`);
    }
  }
}
console.log(bad === 0 ? '\n全部通过' : `\n${bad} 处不通过`);
process.exit(bad === 0 ? 0 : 1);
