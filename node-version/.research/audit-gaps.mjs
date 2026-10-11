// 核查目标里几条「做得够不够实」的项目
import { check, checkShi, checkCi } from '../server/validator.mjs';
import { getTune } from '../server/tunes.mjs';
import { SHI_NAMES } from '../server/shi.mjs';

console.log('=== 1. 律诗对仗：现在的判据能抓到什么、漏掉什么 ===');
const CASES = [
  ['真对仗（工对）', '五言律诗', ['国破山河在', '城春草木深', '感时花溅泪', '恨别鸟惊心', '烽火连三月', '家书抵万金', '白头搔更短', '浑欲不胜簪']],
  ['假对仗（两句毫不相干、内容不相对）', '五言律诗', ['国破山河在', '城春草木深', '客人来问字', '我去买斤盐', '烽火连三月', '家书抵万金', '白头搔更短', '浑欲不胜簪']],
  ['对仗位置字面重复', '五言律诗', ['国破山河在', '城春草木深', '感时花溅泪', '感别鸟惊心', '烽火连三月', '家书抵万金', '白头搔更短', '浑欲不胜簪']],
  ['同字结尾（非对仗）', '五言律诗', ['国破山河在', '城春草木深', '感时花溅泪', '恨别鸟溅泪', '烽火连三月', '家书抵万金', '白头搔更短', '浑欲不胜簪']],
];
for (const [name, form, lines] of CASES) {
  const r = checkShi(form, lines);
  const par = r.issues.filter((i) => i.text.includes('对仗'));
  console.log(`  ${name.padEnd(26)} level=${r.level}  对仗提示：${par.length ? par.map((p) => p.text).join('；').slice(0, 50) : '（无）'}`);
}

console.log('\n=== 2. 律诗中间两联全不对仗时，能否触发重写（level 是否为 error） ===');
const bad = ['国破山河在', '城春草木深', '客人来问字', '我去买斤盐', '烽火连三月', '家书抵万金', '白头搔更短', '浑欲不胜簪'];
const rb = checkShi('五言律诗', bad);
console.log('  level =', rb.level, '→', rb.level === 'error' ? '会重写' : '不会重写（只提示）');

console.log('\n=== 3. 白话/现代词：现在有没有在管 ===');
const MODERN = [
  ['大白话动词', '我可以帮你做这个'],
  ['现代名词', '手机响了我在等电梯'],
  ['虚词', '我的心情很好的'],
];
for (const [name, line] of MODERN) {
  const r = checkCi('浣溪沙', [line, 'x', 'x', 'x', 'x', 'x'].map((s) => s.padEnd(7, '水')));
  const hit = r.issues.filter((i) => /白话|现代|虚词/.test(i.text));
  console.log(`  ${name}：${hit.length ? hit.map((h) => h.text).join('；') : '✗ 完全没有检查'}`);
}

console.log('\n=== 4. 自填体裁是否被接受 ===');
for (const f of ['水调歌头', '减字木兰花', '五言绝句']) {
  const known = Boolean(getTune(f)) || SHI_NAMES.includes(f);
  console.log(`  ${f}：${known ? '已核验' : '未核验'}（getTune/ SHI 能识别）`);
}
