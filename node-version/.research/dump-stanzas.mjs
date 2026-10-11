// 从搜韵缓存的「钦定词谱」定格里，取出例词的分片（每片一段 <p class='mSize'>），
// 用来核对 tunes.mjs 的 stanzas 有没有写错（有的双调词牌被写成了单片）。
// 用法：node dump-stanzas.mjs
import fs from 'node:fs';
import { TUNES } from '../server/tunes.mjs';

const CJK = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;

for (const tune of TUNES) {
  const file = new URL(`./html/${tune.name}.html`, import.meta.url);
  if (!fs.existsSync(file)) { console.log(`${tune.name}\t（无缓存）`); continue; }
  const html = fs.readFileSync(file, 'utf8');
  // 第一个 ciTuneFormat 块 = 定格
  const i = html.indexOf("<div class='ciTuneFormat'>");
  const j = html.indexOf("<div class='ciTuneFormat'>", i + 5);
  const block = html.slice(i, j < 0 ? i + 6000 : j);
  const ps = [...block.matchAll(/<p class='mSize'>([\s\S]*?)<span class='comment'>/g)].map((m) =>
    [...m[1].replace(/<[^>]+>/g, '')].filter((c) => CJK.test(c)).length
  );
  const sum = ps.reduce((a, b) => a + b, 0);
  const lensSum = tune.lens.reduce((a, b) => a + b, 0);
  const ok = JSON.stringify(tune.stanzas) !== JSON.stringify(ps) ? '  ← 不一致' : '';
  console.log(
    `${tune.name}\t现:${JSON.stringify(tune.stanzas)}\t谱:${JSON.stringify(ps)}\t字数 谱${sum}/lens${lensSum}${ok}`
  );
}
