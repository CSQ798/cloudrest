// 云卷云舒 · 诗词的**排版**
//
// 为什么排版要放在服务端，而不是前端自己拼：
//   诗词的换行位置不是随意的 —— 它由词牌的**句读**决定。而句读只有服务端知道
//   （server/tunes.mjs 里每个词牌都带 lens 与 MARKS）。前端手里只有体裁名字，
//   让它去猜换行，只能猜错。所以这里算好，随结果一起发给前端与纸笺。
//
// 三条规矩（站长定的）：
//   一、诗：每两句一行 —— 一句一行排版很难看。
//   二、词：不逐句换行，按「句」连排成行，句间加标点，上下阕用空行隔开。
//   三、标题：词作「词牌·题」，如「清平乐·六盘山」；诗只用题，不另标诗体。
//
// 一个踩过的坑（2024 年这版修掉的）：
//   标点**不能按韵位**来定。早先的写法是「凡押韵的小句后面加句号」，
//   于是《定风波》这种十一个小句处处押韵的词牌，就变成每句后面一个句号 ——
//   站长一眼就看出来了。押韵说的是「声音落在哪里」，标点说的是「语意在哪里收住」，
//   两件事。现在每个词牌的句读标点由 tunes.mjs 的 MARKS 给出（从搜韵历代作品统计而来），
//   这里只负责：哪几个小句合起来算一句、一行排几个字。
//
// 另一个容易搞混的地方：**校律仍然是一句一行**。
//   模型照旧把每一个小句写成一行（那是它填平仄谱的方式），校律器也照旧逐句比对；
//   这里做的只是「把已经校完的句子重新排成给人看的版式」。
//   两件事分开，才不会为了好看而破坏格律判定。

import { getTune, getMarks } from './tunes.mjs';
import { getShi } from './shi.mjs';

const CJK = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;

/** 这句的最后一个汉字（用来判断结尾语气） */
function lastHanzi(line) {
  const chars = [...String(line)].filter((c) => CJK.test(c));
  return chars.length ? chars[chars.length - 1] : '';
}

// 「问号」只做一件事：本来该是句号的地方，如果读起来明显是在发问，就换成问号。
//   两条都不肯放过的误判，所以只认真正表疑问的字：
//   一、收尾字本身只能表疑问（「何」「谁」…）。「处」「许」太常见（「销魂处」不是问句），
//       得前面跟着「何/谁/几/安/焉」才算（「春归何处」「试问闲愁都几许」）。
//   二、句子里出现「谁」「何事」「几时」这类，唱到底也是问句（「云中谁寄锦书来」）。
const ASK_TAIL = /[谁何几耶否乎]$/;
const ASK_TAIL_SOFT = /(?:何|谁|几|安|焉)(?:处|许|所)$/;
const ASK_IN = /谁|何事|何处|何日|何年|何时|几何|几多|几时|奈何|安得/;

/** 给一个小句配标点：base 是词谱给的句读标点，只在句末才可能升成问号 */
function endMark(line, base) {
  const b = base || '，';
  if (b !== '。') return b;
  const t = String(line == null ? '' : line).trim();
  if (ASK_TAIL.test(t) || ASK_TAIL_SOFT.test(t) || ASK_IN.test(t)) return '？';
  return '。';
}

/** 一行最多排几个字（含标点）。纸笺宽 960、正文 27px、左右各留 108 —— 27 字也放得下，
 *  但一行太长读着累，20 字左右最舒服。 */
export const LINE_MAX = 20;

/**
 * 把「一句一行」的正文排成展示用的行数组。
 *
 * @param {string} form 体裁名
 * @param {string[]} bodyLines 一句一行的正文（可含空字符串作分片标记）
 * @returns {string[]} 展示行；'' 表示分段（上下阕之间）
 */
export function layoutPoem(form, bodyLines) {
  const raw = (Array.isArray(bodyLines) ? bodyLines : []).map((l) => String(l == null ? '' : l));
  // 只留真正有字的句子。空行原本是模型标的分片，但它**不可靠**：
  // cleanBody 会把空行过滤掉，模型自己也常常忘。所以下面优先按词谱的
  // stanzas（每阕几句）来重建分片，空行只作退路。
  const flat = raw.map((l) => l.trim()).filter(Boolean);
  if (!flat.length) return [];

  const tune = getTune(form);
  const stanzas = splitIntoStanzas(tune, flat, raw);
  const marks = tune ? getMarks(tune.name) : null;

  const out =
    marks && marks.length === flat.length ? layoutCi(stanzas, marks) : layoutShi(stanzas);
  // 收尾把多余的空段去掉
  return out.filter((l, i, arr) => !(l === '' && (i === 0 || i === arr.length - 1)));
}

/** 按词谱的「每阕几句」把正文切片；对不上就退回按空行切，再不行算一整片 */
function splitIntoStanzas(tune, flat, raw) {
  const perStanza = tune && Array.isArray(tune.stanzas) ? tune.stanzas : null;
  const stanzas = [];
  if (perStanza && perStanza.reduce((a, b) => a + b, 0) === flat.length) {
    let i = 0;
    for (const n of perStanza) {
      stanzas.push(flat.slice(i, i + n));
      i += n;
    }
    return stanzas;
  }
  let cur = [];
  for (const l of raw) {
    if (!l.trim()) {
      if (cur.length) stanzas.push(cur);
      cur = [];
    } else {
      cur.push(l.trim());
    }
  }
  if (cur.length) stanzas.push(cur);
  return stanzas;
}

