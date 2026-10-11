// Refined cross-validation: normalise 俭->琰, compare S1(搜韵) vs S2(诗词家园) vs S3(Wikisource)
import fs from 'node:fs';
const R = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const isCJK = (c) => /^[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u{20000}-\u{2FFFF}]$/u.test(c);
const strip = (s) => s.replace(/\[[^\]]*\]/g, '').replace(/（[^）]*）/g, '').replace(/\([^)]*\)/g, '');
const chars = (s) => [...strip(s)].filter(isCJK);
const norm = (name) => name.replace(/^二十八俭$/, '二十八琰');

function build(setIter) {
  const byYunmu = new Map();
  const byChar = new Map();
  for (const [sheng, name, list] of setIter) {
    const n = norm(name);
    const k = sheng + '|' + n;
    if (!byYunmu.has(k)) byYunmu.set(k, new Set());
    for (const c of list) {
      byYunmu.get(k).add(c);
      if (!byChar.has(c)) byChar.set(c, new Set());
      byChar.get(c).add(k);
    }
  }
  return { byYunmu, byChar };
}

// S1
const ori = R('raw-oriYunDict.json');
const s1iter = [];
for (const [key, val] of Object.entries(ori)) {
  const m = key.replace(/^\uFEFF/, '').match(/^(.+?)([平上去入])$/);
  if (!m) { console.log('!! unparsed', JSON.stringify(key)); continue; }
  s1iter.push([m[2], m[1], chars(val)]);
}
const S1 = build(s1iter);

// S2
const sjy = R('sjy-pingshui-all.json').filter((p) => p.heading);
const s2iter = [];
for (const p of sjy) {
  const tag = p.body.match(/【(上平|下平|上声|去声|入声)[,，]([^】]+)】/);
  const sheng = tag[1].replace('上平', '平').replace('下平', '平').replace(/声$/, '');
  const list = p.body.slice(p.body.indexOf(tag[0]) + tag[0].length).split('手机访问')[0];
  s2iter.push([sheng, tag[2].trim(), chars(list)]);
}
const S2 = build(s2iter);

// S3
const ps = R('raw-Pingshui_Rhyme.json');
const grp = { 上平声部: '平', 下平声部: '平', 上声部: '上', 去声部: '去', 入声部: '入' };
const s3iter = [];
for (const [g, obj] of Object.entries(ps))
  for (const [name0, arr] of Object.entries(obj))
    s3iter.push([grp[g], name0.replace(/^入声/, ''), arr.filter(isCJK)]);
const S3 = build(s3iter);

console.log('S1 韵目', S1.byYunmu.size, '字头', S1.byChar.size);
console.log('S2 韵目', S2.byYunmu.size, '字头', S2.byChar.size);
console.log('S3 韵目', S3.byYunmu.size, '字头', S3.byChar.size);

function cmp(label, A, B) {
  let both = 0, ok = 0, dis = 0, onlyA = 0;
  const bad = [];
  for (const [c, a] of A.byChar) {
    if (!B.byChar.has(c)) { onlyA++; continue; }
    both++;
    const b = B.byChar.get(c);
    if ([...a].some((x) => b.has(x))) ok++;
    else { dis++; bad.push([c, [...a].join(','), [...b].join(',')]); }
  }
  console.log(`\n[${label}] 共有字头=${both} 有交集=${ok} (${(ok / both * 100).toFixed(2)}%) 完全冲突=${dis} 仅A有=${onlyA}`);
  return bad;
}

const bad13 = cmp('S1搜韵 vs S3维基', S1, S3);
const bad12 = cmp('S1搜韵 vs S2诗词家园', S1, S2);
const bad23 = cmp('S2诗词家园 vs S3维基', S2, S3);

console.log('\n--- S1 vs S2 冲突全部 (' + bad12.length + ') ---');
for (const d of bad12) console.log('   ', d.join('  |  '));
console.log('\n--- S1 vs S3 冲突 (前60/' + bad13.length + ') ---');
for (const d of bad13.slice(0, 60)) console.log('   ', d.join('  |  '));

// S2 (curated common) coverage by S1
let covered = 0; const notInS1 = [];
for (const c of S2.byChar.keys()) { if (S1.byChar.has(c)) covered++; else notInS1.push(c); }
console.log(`\nS2 字头中 S1 覆盖: ${covered}/${S2.byChar.size}; 缺 ${notInS1.length}: ${notInS1.join('')}`);

// 三讲 content
console.log('\n三讲 S1:', [...(S1.byYunmu.get('上|三讲') || [])].join(''));
console.log('三讲 S2:', [...(S2.byYunmu.get('上|三讲') || [])].join(''));

fs.writeFileSync('analysis-conflicts.json', JSON.stringify({ bad12, bad13, bad23, notInS1 }, null, 1));
