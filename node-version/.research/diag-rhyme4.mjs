import { __debug, checkCi } from '../server/validator.mjs';
import { getTune } from '../server/tunes.mjs';
import { buOf } from '../server/rhyme.mjs';

const bad = ['宿醉离愁慢髻鬟', '六铢衣薄惹轻寒', '慵红闷翠掩青鸾', '罗袜况兼金菡萏', '雪肌仍是玉琅玕', '骨香腰细更沈东'];
const tune = getTune('浣溪沙');
const lines = bad.map(__debug.hanzi);

const buOfChar = (ch) => (ch ? buOf(ch) : null);
const same = (a, b) => (!a || !b ? true : a.some((x) => b.includes(x)));

console.log('tune.stanzas =', JSON.stringify(tune.stanzas));
console.log('tune.rhymes  =', JSON.stringify(tune.rhymes));

const groups = [];
let start = 0;
for (const n of tune.stanzas) {
  const idxs = [];
  for (let i = start; i < start + n; i++) if (tune.rhymes[i]) idxs.push(i);
  start += n;
  console.log(`片 ${JSON.stringify(idxs)}`);
  let cur = [];
  let ref = null;
  for (const i of idxs) {
    const ch = lines[i].slice(-1);
    const bu = buOfChar(ch);
    const ok = same(bu, ref);
    console.log(`   i=${i} 字=${ch} bu=${JSON.stringify(bu)} ref=${JSON.stringify(ref)} same=${ok}`);
    if (cur.length && !ok) {
      groups.push(cur);
      cur = [];
      ref = null;
    }
    cur.push(i);
    if (!ref) ref = bu;
  }
  if (cur.length) groups.push(cur);
}
console.log('本地重算 groups =', JSON.stringify(groups));
console.log('__debug 返回    =', JSON.stringify(__debug.rhymeGroupsOf(tune, lines)));
console.log('checkCi =', checkCi('浣溪沙', bad).level);
