import { buOf, sameBu, pingBu, zeBu } from '../server/rhyme.mjs';
import { checkCi } from '../server/validator.mjs';
import { getTune } from '../server/tunes.mjs';

const t = getTune('浣溪沙');
console.log('浣溪沙 韵位:', t.rhymes.map((r, i) => (r ? i : -1)).filter((i) => i >= 0));
console.log('分片:', t.stanzas, '句长:', t.lens);

const good = ['宿醉离愁慢髻鬟', '六铢衣薄惹轻寒', '慵红闷翠掩青鸾', '罗袜况兼金菡萏', '雪肌仍是玉琅玕', '骨香腰细更沈檀'];
for (const l of good) {
  const c = l.slice(-1);
  console.log(`  ${l}  末字「${c}」平部=${pingBu(c)} 仄部=${zeBu(c)} buOf=${buOf(c)}`);
}
console.log('sameBu(鬟寒鸾玕檀) =', JSON.stringify(sameBu(['鬟', '寒', '鸾', '玕', '檀'])));

const bad = [...good.slice(0, 5), '骨香腰细更沈东'];
console.log('\n改末字为「东」：');
const r = checkCi('浣溪沙', bad);
console.log('  level =', r.level);
for (const i of r.issues) console.log('  ', i.severity, i.text);
