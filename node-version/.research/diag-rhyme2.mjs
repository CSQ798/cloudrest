import { buOf, sameBu } from '../server/rhyme.mjs';
import { checkCi } from '../server/validator.mjs';

console.log('东 buOf =', buOf('东'));
console.log('sameBu(东,玕) =', JSON.stringify(sameBu(['东', '玕'])));
console.log('sameBu(东,寒) =', JSON.stringify(sameBu(['东', '寒'])));

const bad = ['宿醉离愁慢髻鬟', '六铢衣薄惹轻寒', '慵红闷翠掩青鸾', '罗袜况兼金菡萏', '雪肌仍是玉琅玕', '骨香腰细更沈东'];
const r = checkCi('浣溪沙', bad);
console.log('level =', r.level);
console.log('issues =', JSON.stringify(r.issues, null, 1));

// 独立复算一遍韵组
const { getTune } = await import('../server/tunes.mjs');
const t = getTune('浣溪沙');
console.log('stanzas', t.stanzas, 'rhymes', t.rhymes);
const lines = bad;
const buKey = (ch) => (buOf(ch).length ? buOf(ch).join('/') : null);
let start = 0;
for (const n of t.stanzas) {
  const idxs = [];
  for (let i = start; i < start + n; i++) if (t.rhymes[i]) idxs.push(i);
  start += n;
  console.log(`片内韵位 ${JSON.stringify(idxs)} 末字 ${idxs.map((i) => lines[i].slice(-1)).join('')} buKey ${idxs.map((i) => buKey(lines[i].slice(-1))).join(',')}`);
}
