// 由原始数据生成 server/rhyme.mjs（词林正韵）与 server/pingshui.mjs（平水韵）
// 数据来源见下方注释，原始文件留档在 .research/
import fs from 'node:fs/promises';

const dir = new URL('./', import.meta.url);
const cilin = JSON.parse(await fs.readFile(new URL('raw-Cilin_Rhyme.json', dir), 'utf8'));
const pingshui = JSON.parse(await fs.readFile(new URL('raw-Pingshui_Rhyme.json', dir), 'utf8'));

const CN = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九'];

/* ---------------- 词林正韵 ---------------- */
const buEntries = Object.entries(cilin);
const buChars = { 平: [], 仄: [] };
const buNames = [];
buEntries.forEach(([name, groups], idx) => {
  const ping = new Set();
  const ze = new Set();
  for (const [tone, chars] of Object.entries(groups)) {
    const isPing = tone.includes('平');
    for (const c of chars) (isPing ? ping : ze).add(c);
  }
  buNames.push({ id: idx + 1, name, tones: Object.keys(groups) });
  buChars.平.push([...ping].join(''));
  buChars.仄.push([...ze].join(''));
});

let rhymeOut = `// 栖云 · 词林正韵
// 十九部。数据来源：开源韵书数据集（原始文件留档于 .research/raw-Cilin_Rhyme.json）。
// 每部含平声与仄声（上/去/入）字表。词韵比诗韵宽，此表用于校验词的押韵是否同部。

const PING = [
${buChars.平.map((s) => `  '${s}',`).join('\n')}
];

const ZE = [
${buChars.仄.map((s) => `  '${s}',`).join('\n')}
];

const CN = ${JSON.stringify(CN)};

export const BU = ${JSON.stringify(buNames.map((b) => ({ id: b.id, name: b.name })), null, 2)};

function buildMap(list) {
  const m = new Map();
  list.forEach((chars, idx) => {
    for (const c of chars) if (!m.has(c)) m.set(c, idx + 1);
  });
  return m;
}

const pingMap = buildMap(PING);
const zeMap = buildMap(ZE);

/** 查一个字属第几部（平声） */
export function pingBu(char) {
  return pingMap.get(char) || null;
}

/** 查一个字属第几部（仄声） */
export function zeBu(char) {
  return zeMap.get(char) || null;
}

/** 一个字可能归属的部（平、仄都查） */
export function buOf(char) {
  const out = [];
  const p = pingMap.get(char);
  const z = zeMap.get(char);
  if (p) out.push(p);
  if (z && z !== p) out.push(z);
  return out;
}

/**
 * 判断一组字是否同部（押韵）。
 * 允许「多音字」：只要存在一种部号，使所有字都能落在同一部，即算同韵。
 */
export function sameBu(chars) {
  const list = chars.filter(Boolean);
  if (list.length < 2) return { ok: true, detail: '韵脚不足两个，无从比较' };
  const cands = buOf(list[0]);
  if (!cands.length) {
    return { ok: false, detail: \`「\${list[0]}」不在词林正韵表内，无法判定\` };
  }
  for (const bu of cands) {
    if (list.every((c) => buOf(c).includes(bu))) {
      return { ok: true, detail: \`同属第 \${CN[bu] || bu} 部\` };
    }
  }
  const detail = list.map((c) => \`\${c}(\${buOf(c).join('/') || '未收'})\`).join('、');
  return { ok: false, detail: \`不同部：\${detail}\` };
}

export function pingOf(buIndex) {
  return new Set(PING[buIndex - 1] ? [...PING[buIndex - 1]] : []);
}

export const COVERAGE = { 平声字: pingMap.size, 仄声字: zeMap.size, 部数: BU.length };
`;

/* ---------------- 平水韵 ---------------- */
const psNames = {
  上平声部: '平',
  下平声部: '平',
  上声部: '上',
  去声部: '去',
  入声部: '入',
};
const yunmu = [];
const toneChars = { 平: [], 上: [], 去: [], 入: [] };
for (const [part, tone] of Object.entries(psNames)) {
  const obj = pingshui[part] || {};
  for (const [name, chars] of Object.entries(obj)) {
    yunmu.push({ name, tone, part });
    toneChars[tone].push([...new Set(chars)].join(''));
  }
}

