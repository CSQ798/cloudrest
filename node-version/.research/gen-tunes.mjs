// 由 .research/parsed.json（extract.mjs 的产出）生成 qiyun/server/tunes.mjs
import fs from 'node:fs/promises';

function cnNum(s) {
  const map = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (s === '十') return 10;
  const m = s.match(/^([一二三四五六七八九])?十([一二三四五六七八九])?$/);
  if (m) return (m[1] ? map[m[1]] : 1) * 10 + (m[2] ? map[m[2]] : 0);
  let n = 0;
  for (const ch of s) n = n * 10 + (map[ch] || 0);
  return n;
}

const parsed = JSON.parse(await fs.readFile(new URL('./parsed.json', import.meta.url), 'utf8'));

// 通行正体字数。抽取器只能保证「例词与词谱自洽」，不能保证「取到的那个格就是正体」——
// 曾因此把《望海潮》取成《鹤冲天》、把《八声甘州》取成《双雁儿》（id 映射错误）。
// 所以这里再加一道独立核对：字数与通行正体不符者，一律不入表。
const CANON = {
  忆江南: [27], 如梦令: [33], 相见欢: [36], 生查子: [40], 点绛唇: [41],
  浣溪沙: [42], 卜算子: [44], 菩萨蛮: [44], 清平乐: [46], 西江月: [50],
  临江仙: [54, 58], 鹧鸪天: [55], 玉楼春: [56], 虞美人: [56], 鹊桥仙: [56],
  踏莎行: [58], 一剪梅: [60], 蝶恋花: [60], 定风波: [62], 渔家傲: [62],
  青玉案: [67], 水调歌头: [95], 念奴娇: [100], 满江红: [93], 沁园春: [114],
  雨霖铃: [103], 永遇乐: [104], 水龙吟: [102], 八声甘州: [97], 望海潮: [107], 扬州慢: [98],
};
const rejected = [];

function cnNum2(s) {
  return cnNum(s);
}

/**
 * 从声律说明里解析分片（每片句数）。
 * 常见写法：
 *   双调九十五字，前段九句四平韵，后段十句四平韵 → [9,10]
 *   双调四十四字，前后段各四句、两仄韵      → [4,4]
 *   双调六十字，前后段各五句、四仄韵        → [5,5]
 *   单调二十七字，五句三平韵                → [5]
 */
function stanzas(desc, count) {
  // 「前段N句…后段M句」
  const m = desc.match(/前(?:段|片)([一二三四五六七八九十]+)句[\s\S]*?后(?:段|片)([一二三四五六七八九十]+)句/);
  if (m) {
    const a = cnNum2(m[1]);
    const b = cnNum2(m[2]);
    if (a + b === count) return [a, b];
  }
  // 「前后段各N句」
  const m2 = desc.match(/前后(?:段|片)各([一二三四五六七八九十]+)句/);
  if (m2) {
    const a = cnNum2(m2[1]);
    if (a * 2 === count) return [a, a];
  }
  return [count];
}

/** 从声律说明里解析每片的韵组数（声律说明按片列出「N平韵」「M仄韵」等） */
function groupCountsOf(desc) {
  let parts = desc.split(/(?=前段|前片|后段|后片)/).filter((s) => /韵/.test(s));
  const counts = [];
  if (parts.length >= 2 && /前段|前片/.test(desc)) {
    for (const part of parts) {
      let n = 0;
      for (const m of part.matchAll(/([一二三四五六七八九十两]+)(平|仄|叶)韵/g)) n += m[1] === '两' ? 2 : cnNum(m[1]);
      if (n) counts.push(n);
    }
    if (counts.length >= 2) return counts;
  }
  // 「前后段各N句、M韵」这类：每片组数 = M（若前后各不同则分别列）
  let total = 0;
  for (const m of desc.matchAll(/([一二三四五六七八九十两]+)(平|仄|叶)韵/g)) total += m[1] === '两' ? 2 : cnNum(m[1]);
  return [total];
}

const entries = [];
for (const r of parsed) {
  if (r.error || !r.sentences) continue;
  const lens = r.sentences.map((s) => s.len);
  const tones = r.sentences.map((s) => s.tones);
  const sum = lens.reduce((a, b) => a + b, 0);
  // 独立核对：字数须与通行正体相符，否则视为取错了格，不入表
  const canon = CANON[r.name];
  if (canon && !canon.includes(sum)) {
    rejected.push(`${r.name}（表中 ${sum} 字，通行 ${canon.join('或')} 字）`);
    continue;
  }
  const rhymes = r.sentences.map((s) => (s.rhyme ? 1 : 0));
  // 韵组：换韵处（changed=true）另起一组。同一组内的韵脚必须同韵。
  const groups = [];
  let cur = [];
  let gid = -1;
  for (let i = 0; i < r.sentences.length; i++) {
    const s = r.sentences[i];
    if (!s.rhyme) continue;
    if (s.changed && cur.length) {
      groups.push(cur);
      cur = [];
    }
    if (!cur.length) gid++;
    cur.push({ i, text: s.text.slice(-1) });
  }
  if (cur.length) groups.push(cur);
  const rhymeChars = [...new Set(r.sentences.filter((s) => s.rhyme).map((s) => s.text.slice(-1)))];
  const stanzasArr = stanzas(r.desc, r.sentences.length);
  entries.push({
    name: r.name,
    desc: r.desc,
    author: r.author,
    total: r.sum,
    stanzas: stanzasArr,
    lens,
    tones,
    rhymes,
    rhymeChars,
    rhymeGroups: groups.map((g) => g.map((x) => x.i)),
    groupChars: groups.map((g) => g.map((x) => x.text)),
    groupCounts: groupCountsOf(r.desc),
  });
}

