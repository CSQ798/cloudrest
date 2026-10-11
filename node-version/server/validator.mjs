// 云卷云舒 · 格律校验
// 校验分两级：
//   硬伤（会退回重写）—— 句数、字数、分片、平仄谱失律太多
//   提示（只作说明）—— 个别字的平仄出入
//
// 韵书用**静态 import**，不用 await import()。
// 这是踩过一次的坑，写在这里免得后人改回去：
//   动态 import() 会让 esbuild 把整张模块图改成惰性初始化，产出
//       var init_tunes = __esm({ "../server/tunes.mjs"() { await init_xxx(); ... } });
//   而 __esm 的包装函数是**同步**的，里面却出现了 await ——
//   workerd 一解析就报
//       Uncaught SyntaxError: Unexpected reserved word
//   Pages 那边直接「Deployment failed! Failed to publish your Function」，
//   Workers 那边同样会中招，只是失败在运行时而不是部署时，更难发现。
//   韵书是随包发布的固定数据，本来也不需要在运行时试探它在不在。
//   .test/bundle-safety-test.mjs 守住这条规矩。

import { getTune, splitStanzas } from './tunes.mjs';
import { shiPatterns, getShi, parallelCouplets } from './shi.mjs';
import { checkScript } from './script.mjs';
import * as rhymeMod from './rhyme.mjs';
import * as pingMod from './pingshui.mjs';

// 「韵书就绪」按**数据非空**判断，而不是按模块 import 得进 import 不进。
// 这样即使某份韵书被换成空表，行为仍与从前一致：跳过押韵一致性检查并如实标注。
export const hasRhymeBook = Array.isArray(rhymeMod.BU) && rhymeMod.BU.length > 0;
export const hasPingShui = Array.isArray(pingMod.YUNMU) && pingMod.YUNMU.length > 0;

/** 取出诗句里的汉字（去掉标点空白） */
export function hanzi(line) {
  return [...String(line)].filter((c) => /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/.test(c)).join('');
}

/**
 * 一行是不是「平仄谱」——只由 平/仄/中/韵/句/叶 等谱面记号构成。
 * 模型有时会把词谱的平仄连同正文一起写进 <body>，这类行必须整行剔掉，
 * 否则会被当成诗句，句数直接翻倍。
 */
export function isPatternLine(line) {
  const s = String(line).replace(/[\s，。、；：！？·、（）()【】\[\]]/g, '');
  if (!s) return false;
  return /^[平仄中]+$/.test(s) || /^[平仄中韵句叶读豆换]+$/.test(s);
}

/**
 * 按固定的句式把正文重新切行（近体诗用）。
 * 模型偶有把两句并成一行、或末句少字的情况。句式是确定的，切行就是机械的事：
 *   过长 → 按应有字数切开；恰好可并 → 合并；都不行 → 原样返回（会被判错）。
 */
export function renormByLens(bodyLines, lens) {
  if (!Array.isArray(lens) || !lens.length) return null;
  const flat = bodyLines.map(hanzi).filter(Boolean).join('');
  if (!flat) return null;

  // 先试「直接切」：总字数正好等于句式总和
  const need = lens.reduce((a, b) => a + b, 0);
  if (flat.length === need) {
    const lines = [];
    let pos = 0;
    for (const n of lens) {
      lines.push(flat.slice(pos, pos + n));
      pos += n;
    }
    return { lines, exact: true };
  }

  // 再试「先合并再切」：逐行推进，优先恰好填满当前句
  const out = [];
  let cur = '';
  let i = 0;
  for (const line of bodyLines.map(hanzi).filter(Boolean)) {
    cur += line;
    while (cur.length >= (lens[i] ?? 0) && i < lens.length) {
      out.push(cur.slice(0, lens[i]));
      cur = cur.slice(lens[i]);
      i++;
    }
  }
  if (cur && i < lens.length) out.push(cur);
  const exact = out.length === lens.length && out.every((l, k) => l.length === lens[k]);
  return { lines: out, exact };
}

/**
 * 一行像是「提示词泄漏」或说明文字（而非诗句）。
 * 模型偶尔会把提示词原文、或者自己的说明抄进 <body>，例如
 * 「里**只许写字**绝不可把上面给你的平仄谱平平仄仄之类」。
 * 这类行必须整行丢掉并触发重写，否则会当成诗句渲染出来。
 */
