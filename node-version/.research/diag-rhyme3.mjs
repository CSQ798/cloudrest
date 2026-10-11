import { __debug, checkCi } from '../server/validator.mjs';
import { getTune } from '../server/tunes.mjs';

const bad = ['宿醉离愁慢髻鬟', '六铢衣薄惹轻寒', '慵红闷翠掩青鸾', '罗袜况兼金菡萏', '雪肌仍是玉琅玕', '骨香腰细更沈东'];
const tune = getTune('浣溪沙');
const lines = bad.map(__debug.hanzi);
console.log('hanzi:', JSON.stringify(lines));
const groups = __debug.rhymeGroupsOf(tune, lines);
console.log('rhymeGroupsOf =>', JSON.stringify(groups));
for (const g of groups) {
  const chars = g.map((i) => lines[i].slice(-1));
  console.log('  组', JSON.stringify(g), '末字', chars.join(''));
}
console.log('rhymeBook =', __debug.hasRhymeBook, 'pingShui =', __debug.hasPingShui);
const r = checkCi('浣溪沙', bad);
console.log('level', r.level, JSON.stringify(r.issues));
