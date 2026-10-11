// 词牌句读（标点与断行）自检
//
// 为什么要有它：站长一眼看出《定风波》「每一句话后面都是句号」。
// 根因是标点当时按**韵位**定 —— 而《定风波》十一个小句处处押韵，
// 于是句句都收成了句号。押韵说的是声音落在哪，标点说的是语意在哪收住，两件事。
// 现在每个词牌的句读标点在 server/tunes.mjs 的 MARKS 里，这个测试把它钉住：
//   一、标点表本身要完整、要和词谱句数一一对应、不能退化成「句句句号」；
//   二、排完版之后，每一个小句都要原样出现且只出现一次，标点跟着它走；
//   三、几首名篇的版式逐字比对（含站长报的那一首）。
//
// 用法：node .test/tune-marks-test.mjs

import { TUNES, getMarks } from '../server/tunes.mjs';
import { layoutPoem, LINE_MAX } from '../server/format.mjs';

let bad = 0;
const ok = (c, label) => {
  if (!c) bad++;
  console.log(`  ${c ? '✓' : '✗'} ${label}`);
};
const list = (a) => (a.length ? `（${a.slice(0, 6).join('、')}${a.length > 6 ? '…' : ''}）` : '');

console.log('— 句读标点表 —');
const ALLOWED = new Set(['，', '。', '、']);
const missing = [];
const wrongLen = [];
const wrongChar = [];
const noComma = [];
const notEnded = [];
for (const t of TUNES) {
  const m = getMarks(t.name);
  if (!m) {
    missing.push(t.name);
    continue;
  }
  if (m.length !== t.lens.length) wrongLen.push(`${t.name} ${m.length}≠${t.lens.length}`);
  if (m.some((c) => !ALLOWED.has(c))) wrongChar.push(t.name);
  if (!m.includes('，')) noComma.push(t.name); // 全篇句号 = 老毛病又回来了
  let i = 0;
  for (const n of t.stanzas) {
    if (m[i + n - 1] !== '。') notEnded.push(`${t.name} 第${i + n}句`);
    i += n;
  }
}
ok(missing.length === 0, `${TUNES.length} 个词牌都有句读标点` + list(missing));
ok(wrongLen.length === 0, '标点个数与词谱句数一一对应' + list(wrongLen));
ok(wrongChar.length === 0, '标点只用「，。」，句内的顿用「、」' + list(wrongChar));
ok(noComma.length === 0, '每个词牌都至少有一个逗号（不会再句句都是句号）' + list(noComma));
ok(notEnded.length === 0, '每一片的最后一句都是句号' + list(notEnded));

console.log('\n— 词谱分片 —');
const badStanza = [];
const badTotal = [];
for (const t of TUNES) {
  if (t.stanzas.reduce((a, b) => a + b, 0) !== t.lens.length) badStanza.push(t.name);
  if (t.lens.reduce((a, b) => a + b, 0) !== t.total) badTotal.push(t.name);
}
ok(badStanza.length === 0, '每片句数加起来等于全部句数' + list(badStanza));
ok(badTotal.length === 0, '每句字数加起来等于词谱声明的字数' + list(badTotal));
const single = TUNES.filter((t) => t.total > 40 && t.stanzas.length < 2).map((t) => t.name);
ok(single.length === 0, '四十字以上的词牌都分了上下阕' + list(single));

