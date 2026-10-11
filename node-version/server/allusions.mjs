// 云卷云舒 · 典故索引
//
// 目的：让诗「会用典」。做法不是把整部典故库塞进提示词（那会淹没它），
// 而是**按场景与情感挑出几条候选**，让模型从中择一（或弃用）。
//
// 数据来自 allusions-a（先秦至唐）与 allusions-b（宋至近现代），
// 由两个子代理经网络检索逐条核实出处后写成。
//
// ⚠ 这里从前是 await import()，现在改成静态 import —— 原因见 validator.mjs 顶部：
//   动态 import() 会让 esbuild 生成「同步函数里带 await」的惰性初始化包装，
//   workerd 直接 SyntaxError，部署整个失败。
//   两个数据模块随包发布，静态引入即可；缺失会被 doctor.mjs 的部署前自检拦下，
//   不会拖到线上才发现。

import * as modA from './allusions-a.mjs';
import * as modB from './allusions-b.mjs';

/** 取模块里的典故数组：优先具名导出，退而求其次取第一个数组导出 */
function pickList(m) {
  if (Array.isArray(m.ALLUSIONS_A)) return m.ALLUSIONS_A;
  if (Array.isArray(m.ALLUSIONS_B)) return m.ALLUSIONS_B;
  return Object.values(m).find((v) => Array.isArray(v)) || [];
}

const listA = pickList(modA);
const listB = pickList(modB);

export const ALLUSIONS = [...listA, ...listB];
export const ALLUSION_COUNT = ALLUSIONS.length;

/**
 * 场景关键词 → 情感。用多字词，不用单字——单字（如「归」「月」）会误撞，
 * 曾把「医院走廊」判成「闲适」。
 */
const SCENE_HINTS = [
  [['送别', '送客', '饯行', '折柳', '长亭', '渡口', '站台', '分手', '离别', '辞行'], '送别'],
  [['思念', '想念', '故人', '旧友', '家书', '故乡', '他乡', '异乡', '怀人', '独宿'], '相思'],
  [['夜行', '旅途', '客舍', '驿站', '行舟', '远行', '漂泊', '赶路', '末班'], '羁旅'],
  [['遗址', '故城', '旧城', '古塔', '登高', '凭栏', '怀古', '吊古', '碑', '废墟'], '咏史'],
  [['隐居', '山林', '茅庐', '柴门', '种菊', '垂钓', '田园', '闲居', '山中'], '隐逸'],
  [['病', '医院', '病房', '输液', '老去', '白发', '哭', '泪', '寒夜', '秋风', '秋雨', '送葬'], '悲慨'],
  [['醉酒', '高歌', '壮怀', '宝剑', '铁马', '射猎', '豪气', '长风', '万里'], '豪迈'],
  [['白云', '青天', '大海', '江天', '星辰', '旷野', '雪山', '豁然'], '旷达'],
  [['梦', '蝶', '幻', '禅', '顿悟', '寂'], '哲思'],
  [['饮茶', '下棋', '读书', '赏花', '庭院', '午后', '小坐', '闲坐', '窗前'], '闲适'],
  [['愤', '怒', '讥', '讽刺', '不平', '嘲讽', '呐喊'], '孤愤'],
  [['惆怅', '暮色', '残照', '黄昏', '阑珊', '无端'], '怅惘'],
];

/** 从场景描述里推断可能的情感（最多取匹配最多的三个） */
export function inferSentiments(scene) {
  const s = String(scene || '');
  const hits = [];
  for (const [words, senti] of SCENE_HINTS) {
    const n = words.filter((w) => s.includes(w)).length;
    if (n) hits.push({ senti, n });
  }
  hits.sort((a, b) => b.n - a.n);
  return hits.slice(0, 3).map((h) => h.senti);
}

/**
 * 按场景挑典故候选。
 * 只按情感匹配，且**只取真正命中的情感**；没有任何命中时，
 * 返回各情感里较有代表性的几条，作为「你可能想用」的提示。
 */
export function pickAllusions(scene, n = 8) {
  if (!ALLUSIONS.length) return [];
  const sentis = inferSentiments(scene);
  if (!sentis.length) {
    // 无命中：按情感轮流取，保证候选分布均匀
    const buckets = new Map();
    for (const a of ALLUSIONS) {
      for (const t of a.sentiment || []) {
        if (!buckets.has(t)) buckets.set(t, []);
        buckets.get(t).push(a);
      }
    }
    const out = [];
    const keys = [...buckets.keys()];
    let i = 0;
    while (out.length < n && i < n * 3) {
      for (const k of keys) {
        const b = buckets.get(k);
        const pick = b[i % b.length];
        if (pick && !out.includes(pick)) out.push(pick);
        if (out.length >= n) break;
      }
      i++;
    }
    return out.slice(0, n);
  }
  const primary = sentis[0];
  const matched = ALLUSIONS.filter((a) => (a.sentiment || []).includes(primary));
  // 次情感命中的补足
  const secondary = ALLUSIONS.filter((a) => sentis.slice(1).some((t) => (a.sentiment || []).includes(t)));
  const out = [...matched];
  for (const a of secondary) if (out.length < n && !out.includes(a)) out.push(a);
  for (const a of ALLUSIONS) if (out.length < n && !out.includes(a)) out.push(a);
  return out.slice(0, n);
}

/** 按 id 取典故（用于模型自己挑中的那几条） */
export function allusionsByIds(ids) {
  const set = new Set(ids || []);
  return ALLUSIONS.filter((a) => set.has(a.id));
}

function oneLine(a, i) {
  const senti = (a.sentiment || []).join('、');
  return `${i + 1}. ${a.name}（${a.era}）　出处：${a.source}\n     用意：${a.meaning}　宜用于：${senti}\n     用法：${a.usage}`;
}

/** 候选池：给择体那一步用，条数可多些，让模型自己挑 */
export function allusionPool(scene, n = 16) {
  return pickAllusions(scene, n);
}

/** 把候选典故排成给模型看的一段清单 */
export function allusionBrief(scene, n = 8, ids = null) {
  const picks = ids && ids.length ? allusionsByIds(ids) : pickAllusions(scene, n);
  if (!picks.length) return '';
  return `【可供选用的典故】
${picks.map(oneLine).join('\n')}

  用典规矩：**最多用一处，也可以一处都不用**。若用，必须与眼前这个场景真正相扣，
  不可因为「好看」而硬塞。用错了典比不用更糟。除下列之外，你也可用自己确知的常见典故。`;
}

/** 择体那一步的典故候选清单（只给名字与用意，让模型挑 id） */
export function allusionMenu(scene, n = 16) {
  const picks = allusionPool(scene, n);
  if (!picks.length) return '';
  return `【典故候选池】
${picks.map((a) => `  - ${a.id}　${a.name}（${a.era}）：${a.meaning}`).join('\n')}`;
}

/** 供 /api/health 显示 */
export function allusionsCoverage() {
  return { total: ALLUSION_COUNT, a: listA.length, b: listB.length };
}

/**
 * 本次真正递到模型眼前的那些典故**名字**（书名、人名、典故名一并收）。
 * 用途只有一个：核对它自报的出处是不是在给的典目里 —— 编造出处是最常见的 AI 幻觉。
 * 不去猜字段名，凡字符串字段都收进来，改数据结构也不必跟着改。
 */
export function allusionNames(scene, n = 8, ids = null) {
  const picks = ids && ids.length ? allusionsByIds(ids) : pickAllusions(scene, n);
  const out = new Set();
  for (const a of picks) for (const v of Object.values(a || {})) if (typeof v === 'string' && v) out.add(v);
  return [...out];
}
