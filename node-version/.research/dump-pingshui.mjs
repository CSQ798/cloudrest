import fs from 'node:fs';
const all = JSON.parse(fs.readFileSync('sjy-pingshui-all.json', 'utf8'));
for (const id of [1, 33, 58, 60, 90, 106]) {
  const p = all.find((x) => x.id === id);
  console.log('===== id=' + id + ' heading=' + p.heading);
  console.log(p.body);
  console.log();
}
