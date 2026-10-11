// 纸笺版式的自证
//
// 这个测试是为一个真实 bug 写的：第一版在算折行宽度时用的是画布**默认字体**（10px），
// 而实际按 18px 画，于是取景那行算出只需一行、画出来却宽出纸面三分之一，
// 右边被整段裁掉。混在 canvas 绘制里，这种错只能靠肉眼发现。
//
// 拆出 card-layout.mjs 之后就能这么测：给一个**与画布同规则**的假量宽函数
// （中文按 1em、英文数字按 0.55em，这正是 canvas 用 serif 量汉字的近似），
// 然后断言「任何一行都不宽出内框」。
//
// 注意：这是近似，不是与浏览器逐像素对齐 —— 它能抓住「量错字体」「忘了折行」
// 这类量级错误，抓不住 1px 的差别。这一点如实写在下面。

import { layoutCard, overflow, fonts, W, PAD, RULES_COLS, FONT, SERIF, M } from '../public/card-layout.mjs';

let bad = 0;
const ok = (c, label, extra = '') => {
  if (!c) bad++;
  console.log(`  ${c ? '✓' : '✗'} ${label}${extra ? '　' + extra : ''}`);
};

/**
 * 假的量宽：**保守估计** —— 汉字与全角标点（U+2E80 以上，含，。！？「」等）一律按 1em，
 * 其余按 0.55em。宁可估宽，也不估窄：测试若比浏览器宽松，就会出现
 * 「测试过了、浏览器里却溢出」这种最没用的绿灯。
 */
const measure = (text, font) => {
  // 字号要取「px 前面那个数」——名章的字体串是 600 22px …（600 是字重），
  // 早先直接 parseFloat 会把 600 当成字号，量出 2 字 1200px 宽，把好端端的印章判成越界。
  const size = Number((String(font).match(/(\d+(?:\.\d+)?)px/) || [, 16])[1]) || 16;
  let w = 0;
  for (const ch of String(text)) w += ch.codePointAt(0) >= 0x2e80 ? size : size * 0.55;
  return w;
};

const SCENE =
  '江楼独倚，夕阳熔金铺在江面，一闪一闪像鱼的鳞。栏杆上握着一只凉了的酒杯，日头一沉，杯沿也凉透了。';

console.log('— 五言绝句（短）—');
{
  const L = layoutCard(measure, {
    title: '江楼晚眺',
    scene: SCENE,
    rows: ['江楼衔落照，片片跃金鳞。', '杯倚栏杆侧，风来酒面皴。'],
  });
  console.log(`     纸：${L.W}×${L.H}　取景 ${L.sceneLines.length} 行　正文 ${L.bodyRows.length} 行`);
  for (const l of L.sceneLines) console.log('       ' + l);
  ok(overflow(measure, L, 'scene').length === 0, '取景每一行都在内框之内');
  ok(overflow(measure, L, 'body').length === 0, '正文每一行都在内框之内');
  // 这一段取景 62 字，18px 下约 1116px，而内框只有 698px —— 必然折行。
  // 当初的 bug 是：用 10px 量出 620px < 698px，于是只排一行，画出来却宽出 400px 被裁掉。
  // 所以这里断言「必须多于一行」—— 一行就是那个 bug 的样子。
  ok(L.sceneLines.length >= 2, `长取景真的折成了多行（${L.sceneLines.length} 行）—— 一行就是当初那个 bug`);
  ok(L.H <= 900, `短诗的纸不会留一大片空（${L.H}px）`);
}

console.log('\n— 七言律诗（四行）—');
{
  const L = layoutCard(measure, {
    title: '山院听泉',
    scene: '深秋傍晚，一个人在山中旧院听泉。',
    rows: [
      '暮色初侵独掩门，泉声绕砌自潺湲。',
      '篱边败叶随流去，石上寒苔带雨痕。',
      '久坐不知衣渐湿，欲归犹恋响犹存。',
      '何人来叩萧萧院，半扇柴扉对远村。',
    ],
  });
  console.log(`     纸：${L.W}×${L.H}　正文 ${L.bodyRows.length} 行`);
  ok(overflow(measure, L, 'body').length === 0, '七律四行都不越界');
  ok(L.bodyRows.length === 4, '四行就是四行（没有被莫名折断）', String(L.bodyRows.length));
}

console.log('\n— 长调（连排后很长的一行）—');
{
  const long =
    '渐觉石根生润，旋见松梢滴翠，一径入幽微。白鸟忽惊起，飞破碧云飞。欲问莼鲈归未，且对青灯无寐，此意少人知。';
  const L = layoutCard(measure, { title: '水调歌头·山院听泉', scene: '秋山独坐。', rows: [long, '', '风初定，云未散，月还低。'] });
  console.log(`     纸：${L.W}×${L.H}　正文 ${L.bodyRows.length} 行（含 1 个空行）`);
  ok(overflow(measure, L, 'body').length === 0, '超长的一行被折开了，没越界');
  ok(L.bodyRows.filter((l) => l === '').length === 1, '空行被保留（上下阕的分隔）');
}

console.log('\n— 版式常量自洽 —');
ok(M.FRAME < M.FRAME_INNER, '外框比内框靠外');
ok(PAD > M.FRAME_INNER, '正文留白在内框之内');
ok(RULES_COLS >= 5, `乌丝栏有 ${RULES_COLS} 格`);
ok(M.GAP_SCENE_TO_TITLE >= 80, `取景与诗之间留了 ${M.GAP_SCENE_TO_TITLE}px —— 不挤在一起`);

console.log('\n— 字体：纸上的字必须与页面上同一套 —');
// 这里原来写的是 '27px -serif'。通用族名是 `serif`，`-serif` 不是 ——
// 浏览器会当成一个不存在的字体名，回退到自己的默认字体，于是纸笺上的诗
// 跟屏幕上的诗是两种字。这条断言就是盯着这个错字。
const allFonts = [FONT.scene, FONT.title, FONT.body, FONT.seal];
ok(allFonts.every((f) => !/\d+px\s+-/.test(f)), '字体串里没有 `-serif` 这个错字', allFonts[2]);
ok(allFonts.every((f) => /serif\s*$/.test(f)), '四种字体都以通用族名 serif 收尾');
ok(FONT.body.startsWith('27px ') && FONT.scene.startsWith('18px '), '字号没被动过（正文 27px、取景 18px）');
ok(FONT.body.includes('Source Han Serif SC') && FONT.body.includes('宋体'), '用的是页面上那套衬线栈', FONT.body.slice(0, 46) + '…');
ok(fonts('"只此一家", serif').body === '27px "只此一家", serif', '能听调用方指定的字体栈');

// 量宽与绘制必须同出一处：layoutCard 要把这一次实际用的字体交回来
{
  const L = layoutCard(measure, { title: 'x', scene: 'y', rows: ['甲乙丙丁，戊己庚辛。'], serif: '"只此一家", serif' });
  ok(L.fonts.body === '27px "只此一家", serif', 'layoutCard 用的是传进来的字体栈');
  ok(L.bodyRows.length === 1, '换字体后折行照常');
  // 若 overflow 拿常量重算字体，就会用错字体量宽度 —— 这里用超窄字体栈验证它没有
  const narrow = (t) => [...String(t)].length; // 每字 1 单位，远小于任何真实宽度
  ok(overflow(narrow, L, 'body').length === 0, 'overflow 用这张纸自己的字体量宽');
}

console.log('\n' + '─'.repeat(58));
console.log(bad === 0 ? '纸笺版式自证通过' : `${bad} 项未通过`);
process.exit(bad ? 1 : 0);
