import fs from 'node:fs';

const dec = (buf) => new TextDecoder('gb18030').decode(buf);

for (const book of [20, 21, 22, 23, 24, 25, 26, 27]) {
  for (const path of [`list.asp?book=${book}`, `list.asp?bookid=${book}`]) {
    const u = 'https://www.shicijiayuan.com/' + path;
    try {
      const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const buf = Buffer.from(await r.arrayBuffer());
      const t = dec(buf);
      const title = (t.match(/<title>([\s\S]*?)<\/title>/) || [, ''])[1].trim();
      const looks404 = /404/.test(title) || t.length < 1200;
      if (looks404) { console.log(book, path, r.status, 'len', t.length, 'title=', title, '(skip)'); continue; }
      fs.writeFileSync(`sjy-list-book${book}.html`, t);
      console.log('=== ' + book + ' ' + path + ' status=' + r.status + ' len=' + t.length + ' title=' + title);
      const re = /<a[^>]*href\s*=\s*["']?([^"'\s>]+)["']?[^>]*>([\s\S]*?)<\/a>/g;
      let m;
      while ((m = re.exec(t))) {
        const txt = m[2].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
        if (/detail/i.test(m[1])) console.log('   ' + m[1] + '  ==>  ' + txt);
      }
    } catch (e) { console.log('ERR', book, path, e.message); }
    await new Promise((s) => setTimeout(s, 500));
  }
}
