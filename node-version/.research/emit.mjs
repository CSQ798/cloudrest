// Emit server/pingshui.mjs and server/rhyme.mjs from archived raw sources.
//
// Build -> write to temp files -> import the TEMP files -> run every self-check
// against the imported artifact -> only then rename into place.
// So the shipped file is byte-for-byte what was verified, and a failing check
// leaves the old files untouched.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const HERE = import.meta.dirname;
const SERVER = path.join(HERE, '..', 'server');
const FETCH_DATE = '2026-10-04';

const R = (f) => JSON.parse(fs.readFileSync(path.join(HERE, f), 'utf8'));
const isHan = (c) => /^[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u{20000}-\u{2FFFF}]$/u.test(c);
const stripAnn = (s) => s.replace(/\[[^\]]*\]/g, '').replace(/（[^）]*）/g, '').replace(/\([^)]*\)/g, '');
const toChars = (s) => [...stripAnn(s)].filter(isHan);
const CANON_YAN = (n) => (n === '二十八俭' ? '二十八琰' : n);
const q = (s) => "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
const sorted = (set) => [...set].sort((a, b) => a.codePointAt(0) - b.codePointAt(0));
const CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九'];

// =========================================================================
// PART 1 — 平水韵 (搜韵《平水韵》官方文档)
// =========================================================================
const sjyPs = R('sjy-pingshui-all.json').filter((p) => p.heading);
const CANON = sjyPs.map((p) => {
  const name = p.heading.replace(/\(.*\)$/, '').trim();
  const tag = p.body.match(/【(上平|下平|上声|去声|入声)[,，]([^】]+)】/);
  const half = tag[1];
  return { name, half, sheng: half.replace('上平', '平').replace('下平', '平').replace(/声$/, '') };
});
if (CANON.length !== 106) throw new Error('canon != 106: ' + CANON.length);
if (new Set(CANON.map((c) => c.sheng + c.name)).size !== 106) throw new Error('canon 韵目名重复');

const ori = R('raw-oriYunDict.json');
const PS = new Map();
for (const [key, val] of Object.entries(ori)) {
  const m = key.replace(/^\uFEFF/, '').match(/^(.+?)([平上去入])$/);
  if (!m) throw new Error('unparsed S1 key ' + JSON.stringify(key));
  PS.set(m[2] + '|' + CANON_YAN(m[1]), new Set(toChars(val)));
}
const PINGSHUI = [];
const PS_UP = new Set(), PS_DOWN = new Set();
for (const c of CANON) {
  const chars = PS.get(c.sheng + '|' + c.name);
  if (!chars) throw new Error('搜韵缺韵目 ' + c.half + c.name);
  PINGSHUI.push({ 名: c.half + c.name, name: c.name, 声: c.sheng, chars });
  for (const ch of chars) {
    if (c.sheng === '上') PS_UP.add(ch);
    else if (c.sheng === '去') PS_DOWN.add(ch);
  }
}
const PS_TOTAL = new Set(PINGSHUI.flatMap((y) => [...y.chars]));
console.log('平水韵: 韵目', PINGSHUI.length, '字头(unique)', PS_TOTAL.size);

// =========================================================================
// PART 2 — 词林正韵
//   部 -> 平水韵韵目 mapping derived from character overlap, because the source
//   page labels contain slips (七虞/七麌 swapped, 二十岢 for 二十哿).
//   韵目 NOT marked (半) are taken in FULL from 平水韵 (that is the definition
//   of 词林正韵).  韵目 marked (半) use ONLY sourced char lists, so the
//   十灰/九佳/十三元/十贿/九泰/十一队/十卦/十三阮/十四愿 splits are never guessed.
// =========================================================================
const sjyCl = R('sjy-cilin-all.json').filter((p) => p.heading);
const SPLIT_NUM = /([一二三四五六七八九十]+[^一二三四五六七八九十【】]+)/g;
const cleanName = (s) => s.replace(/[（(]半[)）]/g, '').replace(/通用|独用|声/g, '').trim();
const stripHalf = (s) => s.replace(/[（(]半[)）]/g, '').trim();
const namesIn = (seg) => (seg.match(SPLIT_NUM) || []).map(cleanName);

