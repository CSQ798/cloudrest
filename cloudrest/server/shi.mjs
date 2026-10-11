// 云卷云舒 · 近体诗格律表
//
// 四种基本律句（五言）：
//   A 仄仄平平仄   B 平平仄仄平   C 平平平仄仄   D 仄仄仄平平
// 七言 = 在五言句前加两字，所加二字与首二字平仄相反：
//   平平仄仄平平仄 / 仄仄平平仄仄平 / 仄仄平平平仄仄 / 平平仄仄仄平平
//
// 推导规则（按优先级）：
//   1. 押韵：对句（偶数句）必收平声；出句（除首句外）不收平声
//   2. 粘  ：下联出句的第二字，与上联对句的第二字同平仄
//   3. 对  ：同一联内，对句尽量与出句逐字相反
// 本文件的谱由 .research/derive4.mjs 机械推出，并已与《春望》《山居秋暝》等公认格律逐句核对一致。

const WU = ['仄仄平平仄', '平平仄仄平', '平平平仄仄', '仄仄仄平平'];

const flip = (l) => [...l].map((c) => (c === '平' ? '仄' : '平')).join('');
const toSeven = (l) => flip(l.slice(0, 2)) + l;

export function baseLines(size) {
  return size === 5 ? [...WU] : WU.map(toSeven);
}

function distance(a, b) {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
}

/**
 * 挑下一句：先按「押韵」与「粘」硬性过滤，再取与「对」（逐字相反）最接近的律句。
 * @param {string} ideal  与上一句逐字相反的理想式
 * @param {number} size   5 或 7
 * @param {{ending?:'平'|'仄', sticky?:string}} opt
 */
function chooseLine(ideal, size, opt = {}) {
  const cands = baseLines(size).map((s) => s.slice(0, size));
  let pool = cands.filter((c) => !opt.ending || c.endsWith(opt.ending));
  if (opt.sticky && pool.some((c) => c[1] === opt.sticky)) pool = pool.filter((c) => c[1] === opt.sticky);
  if (!pool.length) pool = cands;
  return pool.slice().sort((a, b) => distance(a, ideal) - distance(b, ideal))[0];
}

/** 由首句推出整篇的平仄谱 */
export function buildPattern(first, couplets, size) {
  const lines = [first];
  for (let i = 1; i < couplets * 2; i++) {
    const ideal = flip(lines[i - 1]);
    if (i % 2 === 1) lines.push(chooseLine(ideal, size, { ending: '平' }));
    else lines.push(chooseLine(ideal, size, { ending: '仄', sticky: lines[i - 1][1] }));
  }
  return lines;
}

// 首句收平声者即为「入韵」格（首句也押韵）
function patternOf(first, couplets, size) {
  const lines = buildPattern(first, couplets, size);
  const rhyme = lines.map((l, i) => (i % 2 === 1 ? true : i === 0 && l.endsWith('平')));
  return { first, lines, rhyme };
}

export const SHI = {
  五言绝句: { size: 5, couplets: 2 },
  七言绝句: { size: 7, couplets: 2 },
  五言律诗: { size: 5, couplets: 4 },
  七言律诗: { size: 7, couplets: 4 },
};

export const SHI_NAMES = Object.keys(SHI);

export function getShi(name) {
  return SHI[name] || null;
}

/** 某体的全部正格（四种首句，各自对应入韵或不入韵） */
export function shiPatterns(name) {
  const spec = SHI[name];
  if (!spec) return null;
  return baseLines(spec.size).map((first) => patternOf(first.slice(0, spec.size), spec.couplets, spec.size));
}

/** 律诗要求对仗的联（0 基）：颔联、颈联 */
export function parallelCouplets(name) {
  return name.includes('律诗') ? [1, 2] : [];
}
