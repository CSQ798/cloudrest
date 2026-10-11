// 长调补抓：搜韵限流很凶，用长退避 + 多次重试，后台慢慢跑
import fs from 'node:fs/promises';

const TUNES = {
  水调歌头: 516, 念奴娇: 614, 满江红: 494, 沁园春: 775, 雨霖铃: 678,
  永遇乐: 640, 水龙吟: 500, 八声甘州: 233, 望海潮: 452, 扬州慢: 596,
  六州歌头: 371, 贺新郎: 552, 木兰花慢: 279, 高阳台: 439, 齐天乐: 398,
};

const dir = new URL('./html/', import.meta.url);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchOne(name, id) {
  const file = new URL(`${name}.html`, dir);
  try {
    const st = await fs.stat(file);
    if (st.size > 20000) {
      console.log(`· ${name} 已有（${st.size} 字节），跳过`);
      return true;
    }
  } catch {}

  // 每次尝试之间拉长等待：限流通常几分钟就解
  const waits = [5000, 20000, 45000, 90000, 150000];
  for (let i = 0; i < waits.length; i++) {
    try {
      const res = await fetch(`https://www.sou-yun.cn/QueryCiTune.aspx?id=${id}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'zh-CN,zh;q=0.9',
        },
      });
      if (res.status === 429 || res.status === 503) {
        console.log(`  ${name} ${res.status}，第 ${i + 1} 次退避，等 ${waits[i] / 1000}s`);
        await sleep(waits[i]);
        continue;
      }
      if (!res.ok) {
        console.log(`  ${name} HTTP ${res.status}`);
        return false;
      }
      const text = await res.text();
      if (text.length < 20000) {
        console.log(`  ${name} 内容过短（${text.length}），疑为限流页，等 ${waits[i] / 1000}s`);
        await sleep(waits[i]);
        continue;
      }
      await fs.writeFile(file, text, 'utf8');
      console.log(`✓ ${name} (id=${id}) ${text.length} 字节`);
      return true;
    } catch (e) {
      console.log(`  ${name} 请求异常：${e.message}，等 ${waits[i] / 1000}s`);
      await sleep(waits[i]);
    }
  }
  console.log(`✗ ${name} 多次尝试仍未取到`);
  return false;
}

let ok = 0;
for (const [name, id] of Object.entries(TUNES)) {
  if (await fetchOne(name, id)) ok++;
  await sleep(4000);
}
console.log(`\n本轮取到 ${ok}/${Object.keys(TUNES).length}`);