/**
 * 词：先按句读把连续的小句攒成「句」（句末的标点是。或？），
 * 再把若干「句」凑成一行 —— 一行的字数尽量整齐，且绝不把一句劈成两行。
 */
function layoutCi(stanzas, marks) {
  const out = [];
  let gi = 0;
  for (let s = 0; s < stanzas.length; s++) {
    if (s > 0) out.push('');
    const clauses = stanzas[s].map((text, k) => ({ text, mark: marks[gi + k] || '。' }));
    gi += stanzas[s].length;

    const sentences = [];
    let cur = [];
    for (const c of clauses) {
      cur.push(c);
      if (c.mark !== '，' && c.mark !== '、' && c.mark !== '') {
        sentences.push(cur); // 。？！ 都算一句的收尾
        cur = [];
      }
    }
    if (cur.length) sentences.push(cur);

    for (const line of packSentences(sentences)) out.push(line);
  }
  return out;
}

/** 诗（近体），以及「没有核验过词谱、自己声明句式」的体裁：两句一行。 */
function layoutShi(stanzas) {
  const out = [];
  for (let s = 0; s < stanzas.length; s++) {
    if (s > 0) out.push('');
    const st = stanzas[s];
    for (let i = 0; i < st.length; i += 2) {
      const group = st.slice(i, i + 2);
      out.push(group.map((line, k) => line + endMark(line, k === group.length - 1 ? '。' : '，')).join(''));
    }
  }
  return out;
}

/** 把若干「句」排成展示行：行数尽量少，每行不超过 LINE_MAX 字，且各行长短尽量匀 */
function packSentences(sentences) {
  // lines → 每行 → 每句 → 每个小句
  const render = (lines) =>
    lines.map((line) =>
      line
        .map((sent) => sent.map((c) => c.text + endMark(c.text, c.mark)).join(''))
        .join('')
    );
  const len = sentences.map((g) => g.reduce((n, c) => n + [...c.text].length + 1, 0));
  const n = len.length;
  if (n <= 1) return render([sentences]);

  for (let k = 1; k <= n; k++) {
    const cuts = bestCuts(len, k, LINE_MAX);
    if (!cuts) continue;
    const groups = [];
    let prev = 0;
    for (const c of cuts) {
      groups.push(sentences.slice(prev, c));
      prev = c;
    }
    groups.push(sentences.slice(prev));
    return render(groups);
  }
  // 某一句本身就超过 LINE_MAX（长调里常见）：那就一句一行
  return render(sentences.map((g) => [g]));
}

/**
 * 把长度为 len 的小段切成 k 组，每组之和 ≤ max，且各组尽量等长。
 * 返回 k-1 个切点（切在第 i 段之前）；无解返回 null。
 */
export function bestCuts(len, k, max) {
  const n = len.length;
  if (k < 1 || k > n) return null;
  const pre = [0];
  for (let i = 0; i < n; i++) pre.push(pre[i] + len[i]);
  const sum = (a, b) => pre[b] - pre[a];
  const mean = pre[n] / k;

  const cost = Array.from({ length: n + 1 }, () => new Array(k + 1).fill(Infinity));
  const from = Array.from({ length: n + 1 }, () => new Array(k + 1).fill(-1));
  cost[0][0] = 0;
  for (let i = 1; i <= n; i++) {
    for (let g = 1; g <= k; g++) {
      for (let j = g - 1; j < i; j++) {
        if (!Number.isFinite(cost[j][g - 1])) continue;
        const s = sum(j, i);
        if (s > max) continue;
        const c = cost[j][g - 1] + (s - mean) * (s - mean);
        if (c < cost[i][g]) {
          cost[i][g] = c;
          from[i][g] = j;
        }
      }
    }
  }
  if (!Number.isFinite(cost[n][k])) return null;
  const cuts = [];
  let i = n;
  let g = k;
  while (g > 1) {
    const j = from[i][g];
    if (j < 0) return null;
    cuts.unshift(j);
    i = j;
    g--;
  }
  return cuts;
}

/**
 * 标题。
 *   词 → 「词牌·题」（题若与词牌重名就只留词牌，避免「清平乐·清平乐」）
 *   诗 → 只用题；没有题就用体裁名兜底
 */
export function layoutTitle(form, rawTitle) {
  const t = String(rawTitle || '').trim().replace(/[《》]/g, '');
  const tune = getTune(form);
  if (tune) {
    if (!t) return form;
    return t === form || t.startsWith(form) ? t : `${form}·${t}`;
  }
  return t || form;
}

/** 纯文本版（「抄一份」用）：一行一句标点，片间空行 */
export function layoutPlain(form, bodyLines) {
  return layoutPoem(form, bodyLines).join('\n');
}

export const __debug = { endMark, lastHanzi, getShi };
