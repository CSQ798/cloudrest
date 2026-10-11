import fs from 'node:fs';
const all = JSON.parse(fs.readFileSync('sjy-cilin-all.json', 'utf8'));
for (const id of [18, 20, 22, 24, 26, 28]) {
  const p = all.find((x) => x.id === id);
  console.log('=== id=' + id + ' heading=' + p.heading);
  const hdr = p.body.match(/【(平声|仄声|入声)[:：]([^】]*)】/);
  console.log('  header:', hdr ? JSON.stringify(hdr[0]) : 'NONE');
  const re = /【([^】]+)】([^【]*)/g; let m;
  while ((m = re.exec(p.body))) {
    if (/^(词林正韵|平声|仄声|入声)/.test(m[1])) continue;
    console.log('   sub:', JSON.stringify(m[1]), 'n=' + m[2].split('手机访问')[0].replace(/\s/g, '').length);
  }
}
