import fs from 'node:fs';
const R = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const isCJK = (c) => /^[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u{20000}-\u{2FFFF}]$/u.test(c);
const strip = (s) => s.replace(/\[[^\]]*\]/g, '').replace(/（[^）]*）/g, '').replace(/\([^)]*\)/g, '');
const chars = (s) => [...strip(s)].filter(isCJK);

// S1 names in order
const ori = R('raw-oriYunDict.json');
const s1 = [];
for (const [key, val] of Object.entries(ori)) {
  const m = key.replace(/^\uFEFF/, '').match(/^(.+?)([平上去入])$/);
  s1.push({ name: m[1], sheng: m[2], chars: chars(val) });
}
console.log('S1 韵目 (in file order):');
console.log(s1.map((x) => x.name + x.sheng).join(' '));
console.log('\nS1 声 counts:', JSON.stringify(s1.reduce((a, x) => (a[x.sheng] = (a[x.sheng] || 0) + 1, a), {})));
console.log('S1 total chars (with dups):', s1.reduce((a, x) => a + x.chars.length, 0));

// shicijiayuan pingshui page 37 body (七麌?)
const sjy = R('sjy-pingshui-all.json').filter((p) => p.heading);
const p37 = sjy.find((p) => p.id === 37);
console.log('\nid=37 heading:', p37.heading);
console.log(p37.body.slice(0, 400));

// find chars in S2 not in S1
const S1all = new Set(s1.flatMap((x) => x.chars));
const s2all = new Set(sjy.flatMap((p) => chars(p.body.slice(p.body.indexOf('】') + 1).split('手机访问')[0])));
const notInS1 = [...s2all].filter((c) => !S1all.has(c));
console.log('\nS2 chars not in S1:', notInS1.join(''), '(', notInS1.length, ')');
