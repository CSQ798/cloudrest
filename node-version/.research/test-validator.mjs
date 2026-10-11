// 用钦谱例词反过来验校验器：例词本身必须合格；故意写坏的必须被判错
import fs from 'node:fs/promises';
import { check, checkCi, checkShi, hasRhymeBook, hasPingShui } from '../server/validator.mjs';
import { TUNES } from '../server/tunes.mjs';

console.log(`韵书就绪=${hasRhymeBook} 平水韵就绪=${hasPingShui}\n`);

const parsed = JSON.parse(await fs.readFile(new URL('./parsed.json', import.meta.url), 'utf8'));

let bad = 0;
console.log('=== 正例：钦谱例词本身应判为合格（至多提示平仄）===');
for (const r of parsed) {
  if (r.error || !r.sentences) continue;
  const lines = r.sentences.map((s) => s.text);
  const res = checkCi(r.name, lines);
  const ok = res.level !== 'error';
  if (!ok) bad++;
  const errs = res.issues.filter((i) => i.severity === 'error');
  console.log(
    `${ok ? '✓' : '✗'} ${r.name.padEnd(4, '　')} ${res.level}` +
      (errs.length ? '  ✗ ' + errs.map((e) => e.text).join('；') : '') +
      (res.stats.平仄出入 ? `  (平仄出入 ${res.stats.平仄出入})` : '')
  );
}

console.log('\n=== 反例：故意写坏，必须判错 ===');
const CASES = [
  ['少句', '浣溪沙', ['宿醉离愁慢髻鬟', '六铢衣薄惹轻寒'], 'error'],
  ['少字', '浣溪沙', ['宿醉离愁慢髻', '六铢衣薄惹轻寒', '慵红闷翠掩青鸾', '罗袜况兼金菡萏', '雪肌仍是玉琅玕', '骨香腰细更沈檀'], 'error'],
  // 押韵不一致按「提示」计：换韵词牌的韵位是从词谱批注推来的，容错余地大，故只求 warn
  ['出韵', '浣溪沙', ['宿醉离愁慢髻鬟', '六铢衣薄惹轻寒', '慵红闷翠掩青鸾', '罗袜况兼金菡萏', '雪肌仍是玉琅玕', '骨香腰细更沈东'], 'warn'],
];
for (const [name, form, lines, want] of CASES) {
  const res = checkCi(form, lines);
  const ok = res.level === want;
  if (!ok) bad++;
  console.log(
    `${ok ? '✓' : '✗'} ${name}：${res.level}（期望 ${want}） ` +
      res.issues.map((i) => `${i.severity === 'error' ? '✗' : '·'}${i.text}`).join('；')
  );
}

console.log('\n=== 近体诗 ===');
const SHI_CASES = [
  ['五言绝句·正例（王之涣《登鹳雀楼》）', '五言绝句', ['白日依山尽', '黄河入海流', '欲穷千里目', '更上一层楼']],
  ['五言律诗·正例（杜甫《春望》）', '五言律诗', ['国破山河在', '城春草木深', '感时花溅泪', '恨别鸟惊心', '烽火连三月', '家书抵万金', '白头搔更短', '浑欲不胜簪']],
  ['七言绝句·正例（李白《早发白帝城》）', '七言绝句', ['朝辞白帝彩云间', '千里江陵一日还', '两岸猿声啼不住', '轻舟已过万重山']],
];
for (const [name, form, lines] of SHI_CASES) {
  const res = checkShi(form, lines);
  const ok = res.level !== 'error';
  if (!ok) bad++;
  console.log(`${ok ? '✓' : '✗'} ${name} → ${res.level} ${JSON.stringify(res.stats)}`);
  for (const i of res.issues) console.log(`      ${i.severity === 'error' ? '✗' : '·'} ${i.text}`);
}

console.log(bad === 0 ? '\n全部通过' : `\n${bad} 处未通过`);
process.exit(bad === 0 ? 0 : 1);