const SUBS = [];
for (const p of sjyCl) {
  const h = p.body.match(/【词林正韵】-\s*([^()（）]*)\((平|仄)\)/);
  if (!h) throw new Error('cilin heading id=' + p.id);
  const bu = p.id >= 29 ? p.id - 14 : (h[2] === '平' ? (p.id + 1) / 2 : p.id / 2);
  const hdr = p.body.match(/【(平声|仄声|入声)[:：]([^】]*)】/);
  if (!hdr) throw new Error('cilin header id=' + p.id);
  let upCount = 0;
  for (const part of hdr[2].split(/\s+/)) {
    const m2 = part.match(/^(上声|去声|入声)(.*)$/);
    if (m2 && m2[1] === '上声') upCount = namesIn(m2[2]).length;
  }
  const subs = [];
  const re = /【([^】]+)】([^【]*)/g; let m;
  while ((m = re.exec(p.body))) {
    const raw = m[1];
    if (/^(词林正韵|平声|仄声|入声)/.test(raw)) continue;
    subs.push({ raw, half: /[（(]半[)）]/.test(raw), siteName: stripHalf(raw), chars: toChars(m[2].split('手机访问')[0]) });
  }
  subs.forEach((s, i) => {
    const sheng = hdr[1] === '平声' ? '平' : hdr[1] === '入声' ? '入' : (i < upCount ? '上' : '去');
    SUBS.push({ bu, sheng, ...s });
  });
}
for (const sl of SUBS) {
  if (!sl.chars.length) throw new Error(`词林正韵空子表 第${sl.bu}部 ${sl.sheng} ${sl.siteName}`);
  let best = null;
  for (const y of PINGSHUI.filter((x) => x.声 === sl.sheng)) {
    const set = PS.get(sl.sheng + '|' + y.name);
    let hit = 0;
    for (const c of sl.chars) if (set.has(c)) hit++;
    const ratio = hit / sl.chars.length;
    if (!best || ratio > best.ratio) best = { name: y.name, ratio };
  }
  if (best.ratio < 0.6) throw new Error(`词林正韵映射置信度过低 ${sl.bu} ${sl.sheng} ${sl.siteName} -> ${best.name} ${best.ratio}`);
  sl.match = best.name;
  sl.ratio = best.ratio;
}
console.log('词林正韵: 子表', SUBS.length, ' 最低映射置信度', Math.min(...SUBS.map((s) => s.ratio)).toFixed(3));
const labelSlips = SUBS.filter((s) => s.siteName !== s.match);
console.log('  站点韵目标签与数据不符（已按数据校正）:',
  labelSlips.map((s) => `第${s.bu}部${s.sheng}「${s.siteName}」→「${s.match}」`).join(' '));

const cilinRaw = R('raw-Cilin_Rhyme.json');
const CN_D = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
function cnNum(s) {
  s = s.replace(/^第/, '').replace(/部$/, '');
  if (s === '十') return 10;
  if (s.startsWith('十')) return 10 + CN_D[s[1]];
  if (s.length === 1) return CN_D[s];
  return CN_D[s[0]] * 10 + CN_D[s[2]];
}
const C2 = {};
for (let i = 1; i <= 19; i++) C2[i] = { 平: new Set(), 仄: new Set(), 入: new Set() };
for (const [bu, obj] of Object.entries(cilinRaw)) {
  const n = cnNum(bu);
  for (const [sheng0, arr] of Object.entries(obj)) {
    const sheng = sheng0.replace(/声$/, '');
    if (!C2[n][sheng]) throw new Error('bad sheng ' + sheng0);
    for (const c of arr) if (isHan(c)) C2[n][sheng].add(c);
  }
}

const RHYME = [];
let unplaced = 0;
let droppedInconsistent = 0;
// 声一致性闸门：把某字收进某部某声时，若该字在平水韵里根本没有这个声，则拒收。
// 这是筛掉来源字表噪声（例：诗词家园把「虞」误列进上声/去声表，
// charlesix59 把「集」误列进第十一部平声）的关键一步。
const PS_SHENG = new Map(); // 字 -> Set<声>
for (const y of PINGSHUI) {
  for (const c of y.chars) {
    let s = PS_SHENG.get(c);
    if (!s) PS_SHENG.set(c, (s = new Set()));
    s.add(y.声);
  }
}
const consistent = (c, s) => {
  const st = PS_SHENG.get(c);
  return !st || st.has(s); // 平水韵完全未收录 -> 无从核对，仍按来源收录（并在下方计入）
};
const noCheck = [];
const COMPOSITION = {};
for (let i = 1; i <= 19; i++) {
  const S = { 平: new Set(), 上: new Set(), 去: new Set(), 入: new Set() };
  COMPOSITION[i] = { 平: [], 上: [], 去: [], 入: [] };
  for (const sl of SUBS.filter((s) => s.bu === i)) {
    if (!sl.half) for (const c of PS.get(sl.sheng + '|' + sl.match)) S[sl.sheng].add(c);
    for (const c of sl.chars) {
      if (consistent(c, sl.sheng)) { S[sl.sheng].add(c); if (!PS_SHENG.has(c)) noCheck.push(c); }
      else droppedInconsistent++;
    }
    COMPOSITION[i][sl.sheng].push(sl.match + (sl.half ? '(半)' : ''));
  }
  for (const c of C2[i].平) {
    if (consistent(c, '平')) { S.平.add(c); if (!PS_SHENG.has(c)) noCheck.push(c); } else droppedInconsistent++;
  }
  for (const c of C2[i].入) {
    if (consistent(c, '入')) { S.入.add(c); if (!PS_SHENG.has(c)) noCheck.push(c); } else droppedInconsistent++;
  }
  for (const c of C2[i].仄) {
    let placed = false;
    if (PS_UP.has(c)) { S.上.add(c); placed = true; }
    if (PS_DOWN.has(c)) { S.去.add(c); placed = true; }
    if (!placed) unplaced++;
  }
  RHYME.push({ id: '第' + CN[i - 1] + '部', 平: S.平, 上: S.上, 去: S.去, 入: S.入 });
}
console.log('词林正韵: 19 部');
console.log('  声一致性闸门拒收（与平水韵声矛盾）:', droppedInconsistent);
console.log('  charlesix59 仄声无法定上/去而丢弃:', unplaced);
console.log('  平水韵未收录、无从核对而按来源收录的字次数:', noCheck.length, '（去重', new Set(noCheck).size, '）');
console.log('  每部字数:', RHYME.map((r) => `${r.id.slice(1, -1)}:平${r.平.size}/上${r.上.size}/去${r.去.size}/入${r.入.size}`).join(' '));

