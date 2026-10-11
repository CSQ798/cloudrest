import { checkCi, __debug } from '../server/validator.mjs';
import { getTune } from '../server/tunes.mjs';
import { buOf, sameBu } from '../server/rhyme.mjs';

const body = ['长廊药气砭人衫', '一灯如豆照颓颜', '抱衣客已入微鼾', '管声滴沥凭空坠', '人影参差未忍还', '夜白悬丝彼独看'];
const tune = getTune('浣溪沙');
const lines = body.map(__debug.hanzi);
console.log('韵位=', JSON.stringify(tune.rhymes), '分片=', JSON.stringify(tune.stanzas));
console.log('韵组=', JSON.stringify(__debug.rhymeGroupsOf(tune, lines)));
for (const [i, l] of lines.entries()) {
  if (!tune.rhymes[i]) continue;
  const ch = l.slice(-1);
  console.log(`  第${i + 1}句末字「${ch}」 buOf=${JSON.stringify(buOf(ch))}`);
}
console.log('sameBu(衫颜鼾) =', JSON.stringify(sameBu(['衫', '颜', '鼾'])));
console.log('sameBu(坠还看) =', JSON.stringify(sameBu(['坠', '还', '看'])));
console.log('sameBu(衫,坠) =', JSON.stringify(sameBu(['衫', '坠'])));
const r = checkCi('浣溪沙', body);
console.log('\nlevel =', r.level);
console.log(JSON.stringify(r.issues, null, 1));
