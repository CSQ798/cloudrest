// 复现「七言律诗末句只有 6 字却没被拦下」
import { check } from '../server/validator.mjs';

// 用户截图里那一首（末句 6 字）
const POEM = [
  '霓虹尽处路人行',
  '灯影重重水色明',
  '门外风霜各自远',
  '座中意气正纵横',
  '暗凝杯壁珍珠冷',
  '别有孤鸿向晚鸣',
  '莫问河山可易老',
  '九州同辙即能',   // ← 只有 6 字
];
const r = check('七言律诗', POEM);
console.log('=== 用户截图那一首 ===');
console.log('level =', r.level);
for (const i of r.issues) console.log(`  ${i.severity === 'error' ? '✗' : '·'} ${i.text}`);
console.log('句长：', POEM.map((l) => [...l].length).join('/'));

// 再验：服务端清洗后长度不足时，会不会被过滤掉而不是判错
const { hanzi, isLeakedProse, isPatternLine, stripTrailingPattern } = await import('../server/validator.mjs');
console.log('\n=== 清洗链路 ===');
const raw = ['霓虹尽处路人行', '灯影重重水色明', '门外风霜各自远', '座中意气正纵横', '暗凝杯壁珍珠冷', '别有孤鸿向晚鸣', '莫问河山可易老', '九州同辙即能'];
const cleaned = raw
  .map((l) => stripTrailingPattern(l))
  .map((l) => l.replace(/[○◆◇□■●、，。；：！？—…「」『』（）\s]/g, ''))
  .map((l) => l.replace(/(平|仄|中|韵|句|读|豆|叶|换)$/g, ''))
  .map((l) => l.trim())
  .filter((l) => l.length)
  .filter((l) => !isLeakedProse(l));
console.log('清洗前', raw.length, '行 → 清洗后', cleaned.length, '行');
console.log('被 isLeakedProse 丢掉的：', raw.filter((l) => isLeakedProse(l)));
const r2 = check('七言律诗', cleaned);
console.log('清洗后 level =', r2.level, '｜硬伤：', r2.issues.filter((i) => i.severity === 'error').map((i) => i.text).join('；') || '（无）');
