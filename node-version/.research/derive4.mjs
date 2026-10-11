// 近体诗格律推导（自证版 v4）
// 四种基本律句（五言）：A 仄仄平平仄  B 平平仄仄平  C 平平平仄仄  D 仄仄仄平平
// 七言 = 在五言句前加两字，所加二字与首二字平仄相反。
//
// 推导规则（按优先级）：
//   1. 押韵：对句（偶数句）必收平声；出句（除首句外）不收平声
//   2. 粘  ：下联出句的第二字，与上联对句的第二字同平仄
//   3. 对  ：同一联内，对句尽量与出句逐字相反
// 实现：每步在四种律句里先按 1、2 过滤，再按 3 取汉明距离最小者。
const A5 = '仄仄平平仄';
const B5 = '平平仄仄平';
const C5 = '平平平仄仄';
const D5 = '仄仄仄平平';
const WU = [A5, B5, C5, D5];

const flip = (l) => [...l].map((c) => (c === '平' ? '仄' : '平')).join('');
const qi = (l) => flip(l.slice(0, 2)) + l;
const baseOf = (size) => (size === 5 ? WU : WU.map(qi));

function dist(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

/** 挑律句：先满足硬条件（收尾、粘），再取与「对」理想式最近者 */
function choose(ideal, size, { ending, sticky, stickyPos = 1 }) {
  const cands = baseOf(size).map((f) => f.slice(0, size));
  let pool = cands.filter((c) => !ending || c.endsWith(ending));
  if (sticky && pool.some((c) => c[stickyPos] === sticky)) {
    pool = pool.filter((c) => c[stickyPos] === sticky);
  }
  if (!pool.length) pool = cands;
  pool.sort((a, b) => dist(a, ideal) - dist(b, ideal));
  return pool[0];
}

function build(first, couplets, size) {
  const lines = [first];
  for (let i = 1; i < couplets * 2; i++) {
    const isDui = i % 2 === 1;
    const ideal = flip(lines[i - 1]);
    if (isDui) {
      lines.push(choose(ideal, size, { ending: '平' }));
    } else {
      lines.push(choose(ideal, size, { ending: '仄', sticky: lines[i - 1][1] }));
    }
  }
  return lines;
}

const ANCHORS = [
  ['五律·仄起不入韵（杜甫《春望》）', ['仄仄平平仄', '平平仄仄平', '平平平仄仄', '仄仄仄平平', '仄仄平平仄', '平平仄仄平', '平平平仄仄', '仄仄仄平平']],
  ['五律·平起不入韵（王维《山居秋暝》）', ['平平平仄仄', '仄仄仄平平', '仄仄平平仄', '平平仄仄平', '平平平仄仄', '仄仄仄平平', '仄仄平平仄', '平平仄仄平']],
  ['七绝·仄起不入韵', ['仄仄平平平仄仄', '平平仄仄仄平平', '平平仄仄平平仄', '仄仄平平仄仄平']],
  ['七绝·平起入韵', ['平平仄仄仄平平', '仄仄平平仄仄平', '仄仄平平平仄仄', '平平仄仄仄平平']],
  ['五绝·仄起不入韵', ['仄仄平平仄', '平平仄仄平', '平平平仄仄', '仄仄仄平平']],
  ['七律·平起入韵（首联）', ['平平仄仄仄平平', '仄仄平平仄仄平', '仄仄平平平仄仄', '平平仄仄仄平平', '平平仄仄平平仄', '仄仄平平仄仄平', '仄仄平平平仄仄', '平平仄仄仄平平']],
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

console.log('\n=== 四式 × 绝句/律诗 ===');
for (const size of [5, 7]) {
  for (const full of baseOf(size)) {
    const first = full.slice(0, size);
    for (const couplets of [2, 4]) {
      const lines = build(first, couplets, size);
      const problems = [];
      lines.forEach((l, i) => {
        if (i % 2 === 1 && !l.endsWith('平')) problems.push(`第${i + 1}句对句未收平`);
        if (i > 0 && i % 2 === 0 && l.endsWith('平')) problems.push(`第${i + 1}句出句收平`);
        if (i > 0 && i % 2 === 0 && l[1] !== lines[i - 1][1]) problems.push(`第${i + 1}句失粘`);
      });
      if (problems.length) bad++;
      const mask = lines.map((l, i) => (i % 2 === 1 ? true : i === 0 && l.endsWith('平')));
      console.log(
        `${problems.length ? '✗' : '✓'} ${size}言${couplets === 2 ? '绝句' : '律诗'} 首句「${first}」 韵位 ${mask.map((x) => (x ? '韵' : '·')).join('')}`
      );
      console.log(`    ${lines.join(' / ')}`);
      if (problems.length) console.log(`    ⚠ ${problems.join('；')}`);
    }
  }
}
console.log(bad === 0 ? '\n全部通过' : `\n${bad} 处不通过`);
process.exit(bad === 0 ? 0 : 1);