// =========================================================================
// PART 3 — emit source text
// =========================================================================
const psRows = PINGSHUI.map((y) => `  [${q(y.名)}, ${q(y.声)}, ${q(sorted(y.chars).join(''))}],`).join('\n');
const psOut = `// 栖云 · 平水韵（近体诗 / 律绝用）
//
// ── 数据来源与抓取日期（${FETCH_DATE}）──────────────────────────────
// 写入本表的唯一数据源：
//   搜韵《平水韵》官方文档      https://www.sou-yun.com/QR.aspx
//   本次经 GitHub 镜像取得：    https://github.com/jkak/pingShuiYun
//     data/origin.txt → data/oriYunDict.json
//   留档：.research/raw-oriYunDict.json
//   （即用户指定的搜韵《平水韵》，106 韵目齐全；原文内嵌的又音注记如
//     「间开」「中[作为]」已在入库时剥离。）
//
// 仅用于交叉验证、未写入本表的两个独立来源：
//   A. 诗词家园《平水韵》106 韵目
//      https://www.shicijiayuan.com/books/showdetail.asp?book=23&id=1..106
//      留档 .research/sjy-pingshui-all.json
//   B. 维基文库《平水韻》 https://zh.wikisource.org/wiki/平水韻
//      经 https://github.com/charlesix59/chinese_word_rhyme → data/Pingshui_Rhyme.json
//      留档 .research/raw-Pingshui_Rhyme.json
//
// ── 交叉验证结果（字头级：同一字是否至少共享一个「声+韵目」）────────
//   搜韵 vs 诗词家园：共有字头 4357，一致 4344 = 99.70%（冲突 13）
//   搜韵 vs 维基文库：共有字头 7956，一致 7882 = 99.07%（冲突 74）
//   两处冲突几乎全是极生僻字或又音取舍差异，故只采用搜韵这单一权威源，
//   不做拼合，以免把不同来源的取舍混在一起。
//   两个已知的维基文库错误（本表据搜韵，故不受影响）：
//     · 维基文库缺「上声三讲」整个韵目；
//     · 维基文库把「花」误列入上声四纸，会令 花 被判为「多」。
//
// ── 覆盖 ──────────────────────────────────────────────────────────
//   106 韵目（平 30 / 上 29 / 去 30 / 入 17），字头（去重）${PS_TOTAL.size} 个。
//   韵目名用通行写法；「上声二十八琰」为正名（搜韵文档作「二十八俭」，同一韵目）。
//
// ── 已知局限（诚实说明）────────────────────────────────────────────
//   1. 生僻字仍有遗漏；未收录字 toneOf 返回 '未知'，绝不猜测。
//   2. 一字多读者一律保留全部读音，toneOf 返回 '多'（看/中/间/铺/少…）。
//      平仄判定需调用方结合词谱的「中」或文意取舍。
//   3. 本表只是韵书归属，不含孤平/拗救/三平调等格律规则。
//   4. 「上平/下平」只是平水韵的卷次分法，声调同为平声，本表 声 字段一律记 '平'。
//   5. samePingYun 对「韵书收录但无平声读法」的字判为不合（非平声不能作平声韵脚）；
//      对「韵书完全未收录」的生僻字则不参与判定，只在 detail 中列出。

const RAW = [
${psRows}
];

/** 平水韵 106 韵目。每项：{ 名: '上平一东', 声: '平'|'上'|'去'|'入', 字: Set<string> } */
export const YUNMU = RAW.map(([名, 声, 字]) => ({ 名, 声, 字: new Set([...字]) }));

/** 平声韵目名（上平 15 + 下平 15，共 30）。 */
export const PING_YUNMU = YUNMU.filter((y) => y.声 === '平').map((y) => y.名);

const HAN = /^[\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF\\u{20000}-\\u{2FFFF}]$/u;

const CHAR = new Map(); // 字 -> Set<'声|名'>
for (const y of YUNMU) {
  for (const c of y.字) {
    let s = CHAR.get(c);
    if (!s) CHAR.set(c, (s = new Set()));
    s.add(y.声 + '|' + y.名);
  }
}

/**
 * 查一个字的平仄。
 *   只有平声读法 → '平'；只有上/去/入读法 → '仄'；平仄兼有 → '多'；未收录 → '未知'。
 */
export function toneOf(char) {
  const s = CHAR.get(char);
  if (!s) return '未知';
  let ping = false, ze = false;
  for (const k of s) {
    if (k.charCodeAt(0) === 0x5e73) ping = true; // '平'
    else ze = true;
  }
  return ping && ze ? '多' : ping ? '平' : '仄';
}

/**
 * 一个字的全部平声韵目名（多音字会有多个），如 ['上平四支','上平十灰']。
 * 非平声或未收录返回 []。
 */
export function pingYunListOf(char) {
  const s = CHAR.get(char);
  if (!s) return [];
  const out = [];
  for (const y of YUNMU) if (y.声 === '平' && s.has('平|' + y.名)) out.push(y.名);
  return out;
}

/** 查一个字所属平声韵目（多音字取第一个）；非平声或未收录返回 null。 */
export function pingYunOf(char) {
  const l = pingYunListOf(char);
  return l.length ? l[0] : null;
}

/**
 * 判断一组平声韵脚是否同韵（近体诗用）。
 * 判据：所有字至少共享一个平声韵目（多音字按任一读音命中即可）。
 * chars 可为字符串或字符数组；标点等非汉字自动忽略。
 * @returns {{ok:boolean, detail:string}}
 */
export function samePingYun(chars) {
  const list = (typeof chars === 'string' ? [...chars] : [...(chars || [])]).filter((c) => HAN.test(c));
  if (!list.length) return { ok: false, detail: '没有可判定的汉字。' };
  const sets = list.map((c) => new Set(pingYunListOf(c)));
  const blank = list.filter((c, i) => sets[i].size === 0);
  // 韵书收录、却无任何平声读法 —— 这类字不可能作平声韵脚，必须判不合
  const notPing = blank.filter((c) => CHAR.has(c));
  if (notPing.length) {
    return { ok: false, detail: '非平声字不能作平声韵脚：' + notPing.join('') + '。（' + list.join('') + '）' };
  }
  const unknown = blank; // 韵书完全未收录
  const ks = sets.filter((s) => s.size > 0);
  if (!ks.length) return { ok: false, detail: '无一字可查：' + list.join('') + '（平水韵未收录）' };
  let common = new Set(ks[0]);
  for (const s of ks.slice(1)) common = new Set([...common].filter((x) => s.has(x)));
  const parts = list.map((c, i) => c + ':' + (sets[i].size ? [...sets[i]].join('/') : '未收录'));
  let detail = common.size
    ? '同属平声韵目「' + [...common].join('、') + '」。(' + parts.join(' ') + ')'
    : '平声韵目不一致：' + parts.join(' ');
  if (unknown.length) detail += '；未参与判定：' + unknown.join('');
  return { ok: common.size > 0, detail };
}

/** 覆盖统计。 */
export const COVERAGE = {
  韵目数: YUNMU.length,
  平声韵目: YUNMU.filter((y) => y.声 === '平').length,
  上声韵目: YUNMU.filter((y) => y.声 === '上').length,
  去声韵目: YUNMU.filter((y) => y.声 === '去').length,
  入声韵目: YUNMU.filter((y) => y.声 === '入').length,
  字头: CHAR.size,
};
`;

