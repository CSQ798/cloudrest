// 云卷云舒 · 纸笺的排版算式（纯函数，不碰 canvas）
//
// 为什么要单独拆出来：第一版把「量字宽 → 折行 → 算高度」和 canvas 绘制写在同一个
// 函数里，结果踩了一个很难看的坑 —— **量宽度时用的是画布默认字体（10px），
// 而实际按 18px 画**，于是取景那行算出只需一行，画出来却宽出纸面三分之一，
// 右边被整段裁掉。这类 bug 只要算式能被测，一眼就能发现；混在绘制里就只能靠眼睛。
//
// 所以这里只做三件事，且全部是纯函数：
//   1. 折行（按给定字体量宽）
//   2. 算高度
//   3. 给出各处基线位置
// 绘制仍在 public/app.js 里，它只负责照着这些数字画。
//
// 关键约定：**measure(text, font) 必须自己设置字体再量**。
// app.js 传进来的那个闭包会自动 ctx.font = font，从根上绝掉「量错字体」。

export const W = 960;
export const PAD = 108; // 正文左右留白
export const RULES_COLS = 9; // 乌丝栏的竖格数

// 字体：纸笺上的字**必须与页面上中栏那套一模一样**，否则同一首诗在屏幕上看是一个样、
// 存成纸笺又是另一个样。
//
// 这里原来写的是 '27px -serif' —— 少了一个字母：通用族名是 `serif`，`-serif` 不是，
// 浏览器会把它当成一个并不存在的字体名，于是回退到自己的默认字体。结果就是纸笺上的
// 诗与屏幕上的诗是两种字。
//
// 现在只有一个来处：app.js 把 CSS 变量 --serif 读出来传进来（见 layoutCard 的 serif 参数）。
// SERIF 只是读不到变量时的退路，值与 style.css 里的 --serif 逐字一致 ——
// .test/structure-test.mjs 有一条断言盯着这两处不许走样。
export const SERIF =
  '"Source Han Serif SC", "Source Han Serif TC", "Noto Serif CJK SC", "Noto Serif SC", "Songti SC", "STSong", "SimSun", "宋体", "NSimSun", "MingLiU", "PMingLiU", "新細明體", "MS Mincho", "Yu Mincho", "Hiragino Mincho ProN", "KaiTi", "楷体", "FangSong", "仿宋", serif';

/** 把字体栈展开成各处用的 canvas 字体串 */
export function fonts(serif) {
  const fam = String(serif == null ? '' : serif).trim() || SERIF;
  return {
    scene: `18px ${fam}`,
    title: `44px ${fam}`,
    body: `27px ${fam}`,
    seal: `600 22px ${fam}`,
  };
}

export const FONT = fonts();

export const M = {
  TOP: 134, // 内容起始
  SCENE_LH: 34,
  GAP_SCENE_TO_TITLE: 104, // 取景与诗之间的空白：让诗「落」下来
  TITLE_LH: 66,
  GAP_TITLE_TO_BODY: 86,
  BODY_LH: 74,
  GAP_ROW: 40, // 空行（上下阕之间）
  BOTTOM: 132,
  MIN_H: 620,
  FRAME: 30, // 外框内缩
  FRAME_INNER: 38, // 内框内缩
  SEAL: 72,
  SEAL_MARGIN: 44, // 名章距内框
  SEAL_RADIUS: 11, // 名章圆角：网页上那枚是 6px/40px，等比放大到 72px 约 11px
  SEAL_INNER: 4, // 内层发丝线与外框的距离 —— 双线的「朱文印」味道
};

/**
 * 名章的形状。
 *   'square' —— 圆角方印，与网页上那枚同一套语言（默认）
 *   'round'  —— 圆印，即传统印章里的「圆朱文」，摆脱方框
 * 两式都已实现，测试两式都跑得通（.test/card-run-test.mjs 里当场切常量验过）；想换只改这一个常量。
 */
export const SEAL_SHAPE = 'square';

/** 把一段文字折成若干行。measure(text, font) → 像素宽 */
export function wrap(measure, text, font, maxWidth) {
  const out = [];
  let line = '';
  for (const ch of String(text || '')) {
    if (ch === '\n') {
      out.push(line);
      line = '';
      continue;
    }
    const next = line + ch;
    if (line && measure(next, font) > maxWidth) {
      out.push(line);
      line = ch;
    } else {
      line = next;
    }
  }
  if (line) out.push(line);
  return out.length ? out : [''];
}

/**
 * 算出一张纸笺的全部版式。
 * @param {(text:string, font:string)=>number} measure 量宽函数（**必须自己设字体**）
 * @param {{title?:string, scene?:string, rows:string[], serif?:string}} input
 *        rows 是已排好的展示行（'' 表示空行）；serif 是衬线字体栈，不传就用 SERIF。
 *        返回值里的 fonts 就是这一次实际用的字体串 —— 绘制照它设，量宽与绘制便不会各说各话。
 */
export function layoutCard(measure, { title, scene, rows, serif }) {
  const innerW = W - PAD * 2;
  const F = fonts(serif);

  const sceneLines = scene ? wrap(measure, scene, F.scene, innerW - 46) : [];

  const bodyRows = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!String(r).trim()) {
      bodyRows.push('');
      continue;
    }
    for (const seg of wrap(measure, r, F.body, innerW)) bodyRows.push(seg);
  }

  const sceneH = sceneLines.length * M.SCENE_LH;
  const titleH = title ? M.TITLE_LH : 0;
  const bodyH = bodyRows.reduce((n, l) => n + (l ? M.BODY_LH : M.GAP_ROW), 0);

  const contentH = M.TOP + sceneH + M.GAP_SCENE_TO_TITLE + titleH + M.GAP_TITLE_TO_BODY + bodyH + M.BOTTOM;
  const H = Math.max(M.MIN_H, contentH);

  // 乌丝栏只罩住「标题 + 正文」，不罩取景
  const rulesTop = M.TOP + sceneH + M.GAP_SCENE_TO_TITLE;
  const rulesBottom = rulesTop + titleH + M.GAP_TITLE_TO_BODY + bodyH + 34;

  return { W, H, innerW, sceneLines, bodyRows, rulesTop, rulesBottom, colW: innerW / RULES_COLS, fonts: F };
}

/** 越界检查：任何一行都不该宽出纸面内框。返回越界的行（正常情况下是空的） */
export function overflow(measure, layout, rowsKey) {
  const list = rowsKey === 'scene' ? layout.sceneLines : layout.bodyRows;
  // 用这张纸**实际**用的字体量，别拿常量再算一遍 —— 那正是「量错字体」那类 bug 的入口
  const F = layout.fonts || FONT;
  const font = rowsKey === 'scene' ? F.scene : F.body;
  const limit = rowsKey === 'scene' ? layout.innerW - 46 : layout.innerW;
  return list.filter((l) => l && measure(l, font) > limit);
}
