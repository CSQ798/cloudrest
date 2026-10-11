import fs from 'node:fs';
const dec = (buf) => new TextDecoder('gb18030').decode(buf);
for (let book = 10; book <= 40; book++) {
  const u = `https://www.shicijiayuan.com/books/showdetail.asp?book=${book}&id=1`;
  try {
    const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const t = dec(Buffer.from(await r.arrayBuffer()));
    const body = t.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    const head = body.match(/【(词林正韵|平水韵|中华新韵)】- ([^返]*)/);
    console.log(book, r.status, 'len=' + t.length, head ? `【${head[1]}】- ${head[2].trim()}` : '(none)');
    if (head) fs.writeFileSync(`sjy-book${book}-id1.html`, t);
  } catch (e) { console.log('ERR', book, e.message); }
  await new Promise((s) => setTimeout(s, 400));
}