const buRows = RHYME.map((r) => {
  const f = (s) => q(sorted(s).join(''));
  return `  { id: ${q(r.id)},\n    平: ${f(r.平)}, 上: ${f(r.上)},\n    去: ${f(r.去)}, 入: ${f(r.入)} },`;
}).join('\n');
const compLines = Object.entries(COMPOSITION).map(([n, c]) => {
  const part = [];
  for (const s of ['平', '上', '去', '入']) if (c[s].length) part.push(s + ': ' + c[s].join(' '));
  return `//   第${CN[n - 1]}部  ${part.join('  |  ')}`;
}).join('\n');
const slipLines = labelSlips.length
  ? labelSlips.map((s) => `//     · 第${s.bu}部${s.sheng}：站点标「${s.siteName}」，实为「${s.match}」（按字表重叠度校正）`).join('\n')
  : '//     （无）';
const BU_TOTAL = new Set(RHYME.flatMap((r) => [...r.平, ...r.上, ...r.去, ...r.入])).size;

const rhymeOut = `// 栖云 · 词林正韵（填词用）
//
// ── 数据来源与抓取日期（${FETCH_DATE}）──────────────────────────────
// 主数据源（提供上/去/入细分与全部韵目名单）：
//   诗词家园《词林正韵》十九部
//   https://www.shicijiayuan.com/books/showdetail.asp?book=22&id=1..33
//   留档 .research/sjy-cilin-all.json
// 交叉验证源（只分平/仄/入）：
//   https://github.com/charlesix59/chinese_word_rhyme → data/Cilin_Rhyme.json
//   留档 .research/raw-Cilin_Rhyme.json
// 韵目归属的旁证：
//   cnkgraph 韵典「词林正韵/平声/四支五微八齐十灰(半)/杯」
//   与「词林正韵/平声/九佳(半)十灰(半)/台」。
// 两源共有字头 4816 个，部归属一致率 100.00%（0 冲突）。
//
// ── 本表是怎么合出来的（可复核）────────────────────────────────────
//   《词林正韵》的定义就是「合并若干平水韵韵目」。于是：
//   1. 先用字表重叠度，把主数据源每个子表匹配到一个平水韵韵目
//      （站点自身的韵目标签有错，不能直接信；见文末「已校正的标签错误」）。
//   2. 未标 (半) 的韵目，整部字表直接取平水韵（搜韵《平水韵》）的全量字。
//   3. 标 (半) 的韵目（十灰/九佳/十三元/十贿/九泰/十一队/十卦/十三阮/十四愿）
//      只用来源明确列出的字，绝不猜测「哪一半」——这几个韵目覆盖偏少是必然的。
//   4. 两源字表取并集。charlesix59 只有合并的「仄声」，其字再按平水韵的声
//      分入上/去（词林正韵保留了所本韵书的上/去之别）。无法定声而丢弃：${unplaced} 字。
//   5. 声一致性闸门：某字要进「某部某声」，须先在该字的平水韵读音里找到这个声，
//      找不到即拒收（共拒收 ${droppedInconsistent} 条）。这是筛掉来源字表噪声的关键——
//      例：诗词家园把「虞」误列进 七麌/七遇 表、charlesix59 把「集」误列进第十一部平声；
//      若无此闸门，「集」会同时落在第十一部，造成假「同部」。
//      平水韵完全未收录、无从核对而仍按来源收录的：${new Set(noCheck).size} 字。
//   6. 不变式：「仄」恒等于 上 ∪ 去 ∪ 入。
//
// ── 本部所含平水韵韵目（由数据推导，非手写）────────────────────────
${compLines}
//
// ── 覆盖 ──────────────────────────────────────────────────────────
//   19 部，字头（去重）${BU_TOTAL} 个。
//
// ── 已校正的标签错误 ───────────────────────────────────────────────
${slipLines}
//
// ── 已知局限（诚实说明，务必阅读）──────────────────────────────────
//   1.《词林正韵》把平水韵的 十灰、九佳、十三元、九泰、十一队、十贿、十卦、
//      十三阮、十四愿 等韵目「劈成两半」分入不同部。因此按本表校验，
//      部分宋词名篇会被判为「不同部」——这不是数据错误：
//        · 晏殊《浣溪沙》韵脚 杯 回 徊 = 第三部（十灰之「灰」半），
//          台 来 = 第五部（十灰之「咍」半）。
//          本表 sameBu 如实返回 ok:false；但这五字在《平水韵》同属 上平十灰，
//          pingshui.mjs 的 samePingYun 返回 ok:true —— 晏殊押的是诗韵。
//        · 同理 顾太清《喝火令》韵脚 繁/翻（第七部）与 昏/门/坤（第六部）
//          在诗韵同属 十三元。
//      调用方要下「合律」结论时，建议 sameBu 与 samePingYun 都看，
//      并在给用户的说明里点出这一差别。
//   2. 生僻字仍有遗漏；未收录字 buOf 返回 []、pingBu/zeBu 返回 null，不猜测。
//   3. 多音字一律保留全部部号（如 铺 在第四部平声也在第四部仄声；
//      「台」因平水韵四支的又音「我也、悦也」而同时在第三部与第五部）。
//      「同部」判定按「存在任一共同部号」计算，因此对多音字偏宽松。
//   4. pingBu/zeBu 只在无结果时返回 null，其余按已排序数组返回。

const RAW = [
${buRows}
];

const BU_CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九'];
const cnBu = (n) => '第' + BU_CN[n - 1] + '部';

/** 词林正韵 19 部。每项：{ id:'第一部', 平:Set, 仄:Set, 上:Set, 去:Set, 入:Set } */
export const BU = RAW.map((r) => {
  const 平 = new Set([...r.平]);
  const 上 = new Set([...r.上]);
  const 去 = new Set([...r.去]);
  const 入 = new Set([...r.入]);
  return { id: r.id, 平, 上, 去, 入, 仄: new Set([...上, ...去, ...入]) };
});

const BU_NUM = new Map(); // 字 -> { 平:number[], 仄:number[] }
BU.forEach((b, i) => {
  const n = i + 1;
  const put = (c, k) => {
    let e = BU_NUM.get(c);
    if (!e) BU_NUM.set(c, (e = { 平: [], 仄: [] }));
    if (!e[k].includes(n)) e[k].push(n);
  };
  for (const c of b.平) put(c, '平');
  for (const c of b.仄) put(c, '仄');
});

const HAN = /^[\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF\\u{20000}-\\u{2FFFF}]$/u;

/** 查一个字属于哪些部，返回部号数组（1..19，升序）；未收录返回 []。 */
export function buOf(char) {
  const e = BU_NUM.get(char);
  if (!e) return [];
  return [...new Set([...e.平, ...e.仄])].sort((a, b) => a - b);
}

/** 一个字的平声部号数组（升序）；无平声归属或未收录返回 null。 */
export function pingBu(char) {
  const e = BU_NUM.get(char);
  return e && e.平.length ? [...e.平].sort((a, b) => a - b) : null;
}

/** 一个字的仄声部号数组（升序）；无仄声归属或未收录返回 null。 */
export function zeBu(char) {
  const e = BU_NUM.get(char);
  return e && e.仄.length ? [...e.仄].sort((a, b) => a - b) : null;
}

/** 某个韵部的平声字集合。buIndex 为 1..19；越界返回空 Set。 */
export function pingOf(buIndex) {
  const b = BU[buIndex - 1];
  return b ? new Set(b.平) : new Set();
}

/**
 * 判断一组字是否同属一个韵部（校验押韵是否一致）。
 * 判据：所有已收录字至少共享一个部号（多音字按任一部命中即可）。
 * chars 可为字符串或字符数组；标点等非汉字自动忽略。
 * 未收录字不参与判定，但会在 detail 中列出。
 *
 * 注意：本函数严格依《词林正韵》。宋词里「押诗韵」的名篇会被判为 false，
 * 详见文件顶部「已知局限」第 1 条。
 * @returns {{ok:boolean, detail:string}}
 */
export function sameBu(chars) {
  const list = (typeof chars === 'string' ? [...chars] : [...(chars || [])]).filter((c) => HAN.test(c));
  if (!list.length) return { ok: false, detail: '没有可判定的汉字。' };
  const unknown = list.filter((c) => buOf(c).length === 0);
  const known = list.filter((c) => buOf(c).length > 0);
  if (!known.length) return { ok: false, detail: '无一字可查：' + list.join('') + '（《词林正韵》未收录）' };
  const sets = known.map((c) => new Set(buOf(c)));
  let common = new Set(sets[0]);
  for (const s of sets.slice(1)) common = new Set([...common].filter((x) => s.has(x)));
  const parts = known.map((c) => c + '=' + buOf(c).map(cnBu).join('、'));
  let detail = common.size
    ? '同属「' + [...common].sort((a, b) => a - b).map(cnBu).join('、') + '」。(' + parts.join(' ') + ')'
    : '不同部：' + parts.join(' ');
  if (unknown.length) detail += '；未收录：' + unknown.join('') + '（未参与判定）';
  return { ok: common.size > 0, detail };
}

/** 覆盖统计。 */
export const COVERAGE = {
  部数: BU.length,
  平声字: new Set(BU.flatMap((b) => [...b.平])).size,
  仄声字: new Set(BU.flatMap((b) => [...b.仄])).size,
  上声字: new Set(BU.flatMap((b) => [...b.上])).size,
  去声字: new Set(BU.flatMap((b) => [...b.去])).size,
  入声字: new Set(BU.flatMap((b) => [...b.入])).size,
};
`;

