import fs from 'node:fs/promises';
const html = await fs.readFile(new URL('./html/忆江南.html', import.meta.url), 'utf8');
const i = html.indexOf('钦谱');
console.log('钦谱位置', i, ' 龙谱位置', html.search(/龙谱|龍譜/));
const seg = html.slice(i, i + 3000);
// 打印 tuneFormatDesc / indentLabel / mSize 结构
const re = /<span class='tuneFormatDesc'>([^<]*)<\/span>|<span class='indentLabel'>([^<]*)<\/span>|<p class='mSize'>([\s\S]*?)<\/p>/g;
let m;
let k = 0;
while ((m = re.exec(seg)) && k < 8) {
  k++;
  if (m[1]) console.log(`\n[desc] ${m[1]}`);
  else if (m[2]) console.log(`[author] ${m[2]}`);
  else {
    const poem = m[3].split(/<span class='comment'>/)[0];
    const pat = (m[3].match(/<span class='comment'>([\s\S]*)$/) || ['', ''])[1];
    console.log(`[poem raw] ${JSON.stringify(poem.replace(/\r?\n/g, '\\n'))}`);
    console.log(`[pattern raw] ${JSON.stringify(pat.replace(/\r?\n/g, '\\n'))}`);
  }
}
