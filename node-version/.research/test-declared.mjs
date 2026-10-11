// 自填体裁：模型先声明句式，服务端核对正文与声明是否一致
import { checkDeclared } from '../server/validator.mjs';

// [名称, 正文, 声明句式, 期望命中的报错关键词（空数组=不应有 error）]
const cases = [
  ['一致 · 不分片', ['明月几时有', '把酒问青天', '不知天上宫阙', '今夕是何年'], '5/5/6/5', []],
  ['一致 · 分片', ['明月几时有', '把酒问青天', '不知天上宫阙', '今夕是何年', '', '转朱阁', '低绮户', '照无眠'], '5/5/6/5 | 3/3/3', []],
  ['不一致 · 字数不同', ['明月几时', '把酒问青天', '不知天上宫阙', '今夕是何年'], '5/5/6/5', ['不符']],
  ['不一致 · 句数不同', ['明月几时有', '把酒问青天', '不知天上宫阙', '今夕是何年', '转朱阁', '低绮户'], '5/5/6/5', ['二者须一致']],
  ['分片标记错位（只提示，不算错）', ['明月几时有', '把酒问青天', '不知天上宫阙', '今夕是何年', '转朱阁', '', '低绮户', '照无眠'], '5/5/6/5 | 3/3/3', []],
  ['没声明句式', ['明月几时有', '把酒问青天', '不知天上宫阙', '今夕是何年'], null, []],
  ['句子过长', ['明月几时有把酒问青天不知天上宫阙今夕是何年', '把酒问青天', '不知天上', '今夕何年'], '16/5/4/4', ['常理', '不符']],
  ['混入白话', ['我的手机响了', '把酒问青天', '不知天上宫阙', '今夕是何年'], '6/5/6/5', []],
];

let bad = 0;
for (const [name, lines, meter, wantErrs] of cases) {
  const r = checkDeclared('水调歌头', lines, meter);
  const errs = r.issues.filter((i) => i.severity === 'error').map((i) => i.text);
  const okCount = errs.length === wantErrs.length;
  const okText = wantErrs.every((w) => errs.some((t) => t.includes(w)));
  const ok = okCount && okText;
  if (!ok) bad++;
  console.log(`\n${ok ? '✓' : '✗'} ${name}（声明 ${meter || '无'}）→ level=${r.level}`);
  for (const t of errs) console.log(`   ✗ ${t}`);
  for (const i of r.issues.filter((i) => i.severity !== 'error')) console.log(`   · ${i.text}`);
  if (!ok) console.log(`   期望报错关键词：${wantErrs.join('、') || '（无）'}`);
}

// 混入白话那条要求必须命中语言提示
const modern = checkDeclared('水调歌头', cases[7][1], cases[7][2]);
const modernHit = modern.issues.some((i) => i.text.includes('现代语汇'));
if (!modernHit) {
  bad++;
  console.log('\n✗ 混入白话未被检出');
} else {
  console.log('\n✓ 混入白话已检出');
}

console.log(bad === 0 ? '\n全部符合预期' : `\n${bad} 处不符预期`);
process.exit(bad === 0 ? 0 : 1);