let out = `// 栖云 · 词牌格律表
// 数据来源：搜韵「钦定词谱」 https://www.sou-yun.cn/QueryCiTune.aspx
// 由 .research/extract.mjs 自动抽取，抽取时逐条硬校验：
//   1) 例词总字数 === 词谱声律说明里声明的字数
//   2) 每句平仄谱的长度 === 该句字数
//   3) 韵位顺序 === 声律说明里声明的韵数
//   4) 例词总字数 === 各句字数之和
// 「中」= 可平可仄。stanzas 为分片句数；rhymes[i] 为 1 表示第 i 句押韵。
// 原始页面与抽取脚本留档在 .research/，可复核。

export const TUNES = [
`;
for (const e of entries) {
  out += '  {\n';
  out += `    name: '${e.name}',\n`;
  out += `    desc: '${e.desc}',\n`;
  out += `    author: '${e.author}',\n`;
  out += `    total: ${e.total},\n`;
  out += `    stanzas: ${JSON.stringify(e.stanzas)},\n`;
  out += `    lens: ${JSON.stringify(e.lens)},\n`;
  out += `    tones: ${JSON.stringify(e.tones)},\n`;
  out += `    rhymes: ${JSON.stringify(e.rhymes)},\n`;
  out += `    rhymeChars: ${JSON.stringify(e.rhymeChars)},\n`;
  out += `    // 韵组：同组内各韵脚须同韵；不同组之间换韵\n`;
  out += `    rhymeGroups: ${JSON.stringify(e.rhymeGroups)},\n`;
  out += `    // 例词各韵脚字，供校对与推导平/仄韵\n`;
  out += `    groupChars: ${JSON.stringify(e.groupChars)},\n`;
  out += `    // 每片有几个韵组（换韵词牌一片之内即有多组）\n`;
  out += `    groupCounts: ${JSON.stringify(e.groupCounts)},\n`;
  out += '  },\n';
}
out += `];

export const TUNE_NAMES = TUNES.map((t) => t.name);

export function getTune(name) {
  return TUNES.find((t) => t.name === name) || null;
}

/** 把句子按分片切开，返回 [[上片句], [下片句]] */
export function splitStanzas(tune) {
  const out = [];
  let i = 0;
  for (const n of tune.stanzas) {
    out.push(tune.lens.slice(i, i + n).map((len, k) => ({
      len,
      tones: tune.tones[i + k],
      rhyme: Boolean(tune.rhymes[i + k]),
    })));
    i += n;
  }
  return out;
}
`;
await fs.writeFile(new URL('../server/tunes.mjs', import.meta.url), out, 'utf8');

console.log(`已写出 server/tunes.mjs：${entries.length} 个词牌`);

// 与声律说明声明的韵数交叉核对。
// 注意：钦谱的声律说明里，「前段…韵、后段…韵」通常是分别计数的；
// 若不是这种句式（如「前后段各四句、三平韵」），声明的数字往往只算一片，
// 所以整首的韵数应为声明的 1 倍或 2 倍，两者之一对上即算相符。
function declaredRhymes(desc) {
  const parts = desc.split(/(?=前段|前片|后段|后片|前后段|前后片)/);
  let total = 0;
  const perStanza = [];
  for (const part of parts) {
    let n = 0;
    for (const m of part.matchAll(/([一二三四五六七八九十两]+)(平|仄|叶)韵/g)) {
      n += m[1] === '两' ? 2 : cnNum(m[1]);
    }
    if (n) {
      total += n;
      perStanza.push(n);
    }
  }
  return { total, perStanza };
}

let mismatch = 0;
for (const e of entries) {
  const sum = e.lens.reduce((a, b) => a + b, 0);
  const got = e.rhymes.reduce((a, b) => a + b, 0);
  const d = declaredRhymes(e.desc);
  const structOk = sum === e.total;
  const rhymeOk = d.total === got || d.total * 2 === got || d.total === 0;
  if (!structOk || !rhymeOk) mismatch++;
  console.log(
    `${structOk && rhymeOk ? '✓' : '✗'} ${e.name.padEnd(4, '　')} ${e.total}字 ${e.stanzas.join('+')}片 ` +
      `句长${e.lens.join('/')} 韵${got}处(声明${d.perStanza.join('+')}=${d.total}) 韵组${e.rhymeGroups.map((g) => g.length).join('+')}`
  );
}
console.log(mismatch === 0 ? '\n结构与韵数全部相符' : `\n${mismatch} 个词牌与声律说明不符`);
if (rejected.length) {
  console.log(`\n因「字数与通行正体不符」而被拒收（视为取错了格）：\n  ` + rejected.join('\n  '));
}
