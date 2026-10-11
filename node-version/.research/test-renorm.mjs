// 按句式机械切行：必须能修正「两句并一行」「末句少字」，且不误判
import { renormByLens } from '../server/validator.mjs';

const L7 = Array(8).fill(7);
const L5 = Array(8).fill(5);

const CASES = [
  ['正常八句', ['霓虹尽处路人行', '灯影重重水色明', '门外风霜各自远', '座中意气正纵横', '暗凝杯壁珍珠冷', '别有孤鸿向晚鸣', '莫问河山可易老', '九州同辙即能归'], L7, true],
  ['末句少一字（应被判不可修）', ['霓虹尽处路人行', '灯影重重水色明', '门外风霜各自远', '座中意气正纵横', '暗凝杯壁珍珠冷', '别有孤鸿向晚鸣', '莫问河山可易老', '九州同辙即能'], L7, false],
  ['两句并成一行', ['霓虹尽处路人行灯影重重水色明', '门外风霜各自远', '座中意气正纵横', '暗凝杯壁珍珠冷', '别有孤鸿向晚鸣', '莫问河山可易老', '九州同辙即能归'], L7, true],
  ['四句并成两行', ['霓虹尽处路人行灯影重重水色明', '门外风霜各自远座中意气正纵横', '暗凝杯壁珍珠冷', '别有孤鸿向晚鸣', '莫问河山可易老', '九州同辙即能归'], L7, true],
  ['全部并成一行', ['霓虹尽处路人行灯影重重水色明门外风霜各自远座中意气正纵横暗凝杯壁珍珠冷别有孤鸿向晚鸣莫问河山可易老九州同辙即能归'], L7, true],
  ['五律·多一字', ['国破山河在城', '春草木深', '感时花溅泪', '恨别鸟惊心', '烽火连三月', '家书抵万金', '白头搔更短', '浑欲不胜簪'], L5, true],
];

let bad = 0;
for (const [name, lines, lens, wantExact] of CASES) {
  const r = renormByLens(lines, lens);
  const okExact = r && r.exact === wantExact;
  const okLens = !wantExact || r.lines.every((l) => l.length === 7 || l.length === 5);
  const ok = okExact && okLens;
  if (!ok) bad++;
  console.log(`${ok ? '✓' : '✗'} ${name} → exact=${r ? r.exact : 'null'}`);
  if (r) console.log('     ' + r.lines.map((l) => `${l}(${l.length})`).join(' / '));
  if (!ok) console.log(`     期望 exact=${wantExact}`);
}
console.log(bad === 0 ? '\n全部符合预期' : `\n${bad} 处不符预期`);
process.exit(bad === 0 ? 0 : 1);
