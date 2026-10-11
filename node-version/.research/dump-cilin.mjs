import fs from 'node:fs';
const all = JSON.parse(fs.readFileSync('sjy-cilin-all.json', 'utf8'));
for (const id of [9, 10, 17, 23, 25, 12]) {
  const p = all.find((x) => x.id === id);
  const body = p.body;
  const hdr = body.match(/【(平声|仄声|入声)[:：]([^】]*)】/);
  console.log('=== id=' + id + ' heading=' + p.heading);
  console.log('  header:', hdr ? JSON.stringify(hdr[0]) : 'NONE');
  const re = /【([^】]+)】([^【]*)/g; let m;
  while ((m = re.exec(body))) {
    const nm = m[1];
    if (/^(词林正韵|平声|仄声|入声)/.test(nm)) continue;
    console.log('   sublist:', JSON.stringify(nm), 'len=' + m[2].split('手机访问')[0].length);
  }
}