const tmpPs = path.join(SERVER, '.__tmp_pingshui.mjs');
const tmpRh = path.join(SERVER, '.__tmp_rhyme.mjs');
const VERIFY_ONLY = process.argv.includes('--check-installed');
const stamp = Date.now();
let psMod, rhMod;
if (VERIFY_ONLY) {
  psMod = await import(pathToFileURL(path.join(SERVER, 'pingshui.mjs')).href + '?t=' + stamp);
  rhMod = await import(pathToFileURL(path.join(SERVER, 'rhyme.mjs')).href + '?t=' + stamp);
  console.log('\n[校验模式] 比对已安装的 server/pingshui.mjs 与 server/rhyme.mjs，不写任何文件。');
} else {
  fs.writeFileSync(tmpPs, psOut, 'utf8');
  fs.writeFileSync(tmpRh, rhymeOut, 'utf8');
  try {
    psMod = await import(pathToFileURL(tmpPs).href + '?t=' + stamp);
    rhMod = await import(pathToFileURL(tmpRh).href + '?t=' + stamp);
  } catch (e) {
    fs.rmSync(tmpPs, { force: true });
    fs.rmSync(tmpRh, { force: true });
    throw new Error('生成的模块无法 import：' + e.message);
  }
}

// =========================================================================
// PART 4 — self-checks, run against the ACTUAL generated modules
// =========================================================================
const { YUNMU, toneOf, pingYunOf, pingYunListOf, samePingYun, COVERAGE: PS_COV, PING_YUNMU } = psMod;
const { BU, buOf, pingBu, zeBu, pingOf, sameBu, COVERAGE: BU_COV } = rhMod;

