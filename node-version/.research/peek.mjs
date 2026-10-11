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
const decode = (s) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d));

const name = process.argv[2] || '浣溪沙';
const html = await fs.readFile(new URL(`./html/${name}.html`, import.meta.url), 'utf8');
const text = decode(stripTags(html));
const i = text.indexOf('钦谱');
const j = text.indexOf('龙谱');
const block = j > i ? text.slice(i, j) : text.slice(i);
const ls = block.split('\n').map((s) => s.replace(/[\u3000\t ]+/g, ' ').trim()).filter(Boolean);
console.log(`共 ${ls.length} 行\n`);
ls.slice(0, 40).forEach((l, k) => console.log(`${String(k).padStart(3)}| ${l}`));
