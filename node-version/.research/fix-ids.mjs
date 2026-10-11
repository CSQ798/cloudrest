// 重查这 5 个词牌的正确 id：用站内搜索，逐个验证返回页的标题就是该词牌
import fs from 'node:fs/promises';

const WANT = ['望海潮', '八声甘州', '水龙吟', '永遇乐', '扬州慢'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
          'Accept-Language': 'zh-CN,zh;q=0.9',
        },
      });
      if (res.status === 429 || res.status === 503) {
        await sleep(8000 * (i + 1));
        continue;
      }
      if (!res.ok) return null;
      const t = await res.text();
      if (t.length < 3000) {
        await sleep(8000 * (i + 1));
        continue;
      }
      return t;
    } catch {
      await sleep(6000 * (i + 1));
    }
  }
  return null;
}

// 先抓词牌列表，把 id→名称 映射正确建起来（上次可能就是这里错了）
const found = new Map();
for (let page = 0; page < 8; page++) {
  const url = page === 0 ? 'https://www.sou-yun.cn/QueryCiTune.aspx' : `https://www.sou-yun.cn/QueryCiTune.aspx?page=${page - 1}`;
  const text = await get(url);
  if (!text) break;
  // 只在「词牌列表」区块里取：形如 QueryCiTune.aspx?id=NNN ... >名称<
  const re = /QueryCiTune\.aspx\?id=(\d+)[^>]*>\s*([^<>]{1,10}?)\s*</g;
  let m;
  while ((m = re.exec(text))) {
    const name = m[2].replace(/[《》\s]/g, '');
    if (name && !found.has(name)) found.set(name, m[1]);
  }
  await sleep(3000);
}

console.log(`列表里取到 ${found.size} 个词牌名`);
const result = {};
for (const w of WANT) {
  const id = found.get(w);
  if (!id) {
    console.log(`✗ ${w} 在列表里找不到`);
    continue;
  }
  // 逐个验证：抓该 id 的页面，看标题是否真是这个词牌
  const text = await get(`https://www.sou-yun.cn/QueryCiTune.aspx?id=${id}`);
  const title = text ? (text.match(/<title>([^<]*)<\/title>/i)?.[1] || '').trim() : '';
  const ok = title.includes(w);
  console.log(`${ok ? '✓' : '✗'} ${w} id=${id} 标题=「${title}」`);
  if (ok) {
    await fs.writeFile(new URL(`./html/${w}.html`, import.meta.url), text, 'utf8');
    result[w] = id;
  } else {
    console.log(`    该 id 实际是别的词牌，弃用`);
  }
  await sleep(4000);
}
console.log('\n正确 id：' + JSON.stringify(result, null, 0));