console.log('\n— 排完版之后：小句一个不多一个不少 —');
// 用「云」按词谱填一首假词，逐字核对：拼回去必须与「每个小句 + 它自己的标点」完全一致
const lost = [];
const splitInside = [];
const longLine = [];
const badLast = [];
for (const t of TUNES) {
  const marks = getMarks(t.name);
  const body = t.lens.map((n) => '云'.repeat(n));
  const lines = layoutPoem(t.name, body);
  const want = body.map((l, i) => l + marks[i]).join('');
  const got = lines.filter((l) => l !== '').join('');
  if (got !== want) lost.push(t.name);
  // 每个小句都不能被劈成两行：逐行累加，行的长度必须能落在小句边界上
  const lens = lines.filter((l) => l !== '').map((l) => [...l].length);
  if (lens.some((n) => n > LINE_MAX)) {
    // 允许「一句本身就超过 LINE_MAX」的独行
    const tooLong = lines.filter((l) => l !== '' && [...l].length > LINE_MAX);
    const eachSingle = tooLong.every((l) => {
      const n = [...l].length;
      let acc = 0;
      let i = 0;
      for (const m of marks) {
        acc += t.lens[i] + 1;
        i++;
        if (acc === n) return true;
      }
      return false;
    });
    if (!eachSingle) longLine.push(t.name);
  }
  // 行尾不能是逗号或顿号：行只在「句」的边界上断开
  if (lines.some((l) => /[，、]$/.test(l))) splitInside.push(t.name);
  // 每片的最后一行必须是句号或问号收尾
  const ends = lines.filter((l) => l !== '' && /[。？]$/.test(l));
  if (!ends.length) badLast.push(t.name);
}
ok(lost.length === 0, '拼回去与「小句 + 标点」逐字一致' + list(lost));
ok(splitInside.length === 0, '没有一行是断在逗号上的（不劈开一句）' + list(splitInside));
ok(longLine.length === 0, `每行不超过 ${LINE_MAX} 字（本身超长的单句除外）` + list(longLine));
ok(badLast.length === 0, '每首词都以句号或问号收尾' + list(badLast));

console.log('\n— 几首名篇的版式 —');
const golden = [
  [
    '定风波',
    '暖日闲窗映碧纱|小池春水浸晴霞|数树海棠红欲尽|争忍|玉闺深掩过年华|独凭绣床方寸乱|肠断|泪珠穿破脸边花|邻舍女郎相借问|音信|教人羞道未还家',
    [
      '暖日闲窗映碧纱，小池春水浸晴霞。',
      '数树海棠红欲尽，争忍，玉闺深掩过年华。',
      '',
      '独凭绣床方寸乱，肠断，泪珠穿破脸边花。',
      '邻舍女郎相借问，音信，教人羞道未还家。',
    ],
  ],
  [
    '忆江南',
    '江南好|风景旧曾谙|日出江花红胜火|春来江水绿如蓝|能不忆江南',
    ['江南好，风景旧曾谙。', '日出江花红胜火，春来江水绿如蓝。', '能不忆江南。'],
  ],
  [
    '相见欢',
    '无言独上西楼|月如钩|寂寞梧桐深院|锁清秋|剪不断|理还乱|是离愁|别是一般滋味|在心头',
    ['无言独上西楼，月如钩。', '寂寞梧桐深院，锁清秋。', '', '剪不断，理还乱，是离愁。', '别是一般滋味，在心头。'],
  ],
  [
    '浣溪沙',
    '一曲新词酒一杯|去年天气旧亭台|夕阳西下几时回|无可奈何花落去|似曾相识燕归来|小园香径独徘徊',
    ['一曲新词酒一杯，去年天气旧亭台，夕阳西下几时回？', '', '无可奈何花落去，似曾相识燕归来，小园香径独徘徊。'],
  ],
  [
    '清平乐',
    '禁庭春昼|莺羽披新绣|百草巧求花下斗|祗赌珠玑满斗|日晚却理残妆|御前闲舞霓裳|谁道腰肢窈窕|折旋笑得君王',
    ['禁庭春昼，莺羽披新绣。', '百草巧求花下斗，祗赌珠玑满斗。', '', '日晚却理残妆，御前闲舞霓裳。', '谁道腰肢窈窕，折旋笑得君王。'],
  ],
  [
    '一剪梅',
    '红藕香残玉簟秋|轻解罗裳|独上兰舟|云中谁寄锦书来|雁字回时|月满西楼|花自飘零水自流|一种相思|两处闲愁|此情无计可消除|才下眉头|却上心头',
    [
      '红藕香残玉簟秋。轻解罗裳，独上兰舟。',
      '云中谁寄锦书来？雁字回时，月满西楼。',
      '',
      '花自飘零水自流。一种相思，两处闲愁。',
      '此情无计可消除。才下眉头，却上心头。',
    ],
  ],
  [
    '鹊桥仙',
    '纤云弄巧|飞星传恨|银汉迢迢暗度|金风玉露一相逢|便胜却|人间无数|柔情似水|佳期如梦|忍顾鹊桥归路|两情若是久长时|又岂在|朝朝暮暮',
    [
      '纤云弄巧，飞星传恨，银汉迢迢暗度。',
      '金风玉露一相逢，便胜却、人间无数。',
      '',
      '柔情似水，佳期如梦，忍顾鹊桥归路。',
      '两情若是久长时，又岂在、朝朝暮暮。',
    ],
  ],
  [
    '七律',
    '风急天高猿啸哀|渚清沙白鸟飞回|无边落木萧萧下|不尽长江滚滚来|万里悲秋常作客|百年多病独登台|艰难苦恨繁霜鬓|潦倒新停浊酒杯',
    [
      '风急天高猿啸哀，渚清沙白鸟飞回。',
      '无边落木萧萧下，不尽长江滚滚来。',
      '万里悲秋常作客，百年多病独登台。',
      '艰难苦恨繁霜鬓，潦倒新停浊酒杯。',
    ],
  ],
];
for (const [form, body, want] of golden) {
  const got = layoutPoem(form, body.split('|'));
  ok(JSON.stringify(got) === JSON.stringify(want), `${form} 版式` + (JSON.stringify(got) === JSON.stringify(want) ? '' : `\n      得到 ${JSON.stringify(got)}\n      期望 ${JSON.stringify(want)}`));
}

