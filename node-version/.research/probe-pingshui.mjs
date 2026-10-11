import fs from 'node:fs';

const r = await fetch('https://www.shicijiayuan.com/list.asp?bookid=9', { headers: { 'User-Agent': 'Mozilla/5.0' } });
const t = new TextDecoder('gb18030').decode(Buffer.from(await r.arrayBuffer()));
fs.writeFileSync('sjy-pingshui-list.html', t);
console.log('status', r.status, 'len', t.length);
const re = /<a[^>]*href\s*=\s*["']?([^"'\s>]+)["']?[^>]*>([\s\S]*?)<\/a>/g;
let m;
while ((m = re.exec(t))) {
  const txt = m[2].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  console.log(m[1] + '  ==>  ' + txt);
}
