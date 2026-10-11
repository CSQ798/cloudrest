// 在 id 区间里逐个验证，找到标题正是目标词牌的那一个
import fs from 'node:fs/promises';

const WANT = ['望海潮', '八声甘州', '水龙吟', '永遇乐', '扬州慢'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
          'Accept-Language': 'zh-CN,zh;q=0.9',
        },
      });
      if (res.status === 429 || res.status === 503) {
        await sleep(6000 * (i + 1));
        continue;
      }
      if (!res.ok) return null;
      const t = await res.text();
      if (t.length < 3000) {
        await sleep(6000 * (i + 1));
        continue;
      }
      return t;
    } catch {
      await sleep(5000 * (i + 1));
    }
  }
  return null;
}

// 待查区间：这几个词牌的常见体量都在 100 字上下，id 应在 400-700 之间
const RANGE = [];
for (let i = 380; i <= 720; i++) RANGE.push(i);

const hits = new Map(); // id -> 标题词牌名
console.log('开始逐个验证 id（慢，但每个都核对标题）…');
for (const id of RANGE) {
  if (hits.size >= WANT.length) break;
  const text = await get(`https://www.sou-yun.cn/QueryCiTune.aspx?id=${id}`, 2);
  if (!text) continue;
  const title = (text.match(/<title>([^<]*)<\/title>/i)?.[1] || '').replace(/^词牌\s*/, '').trim();
  if (!title) continue;
  for (const w of WANT) {
    if (title === w && !hits.has(w)) {
      hits.set(w, { id, title });
      await fs.writeFile(new URL(`./html/${w}.html`, import.meta.url), text, 'utf8');
      console.log(`✓ ${w} → id=${id}（已存盘）`);
    }
  }
  await sleep(1800);
}

console.log('\n结果：');
for (const w of WANT) {
  const h = hits.get(w);
  console.log(`  ${h ? '✓' : '✗'} ${w}${h ? ' id=' + h.id : ' 未找到'}`);
}