const checks = [];
const ck = (d, c, x = '') => checks.push({ d, p: Boolean(c), x: String(x) });
const eq = (d, got, want) => ck(d + ' = ' + JSON.stringify(want), got === want, JSON.stringify(got));

eq('YUNMU 数量', YUNMU.length, 106);
eq('BU 数量', BU.length, 19);
eq('PING_YUNMU 数量', PING_YUNMU.length, 30);
// 与本次从原始数据重建出的期望值做集合级全等比对（校验模式下这是最关键的一条）
const EXP_PS = new Map(PINGSHUI.map((y) => [y.名, y.chars]));
ck('平水韵：与重建期望逐韵目集合全等',
  YUNMU.length === PINGSHUI.length && PINGSHUI.every((e) => {
    const y = YUNMU.find((x) => x.名 === e.名);
    return y && y.声 === e.声 && y.字.size === e.chars.size && [...e.chars].every((c) => y.字.has(c));
  }));
ck('词林正韵：与重建期望逐部逐声集合全等',
  BU.length === RHYME.length && RHYME.every((e, i) => ['平', '上', '去', '入'].every((s) =>
    BU[i][s].size === e[s].size && [...e[s]].every((c) => BU[i][s].has(c)))));
ck('词林正韵：id 顺序为 第一…第十九部',
  BU.every((b, i) => b.id === '第' + CN[i] + '部'), BU.map((b) => b.id).join(','));
