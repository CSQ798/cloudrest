// 抓取目标词牌的词谱页，存进 html/ 供离线解析
import fs from 'node:fs/promises';
import path from 'node:path';

const TUNES = {
  忆江南: 23, 如梦令: 57, 相见欢: 69, 生查子: 81, 点绛唇: 91, 浣溪沙: 96,
  菩萨蛮: 105, 卜算子: 110, 清平乐: 126, 西江月: 190, 临江仙: 246,
  鹧鸪天: 268, 虞美人: 271, 玉楼春: 273, 鹊桥仙: 275, 踏莎行: 295,
  蝶恋花: 304, 一剪梅: 313, 定风波: 325, 渔家傲: 328, 青玉案: 355,
  满江红: 494, 水调歌头: 516, 念奴娇: 614, 雨霖铃: 678, 沁园春: 775,
};

const dir = new URL('./html/', import.meta.url);
await fs.mkdir(dir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const [name, id] of Object.entries(TUNES)) {
  const file = new URL(`./html/${name}.html`, import.meta.url);
  try {
    const stat = await fs.stat(file);
    if (stat.size > 5000) {
      console.log(`· ${name} 已有（${stat.size} 字节），跳过`);
      continue;
    }
  } catch {}

  let ok = false;
  for (let attempt = 0; attempt < 4 && !ok; attempt++) {
    const res = await fetch(`https://www.sou-yun.cn/QueryCiTune.aspx?id=${id}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
    });
    if (res.status === 429 || res.status === 503) {
      const wait = 4000 * (attempt + 1);
      console.log(`  ${name} 限流，等 ${wait}ms`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) {
      console.log(`  ${name} HTTP ${res.status}`);
      break;
    }
    const text = await res.text();
    if (text.length < 5000) {
      console.log(`  ${name} 内容过短（${text.length}），重试`);
      await sleep(3000);
      continue;
    }
    await fs.writeFile(file, text, 'utf8');
    console.log(`✓ ${name} (id=${id}) ${text.length} 字节`);
    ok = true;
  }
  await sleep(2600);
}
console.log('抓取结束');
