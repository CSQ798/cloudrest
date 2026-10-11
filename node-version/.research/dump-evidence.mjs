// 给每个词牌打一张「证据表」：词谱结构 + 搜韵历代作品里通行标点的例子
// 用法：node dump-evidence.mjs > evidence.txt
import fs from 'node:fs';
import { TUNES } from '../server/tunes.mjs';

const CJK = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;
const STOP = new Set(['，', '。', '？', '！', '；', '、']);

function sentences(p) {
  const out = [];
  const re = /<div class='poemSentence'[^>]*>([\s\S]*?)<div id='poem_sentence_[^']*_comment'/g;
  let m;
  while ((m = re.exec(p))) out.push(m[1].replace(/<[^>]+>/g, ''));
  return out.join('');
}
function clauses(t) {
  const out = [];
  let run = '';
  for (const ch of t) {
    if (CJK.test(ch)) { run += ch; continue; }
    if (STOP.has(ch)) { if (run) out.push({ text: run, mark: ch }); run = ''; continue; }
    run = '';
  }
  if (run) out.push({ text: run, mark: '' });
  return out;
}

for (const tune of TUNES) {
  const file = new URL(`./html/${tune.name}.html`, import.meta.url);
  console.log('\n' + '='.repeat(70));
  console.log(`词牌：${tune.name}　${tune.desc}　例词作者：${tune.author}`);
  console.log(`lens   : ${JSON.stringify(tune.lens)}`);
  console.log(`stanzas: ${JSON.stringify(tune.stanzas)}`);
  console.log(`rhymes : ${JSON.stringify(tune.rhymes)}`);
  if (!fs.existsSync(file)) { console.log('（无缓存页面）'); continue; }
  const html = fs.readFileSync(file, 'utf8');
  const region = html.slice(Math.max(0, html.indexOf('历代作品')));
  const ps = region.split(/<div id='poem_\d+' class='_poem'>/).slice(1).map(sentences);
  const tally = {};
  for (const t of ps) {
    const cs = clauses(t);
    if (cs.length !== tune.lens.length) continue;
    if (cs.some((c, i) => [...c.text].length !== tune.lens[i])) continue;
    const key = cs.map((c) => c.mark).join('');
    (tally[key] = tally[key] || []).push(cs.map((c) => c.text + c.mark).join(''));
  }
  const rows = Object.entries(tally).sort((a, b) => b[1].length - a[1].length).slice(0, 6);
  if (!rows.length) { console.log('（结构吻合的作品：0）'); continue; }
  for (const [seq, list] of rows) {
    console.log(`  x${String(list.length).padStart(3)}  ${seq}`);
    console.log(`        ${list[0]}`);
  }
}
