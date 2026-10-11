// Derive the 词林正韵 部 -> 平水韵 韵目 mapping from character overlap (data-driven,
// so we do not trust the flaky 韵目 labels on the source page).
import fs from 'node:fs';
const R = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const isHan = (c) => /^[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u{20000}-\u{2FFFF}]$/u.test(c);
const stripAnn = (s) => s.replace(/\[[^\]]*\]/g, '').replace(/（[^）]*）/g, '').replace(/\([^)]*\)/g, '');
const toChars = (s) => [...stripAnn(s)].filter(isHan);
const CANON_YAN = (n) => (n === '二十八俭' ? '二十八琰' : n);

// 平水韵 from 搜韵
const ori = R('raw-oriYunDict.json');
const PS = new Map(); // '声|名' -> Set
for (const [key, val] of Object.entries(ori)) {
  const m = key.replace(/^\uFEFF/, '').match(/^(.+?)([平上去入])$/);
  PS.set(m[2] + '|' + CANON_YAN(m[1]), new Set(toChars(val)));
}

// cilin pages
const sjyCl = R('sjy-cilin-all.json').filter((p) => p.heading);
const SPLIT_NUM = /([一二三四五六七八九十]+[^一二三四五六七八九十【】]+)/g;
const cleanName = (s) => s.replace(/[（(]半[)）]/g, '').replace(/通用|独用|声/g, '').trim();
const stripHalf = (s) => s.replace(/[（(]半[)）]/g, '').trim();
const namesIn = (seg) => (seg.match(SPLIT_NUM) || []).map(cleanName);
const CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九'];

const SUBLISTS = [];
for (const p of sjyCl) {
  const h = p.body.match(/【词林正韵】-\s*([^()（）]*)\((平|仄)\)/);
  const buNo = p.id >= 29 ? p.id - 14 : (h[2] === '平' ? (p.id + 1) / 2 : p.id / 2);
  const hdr = p.body.match(/【(平声|仄声|入声)[:：]([^】]*)】/);
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
    subs.push({ raw, half: /[（(]半[)）]/.test(raw), nm: stripHalf(raw), chars: toChars(m[2].split('手机访问')[0]) });
  }
  subs.forEach((s, i) => {
    const sheng = hdr[1] === '平声' ? '平' : hdr[1] === '入声' ? '入' : (i < upCount ? '上' : '去');
    SUBLISTS.push({ bu: buNo, sheng, ...s });
  });
}

console.log('sublists', SUBLISTS.length);
// overlap match
const PS_BY_SHENG = {};
for (const k of PS.keys()) {
  const [s, n] = k.split('|');
  (PS_BY_SHENG[s] ??= []).push(n);
}
let bad = 0;
const mapping = [];
for (const sl of SUBLISTS) {
  if (!sl.chars.length) { console.log('!! empty sublist', sl.bu, sl.sheng, sl.nm); bad++; continue; }
  let best = null;
  for (const n of PS_BY_SHENG[sl.sheng] || []) {
    const set = PS.get(sl.sheng + '|' + n);
    let hit = 0;
    for (const c of sl.chars) if (set.has(c)) hit++;
    const ratio = hit / sl.chars.length;
    if (!best || ratio > best.ratio) best = { n, ratio, hit };
  }
  const nameMatch = best.n === sl.nm;
  if (best.ratio < 0.85 || !nameMatch) bad++;
  mapping.push({ ...sl, match: best.n, ratio: best.ratio, nameMatch });
  if (best.ratio < 0.85 || !nameMatch) {
    console.log(`  ${best.ratio < 0.85 ? 'LOW ' : '    '}${sl.nameMatch ? ' ' : 'X'} 第${CN[sl.bu - 1]}部 ${sl.sheng} 站名「${sl.nm}」${sl.half ? '(半)' : '    '} -> 平水韵「${best.n}」 overlap=${(best.ratio * 100).toFixed(1)}% (${best.hit}/${sl.chars.length})`);
  }
}
console.log('\n不吻合数:', bad, '/', SUBLISTS.length);
console.log('\n=== 完整映射 ===');
for (const m of mapping) {
  if (m.ratio >= 0.85 && m.nameMatch) continue;
}
// per-部 summary
const byBu = {};
for (const m of mapping) {
  (byBu[m.bu] ??= {});
  (byBu[m.bu][m.sheng] ??= []).push(`${m.match}${m.half ? '(半)' : ''}`);
}
for (const [bu, o] of Object.entries(byBu)) {
  console.log(`第${CN[bu - 1]}部  ` + ['平', '上', '去', '入'].filter((s) => o[s]).map((s) => s + ': ' + o[s].join(' ')).join('  |  '));
}
fs.writeFileSync('cilin-map.json', JSON.stringify(mapping.map((m) => ({ bu: m.bu, sheng: m.sheng, siteName: m.nm, half: m.half, match: m.match, ratio: m.ratio, nameMatch: m.nameMatch })), null, 1));
