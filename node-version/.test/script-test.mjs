// 繁体字检测的自证（轻量版，不依赖 .research 的语料）
//
// 这个检查只有两种失败方式，两种都必须挡住：
//   误报 —— 把简体正常用法的字当繁体，真诗被退回重写，白花钱还可能越改越差
//   漏报 —— 模型写了繁体而没人发现，繁简混用留在成品里
//
// 完整版（21 首钦谱例词 + 四首名作逐字扫）在 qiyun/.research/test-script.mjs，
// 那份要读词谱语料；这里用内嵌的真作，好在任何地方都能跑。

import { checkScript, TRAD_CHAR_COUNT, __table } from '../server/script.mjs';
import { checkCi, checkShi } from '../server/validator.mjs';

let bad = 0;
const ok = (c, label, extra = '') => {
  if (!c) bad++;
  console.log(`${c ? '✓' : '✗'} ${label}${extra ? '　' + extra : ''}`);
};

console.log('=== 繁简表本身 ===');
ok(TRAD_CHAR_COUNT > 600, `表规模 ${TRAD_CHAR_COUNT} 字`, '（载入时已逐项自检：二字一对、繁简不同字）');
ok(
  [...__table].every(([t, s]) => t !== s),
  '无一字是自己对自己的映射'
);

console.log('\n=== 真作零误报（全是简体，不许命中）===');
const REAL = [
  ['五言绝句', ['白日依山尽', '黄河入海流', '欲穷千里目', '更上一层楼']],
  ['五言律诗', ['国破山河在', '城春草木深', '感时花溅泪', '恨别鸟惊心', '烽火连三月', '家书抵万金', '白头搔更短', '浑欲不胜簪']],
  ['七言绝句', ['朝辞白帝彩云间', '千里江陵一日还', '两岸猿声啼不住', '轻舟已过万重山']],
  ['七言律诗', ['风急天高猿啸哀', '渚清沙白鸟飞回', '无边落木萧萧下', '不尽长江滚滚来', '万里悲秋常作客', '百年多病独登台', '艰难苦恨繁霜鬓', '潦倒新停浊酒杯']],
];
let fp = 0;
for (const [form, lines] of REAL) {
  for (const l of lines) {
    const hits = checkScript(l);
    if (hits.length) {
      fp++;
      console.log(`  ✗ ${form}「${l}」→ ${hits.join('、')}`);
    }
  }
  const res = checkShi(form, lines);
  const s = res.issues.find((i) => i.text.includes('繁体'));
  if (s) {
    fp++;
    console.log(`  ✗ ${form} 整篇被判出繁体：${s.text}`);
  }
}
ok(fp === 0, '四首名作逐字扫过', fp ? `${fp} 处误报` : '零误报');

console.log('\n=== 简体里同样通用的字，表里绝不能收 ===');
const DANGER = '著藉乾徵祇澹面的了里台只并后发干尽复系松谷划咸恶丑采布才尝卷舍制志注表别冲梁檐峰群污泛席杯吃挂玩昆岳溪床';
let danger = 0;
for (const ch of DANGER) {
  if (__table.has(ch)) {
    danger++;
    console.log(`  ✗ 表里收了「${ch}」→ 会被当成繁体改成「${__table.get(ch)}」，误伤`);
  }
}
ok(danger === 0, `${DANGER.length} 个高危字逐个确认表里没有`, danger ? `${danger} 个越界` : '全部安全');

console.log('\n=== 故意写繁体，必须命中 ===');
const CASES = [
  ['隔岸樓高燈自密', ['樓（应作「楼」）', '燈（应作「灯」）']],
  ['一時吹散萬千星', ['時（应作「时」）', '萬（应作「万」）']],
  ['我衣露重影相仍', []],
  ['夢裏不知身是客', ['夢（应作「梦」）', '裏（应作「里」）']],
  ['風急天高猿嘯哀', ['風（应作「风」）', '嘯（应作「啸」）']],
];
for (const [line, want] of CASES) {
  const got = checkScript(line);
  ok(JSON.stringify(got) === JSON.stringify(want), `「${line}」`, got.length ? got.join('、') : '（无繁体，正确）');
}

const mixed = ['暮江風蹙一川星', '碎金搖漾未成形', '一身同此水中凭', '浪去打圆还复散', '風來合碧又重明', '立盡寒沙影自聽'];
const res = checkCi('浣溪沙', mixed);
ok(res.level === 'error' && res.issues.some((i) => i.text.includes('繁体')), '混了繁体的整篇判为 error（会退回重写）', `level=${res.level}`);

const short = ['暮江風蹙一川星', '碎金搖漾未成形', '一身同此水中凭', '浪去打圆还复散'];
const res2 = checkCi('浣溪沙', short);
ok(
  res2.issues.some((i) => i.text.includes('繁体')) && res2.issues.some((i) => i.text.includes('共 6 句')),
  '句数不对时，繁体与句数两条一起报（省一轮调用）',
  res2.issues.map((i) => i.text.split('：')[0]).join(' / ')
);

console.log('\n' + '─'.repeat(56));
console.log(bad === 0 ? '繁体字检测自证通过：真作零误报，繁体必命中' : `${bad} 项未通过`);
process.exit(bad === 0 ? 0 : 1);
