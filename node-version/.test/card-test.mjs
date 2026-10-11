// 一次性自检：纸笺函数重做之后，有没有留下旧代码
import fs from 'node:fs';

const s = fs.readFileSync('public/app.js', 'utf8');
const i = s.indexOf('function downloadCard');
const j = s.indexOf('/* ---------------- 启动');
const seg = s.slice(i, j);

const checks = [
  ['downloadCard 段非空', seg.length > 1500],
  ['没有旧名章的固定坐标（sx + 33）', !seg.includes('sx + 33')],
  ['没有旧的左下角落款（62, H - 54）', !seg.includes('H - 54')],
  ['没有旧的「诗体」行（p.form || ""）', !seg.includes("p.form || ''")],
  ['有乌丝栏（竖格）', seg.includes('COLS') && seg.includes('乌丝栏')],
  // 注释里会提到站长那个 D:\云卷云舒 的路径，所以剥掉注释再数，量的是代码不是说明
  ['有「云卷云舒」只出现在兜底文件名里', ((seg.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')).match(/云卷云舒/g) || []).length <= 2],
  ['有 toBlob 收尾', seg.includes('toBlob')],
  ['板块计数：全文件里 downloadCard 只定义一次', (s.match(/function downloadCard/g) || []).length === 1],
];
let bad = 0;
for (const [k, v] of checks) {
  if (!v) bad++;
  console.log(`  ${v ? '✓' : '✗'} ${k}`);
}

// 名章字符出现次数：两处 fillText（云卷 / 云舒）
const sealHits = (seg.match(/fillText\('云卷'|fillText\('云舒'/g) || []).length;
console.log(`  ${sealHits === 2 ? '✓' : '✗'} 名章恰好两行两字（找到 ${sealHits} 处）`);
if (sealHits !== 2) bad++;

process.exit(bad ? 1 : 0);
