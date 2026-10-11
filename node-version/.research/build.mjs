// Build server/pingshui.mjs and server/rhyme.mjs from archived raw sources, with cross-validation.
import fs from 'node:fs';
import path from 'node:path';

const HERE = import.meta.dirname;
const R = (f) => JSON.parse(fs.readFileSync(path.join(HERE, f), 'utf8'));
const isCJK = (c) => /^[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u{20000}-\u{2FFFF}]$/u.test(c);
const stripAnn = (s) => s.replace(/\[[^\]]*\]/g, '').replace(/（[^）]*）/g, '').replace(/\([^)]*\)/g, '');
const toChars = (s) => [...stripAnn(s)].filter(isCJK);
const CANON_YAN = (n) => (n === '二十八俭' ? '二十八琰' : n);

// ---------- S2 first: provides the canonical 106-韵目 order + 上平/下平 ----------
const sjyPs = R('sjy-pingshui-all.json').filter((p) => p.heading);
const CANON = sjyPs.map((p) => {
  const name = p.heading.replace(/\(.*\)$/, '').trim();
  const tag = p.body.match(/【(上平|下平|上声|去声|入声)[,，]([^】]+)】/);
  if (!tag) throw new Error('no tag id=' + p.id);
  const half = tag[1];
  const sheng = half.replace('上平', '平').replace('下平', '平').replace(/声$/, '');
  return { name, sheng, half };
});
if (CANON.length !== 106) throw new Error('canon length ' + CANON.length);
console.log('canon 106 韵目:', CANON.map((c) => c.half + c.name).join(' '));

// ---------- source indexes ----------
const mk = (list) => {
  const byYun = new Map(), byChar = new Map();
  for (const x of list) {
    const k = x.sheng + '|' + x.name;
    if (!byYun.has(k)) byYun.set(k, new Set());
    for (const c of x.chars) {
      byYun.get(k).add(c);
      if (!byChar.has(c)) byChar.set(c, new Set());
      byChar.get(c).add(k);
    }
  }
  return { byYun, byChar };
};

// S1: 搜韵《平水韵》官方文档 (jkak/pingShuiYun)
const ori = R('raw-oriYunDict.json');
const S1 = [];
for (const [key, val] of Object.entries(ori)) {
  const m = key.replace(/^\uFEFF/, '').match(/^(.+?)([平上去入])$/);
  if (!m) throw new Error('unparsed S1 key ' + JSON.stringify(key));
  S1.push({ name: CANON_YAN(m[1]), sheng: m[2], chars: toChars(val) });
}
const I1 = mk(S1);

// S2
const S2 = sjyPs.map((p, i) => {
  const after = p.body.slice(p.body.indexOf('】', p.body.indexOf('【' + CANON[i].half)) ).split('手机访问')[0];
  const list = p.body.slice(p.body.lastIndexOf('】') + 1).split('手机访问')[0];
  return { name: CANON[i].name, sheng: CANON[i].sheng, chars: toChars(list) };
});
const I2 = mk(S2);

// S3: Wikisource (charlesix59)
const psRaw = R('raw-Pingshui_Rhyme.json');
const grp = { 上平声部: '平', 下平声部: '平', 上声部: '上', 去声部: '去', 入声部: '入' };
const S3 = [];
for (const [g, obj] of Object.entries(psRaw))
  for (const [n0, arr] of Object.entries(obj))
    S3.push({ name: CANON_YAN(n0.replace(/^入声/, '')), sheng: grp[g], chars: arr.filter(isCJK) });
const I3 = mk(S3);

console.log('\n== 平水韵 交叉验证 ==');
console.log(`  S1 搜韵:       ${I1.byYun.size} 韵目 / ${I1.byChar.size} 字头`);
console.log(`  S2 诗词家园:   ${I2.byYun.size} 韵目 / ${I2.byChar.size} 字头`);
console.log(`  S3 Wikisource: ${I3.byYun.size} 韵目 / ${I3.byChar.size} 字头`);
function agree(A, B, label) {
  let both = 0, ok = 0; const dis = [];
  for (const [c, a] of A.byChar) {
    if (!B.byChar.has(c)) continue;
    both++;
    const b = B.byChar.get(c);
    if ([...a].some((x) => b.has(x))) ok++; else dis.push([c, [...a].join(','), [...b].join(',')]);
  }
  console.log(`  ${label}: 共有 ${both}, 有交集 ${ok} (${(ok / both * 100).toFixed(2)}%), 完全冲突 ${dis.length}`);
  return dis;
}
const d13 = agree(I1, I3, 'S1 vs S3');
const d12 = agree(I1, I2, 'S1 vs S2');

// verify every canon 韵目 exists in S1
const missS1 = CANON.filter((c) => !I1.byYun.has(c.sheng + '|' + c.name));
console.log('  canon 中 S1 缺失的韵目:', JSON.stringify(missS1));

// ---------- 词林正韵 ----------
const sjyCl = R('sjy-cilin-all.json').filter((p) => p.heading);
const SPLIT_NUM = /([一二三四五六七八九十]+[^一二三四五六七八九十【】]+)/g;
const cleanName = (s) => s.replace(/[（(]半[)）]/g, '').replace(/通用|独用|声/g, '').trim();
const stripHalf = (s) => s.replace(/[（(]半[)）]/g, '').trim();
const namesIn = (seg) => (seg.match(SPLIT_NUM) || []).map(cleanName);

