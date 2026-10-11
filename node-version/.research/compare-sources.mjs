// Cross-validate all harvested rhyme sources. Report only; no output files yet.
import fs from 'node:fs';
const R = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const isCJK = (c) => /^[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u{20000}-\u{2FFFF}]$/u.test(c);

const strip = (s) => s.replace(/\[[^\]]*\]/g, '').replace(/（[^）]*）/g, '').replace(/\([^)]*\)/g, '');
const chars = (s) => [...strip(s)].filter(isCJK);

// ---------------- 平水韵 sources ----------------
// S1 搜韵官方文档 via jkak/pingShuiYun
const ori = R('raw-oriYunDict.json');
const S1 = new Map(); // 韵目(声+名) -> Set
const S1c = new Map(); // char -> Set of "声|韵目"
for (const [key, val] of Object.entries(ori)) {
  const k = key.replace(/^\uFEFF/, '');
  const m = k.match(/^(.+?)([平上去入])$/);
  if (!m) { console.log('!! unparsed ori key', JSON.stringify(key)); continue; }
  const [, name, sheng] = m;
  S1.set(name + sheng, new Set(chars(val)));
  for (const c of chars(val)) {
    if (!S1c.has(c)) S1c.set(c, new Set());
    S1c.get(c).add(sheng + '|' + name);
  }
}
console.log('S1 (搜韵/jkak) 韵目数:', S1.size, ' 字头数:', S1c.size);

// S2 诗词家园 平水韵 (book=23)
const sjy = R('sjy-pingshui-all.json').filter((p) => p.heading);
const S2 = new Map();
const S2c = new Map();
for (const p of sjy) {
  const body = p.body;
  const tag = body.match(/【(上平|下平|上声|去声|入声)[,，]([^】]+)】/);
  if (!tag) { console.log('!! no tag', p.id, p.heading); continue; }
  const sheng = tag[1].replace('上平', '平').replace('下平', '平');
  const name = tag[2].trim();
  const after = body.slice(body.indexOf(tag[0]) + tag[0].length);
  const list = after.split('手机访问')[0];
  S2.set(name + sheng, new Set(chars(list)));
  for (const c of chars(list)) {
    if (!S2c.has(c)) S2c.set(c, new Set());
    S2c.get(c).add(sheng + '|' + name);
  }
}
console.log('S2 (诗词家园) 韵目数:', S2.size, ' 字头数:', S2c.size);

// S3 charlesix59 Pingshui_Rhyme.json (Wikisource, simplified)
const ps = R('raw-Pingshui_Rhyme.json');
const grpSheng = { 上平声部: '平', 下平声部: '平', 上声部: '上', 去声部: '去', 入声部: '入' };
const S3 = new Map();
const S3c = new Map();
for (const [g, obj] of Object.entries(ps)) {
  for (const [name0, arr] of Object.entries(obj)) {
    const name = name0.replace(/^入声/, '');
    const sheng = grpSheng[g];
    S3.set(name + sheng, new Set(arr.filter(isCJK)));
    for (const c of arr) {
      if (!isCJK(c)) continue;
      if (!S3c.has(c)) S3c.set(c, new Set());
      S3c.get(c).add(sheng + '|' + name);
    }
  }
}
console.log('S3 (Wikisource/sc) 韵目数:', S3.size, ' 字头数:', S3c.size);

// ---------------- compare ----------------
console.log('\n##### S1 vs S3 : 韵目对照 (S1=搜韵, S3=Wikisource) #####');
const names1 = new Set([...S1.keys()]);
const names3 = new Set([...S3.keys()]);
const only1 = [...names1].filter((k) => !names3.has(k));
const only3 = [...names3].filter((k) => !names1.has(k));
console.log('仅 S1 有:', JSON.stringify(only1));
console.log('仅 S3 有:', JSON.stringify(only3));

// char-level disagreement: char in S1 韵目 X, S3 has char but not in X
let both = 0, agree = 0, missingInS3 = 0;
const disagree = [];
for (const [c, s1set] of S1c) {
  if (!S3c.has(c)) { missingInS3++; continue; }
  both++;
  const s3set = S3c.get(c);
  const inter = [...s1set].filter((x) => s3set.has(x));
  if (inter.length) agree++;
  else disagree.push([c, [...s1set].join(','), [...s3set].join(',')]);
}
console.log(`char 双方都有: ${both}, 至少有交集: ${agree}, 完全无交集: ${disagree.length}, 仅S1有: ${missingInS3}`);
console.log('无交集样本(前40):');
for (const d of disagree.slice(0, 40)) console.log('   ', d.join('  |  '));

// ---------------- 词林正韵 ----------------
const cilin = R('raw-Cilin_Rhyme.json');
const CB = new Map(); // char -> Set('声|第N部')
for (const [bu, obj] of Object.entries(cilin)) {
  const n = bu.replace(/^第/, '').replace(/部$/, '');
  for (const [sheng, arr] of Object.entries(obj)) {
    for (const c of arr) {
      if (!isCJK(c)) continue;
      if (!CB.has(c)) CB.set(c, new Set());
      CB.get(c).add(sheng + '|' + n);
    }
  }
}
console.log('\n##### 词林正韵 charlesix59 字头数:', CB.size, '#####');

fs.writeFileSync('analysis-summary.json', JSON.stringify({
  S1_yunmu: [...S1.keys()], S3_yunmu: [...S3.keys()],
  disagreeCount: disagree.length, missingInS3,
}, null, 1));
