// 从搜韵缓存的词牌页里，统计每个词牌的句读标点，并与 tunes.mjs 的 MARKS 对账
//
// 为什么要这么做：
//   server/format.mjs 以前只按「押韵位置」断句，于是像《定风波》这种每句都押韵的
//   词牌，就变成每句后面一个句号 —— 那是错的。标点要按「句读」，而句读是每个词牌
//   自己的数据，得从真实作品里统计。
//
// 步骤：
//   1. 按 <div id='poem_…'> 把页面切成一首一首（搜韵自己的切分，最可靠）；
//   2. 把每首切成「小句」——「，。？！；」断句，「、」是句内的顿，也是一句；
//   3. 用词谱的 lens（每句字数）筛出结构吻合的作品；
//   4. 只统计「通行标点」那一类（至少有一个逗号），逐位投票取多数。
//
// 注意：搜韵库里同时存在两套标点风格 ——
//   甲、钦定词谱原样：凡是韵脚都用句号（「素藕抽条未放莲。晚蚕将茧不成眠。…」）
//   乙、通行（龙榆生）体：逗用「，」、句用「。」
// tunes.mjs 的 MARKS 要的是乙。可是有的词牌库里甲类占压倒多数（《渔家傲》57:1），
// 所以 MARKS 在甲类太多、或乙类之间互相打架时，按该词牌最著名例词的通行标点定稿。
// 这个脚本会把「MARKS 与统计多数不一致」的词牌全部列出来，方便复核。
//
// 用法：node extract-marks.mjs            全部词牌 + 对账
//       node extract-marks.mjs 定风波     只看一个
import fs from 'node:fs';
import { TUNES, MARKS, getMarks } from '../server/tunes.mjs';

const CJK = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;
const STOP = new Set(['，', '。', '？', '！', '；', '、']);

function sentences(p) {
  const out = [];
  const re = /<div class='poemSentence'[^>]*>([\s\S]*?)<div id='poem_sentence_[^']*_comment'/g;
  let m;
  while ((m = re.exec(p))) out.push(m[1].replace(/<[^>]+>/g, ''));
  return out.join('');
}
function clauses(t) {
  const out = [];
  let run = '';
  for (const ch of t) {
    if (CJK.test(ch)) { run += ch; continue; }
    if (STOP.has(ch)) { if (run) out.push({ text: run, mark: ch }); run = ''; continue; }
    run = '';
  }
  if (run) out.push({ text: run, mark: '' });
  return out;
}

function tally(name) {
  const tune = TUNES.find((t) => t.name === name);
  const file = new URL(`./html/${name}.html`, import.meta.url);
  if (!fs.existsSync(file)) return null;
  const html = fs.readFileSync(file, 'utf8');
  const region = html.slice(Math.max(0, html.indexOf('历代作品')));
  const ps = region.split(/<div id='poem_\d+' class='_poem'>/).slice(1).map(sentences);

  const hits = [];
  for (const t of ps) {
    const cs = clauses(t);
    if (cs.length !== tune.lens.length) continue;
    if (cs.some((c, i) => [...c.text].length !== tune.lens[i])) continue;
    hits.push(cs);
  }
  // 甲类（全篇一个逗号都没有）不参与投票
  const modern = hits.filter((cs) => cs.some((c) => c.mark === '，'));
  const pool = modern.length ? modern : hits;
  const votes = tune.lens.map(() => ({}));
  for (const cs of pool) {
    cs.forEach((c, i) => {
      if (!STOP.has(c.mark)) return;
      votes[i][c.mark] = (votes[i][c.mark] || 0) + 1;
    });
  }
  const marks = votes.map((v) => {
    let best = '';
    let n = 0;
    for (const [m, c] of Object.entries(v)) if (c > n) { best = m; n = c; }
    return { mark: best, n };
  });
  return { hits: hits.length, modern: modern.length, marks, sample: pool[0] };
}

const only = process.argv[2];
const names = only ? [only] : TUNES.map((t) => t.name);
const report = [];
let differ = 0;
for (const name of names) {
  console.log(`\n########## ${name} ##########`);
  const r = tally(name);
  if (!r) { console.log('  ✗ 没有缓存页面'); continue; }
  const mine = [...(MARKS[name] || '')];
  const stat = r.marks.map((m) => m.mark || '·').join('');
  const same = stat === mine.join('');
  if (!same) differ++;
  console.log(`  结构吻合 ${r.hits} 首｜其中通行标点 ${r.modern} 首`);
  console.log(`  统计多数 ${stat}`);
  console.log(`  MARKS    ${mine.join('')}   ${same ? '✓ 一致' : '← 人工定稿（见下方理由）'}`);
  if (!same) {
    const diffs = mine.map((m, i) => (m === stat[i] ? null : `#${i} 多数「${stat[i]}」→ 取「${m}」`)).filter(Boolean);
    console.log('    差异：' + diffs.join('；'));
  }
  if (r.sample) console.log('    例：' + r.sample.map((c) => c.text + c.mark).join(''));
  report.push({ name, hits: r.hits, modern: r.modern, stat, mine: mine.join(''), same });
}
fs.writeFileSync(new URL('./marks-report.json', import.meta.url), JSON.stringify(report, null, 2));
console.log(`\n${names.length} 个词牌里，有 ${differ} 个是人工定稿的（其余与统计多数一致）。`);
console.log('明细已写出 marks-report.json');