const C1 = {};
for (let i = 1; i <= 19; i++) C1[i] = { 平: new Set(), 上: new Set(), 去: new Set(), 入: new Set() };
const buOfPage = new Map();
for (const p of sjyCl) {
  const h = p.body.match(/【词林正韵】-\s*([^()（）]*)\((平|仄)\)/);
  if (!h) throw new Error('cilin heading unparsed id=' + p.id);
  const buNo = p.id >= 29 ? p.id - 14 : (h[2] === '平' ? (p.id + 1) / 2 : p.id / 2);
  buOfPage.set(p.id, buNo);
  const hdr = p.body.match(/【(平声|仄声|入声)[:：]([^】]*)】/);
  if (!hdr) throw new Error('cilin header unparsed id=' + p.id);
  const shengOfYunmu = new Map();
  if (hdr[1] === '平声' || hdr[1] === '入声') {
    for (const n of namesIn(hdr[2])) shengOfYunmu.set(n, hdr[1] === '平声' ? '平' : '入');
  } else {
    for (const part of hdr[2].split(/\s+/)) {
      const s = part.startsWith('上声') ? '上' : part.startsWith('去声') ? '去' : part.startsWith('入声') ? '入' : null;
      if (!s) continue;
      for (const n of namesIn(part.replace(/^(上声|去声|入声)/, ''))) shengOfYunmu.set(n, s);
    }
  }
  const re = /【([^】]+)】([^【]*)/g; let m; let seen = 0;
  while ((m = re.exec(p.body))) {
    const nm = stripHalf(m[1]);
    if (/^(词林正韵|平声|仄声|入声)/.test(nm)) continue;
    const s = shengOfYunmu.get(nm);
    if (!s) { console.log(`!! bu${buNo} 韵目 ${nm} 无声 (page ${p.id})`); continue; }
    for (const c of toChars(m[2].split('手机访问')[0])) C1[buNo][s].add(c);
    seen++;
  }
  if (!seen) console.log('!! no sublists page ' + p.id);
}
console.log('\n== 词林正韵 诗词家园 (C1) ==');
for (let i = 1; i <= 19; i++) {
  const x = C1[i];
  console.log(`  第${i}部 平${x.平.size} 上${x.上.size} 去${x.去.size} 入${x.入.size}`);
}

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
  if (!C2[n]) throw new Error('bad bu key ' + bu);
  for (const [sheng0, arr] of Object.entries(obj)) {
    const sheng = sheng0.replace(/声$/, '');
    if (!C2[n][sheng]) throw new Error('bad sheng ' + sheng0 + ' in ' + bu);
    for (const c of arr) if (isCJK(c)) C2[n][sheng].add(c);
  }
}
console.log('\n== 词林正韵 charlesix59 (C2) ==');
for (let i = 1; i <= 19; i++) console.log(`  第${i}部 平${C2[i].平.size} 仄${C2[i].仄.size} 入${C2[i].入.size}`);

const c1All = new Map(), c2All = new Map();
for (let i = 1; i <= 19; i++) {
  for (const s of ['平', '上', '去', '入']) for (const c of C1[i][s]) {
    if (!c1All.has(c)) c1All.set(c, new Set());
    c1All.get(c).add(s + '|' + i);
  }
  for (const c of C2[i].平) { if (!c2All.has(c)) c2All.set(c, new Set()); c2All.get(c).add('平|' + i); }
  for (const c of C2[i].入) { if (!c2All.has(c)) c2All.set(c, new Set()); c2All.get(c).add('入|' + i); }
  for (const c of C2[i].仄) { if (!c2All.has(c)) c2All.set(c, new Set()); c2All.get(c).add('仄|' + i); }
}
let cBoth = 0, cOk = 0; const cDis = [];
for (const [c, a] of c1All) {
  if (!c2All.has(c)) continue;
  cBoth++;
  const b = c2All.get(c);
  const hit = [...a].some((x) => {
    const [s, i] = x.split('|');
    return b.has(s + '|' + i) || (s !== '平' && s !== '入' && b.has('仄|' + i));
  });
  if (hit) cOk++; else cDis.push([c, [...a].join(','), [...b].join(',')]);
}
console.log(`\n  词林正韵 C1 vs C2: 共有字头 ${cBoth}, 有交集 ${cOk} (${(cOk / cBoth * 100).toFixed(2)}%), 完全冲突 ${cDis.length}`);
console.log('  冲突(前40):');
for (const d of cDis.slice(0, 40)) console.log('    ', d.join('  |  '));
const only1 = [...c1All.keys()].filter((c) => !c2All.has(c));
const only2 = [...c2All.keys()].filter((c) => !c1All.has(c));
console.log(`  仅C1有 ${only1.length}, 仅C2有 ${only2.length}`);

fs.writeFileSync(path.join(HERE, 'build-report.json'), JSON.stringify({
  pingshui: { s1: I1.byChar.size, s2: I2.byChar.size, s3: I3.byChar.size, d13, d12 },
  cilin: { c1: c1All.size, c2: c2All.size, cBoth, cOk, cDis, only1, only2 },
}, null, 1));
console.log('\nwrote build-report.json');
