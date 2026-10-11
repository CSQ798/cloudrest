// 抓搜韵「对仗词汇」索引，供对仗校验用
// 搜韵有「对仗詞彙」查询页：https://www.sou-yun.cn/QueryCoupletWord.aspx
import fs from 'node:fs/promises';

const dir = new URL('./html-couplet/', import.meta.url);
await fs.mkdir(dir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
    });
    if (res.status === 429 || res.status === 503) {
      await sleep(4000 * (i + 1));
      continue;
    }
    return res;
  }
  return null;
}

// 先看看首页结构
const res = await get('https://www.sou-yun.cn/QueryCoupletWord.aspx');
if (!res || !res.ok) {
  console.log('取不到对仗词汇页：', res ? res.status : 'no response');
  process.exit(1);
}
const html = await res.text();
await fs.writeFile(new URL('./couplet-index.html', import.meta.url), html, 'utf8');
console.log('首页字节数', html.length);

// 找形如 ?id= 的链接
const links = [...new Set([...html.matchAll(/QueryCoupletWord\.aspx\?([^"'#]+)/g)].map((m) => m[1]))];
console.log('链接样本：');
for (const l of links.slice(0, 20)) console.log('  ' + l);

// 找出页面里的字数/分类入口文字
const text = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
console.log('\n正文片段：', text.slice(0, 600));
