// 前端分行逻辑的离线验证：按句长整齐度切句，流式与一次性必须一致
function pickSize(n) {
  let best = -1;
  let bestCost = Infinity;
  for (const c of [7, 6, 5]) {
    if (c > n) continue;
    let cost;
    if (c === n) {
      cost = 2.2 + 0.008;
    } else {
      const whole = Math.floor(n / c);
      const rest = n % c;
      cost = (rest ? 2 : 1) * 2.2 + (whole + (rest ? 1 : 0)) * 0.008;
    }
    if (cost < bestCost) {
      bestCost = cost;
      best = c;
    }
  }
  return best > 0 ? best : Math.max(n, 1);
}

function normalizeBody(raw) {
  const strip = (s) => s.replace(/[\s，。、；：！？·「」『』（）()]/g, '');
  const ch = strip(raw);
  if (!ch) return [];
  const segs = raw
    .split('\n')
    .map(strip)
    .filter((s) => s !== '');
  if (segs.length > 1) {
    const lens = segs.map((s) => s.length);
    const modal = lens.slice().sort((a, b) => a - b)[Math.floor(lens.length / 2)];
    if (modal >= 4 && lens.every((n) => n <= modal * 2)) {
      return segs.flatMap((s) => {
        const size = pickSize(s.length);
        const out = [];
        for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
        return out;
      });
    }
  }
  const size = pickSize(ch.length);
  const out = [];
  for (let i = 0; i < ch.length; i += size) out.push(ch.slice(i, i + size));
  return out;
}

const CASES = [
  ['五绝·一句一行', '日斜灶火暖\n面白碗沿青\n为我添新箸\n低头理旧瓶', [5, 5, 5, 5]],
  ['七绝·一句一行', '纸箱捆尽屋初空\n门隙斜阳到檐东\n一架尘衣悬挂久\n风来独自响玲珑', [7, 7, 7, 7]],
  ['七绝·整首一行带标点', '纸箱捆尽屋初空，门隙斜阳到檐东。一架尘衣悬挂久，风来独自响玲珑。', [7, 7, 7, 7]],
  [
    '七律·整首一行',
    '推车逐货过衡门，暖气干灯午易昏。骤起乡音疑巷口，回看鬓发已霜根。分明藕臂渔歌渡，忽作莼洲菜担村。怕认横眸先自笑，低头拣蛋未寒温。',
    [7, 7, 7, 7, 7, 7, 7, 7],
  ],
  ['五绝·逗号连行', '日斜灶火暖，面白碗沿青\n为我添新箸，低头理旧瓶', [5, 5, 5, 5]],
  ['五律·无标点连写', '灯低光半壁纸展字微斜身倦翻茶叶杯凉未续些', [5, 5, 5, 5]],
  [
    '临江仙·靠分行认句（词本就长短句）',
    '楼角铃声惊旧雨\n寻常一句还行\n玻璃窗上映微灯\n两肩披暮色\n十指攥空瓶\n说尽平安天气好\n无言立到声停\n阶前秋叶自飘零\n当时谁种得\n却向此人青',
    [7, 6, 7, 5, 5, 7, 6, 7, 5, 5],
  ],
  [
    '六十字连写（六言最整齐）',
    '楼角铃声惊旧雨寻常一句还行玻璃窗上映微灯两肩披暮色十指攥空瓶说尽平安天气好无言立到声停阶前秋叶自飘零当时谁种得却向此人青',
    [6, 6, 6, 6, 6, 6, 6, 6, 6, 6],
  ],
  [
    '二十五字连写（五言最整齐）',
    '日斜灶火暖面白碗沿青为我添新箸低头理旧瓶风来无一事',
    [5, 5, 5, 5, 5],
  ],
  ['流式中途（不足一句也不吞字）', '日斜灶火', [4]],
];

let bad = 0;
function check(name, got, want) {
  const gotLens = got.map((l) => [...l].length);
  const ok = gotLens.length === want.length && gotLens.every((n, i) => n === want[i]);
  if (!ok) bad++;
  console.log(`${ok ? '✓' : '✗'} ${name} → ${gotLens.length} 句 ${gotLens.join('/')} 字`);
  if (!ok) console.log('    ' + got.join(' | '));
}

for (const [name, text, want] of CASES) {
  check(name, normalizeBody(text), want);
}

// 流式：把整首切碎喂进去，结果必须与一次性喂入完全相同
function feed(chunks) {
  let raw = '';
  let lines = [];
  for (const c of chunks) {
    raw += c;
    lines = normalizeBody(raw);
  }
  return lines;
}
const full = '推车逐货过衡门，暖气干灯午易昏。骤起乡音疑巷口，回看鬓发已霜根。分明藕臂渔歌渡，忽作莼洲菜担村。怕认横眸先自笑，低头拣蛋未寒温。';
const targets = normalizeBody(full);
for (const size of [1, 2, 3, 5, 7, 13]) {
  const chunks = [];
  for (let i = 0; i < full.length; i += size) chunks.push(full.slice(i, i + size));
  const got = feed(chunks);
  const same = JSON.stringify(got) === JSON.stringify(targets);
  if (!same) bad++;
  console.log(`${same ? '✓' : '✗'} 每 ${size} 字一块流式进入 → 与一次性解析一致`);
  if (!same) console.log('    ' + got.join(' | '));
}

console.log(bad === 0 ? '\n全部通过' : `\n${bad} 个用例未通过`);
process.exit(bad === 0 ? 0 : 1);
