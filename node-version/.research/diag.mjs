import fs from 'node:fs/promises';

function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '');
}
const decode = (s) =>
  s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d));
const CJK = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;
const META_CHARS = '中仄平句韵韻叶叶協协换換读讀豆、。，';
const cjkCount = (s) => [...s].filter((c) => CJK.test(c)).length;

const SIMP = (s) =>
  s
    .replace(/欽/g, '钦').replace(/譜/g, '谱').replace(/韻/g, '韵').replace(/葉/g, '叶')
    .replace(/換/g, '换').replace(/讀/g, '读').replace(/雙/g, '双').replace(/調/g, '调')
    .replace(/後/g, '后').replace(/詞/g, '词').replace(/龍/g, '龙').replace(/闋/g, '阕');

for (const name of ['浣溪沙', '忆江南', '蝶恋花', '临江仙']) {
  const html = await fs.readFile(new URL(`./html/${name}.html`, import.meta.url), 'utf8');
  const text = decode(stripTags(html));
  const i = text.indexOf('钦谱');
  const j = text.indexOf('龙谱');
  const block = j > i ? text.slice(i, j) : text.slice(i);
  const ls = block.split('\n').map((s) => s.replace(/[\u3000\t ]+/g, ' ').trim()).filter(Boolean);
  const norm = ls.map(SIMP);

  console.log('#' + name + ' 行数 ' + ls.length);
  // 找声律行
  const runs = [];
  norm.forEach((l, k) => {
    const m = l.match(/([一二三四五六七八九十百]+)字/);
    if (m) runs.push(`${k}:「${l}」含韵=${/韵/.test(l)} 长度=${l.length}`);
  });
  console.log('  含「N字」的行：');
  runs.slice(0, 6).forEach((r) => console.log('    ' + r));

  const isPattern = (line) => {
    const cjk = cjkCount(line);
    if (!cjk) return false;
    return [...line].every((c) => !CJK.test(c) || META_CHARS.includes(c));
  };
  // 找第一个同时满足 字数+韵+长度<=40 的行
  let start = -1;
  for (let k = 0; k < norm.length; k++) {
    const m = norm[k].match(/([一二三四五六七八九十百]+)字/);
    if (m && /韵/.test(norm[k]) && norm[k].length <= 40) { start = k; break; }
  }
  console.log(`  起手行 = ${start}`);
  if (start >= 0) {
    console.log(`    说明：「${ls[start]}」`);
    console.log(`    上一行（词牌名？）：「${ls[start - 1] || ''}」`);
    console.log(`    下一行（作者？）：「${ls[start + 1] || ''}」`);
    console.log(`    再下两行：`);
    for (let k = start + 2; k < Math.min(start + 8, ls.length); k++) {
      console.log(`      ${k}| 谱行=${isPattern(ls[k])} 「${ls[k].slice(0, 40)}」`);
    }
  }
  console.log('');
}