// 只收「诗句里绝不可能出现」的说明性用语；像「请」「可以」「要求」「说明」这类
// 单看也像人话的词不收，免得误杀真句子。
const LEAK_MARKERS = [
  '只许写字', '绝不可', '不可把', '平仄谱', '输出格式', '一句一行', '真正的诗', '抄的',
  '约束', '记号', '骨架', '标签', '正文', '应当', '必须', '切勿', '切记', '如下',
  '遵循', '符合', '格式', '题面', '提示词', '以上', '下面给',
];

export function isLeakedProse(line) {
  const s = String(line).replace(/[\s*＊`#【】\[\]]/g, '');
  if (!s) return false;
  // 诗句不会有这么长
  if ([...s].length > 12) return true;
  return LEAK_MARKERS.some((m) => s.includes(m));
}

/**
 * 从一行里剥掉尾部紧跟的平仄注记。
 * 模型有时写「雨脚斜侵夜半车　中仄平平仄仄平」这种「正文 + 空格 + 谱」的格式，
 * 若行尾确实是一串 平仄中，且剥掉后仍有正文，就去掉谱。
 */
export function stripTrailingPattern(line) {
  const s = String(line).trim();
  const m = s.match(/^(.*?)[\s　]{1,}([平仄中]{3,})$/);
  if (m && /[\u4e00-\u9fff]/.test(m[1])) {
    const tail = m[2];
    // 只有当尾部那串明显不像诗句（含「中」，或整串都是平仄且长度≥4）时才剥
    if (/[中]/.test(tail) || [...tail].length >= 4) return m[1];
  }
  return s;
}

function toneOf(ch) {
  if (hasPingShui && pingMod.toneOf) {
    const t = pingMod.toneOf(ch);
    return t === '平' || t === '仄' ? t : null; // 「多」「未知」都返回 null，不予苛责
  }
  return null;
}

/** 单句对谱：返回 { ok, mismatches: [{index, got, want}] } */
function matchTones(line, pattern) {
  const chars = [...hanzi(line)];
  const mismatches = [];
  for (let i = 0; i < pattern.length; i++) {
    const want = pattern[i];
    if (want === '中') continue;
    const ch = chars[i];
    if (!ch) continue;
    const got = toneOf(ch);
    if (got && got !== want) mismatches.push({ index: i, char: ch, got, want });
  }
  return { mismatches, chars };
}

function rhymeReport(chars) {
  if (!chars.length) return null;
  if (hasRhymeBook && rhymeMod.sameBu) {
    const r = rhymeMod.sameBu(chars);
    return { ok: r.ok, detail: r.detail };
  }
  return null;
}

/**
 * 划韵组。
 * 韵组结构已由「钦谱例词 + 韵书」实测固化在 tunes.mjs 的 rhymePlan 里：
 *   绝大多数词牌一片一组（如《浣溪沙》[3],[2] 表示上片三个韵脚互押、下片两个互押）；
 *   换韵词牌一片多组（如《菩萨蛮》[2,2],[2,2]）。
 * 这里只按规模把每片的韵位切开，逐组校验，既不会把该互押的拆开，也不会让异组互相掩护。
 */
function rhymeGroupsOf(tune, lines) {
  const groups = [];
  let cursor = 0;
  tune.stanzas.forEach((stanzaLen, si) => {
    const idxs = [];
    for (let i = cursor; i < cursor + stanzaLen; i++) if (tune.rhymes[i]) idxs.push(i);
    cursor += stanzaLen;
    if (!idxs.length) return;

    const sizes = tune.rhymePlan && tune.rhymePlan[si] ? tune.rhymePlan[si] : [idxs.length];
    const sum = sizes.reduce((a, b) => a + b, 0);
    // 若规模之和与韵位数不符，退化为「整片一组」，宁可宽也不误判
    if (sum !== idxs.length) {
      groups.push(idxs);
      return;
    }
    let k = 0;
    for (const size of sizes) {
      groups.push(idxs.slice(k, k + size));
      k += size;
    }
  });
  return groups;
}

/**
 * 校验一首词。
 * @returns {{ level:'ok'|'warn'|'error', issues:Array<{severity,text}>, stats:object }}
 */
export function checkCi(tuneName, bodyLines) {
  const tune = getTune(tuneName);
  const issues = [];
  if (!tune) {
    return { level: 'warn', issues: [{ severity: 'warn', text: `词牌《${tuneName}》暂不在已核验之列，只能按字数粗看。` }], stats: {} };
  }

  const lines = bodyLines.map(hanzi);

  // 语言先查，且不跟着「句数不对」一起早退：
  // 句数错了固然要重写，但若同时还有繁体字或白话，一次把话说全，
  // 免得改完句数又因为繁体再退一次，白花一轮调用。
  issues.push(...languageIssues(lines));

  if (lines.length !== tune.lens.length) {
    issues.push({
      severity: 'error',
      text: `《${tuneName}》共 ${tune.lens.length} 句，此稿 ${lines.length} 句。`,
    });
    return { level: 'error', issues, stats: {} };
  }

  let totalBad = 0;
  let toneTolerance = 0;

  lines.forEach((l, i) => {
    const want = tune.lens[i];
    if (l.length !== want) {
      issues.push({ severity: 'error', text: `第 ${i + 1} 句应 ${want} 字，实为 ${l.length} 字：「${l}」` });
      totalBad++;
      return;
    }
    const { mismatches } = matchTones(l, tune.tones[i]);
    if (mismatches.length) {
      toneTolerance += mismatches.length;
      const detail = mismatches
        .map((m) => `第 ${m.index + 1} 字「${m.char}」宜${m.want}而实${m.got}`)
        .join('、');
      issues.push({ severity: 'warn', text: `第 ${i + 1} 句平仄：${detail}` });
    }
  });

  // 押韵：同组内的韵脚须同韵（换韵词牌逐组校验）
  const byGroup = rhymeGroupsOf(tune, lines);
  for (const g of byGroup) {
    const chars = g.map((i) => (lines[i] ? lines[i].slice(-1) : '')).filter(Boolean);
    if (chars.length < 2) continue;
    // 组内可能有韵书未收的生僻字，逐个与「同组其余字」比对，避免一颗老鼠屎坏一锅汤
    const bad = [];
    for (const c of chars) {
      const others = chars.filter((x) => x !== c);
      if (!others.length) continue;
      const rep = rhymeReport([c, others[0]]);
      if (rep && !rep.ok) {
        // 与组内多数比对一次，确认确实不合
        const rep2 = rhymeReport([c, ...others.slice(0, 3)]);
        if (rep2 && !rep2.ok) bad.push(c);
      }
    }
    if (bad.length) {
      // 押韵按「提示」而不按「必改」：
      // 句式、字数、平仄谱都来自词谱正文，可严格判定；
      // 而韵位对少数「换韵且原文未另起一行」的词牌（如《相见欢》《虞美人》《定风波》）
      // 是从词谱批注推来的，容错余地大，故不想用它把一首好诗硬判为不合格。
      issues.push({
        severity: 'warn',
        text: `韵脚「${chars.join('、')}」中，「${bad.join('、')}」与同组其余韵脚不同韵（宜同属《词林正韵》一部）。`,
      });
    }
  }

  // 分片：句数多于一片时，正文里应有相应的分段
  // level 由 issues 的 severity 推出（不是只看字数）：
  // 繁体字这类硬伤也是 severity error，若只按 totalBad 算，
  // 会出现「level=warn 却带着一条必改」的自相矛盾。
  const levels = issues.some((i) => i.severity === 'error') ? 'error' : issues.length ? 'warn' : 'ok';
  return {
    level: levels,
    issues,
    stats: { 句数: lines.length, 字数: lines.reduce((a, b) => a + b.length, 0), 平仄出入: toneTolerance },
    known: true,
  };
}

/** 校验一首近体诗（绝句/律诗），会逐一试四种正格，取最接近者 */
export function checkShi(formName, bodyLines) {
  const spec = getShi(formName);
  const issues = [];
  if (!spec) return { level: 'warn', issues: [{ severity: 'warn', text: '未知诗体' }], stats: {} };

  const lines = bodyLines.map(hanzi);

  // 语言先查，且不跟着「句数/字数不对」一起早退（理由同 checkCi）
  issues.push(...languageIssues(lines));

  if (lines.length !== spec.couplets * 2) {
    issues.push({ severity: 'error', text: `${formName}应 ${spec.couplets * 2} 句，此稿 ${lines.length} 句。` });
    return { level: 'error', issues, stats: {} };
  }

  let bad = 0;
  lines.forEach((l, i) => {
    if (l.length !== spec.size) {
      issues.push({ severity: 'error', text: `第 ${i + 1} 句应 ${spec.size} 字，实为 ${l.length} 字：「${l}」` });
      bad++;
    }
  });
  if (bad) return { level: 'error', issues, stats: {} };

  // 选最贴合的平仄正格
  const pats = shiPatterns(formName);
  let best = null;
  for (const p of pats) {
    let score = 0;
    const detail = [];
    p.lines.forEach((pat, i) => {
      const { mismatches } = matchTones(lines[i], pat);
      score += mismatches.length;
      if (mismatches.length) detail.push({ i, mismatches });
    });
    if (!best || score < best.score) best = { p, score, detail };
  }

  // 押韵：同一正格下，韵脚句须同韵（平水韵）
  const rhymeIdx = best.p.rhyme.map((x, i) => (x ? i : -1)).filter((i) => i >= 0);
  const rhymeChars = rhymeIdx.map((i) => lines[i].slice(-1));
  let rhymeOk = true;
  if (hasPingShui && pingMod.samePingYun) {
    const r = pingMod.samePingYun(rhymeChars);
    rhymeOk = r.ok;
    if (!r.ok) {
      // 近体诗的押韵可严格判定（偶句必押平声、同属平水韵一目），故按必改处理
      issues.push({ severity: 'error', text: `韵脚「${rhymeChars.join('、')}」不同韵：${r.detail}` });
      bad++;
    }
  }

  if (best.score) {
    for (const d of best.detail) {
      issues.push({
        severity: 'warn',
        text: `第 ${d.i + 1} 句平仄：` + d.mismatches.map((m) => `第 ${m.index + 1} 字「${m.char}」宜${m.want}而实${m.got}`).join('、'),
      });
    }
  }

  // 律诗中间两联须对仗。
  // 「是否工对」需要词性知识，无法机械判定；但工对必然要求「字面对称而不重复」，
  // 所以这里抓可判定的硬伤：对应位置的实词重复、两句同字收尾。
  for (const c of parallelCouplets(formName)) {
    const a = lines[c * 2];
    const b = lines[c * 2 + 1];
    if (!a || !b) continue;
    const problems = parallelProblems(a, b);
    if (problems.length) {
      issues.push({
        severity: 'warn',
        text: `第 ${c + 1} 联（「${a}」/「${b}」）对仗有碍：${problems.join('；')}。律诗此联须工对，对应处不可用同一字或同一词。`,
      });
    }
  }

  return {
    // 与 checkCi 同一口径：level 由 issues 的 severity 推出，不另算
    level: issues.some((i) => i.severity === 'error') ? 'error' : issues.length ? 'warn' : 'ok',
    issues,
    stats: { 正格: best.p.first, 平仄出入: best.score, 韵脚: rhymeChars.join('、'), 押韵: rhymeOk ? '合' : '不合' },
    known: true,
  };
}

/**
 * 对仗硬伤检查（可判定的部分）：
 *  1. 两句同字收尾——律诗一联之中绝不许同字相对；
 *  2. 对应位置的实词重复——工对要求「虚实相对而不相犯」，
 *     同一字或同一双字词出现在对应位置即是对仗之病。
 * 「词性是否相对」无法机械判定，故此函数只报这两类能确证的硬伤，不猜内容。
 */
function parallelProblems(a, b) {
  const out = [];
  const A = [...a];
  const B = [...b];
  if (A.length !== B.length) return ['两句字数不等，不成对仗'];
  if (A[A.length - 1] === B[B.length - 1]) out.push(`两句同以「${A[A.length - 1]}」收尾`);

  // 逐位比较：同一位置出现同一个字
  const samePos = [];
  for (let i = 0; i < A.length; i++) if (A[i] === B[i] && FUNCTION_WORDS.has(A[i])) samePos.push(i);
  // 虚词同位重复在古人也偶有，不报；只报实词
  const contentSame = [];
  for (let i = 0; i < A.length; i++) if (A[i] === B[i] && !FUNCTION_WORDS.has(A[i])) contentSame.push(`第 ${i + 1} 字「${A[i]}」`);
  if (contentSame.length) out.push(`对应位置重复：${contentSame.join('、')}`);

  // 同一双字词在对应位置出现
  for (let i = 0; i + 1 < A.length; i++) {
    if (A[i] === B[i] && A[i + 1] === B[i + 1] && !FUNCTION_WORDS.has(A[i])) {
      out.push(`第 ${i + 1}、${i + 2} 字重复「${A[i]}${A[i + 1]}」`);
      break;
    }
  }
  return out;
}

/** 古人常用的虚词，同位重复不算病 */
const FUNCTION_WORDS = new Set([...'之其而以于与共独犹尚未莫何谁尔又亦皆尽更复只惟乃遂即使令被所为']);

/* ============================================================
 * 语言检查：不许大白话与现代语汇
 * 词表与 server/prompt.mjs 的准则同源，改准则时这里要同步。
 *
 * 注意：单字词极容易误伤古人（「又是韶光过了」「人间万事何时了」都是真诗），
 * 所以单字一律用「现代搭配」的形式列出，不裸列单字。
 * 本表的误报由 .research/test-language.mjs 守住：21 首钦谱例词 + 四首名作必须零误报。
 * ============================================================ */
const MODERN_WORDS = [
  // 现代生活
  '手机', '电话', '电脑', '电视', '微信', '网络', '视频', '直播', '外卖', '快递', '地铁', '公交', '高铁', '飞机',
  '出租', '司机', '超市', '商场', '医院', '护士', '医生', '病房', '输液', '电梯', '空调', '冰箱', '公司', '单位',
  '老板', '同事', '加班', '上班', '下班', '周末', '假期', '考试', '成绩', '大学', '同学', '老师', '学生', '门票',
  '工资', '房价', '房间', '客厅', '卧室', '阳台', '马路', '城市', '小区', '物业', '警察', '新闻', '节目', '游戏',
  // 现代时间与抽象
  '时间', '时候', '片刻', '瞬间', '岁月', '青春', '人生', '生活', '世界', '时代', '社会', '国家', '未来', '过去',
  // 现代情绪
  '心情', '感觉', '感受', '情绪', '压力', '疲惫', '孤独', '回忆', '思念', '开心', '快乐', '难过',
  '幸福', '痛苦', '烦恼', '焦虑', '抑郁', '紧张', '兴奋', '失落', '无奈', '遗憾', '希望', '梦想', '理想', '爱情',
  // 现代抽象
  '存在', '状态', '方式', '问题', '结果', '意义', '空气', '氛围', '距离', '关系', '情况', '内容', '形式', '过程',
  // 现代器物（古代没有的东西，入旧体诗即为破体）
  '汽车', '火车', '轮船', '飞机', '电视', '电影', '电话', '手机', '电脑', '相机', '照片', '网络', '电灯', '电线',
  '视频', '广播', '录音', '塑料', '玻璃', '水泥', '钢铁', '汽油', '机器', '工厂', '空调', '暖气', '煤气',
  // 白话虚词与口语（多字）
  '吗', '呢', '吧', '哦', '嗯', '很', '挺', '非常', '特别', '已经', '正在', '一直',
  '还是', '但是', '因为', '所以', '如果', '虽然', '然后', '而且', '什么', '怎么', '为什么', '这个', '那个',
  '我们', '你们', '他们', '自己', '东西', '事情', '地方', '一点', '一下', '一起', '一样',
];

export function checkModern(line) {
  const hits = new Set();
  for (const w of MODERN_WORDS) if (line.includes(w)) hits.add(w);
  // 「的」作结构助词（古人「的」多作箭靶或「的确」，现代助词用法是白话）
  if (/的[一-龥]/.test(line) && !/目的|的的|中的|是的|端的/.test(line)) hits.add('的（似白话助词）');
  // 说明：「了」不判。宋词「人间万事何时了」「又是韶光过了」皆古人常用，
  // 单字无从与白话区分，宁可漏判也不用它误伤真诗。已在准则里明确禁用。
  return [...hits];
}

/**
 * 语言层面的整篇检查，三种体裁共用。返回待 push 进 issues 的条目。
 *
 * 分两档，是有意的：
 *   白话/现代语汇 → warn。这一档靠词表判定，词表必有边界，
 *                   误判真诗（「人间万事何时了」）比漏判更伤，所以只提示。
 *   繁体字       → error。这一档是**精确**判定：表里的字在简体里不是规范写法，
 *                   命中即为破绽；而一篇里繁简混用，读起来比平仄不合更刺眼。
 *                   判成必改，才会真正退回重写。
 */
function languageIssues(lines) {
  const out = [];

  const modernHits = new Set();
  lines.forEach((l, i) => {
    for (const w of checkModern(l)) modernHits.add(`${w}（第 ${i + 1} 句）`);
  });
  if (modernHits.size) {
    out.push({
      severity: 'warn',
      text: `出现现代语汇或白话：${[...modernHits].join('、')}。旧体诗词不得用此类词。`,
    });
  }

  const scriptHits = new Set();
  lines.forEach((l, i) => {
    for (const w of checkScript(l)) scriptHits.add(`${w}（第 ${i + 1} 句）`);
  });
  if (scriptHits.size) {
    out.push({
      severity: 'error',
      text:
        `出现繁体字：${[...scriptHits].join('、')}。` +
        `全篇一律用简体字，繁简混用是一眼可见的破绽。请把这些字换成简体后重写这一稿。`,
    });
  }

  return out;
}

/**
 * 按已声明的句式把正文重新切行。
 * 长调最常见的失败不是写错字，而是模型把两句并成一行（19 句写成 8 句）。
 * 既然句式已经声明，切行就是纯机械的事：把这些行首尾相接，再按句式重新切开。
 * 返回 { lines, exact }：exact 表示切完后每句字数都与句式完全吻合。
 */
export function renormByMeter(bodyLines, declared) {
  const meter = String(declared || '')
    .split(/\n\s*\n|\|/)
    .map((s) => s.split(/[^0-9]+/).map(Number).filter((n) => n > 0))
    .flat()
    .filter((n) => n > 0);
  if (!meter.length) return null;

  // 保留模型自己的分片位置（空行），只在每片内部重新切句
  const stanzas = String(bodyLines.join('\n'))
    .split(/\n\s*\n/)
    .map((s) => s.split('\n').map(hanzi).filter(Boolean));

  const flat = stanzas.flat().join('');
  if (!flat) return null;

  const lines = [];
  let pos = 0;
  for (const n of meter) {
    lines.push(flat.slice(pos, pos + n));
    pos += n;
  }
  // 句式之后还有多余的字，说明多写了，接在最后一句上以便被检出
  if (pos < flat.length) lines[lines.length - 1] += flat.slice(pos);

  const exact = lines.length === meter.length && lines.every((l, i) => l.length === meter[i]);
  return { lines, exact, meter };
}

export function check(form, bodyLines) {
  if (getTune(form)) return checkCi(form, bodyLines);
  if (getShi(form)) return checkShi(form, bodyLines);
  return checkDeclared(form, bodyLines, null);
}

/**
 * 未核验体裁：让模型自己先声明句式，再核对正文与它自述是否一致。
 * 这样「自填词牌」也可校验——不是校验它合不合那个词牌（我没有该词牌的词谱），
 * 而是校验它有没有做到自己说的句式，并把「未核验」如实告诉用户。
 * @param {string} form 体裁名
 * @param {string[]} bodyLines 正文
 * @param {string|null} declared 模型自述的句式，如 "5/5/7/5" 或 "5,5,7,5"
 */
export function checkDeclared(form, bodyLines, declared) {
  const issues = [];
  // 只留有字的行（空行是分片标记，不是句子）
  const raw = bodyLines.map((l) => String(l)).filter((l) => hanzi(l).length);
  const lines = raw.map(hanzi);

  // 语言检查与已核验体裁同一套
  issues.push(...languageIssues(lines));

  if (lines.length < 4) {
    issues.push({ severity: 'error', text: `全篇只有 ${lines.length} 句，太少，不成一首。` });
    return { level: 'error', issues, stats: { 句数: lines.length, 未核验: true }, known: false };
  }

  const lens = lines.map((l) => l.length);
  if (lens.some((n) => n < 2 || n > 11)) {
    issues.push({
      severity: 'error',
      text: `有句子字数不合常理：${lens.join('/')}。词句一般在 2 到 11 字之间。`,
    });
  }

  if (declared) {
    // 声明可以是「不分片的一个句式」，也可以是「分片的多段句式」（段间用 | 或空行分开）
    const declaredStanzas = String(declared)
      .split(/\n\s*\n|\|/)
      .map((s) => s.split(/[^0-9]+/).map(Number).filter((n) => n > 0))
      .filter((a) => a.length);
    const wantFlat = declaredStanzas.flat();

    // 正文按字数切句（不依赖模型给的分片标记，标记位置可能不准）
    const gotFlat = lines.map((l) => l.length);
    if (wantFlat.length && wantFlat.length !== gotFlat.length) {
      issues.push({
        severity: 'error',
        text: `你自述《${form}》为 ${wantFlat.length} 句（${wantFlat.join('/')}），正文却是 ${gotFlat.length} 句（${gotFlat.join('/')}）。二者须一致。`,
      });
    } else if (wantFlat.length && wantFlat.some((n, i) => n !== gotFlat[i])) {
      const badIdx = wantFlat.map((n, i) => (n === gotFlat[i] ? -1 : i + 1)).filter((i) => i > 0);
      issues.push({
        severity: 'error',
        text:
          `你自述《${form}》句式 ${wantFlat.join('/')}，正文实际 ${gotFlat.join('/')}；` +
          `第 ${badIdx.join('、')} 句字数不符。请照你自述的句式改这些句子。`,
      });
    }

    // 分片标记位置：错了要提示，因为它直接影响词的分片形制
    if (declaredStanzas.length > 1) {
      const gotStanzas = raw
        .join('\n')
        .split(/\n\s*\n/)
        .map((s) => s.split('\n').map((l) => hanzi(l)).filter(Boolean).length)
        .filter((n) => n > 0);
      const wantStanzas = declaredStanzas.map((a) => a.length);
      if (JSON.stringify(gotStanzas) !== JSON.stringify(wantStanzas)) {
        issues.push({
          severity: 'warn',
          text: `你声明的分片是 ${wantStanzas.join('+')} 句，正文的分片标记却切成了 ${gotStanzas.join('+')} 句。分片标记（空行）要放在片与片之间。`,
        });
      }
    }
  }

  return {
    level: issues.some((i) => i.severity === 'error') ? 'error' : issues.length ? 'warn' : 'warn',
    issues,
    stats: { 句数: lens.length, 句式: lens.join('/'), 未核验: true },
    known: false,
  };
}

/** 把校验结果整理成给模型看的整改意见 */
export function toFeedback(result) {
  const errs = result.issues.filter((i) => i.severity === 'error').map((i) => i.text);
  const warns = result.issues.filter((i) => i.severity === 'warn').map((i) => i.text);
  const lines = [];
  if (errs.length) {
    lines.push('【必改】');
    for (const e of errs) lines.push('- ' + e);
    // 句式不符是最常见的失败，往往因为把两句并成了一行
    if (errs.some((e) => /句|字|不符|一致/.test(e))) {
      lines.push('- 特别注意：一句必须写成一行，切不可把两句并进同一行，也不可一句拆成两行。');
      lines.push('- 请先按上面的句式把每一行的字数数准（一行一行数），再填字面。');
    }
  }
  if (result.patternLeak) {
    lines.push('【必改】<body> 里混进了平仄谱。正文只许写字：不要写平平仄仄，不要写 ○ ◆，不要写「韵」。');
  }
  if (warns.length) {
    lines.push('【宜改】');
    for (const w of warns) lines.push('- ' + w);
    // 平仄是逐字的事，只换那几个字最有效；一味重写全篇会把已经对的地方又改坏。
    const toneOnly = !errs.length && warns.every((w) => /平仄/.test(w));
    if (toneOnly) {
      lines.push('- 上面这些是逐字的事：只把点到的字换掉，别的字一个都不要动。');
      lines.push('- 谱里的「中」表示可平可仄，那些位置不必管，别为它们改字。');
      lines.push('- 换字之后整句仍须读得通、说的事不变；宁可选一个平实的字，不要为合律硬造词。');
    }
  }
  return lines.join('\n');
}

export const __debug = { rhymeGroupsOf, matchTones, hanzi, hasRhymeBook, hasPingShui };