let pingOut = `// 栖云 · 平水韵（近体诗用）
// 一百零六韵目。数据来源：开源韵书数据集（原始文件留档于 .research/raw-Pingshui_Rhyme.json）。
// 平声 30 韵、上声 29 韵、去声 30 韵、入声 17 韵。近体诗押平声韵，故以平声韵目为主。

export const YUNMU = ${JSON.stringify(yunmu, null, 2)};

const PING = [
${toneChars.平.map((s) => `  '${s}',`).join('\n')}
];

const SHANG = [
${toneChars.上.map((s) => `  '${s}',`).join('\n')}
];

const QU = [
${toneChars.去.map((s) => `  '${s}',`).join('\n')}
];

const RU = [
${toneChars.入.map((s) => `  '${s}',`).join('\n')}
];

function build(list) {
  const m = new Map();
  list.forEach((chars, idx) => {
    for (const c of chars) {
      if (!m.has(c)) m.set(c, []);
      m.get(c).push(idx);
    }
  });
  return m;
}

const pingMap = build(PING);
const zeMap = new Map();
for (const [m, tag] of [[build(SHANG), '上'], [build(QU), '去'], [build(RU), '入']]) {
  for (const [c, idxs] of m) {
    if (!zeMap.has(c)) zeMap.set(c, []);
    for (const i of idxs) zeMap.get(c).push(\`\${tag}\${i + 1}\`);
  }
}

/** 平声韵目名列表（近体诗的韵脚只能出自这里） */
export const PING_YUNMU = YUNMU.filter((y) => y.tone === '平').map((y) => y.name);

/**
 * 查一个字的平仄。
 * 返回 '平' | '仄' | '多'（平仄两读） | '未知'（表中无此字）
 */
export function toneOf(char) {
  const p = pingMap.has(char);
  const z = zeMap.has(char);
  if (p && z) return '多';
  if (p) return '平';
  if (z) return '仄';
  return '未知';
}

/** 查一个字所属的平声韵目（非平声返回 null） */
export function pingYunOf(char) {
  const idxs = pingMap.get(char);
  if (!idxs || !idxs.length) return null;
  const y = YUNMU.filter((x) => x.tone === '平')[idxs[0]];
  return y ? y.name : null;
}

/**
 * 判断一组平声韵脚是否同韵。
 * 多音字只要存在一种共同韵目即算合。
 */
export function samePingYun(chars) {
  const list = chars.filter(Boolean);
  if (list.length < 2) return { ok: true, detail: '韵脚不足两个，无从比较' };
  const names = list.map((c) => {
    const idxs = pingMap.get(c);
    if (!idxs || !idxs.length) return null;
    const pingList = YUNMU.filter((x) => x.tone === '平');
    return idxs.map((i) => pingList[i]?.name).filter(Boolean);
  });
  if (names.some((n) => !n)) {
    const missing = list.filter((_, i) => !names[i]);
    return { ok: false, detail: \`「\${missing.join('、')}」不在平水韵平声表内\` };
  }
  for (const cand of names[0]) {
    if (names.every((n) => n.includes(cand))) {
      return { ok: true, detail: \`同属 \${cand}\` };
    }
  }
  const detail = list.map((c, i) => \`\${c}(\${names[i].join('/')})\`).join('、');
  return { ok: false, detail: \`不同韵：\${detail}\` };
}

export const COVERAGE = {
  韵目数: YUNMU.length,
  平声韵目: PING.length,
  平声字: pingMap.size,
  仄声字: zeMap.size,
};
`;

await fs.writeFile(new URL('../server/rhyme.mjs', import.meta.url), rhymeOut, 'utf8');
await fs.writeFile(new URL('../server/pingshui.mjs', import.meta.url), pingOut, 'utf8');
console.log('已写出 server/rhyme.mjs 与 server/pingshui.mjs');
console.log('词林正韵：' + buNames.length + ' 部');
console.log('平水韵：' + yunmu.length + ' 韵目（平声 ' + yunmu.filter((y) => y.tone === '平').length + '）');
