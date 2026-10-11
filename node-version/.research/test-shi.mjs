// 自证：近体诗格律表（正式模块）
import { shiPatterns, parallelCouplets, SHI_NAMES, baseLines } from '../server/shi.mjs';

let bad = 0;
const ANCHORS = {
  五言律诗: {
    仄仄平平仄: ['仄仄平平仄', '平平仄仄平', '平平平仄仄', '仄仄仄平平', '仄仄平平仄', '平平仄仄平', '平平平仄仄', '仄仄仄平平'],
    平平平仄仄: ['平平平仄仄', '仄仄仄平平', '仄仄平平仄', '平平仄仄平', '平平平仄仄', '仄仄仄平平', '仄仄平平仄', '平平仄仄平'],
  },
  七言绝句: {
    仄仄平平平仄仄: ['仄仄平平平仄仄', '平平仄仄仄平平', '平平仄仄平平仄', '仄仄平平仄仄平'],
    平平仄仄仄平平: ['平平仄仄仄平平', '仄仄平平仄仄平', '仄仄平平平仄仄', '平平仄仄仄平平'],
  },
};

for (const name of SHI_NAMES) {
  const pats = shiPatterns(name);
  const size = name.startsWith('五') ? 5 : 7;
  console.log(`# ${name}（要求对仗的联：${parallelCouplets(name).map((i) => i + 1).join(',') || '无'}）`);
  for (const p of pats) {
    const problems = [];
    p.lines.forEach((l, i) => {
      if ([...l].length !== size) problems.push(`第${i + 1}句长度错`);
      const isDui = i % 2 === 1;
      if (isDui && !l.endsWith('平')) problems.push(`第${i + 1}句对句未收平`);
      if (!isDui && i > 0 && l.endsWith('平')) problems.push(`第${i + 1}句出句收平`);
      if (i > 0 && !isDui && l[1] !== p.lines[i - 1][1]) problems.push(`第${i + 1}句失粘`);
      if (p.rhyme[i] !== l.endsWith('平')) problems.push(`第${i + 1}句韵位与收尾不符`);
    });
    if (problems.length) bad++;
    console.log(`${problems.length ? '✗' : '✓'} 首句「${p.first}」入韵=${p.first.endsWith('平')}`);
    console.log(`    ${p.lines.join(' / ')}`);
    console.log(`    韵脚句 ${p.rhyme.map((x, i) => (x ? i + 1 : '')).filter(Boolean).join(',')}`);
    if (problems.length) console.log('    ⚠ ' + problems.join('；'));
  }
}

// 与锚点核对
console.log('\n# 锚点核对');
for (const [name, byFirst] of Object.entries(ANCHORS)) {
  const pats = shiPatterns(name);
  for (const [first, want] of Object.entries(byFirst)) {
    const got = pats.find((p) => p.first === first);
    const same = got && JSON.stringify(got.lines) === JSON.stringify(want);
    if (!same) bad++;
    console.log(`${same ? '✓' : '✗'} ${name} 首句「${first}」`);
    if (!same) console.log(`    推出 ${got ? got.lines.join('/') : '无'}\n    应为 ${want.join('/')}`);
  }
}
console.log(bad === 0 ? '\n全部通过' : `\n${bad} 处不通过`);
process.exit(bad === 0 ? 0 : 1);