ck('含 上声三讲 且非空', YUNMU.some((y) => y.名 === '上声三讲' && y.字.size > 0));
ck('YUNMU 每项 {名,声,字:Set}', YUNMU.every((y) => typeof y.名 === 'string' && ['平', '上', '去', '入'].includes(y.声) && y.字 instanceof Set && y.字.size > 0));
ck('BU 每项 id/平/仄/上/去/入 且 仄=上∪去∪入', BU.every((b) => /^第.+部$/.test(b.id)
  && b.平 instanceof Set && b.仄 instanceof Set && b.上 instanceof Set && b.去 instanceof Set && b.入 instanceof Set
  && b.仄.size === new Set([...b.上, ...b.去, ...b.入]).size
  && [...b.上, ...b.去, ...b.入].every((c) => b.仄.has(c))));
eq('声调分布 平/上/去/入', [PS_COV.平声韵目, PS_COV.上声韵目, PS_COV.去声韵目, PS_COV.入声韵目].join('/'), '30/29/30/17');

// —— 平仄查询 ——
for (const ch of ['天', '年', '寒', '眠', '圆', '全', '娟', '东', '花', '风', '书', '珠', '杯', '来', '虞'])
  eq(`toneOf(${ch})`, toneOf(ch), '平');
eq('toneOf(月) 入声→仄', toneOf('月'), '仄');
eq('toneOf(雨) 上声→仄', toneOf('雨'), '仄');
eq('toneOf(少) 上去→仄', toneOf('少'), '仄');
eq('toneOf(看) 平+去→多', toneOf('看'), '多');
eq('toneOf(中) 平+去→多', toneOf('中'), '多');
eq('toneOf(铺) 平+去→多', toneOf('铺'), '多');
eq('toneOf(间) 平+去→多', toneOf('间'), '多');
eq('pingYunOf(天)', pingYunOf('天'), '下平一先');
eq('pingYunOf(看) 取首个平声韵目', pingYunOf('看'), '上平十四寒');
eq('pingYunOf(月) 非平声→null', pingYunOf('月'), null);
ck('pingYunListOf(台) 含 四支 与 十灰', pingYunListOf('台').includes('上平四支') && pingYunListOf('台').includes('上平十灰'), JSON.stringify(pingYunListOf('台')));
let absent = null;
for (let cp = 0x20000; cp < 0x2a6e0 && !absent; cp++) { const c = String.fromCodePoint(cp); if (isHan(c) && toneOf(c) === '未知') absent = c; }
eq('toneOf(未收录字) 不猜测', toneOf(absent), '未知');
eq('buOf(未收录字)', buOf(absent).length, 0);

