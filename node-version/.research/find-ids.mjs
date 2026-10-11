// 从搜韵词牌列表里找出目标词牌的 id（带节流与重试）
const WANT = [
  '浣溪沙', '蝶恋花', '清平乐', '临江仙', '鹧鸪天', '虞美人', '忆江南',
  '相见欢', '如梦令', '菩萨蛮', '西江月', '卜算子', '定风波', '雨霖铃',
  '青玉案', '一剪梅', '玉楼春', '渔家傲', '点绛唇', '踏莎行',
  '水调歌头', '念奴娇', '满江红', '沁园春', '鹊桥仙', '生查子',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
    });
    if (res.status === 429 || res.status === 503) {
      const wait = 3000 * (i + 1);
      console.log(`  ${res.status} 限流，等 ${wait}ms 重试`);
      await sleep(wait);
      continue;
    }
    return res;
  }
  return null;
}

const found = new Map();
for (let page = 0; page < 6; page++) {
  const url = page === 0 ? 'https://www.sou-yun.cn/QueryCiTune.aspx' : `https://www.sou-yun.cn/QueryCiTune.aspx?page=${page - 1}`;
  const res = await get(url);
  if (!res || !res.ok) {
    console.log(`第 ${page} 页取不到（${res ? res.status : 'no response'}），停`);
    break;
  }
  const text = await res.text();
  console.log(`第 ${page} 页 ${text.length} 字节`);
  const re = /QueryCiTune\.aspx\?id=(\d+)[^>]*>\s*([^<]{1,12}?)\s*</g;
  let m;
  while ((m = re.exec(text))) {
    const name = m[2].replace(/[《》\s]/g, '');
    if (name && !found.has(name)) found.set(name, m[1]);
  }
  await sleep(2500);
}

console.log('\n列表里共取到', found.size, '个词牌');
const hits = [];
for (const w of WANT) {
  const id = found.get(w);
  if (id) hits.push(`${w}=${id}`);
  console.log(`${id ? '✓' : '✗'} ${w}${id ? '  ' + id : ''}`);
}
console.log('\n命中的：' + hits.join(' '));
