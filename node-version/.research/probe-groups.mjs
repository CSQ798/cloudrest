// 用韵书实测：每个词牌各片的韵脚能否各自归为一组
import fs from 'node:fs/promises';
import { buOf } from '../server/rhyme.mjs';
import { getTune } from '../server/tunes.mjs';

const parsed = JSON.parse(await fs.readFile(new URL('./parsed.json', import.meta.url), 'utf8'));

function partition(idxChars) {
  // 返回 [[char...], ...]，同组内两两可通韵
  const groups = [];
  let cur = [];
  let curTones = new Set();
  for (const { ch, bu } of idxChars) {
    const tone = bu.length && bu.every((x) => x <= 19) ? null : null;
    if (cur.length === 0) {
      cur.push({ ch, bu });
      continue;
    }
    const ok = cur.every((c) => !c.bu.length || !bu.length || c.bu.some((x) => bu.includes(x)));
    if (ok) cur.push({ ch, bu });
    else {
      groups.push(cur);
      cur = [{ ch, bu }];
    }
  }
  if (cur.length) groups.push(cur);
  return groups;
}

console.log('词牌　　　分片　　实测韵组（按例词韵脚）');
for (const r of parsed) {
  if (r.error || !r.sentences) continue;
  const tune = getTune(r.name);
  const lines = r.sentences.map((s) => s.text);
  let cursor = 0;
  const perStanza = [];
  for (const n of tune.stanzas) {
    const idxs = [];
    for (let i = cursor; i < cursor + n; i++) if (tune.rhymes[i]) idxs.push(i);
    cursor += n;
    const items = idxs.map((i) => {
      const ch = lines[i].slice(-1);
      return { ch, bu: buOf(ch) };
    });
    const groups = partition(items);
    perStanza.push(groups.map((g) => g.map((x) => x.ch).join('')).join(' | '));
  }
  const counts = perStanza.map((s) => s.split('|').length);
  console.log(
    `${r.name.padEnd(5, '　')} ${tune.stanzas.join('+').padEnd(6)} ` +
      perStanza.map((s, i) => `[${s}]`).join(' ') +
      `　→ 每组数 ${counts.join('+')}`
  );
}
