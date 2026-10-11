// 繁体字检测的自证
//
// 这个检查只有两种失败方式，两种都必须挡住：
//   一、误报：把简体正常用法的字当成繁体 → 真诗被退回重写，白白花钱，还可能越改越差
//   二、漏报：模型写了繁体而不自知 → 繁简混用留在成品里
//
// 所以下面分三组：
//   A. 表本身的自洽（载入时的完整性检查已在 script.mjs 里，这里再报一次规模）
//   B. 真作零误报：21 首钦谱例词 + 四首名作，全部简体，必须一个都不命中
//   C. 故意写繁体，必须命中，且给出的简体字要对

import fs from 'node:fs/promises';
import { checkScript, TRAD_CHAR_COUNT, __table } from '../server/script.mjs';
import { checkCi, checkShi } from '../server/validator.mjs';

let bad = 0;
const ok = (c, label, extra = '') => {
  if (!c) bad++;
  console.log(`${c ? '✓' : '✗'} ${label}${extra ? '　' + extra : ''}`);
};

console.log('=== A. 繁简表本身 ===');
ok(TRAD_CHAR_COUNT > 600, `表规模 ${TRAD_CHAR_COUNT} 字`, '（载入时已逐项自检：二字一对、繁简不同字）');
const wrong = [...__table].filter(([t, s]) => t === s || [...t].length !== 1 || [...s].length !== 1);
ok(wrong.length === 0, '无一字是自己对自己的映射', wrong.length ? JSON.stringify(wrong) : '');

console.log('\n=== B. 真作零误报（这些全是简体，不许命中）===');
const parsed = JSON.parse(await fs.readFile(new URL('./parsed.json', import.meta.url), 'utf8'));
let fp = 0;
let checked = 0;
for (const r of parsed) {
  if (r.error || !r.sentences) continue;
  checked++;
  const lines = r.sentences.map((s) => s.text);
  for (const l of lines) {
    const hits = checkScript(l);
    if (hits.length) {
      fp++;
      console.log(`  ✗ 《${r.name}》「${l}」→ ${hits.join('、')}`);
    }
  }
}
ok(fp === 0, `21 首钦谱例词共 ${checked} 首，逐字扫过`, fp ? `${fp} 行误报` : '零误报');

const SHI = [
  ['五言绝句', ['白日依山尽', '黄河入海流', '欲穷千里目', '更上一层楼']],
  ['五言律诗', ['国破山河在', '城春草木深', '感时花溅泪', '恨别鸟惊心', '烽火连三月', '家书抵万金', '白头搔更短', '浑欲不胜簪']],
  ['七言绝句', ['朝辞白帝彩云间', '千里江陵一日还', '两岸猿声啼不住', '轻舟已过万重山']],
  ['七言律诗', ['风急天高猿啸哀', '渚清沙白鸟飞回', '无边落木萧萧下', '不尽长江滚滚来', '万里悲秋常作客', '百年多病独登台', '艰难苦恨繁霜鬓', '潦倒新停浊酒杯']],
];
let shiFp = 0;
for (const [form, lines] of SHI) {
  for (const l of lines) {
    const hits = checkScript(l);
    if (hits.length) {
      shiFp++;
      console.log(`  ✗ ${form}「${l}」→ ${hits.join('、')}`);
    }
  }
  // 顺带确认整篇校验也没把它判错
  const res = checkShi(form, lines);
  const scriptIssue = res.issues.find((i) => i.text.includes('繁体'));
  if (scriptIssue) {
    shiFp++;
    console.log(`  ✗ ${form} 整篇被判出繁体：${scriptIssue.text}`);
  }
}
ok(shiFp === 0, '四首名作（白/杜/李/杜）逐字扫过', shiFp ? `${shiFp} 处误报` : '零误报');

// 易误伤的字单独再钉一遍：这些字在简体里也是规范用法，表里绝不能有
console.log('\n=== B2. 简体里同样通用的字，表里绝不能收 ===');
const MUST_NOT_HAVE = '著藉乾徵祇澹面的了里台只并后发干尽复系松谷划咸恶丑采布才尝卷舍制志注表别冲梁檐峰群污泛席杯吃挂玩昆岳溪';
let danger = 0;
for (const ch of MUST_NOT_HAVE) {
  if (__table.has(ch)) {
    danger++;
    console.log(`  ✗ 表里收了「${ch}」→ 会把它当繁体改成「${__table.get(ch)}」，误伤`);
  }
}
ok(danger === 0, `${MUST_NOT_HAVE.length} 个高危字逐个确认表里没有`, danger ? `${danger} 个越界` : '全部安全');

console.log('\n=== C. 故意写繁体，必须命中 ===');
const CASES = [
  ['隔岸樓高燈自密', ['樓（应作「楼」）', '燈（应作「灯」）']],
  ['一時吹散萬千星', ['時（应作「时」）', '萬（应作「万」）']],
  ['我衣露重影相仍', []],
  ['夢裏不知身是客', ['夢（应作「梦」）', '裏（应作「里」）']],
  ['風急天高猿嘯哀', ['風（应作「风」）', '嘯（应作「啸」）']],
];
for (const [line, want] of CASES) {
  const got = checkScript(line);
  ok(
    JSON.stringify(got) === JSON.stringify(want),
    `「${line}」`,
    got.length ? got.join('、') : '（无繁体，正确）'
  );
}

// 整篇：一首混了繁体的诗，必须被判为 error（这样才会退回重写）
const mixed = ['暮江風蹙一川星', '碎金搖漾未成形', '一身同此水中凭', '浪去打圆还复散', '風來合碧又重明', '立盡寒沙影自聽'];
const res = checkCi('浣溪沙', mixed);
const hit = res.issues.find((i) => i.text.includes('繁体'));
ok(Boolean(hit), '混了繁体的整篇被判为 error（会退回重写）', `level=${res.level}`);
ok(res.level === 'error', 'level 为 error', res.level);
if (hit) console.log(`     判词：${hit.text.slice(0, 78)}…`);

// 句数同时不对时，语言问题也要一并报出来，别让它分两轮才改完
const short = ['暮江風蹙一川星', '碎金搖漾未成形', '一身同此水中凭', '浪去打圆还复散'];
const res2 = checkCi('浣溪沙', short);
ok(
  res2.issues.some((i) => i.text.includes('繁体')) && res2.issues.some((i) => i.text.includes('共 6 句')),
  '句数不对时，繁体与句数两条一起报（省一轮调用）',
  res2.issues.map((i) => i.text.slice(0, 12)).join(' / ')
);

console.log('\n' + '─'.repeat(56));
console.log(bad === 0 ? '繁体字检测自证通过：真作零误报，繁体必命中' : `${bad} 项未通过`);
process.exit(bad === 0 ? 0 : 1);
