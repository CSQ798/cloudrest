import fs from 'node:fs';
const dec = (buf) => new TextDecoder('gb18030').decode(buf);

const out = [];
for (let id = 1; id <= 115; id++) {
  const u = `https://www.shicijiayuan.com/books/showdetail.asp?book=23&id=${id}`;
  let t = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (r.status !== 200) throw new Error('status ' + r.status);
      t = dec(Buffer.from(await r.arrayBuffer()));
      break;
    } catch (e) {
      console.log('retry', id, e.message);
      await new Promise((s) => setTimeout(s, 2500));
    }
  }
  if (!t) { console.log('FAIL id=' + id); continue; }
  const body = t.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  const head = body.match(/【平水韵】- ([^返]*)/);
  const heading = head ? head[1].trim() : null;
  console.log(id, heading, 'len=' + body.length);
  out.push({ id, heading, body });
  await new Promise((s) => setTimeout(s, 350));
}
fs.writeFileSync('sjy-pingshui-all.json', JSON.stringify(out, null, 1));
console.log('total', out.length, 'non-null', out.filter((p) => p.heading).length);