console.log('\n— 站长报的那一处 —');
{
  const body = '暖日闲窗映碧纱|小池春水浸晴霞|数树海棠红欲尽|争忍|玉闺深掩过年华|独凭绣床方寸乱|肠断|泪珠穿破脸边花|邻舍女郎相借问|音信|教人羞道未还家'.split('|');
  const got = layoutPoem('定风波', body).join('');
  const periods = (got.match(/。/g) || []).length;
  const commas = (got.match(/，/g) || []).length;
  ok(periods === 4, `《定风波》全篇只有 4 个句号（实际 ${periods} 个：上下片各两句末）`);
  ok(commas === 7, `《定风波》有 7 个逗号（实际 ${commas} 个）`);
  ok(!got.includes('玉闺深掩过年华。独凭绣床方寸乱。'), '上下片之间没有连成一行');
}
{
  // 站长截图里那一首：模型只写了 9 句（《定风波》是 11 句 62 字），词谱对不上，
  // 于是走兜底排版。兜底也绝不能退化成「一句一个句号」。
  const off = layoutPoem(
    '定风波',
    '小庭深树自盘桓|一角青山俯画栏|不语看花花尽落|庭寒|北风卷地送微澜|纵有鲲鹏九万转|应咽|劫痕累累我自安|铁干已生千尺藤'.split('|')
  );
  const want = [
    '小庭深树自盘桓，一角青山俯画栏。',
    '不语看花花尽落，庭寒。',
    '北风卷地送微澜，纵有鲲鹏九万转。',
    '应咽，劫痕累累我自安。',
    '铁干已生千尺藤。',
  ];
  ok(JSON.stringify(off) === JSON.stringify(want), '句数与词谱对不上时走兜底，也不再有「句句都是句号」');
}

console.log('\n' + '─'.repeat(56));
console.log(bad === 0 ? '词牌句读自检通过' : `${bad} 项未通过`);
process.exit(bad ? 1 : 0);
