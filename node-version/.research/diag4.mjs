import fs from 'node:fs/promises';
const decode = (s) => s.replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d));
for (const name of ['虞美人', '菩萨蛮', '清平乐', '定风波']) {
  const html = await fs.readFile(new URL(`./html/${name}.html`, import.meta.url), 'utf8');
  const i = html.indexOf('钦谱');
  const j = html.search(/龙谱|龍譜/);
  const block = html.slice(i, j);
  const re = /<p class='mSize'>([\s\S]*?)<\/p>/g;
  let m, k = 0;
  console.log('#' + name);
  while ((m = re.exec(block)) && k < 2) {
    k++;
    const v = m[1];
    const poem = v.split(/<span class='comment'>/)[0];
    const pat = (v.match(/<span class='comment'>([\s\S]*)$/) || ['', ''])[1];
    console.log('  例词:', decode(poem.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim().slice(0, 40));
    console.log('  谱  :', pat.replace(/\s+/g, ' ').replace(/<span class='rhythm'>/g, '【').replace(/<\/span>/g, '】').slice(0, 300));
  }
}
