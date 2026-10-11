// 白话词表与对仗检查的「误报」体检：古人真作不得被判为白话
import fs from 'node:fs/promises';
import { checkCi, checkShi, checkModern } from '../server/validator.mjs';

const parsed = JSON.parse(await fs.readFile(new URL('./parsed.json', import.meta.url), 'utf8'));

console.log('=== 21 首钦谱例词（真作）是否被误判为白话 ===');
let fp = 0;
for (const r of parsed) {
  if (r.error || !r.sentences) continue;
  const lines = r.sentences.map((s) => s.text);
  const r2 = checkCi(r.name, lines);
  const hit = r2.issues.find((i) => i.text.includes('现代语汇'));
  if (hit) {
    fp++;
    console.log(`  ✗ ${r.name}：${hit.text}`);
    console.log(`     例词：${lines.join(' / ')}`);
  }
}
console.log(fp === 0 ? '  ✓ 无一误报' : `  ✗ ${fp} 处误报`);

console.log('\n=== 名作（真作）是否被误判 ===');
const SHI = [
  ['五言绝句', ['白日依山尽', '黄河入海流', '欲穷千里目', '更上一层楼']],
  ['五言律诗', ['国破山河在', '城春草木深', '感时花溅泪', '恨别鸟惊心', '烽火连三月', '家书抵万金', '白头搔更短', '浑欲不胜簪']],
  ['七言绝句', ['朝辞白帝彩云间', '千里江陵一日还', '两岸猿声啼不住', '轻舟已过万重山']],
  ['七言律诗', ['风急天高猿啸哀', '渚清沙白鸟飞回', '无边落木萧萧下', '不尽长江滚滚来', '万里悲秋常作客', '百年多病独登台', '艰难苦恨繁霜鬓', '潦倒新停浊酒杯']],
];
for (const [form, lines] of SHI) {
  const res = checkShi(form, lines);
  const hit = res.issues.filter((i) => i.text.includes('现代语汇') || i.text.includes('对仗'));
  if (hit.length) {
    fp++;
    console.log(`  ✗ ${form}：${hit.map((h) => h.text).join('；')}`);
  } else {
    console.log(`  ✓ ${form}（${lines[0]}…）`);
  }
}

console.log('\n=== 逐词误伤排查：这些字词在古诗词里很常见，不该被当成白话 ===');
const SAFE = [
  ['之', '之子于归'], ['其', '其雨其雨'], ['而', '敏而好学'], ['于', '于以采苹'],
  ['与', '与子同袍'], ['共', '共看明月'], ['独', '独坐幽篁里'], ['犹', '犹抱琵琶半遮面'],
  ['尚', '尚思为国戍轮台'], ['未', '未谙姑食性'], ['莫', '莫愁前路无知己'], ['何', '何当共剪西窗烛'],
  ['谁', '谁家玉笛暗飞声'], ['尔', '尔来四万八千岁'], ['又', '又闻子规啼夜月'], ['亦', '亦足以畅叙幽情'],
  ['皆', '皆若空游无所依'], ['尽', '不尽长江滚滚来'], ['更', '更上一层楼'], ['复', '复照青苔上'],
  ['只', '只在此山中'], ['惟', '惟见长江天际流'], ['乃', '乃不知有汉'], ['遂', '遂至承天寺'],
  ['曾', '曾不吝情去留'], ['已', '已是悬崖百丈冰'], ['方', '方宅十余亩'], ['始', '始觉人间是梦间'],
  ['空', '空山不见人'], ['满', '满城尽带黄金甲'], ['半', '半壁见海日'], ['一', '一片冰心在玉壶'],
  ['相', '相看两不厌'], ['自', '自将磨洗认前朝'], ['从', '从今若许闲乘月'], ['向', '向阳花木易逢春'],
  ['无', '无边落木萧萧下'], ['有', '有约不来过夜半'], ['不', '不知细叶谁裁出'], ['多', '多情自古伤离别'],
];
let safeBad = 0;
for (const [w, sample] of SAFE) {
  const hits = checkModern(sample);
  if (hits.length) {
    safeBad++;
    console.log(`  ✗ 「${w}」在「${sample}」中被判为白话（命中：${hits.join('、')}）`);
  }
}
console.log(safeBad === 0 ? '  ✓ 常用虚词与常见字无一误伤' : `  ✗ ${safeBad} 处误伤`);

console.log(fp === 0 && safeBad === 0 ? '\n全部通过：无误报' : '\n存在误报，需修词表');
process.exit(fp === 0 && safeBad === 0 ? 0 : 1);
