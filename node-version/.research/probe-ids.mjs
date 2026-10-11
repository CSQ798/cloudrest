// 小范围探测：上次错抓的 id 与正确 id 相差约 +8/+9，逐一验证标题后再收
import fs from 'node:fs/promises';

// 目标词牌 → 上次用错的 id
const TARGETS = {
  望海潮: 452,
  八声甘州: 233,
  水龙吟: 500,
  永遇乐: 640,
  扬州慢: 596,
};

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
        await sleep(9000 * (i + 1));
        continue;
      }
      if (!res.ok) return null;
      const t = await res.text();
      if (t.length < 20000) {
        await sleep(9000 * (i + 1));
        continue;
      }
      return t;
    } catch {
      await sleep(7000 * (i + 1));
    }
  }
  return null;
}

// 每个目标只试 8 个候选 id（6..12 偏移），够便宜
const OFFSETS = [6, 7, 8, 9, 10, 11, 12];
const found = {};
for (const [name, wrongId] of Object.entries(TARGETS)) {
  let got = false;
  for (const off of OFFSETS) {
    const id = wrongId + off;
    const text = await get(`https://www.sou-yun.cn/QueryCiTune.aspx?id=${id}`, 2);
    if (!text) {
      console.log(`  ${name} id=${id} 取不到`);
      continue;
    }
    const title = (text.match(/<title>([^<]*)<\/title>/i)?.[1] || '').replace(/^词牌\s*/, '').trim();
    console.log(`  ${name} id=${id} 标题=「${title}」`);
    if (title === name) {
      await fs.writeFile(new URL(`./html/${name}.html`, import.meta.url), text, 'utf8');
      found[name] = id;
      console.log(`✓ ${name} → id=${id}（已存盘）`);
      got = true;
      break;
    }
    await sleep(2500);
  }
  if (!got) console.log(`✗ ${name} 未在候选区间内找到`);
  await sleep(3000);
}

console.log('\n结果：' + JSON.stringify(found, null, 0));
const ok = Object.keys(found).length;
console.log(`${ok}/5 找到正确 id`);