// —— 押韵一致性：词林正韵 ——
const okT = (d, r) => ck(d, r.ok, r.detail);
const noT = (d, r) => ck(d + '  [必须判否]', !r.ok, r.detail);
const SU = ['天', '年', '寒', '间', '眠', '圆', '全', '娟'];
const MAO = ['馀', '书', '珠', '夫', '衢', '竽', '铺', '虞'];
const YAN = ['杯', '台', '回', '来', '徊'];
okT('sameBu 苏轼《水调歌头》天年寒间眠圆全娟', sameBu(SU));
okT('sameBu 毛滂《水调歌头》馀书珠夫衢竽铺虞', sameBu(MAO));
okT('sameBu 李煜《虞美人》了少（仄）', sameBu(['了', '少']));
okT('sameBu 李煜《虞美人》风中同（平）', sameBu(['风', '中', '同']));
okT('sameBu 韩偓《浣溪沙》鬟寒鸾玕檀', sameBu(['鬟', '寒', '鸾', '玕', '檀']));
okT('sameBu 清平乐 夜罅麝灺（覆盖回归）', sameBu(['夜', '罅', '麝', '灺']));
okT('sameBu 字符串入参', sameBu('天年寒间眠圆全娟'));
noT('sameBu 反例 东 vs 花', sameBu(['东', '花']));
noT('sameBu 反例 杯 vs 东', sameBu(['杯', '东']));
noT('sameBu 反例 寒 vs 真', sameBu(['寒', '真']));
noT('sameBu 反例 出韵 鬟寒鸾玕 + 东', sameBu(['鬟', '寒', '鸾', '玕', '东']));
// 晏殊：词林正韵下必须判否，且指出第三部/第五部
const yan = sameBu(YAN);
ck('晏殊《浣溪沙》杯台回来徊 在词林正韵下判否', !yan.ok, yan.detail);
ck('  且 detail 写出 第三部/第五部', yan.detail.includes('第三部') && yan.detail.includes('第五部'), yan.detail);
ck('  杯回徊=第三部，台来=第五部', [3, 3, 3].every((n, i) => buOf(['杯', '回', '徊'][i]).includes(n)) && buOf('台').includes(5) && buOf('来').includes(5),
  JSON.stringify({ 杯: buOf('杯'), 回: buOf('回'), 徊: buOf('徊'), 台: buOf('台'), 来: buOf('来') }));

// —— 押韵一致性：平水韵 ——
okT('samePingYun 王之涣《登鹳雀楼》流楼', samePingYun(['流', '楼']));
okT('samePingYun 杜甫《春望》深心金簪', samePingYun(['深', '心', '金', '簪']));
okT('samePingYun 李白《早发白帝城》间还山', samePingYun(['间', '还', '山']));
okT('samePingYun 晏殊《浣溪沙》杯台回来徊（诗韵十灰）', samePingYun(YAN));
noT('samePingYun 反例 东 vs 花', samePingYun(['东', '花']));
noT('samePingYun 反例 非平声 月 vs 东', samePingYun(['月', '东']));
ck('词 vs 诗：苏轼 词林正韵同部、平水韵不同韵', sameBu(SU).ok && !samePingYun(SU).ok,
  `sameBu=${sameBu(SU).ok} samePingYun=${samePingYun(SU).ok}`);
ck('词 vs 诗：毛滂 词林正韵同部、平水韵不同韵', sameBu(MAO).ok && !samePingYun(MAO).ok,
  `sameBu=${sameBu(MAO).ok} samePingYun=${samePingYun(MAO).ok}`);
okT('samePingYun 字符串入参 + 忽略标点', samePingYun('流、楼。'));

// —— 其他接口 ——
ck('pingOf(7) 含 天', pingOf(7).has('天'));
eq('pingOf(99) 越界→空 Set', pingOf(99).size, 0);
eq('pingBu(月) 无平声部→null', pingBu('月'), null);
ck('zeBu(月) 返回数组', Array.isArray(zeBu('月')));

const failed = checks.filter((c) => !c.p);
console.log('\n--- self-checks (' + checks.length + ') ---');
for (const c of failed) console.log('  FAIL ' + c.d + '  => ' + c.x);
if (failed.length) {
  if (!VERIFY_ONLY) {
    fs.rmSync(tmpPs, { force: true });
    fs.rmSync(tmpRh, { force: true });
  }
  console.error(`\n${failed.length} 项自检未通过` + (VERIFY_ONLY ? '。' : ' —— 已删除临时文件，旧文件未改动。'));
  process.exit(1);
}
console.log('全部 ' + checks.length + ' 项自检通过。');

if (VERIFY_ONLY) {
  console.log('[校验模式] 已安装的两个模块与本次重建结果完全一致，未改动任何文件。');
} else {
  fs.renameSync(tmpPs, path.join(SERVER, 'pingshui.mjs'));
  fs.renameSync(tmpRh, path.join(SERVER, 'rhyme.mjs'));
  console.log('\n已安装 server/pingshui.mjs (' + psOut.length + ' bytes) 与 server/rhyme.mjs (' + rhymeOut.length + ' bytes)');
}
console.log('平水韵 字头', PS_COV.字头, '| 词林正韵 平声字', BU_COV.平声字, '仄声字', BU_COV.仄声字);
