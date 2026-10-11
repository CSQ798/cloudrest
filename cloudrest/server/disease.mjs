// 云卷云舒 · 诗病自检
//
// 为什么要有这个文件：
//   server/validator.mjs 管的是**格律**——句数、字数、平仄、韵部、对仗硬伤。
//   那些都是「对错」，可以判死。可是诗还有一层「病」：格律全对，读起来仍然是坏诗 ——
//   套语堆砌、颜色数字滥用、意象打架、合掌、重字重韵、生造词、用典编造出处。
//   这一层没有一条能靠一条规则判死，但**能数出来**。数出来的东西给两处用：
//     一、喂回模型（「这几处再改」），它比一句空泛的「再雅一点」有用得多；
//     二、摊在页面上给你看（左栏「诗病自检」），你能一眼看出这一稿病在哪。
//
// 分寸（这一点比功能重要）：
//   · 凡词表判定的（套语、颜色、数字、生造嫌疑），一律只报「提示」，
//     绝不退回重写 —— 词表必有边界，「人间万事何时了」也是真诗。
//   · 凡能确证的（合掌同位同义、重韵、用典出处不在所给典目、物候硬冲突），
//     才报「宜改」，且一定带上根据（哪一句、哪两个字）。
//   · 报不出理由的一律不报。宁可少报，不可乱报。
//
// 与提示词的关系：本文件里的词表与 server/prompt.mjs 的《要精确，不要漂亮》同源，
//   改准则时两边要一起改。.test/craft-test.mjs 会把这件事钉住。

import { checkModern } from './validator.mjs';
import { getShi } from './shi.mjs';
import { toneOf, pingYunListOf } from './pingshui.mjs';
import { rhymePlan } from './voice.mjs';
import { isOn } from './flags.mjs';

/* ============================================================
 * 一、词表
 * ============================================================ */

/** 陈词套语：古人已用尽，再用等于不写（二十、四十条） */
const CLICHE = [
  '斜阳', '夕阳', '孤舟', '扁舟', '浊酒', '青衫', '红尘', '天涯', '断肠', '梦回',
  '流年', '岁月', '韶华', '浮生', '光阴', '年华', '芳华', '缱绻', '阑珊', '氤氲',
  '归鸿', '西风', '烟雨', '残月', '孤灯', '落花', '流水', '明月', '清风', '浮云',
  '离愁', '相思', '凭栏', '惆怅', '凄凉', '寂寞', '沧桑', '浅笑', '安好', '静好',
];

/** 颜色字（二十一） */
const COLORS = [...'青白红碧苍翠丹紫绿朱素皓绯黛'];

/** 数字与程度字（二十二）：只列真是数字或程度的，免得误伤 */
const NUMBERS = [...'千万孤独半一百十双'];

/** 空泛的抽象时间词（二十三）：已在 CLICHE 里的不重复列 */
const VAGUE_TIME = ['时光', '千秋', '万古', '前世', '来生', '浮世', '人间', '尘世', '江湖'];

/**
 * 生造嫌疑（第十九）：抽象字 + 自然字的二字节组合。
 * 这类组合里确实有些是现成的词（愁云、心香），所以只报「提示」，并且要求
 * 两个字都不是常见的固定搭配字（下面 REAL_WORDS 里列出的都放过）。
 */
const ABSTRACT = [...'愁思梦心魂恨情泪怨悲欢幽寒香孤冷'];
const NATURE = [...'云月风雨烟霜雪花山水露霞波林江秋春'];
const REAL_WORDS = new Set([
  '愁云', '愁烟', '愁心', '思乡', '思君', '梦魂', '梦云', '心香', '心月', '寒云', '寒烟',
  '寒山', '寒江', '寒花', '香云', '香雪', '香风', '孤云', '孤月', '孤舟', '孤灯', '孤山',
  '冷云', '冷月', '冷烟', '冷香', '幽云', '幽月', '幽花', '幽香', '悲风', '悲秋', '怨月',
  '欢情', '情云', '泪雨', '泪花', '魂梦', '恨水', '恨月', '楚云', '楚江',
]);

/** 物候 → 季节。只列**确定**的，不确定的不列，宁可漏判（三十三、三十四） */
const SEASON = {
  春: ['桃', '杏', '梨', '海棠', '柳', '燕', '莺', '蝶', '杜鹃', '清明', '春', '东风', '芍药', '牡丹', '荼蘼'],
  夏: ['荷', '莲', '蝉', '蛙', '榴', '蒲', '薰风', '梅雨', '小满', '盛夏', '芙蕖'],
  秋: ['菊', '桂', '枫', '雁', '蛩', '霜', '重阳', '蒹葭', '梧桐', '中秋', '西风', '砧', '木叶'],
  冬: ['雪', '冰', '炉', '炭', '朔风', '腊', '貂', '冬至', '梅'],
};

/**
 * 只在**确实不可能同框**时才报的冲突对（三十三）。
 * 梅花开在冬末春初、荷花在夏，这两样同框是历来的笑柄，所以说得出道理；
 * 「春 + 秋」不作判定 —— 今昔对照、怀古诗里多得是。
 */
const SEASON_CLASH = [
  [['荷', '莲', '芙蕖'], ['雪', '冰', '梅', '菊', '桂', '霜', '枫']],
  [['蝉', '蛙'], ['雪', '冰', '梅', '菊', '霜']],
  [['桃', '杏', '海棠', '牡丹', '芍药'], ['菊', '桂', '雪', '冰', '霜', '枫']],
];

/** 地理：南北同框要问一句（三十三、五十四） */
const NORTH = ['塞北', '塞外', '朔漠', '阴山', '玉门', '关山', '燕山', '瀚海', '大漠', '长城', '陇'];
const SOUTH = ['江南', '西湖', '潇湘', '吴越', '钱塘', '岭南', '姑苏', '秦淮', '巴蜀', '蜀'];

/**
 * 同义组：组内任意两个词出现在对句的**同一位置**，即为合掌（第七条）。
 * 「神州/华夏」这种是古人的笑柄，摆在一起读一遍就露。
 *
 * 分寸：这里只列**真正同义**的。有意排除两类，否则会冤枉好诗 ——
 *   · 数字（千/万/百/十）：数量对数量是正对，杜甫「万里悲秋」对「百年多病」
 *     正是空间对时间的名对，不是合掌；
 *   · 颜色（青/苍/碧/翠）：青山对碧水是工对，不是合掌。
 * 这两条都是实测踩出来的（《登高》曾被冤判合掌）。
 */
const SYN_GROUPS = [
  ['神州', '华夏', '九州', '赤县', '中国', '中土'],
  ['孤', '独', '单', '只'],
  ['舟', '船', '舸'],
  ['望', '看', '见', '视', '观', '瞻'],
  ['寒', '冷', '凉', '冰'],
  ['悲', '愁', '哀', '伤', '恨'],
  ['尽', '绝', '穷', '竭'],
  ['长', '远', '遥', '迢'],
  ['白', '素', '皓', '皎'],
  ['红', '赤', '朱', '丹', '绯'],
  ['行', '走', '趋'],
  ['归', '返', '还', '回'],
  ['高', '崇', '峻', '危'],
  ['清', '净', '澄', '澈'],
  ['山', '岭', '峰', '岳'],
  ['水', '江', '河', '川'],
  ['花', '蕊', '英', '芳'],
  ['夜', '宵'],
  ['老', '衰', '暮'],
  ['愁', '忧', '戚'],
  ['空', '虚', '无'],
  ['明', '朗', '亮'],
  ['旧', '故', '昔', '往'],
];

/* ============================================================
 * 二、小工具
 * ============================================================ */

const han = (s) => [...String(s || '')].filter((c) => /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/.test(c));

/**
 * 一个字的**声调**：平 / 上 / 去 / 入；兼属数声返回「多」，未收录返回 ''。
 * toneOf 只给平/仄，判「上尾」不够用 —— 上尾说的正是同一声调，不是同一个平仄。
 */
function diaoOf(ch) {
  const names = pingYunListOf(ch) || [];
  const ds = new Set();
  for (const n of names) {
    const head = String(n).replace(/^[上下]/, '').slice(0, 1); // 上平/下平 → 平
    if (head === '平') ds.add('平');
    else if (head === '上') ds.add('上');
    else if (head === '去') ds.add('去');
    else if (head === '入') ds.add('入');
  }
  if (ds.size === 1) return [...ds][0];
  return ds.size > 1 ? '多' : '';
}

function countHits(lines, table) {
  const hits = new Map();
  for (const w of table) {
    const n = lines.reduce((total, l) => total + (l.split(w).length - 1), 0);
    if (n) hits.set(w, n);
  }
  return hits;
}

const sum = (m) => [...m.values()].reduce((a, b) => a + b, 0);

/** 中间两联（律诗）的对句行对；不适用则返回空数组 */
function coupletsOf(form, lines) {
  if (!getShi(form)) return [];
  const spec = getShi(form);
  if (!spec.couplets) return [];
  // 律诗八句：中间两联是第 2、3 联（第 3~6 句）
  const out = [];
  for (let c = 1; c < spec.couplets - 1; c++) {
    const a = lines[c * 2];
    const b = lines[c * 2 + 1];
    if (a && b && han(a).length === han(b).length) out.push({ c, a, b });
  }
  return out;
}

/* ============================================================
 * 三、自检
 * ============================================================ */

/**
 * @param {{form:string, bodyLines:string[], fields?:object, allusionMenu?:string[],
 *          rhymeChars?:string[]}} input
 *        rhymeChars 由调用方按词谱的韵位算好传入（词）；不传就按近体诗的偶句取。
 * @returns {{level:'ok'|'note'|'warn', findings:Array<{id,name,severity,text}>, plan:object|null, stats:object}}
 */
export function diagnose({ form, bodyLines, fields = {}, allusionMenu = [], rhymeChars = [], scene = '' }) {
  const lines = (Array.isArray(bodyLines) ? bodyLines : []).map((l) => String(l || '').trim()).filter(Boolean);
  const F = [];
  const add = (id, name, severity, text) => F.push({ id, name, severity, text });
  // 空稿也要返回**同一组字段** —— 第十轮总验收时踩到：这条早返回少了 realm/make/live，
  // 左栏「境界」一行就整个空掉，而且调用方要写两种取值方式。任何出口都长一样，才算稳。
  if (!lines.length) {
    return { level: 'ok', findings: [], plan: null, realm: null, make: null, live: [], stats: {} };
  }

  const shi = getShi(form);
  const isShi = Boolean(shi);

  /* ---- 一、词语 ---- */

  // 现代语汇（validator 已有同表，这里合并进同一份自检表里，只提示）
  const modern = new Set();
  for (const l of lines) for (const w of checkModern(l)) modern.add(w);
  if (modern.size) add('modern', '现代语汇', 'warn', `疑似白话或现代词：${[...modern].join('、')}。`);

  const cliche = countHits(lines, CLICHE);
  if (sum(cliche) >= 2) {
    add('cliche', '陈词套语', 'note', `套语 ${sum(cliche)} 处：${[...cliche.keys()].slice(0, 6).join('、')}。古人已用尽，再用等于不写。`);
  } else if (sum(cliche) === 1 && lines.length <= 4) {
    add('cliche', '陈词套语', 'note', `用了套语「${[...cliche.keys()][0]}」，若无实景可依，换掉更好。`);
  }

  const colors = countHits(lines, COLORS);
  if (sum(colors) >= 3) {
    add('color', '颜色字偏多', 'note', `颜色字 ${sum(colors)} 个（${[...colors.keys()].join('、')}）。颜色一多，画面反而糊。`);
  }
  const nums = countHits(lines, NUMBERS);
  if (sum(nums) >= 4) {
    add('number', '数字与程度字偏多', 'note', `数字/程度字 ${sum(nums)} 个（${[...nums.keys()].join('、')}）。查一查是不是拿它们凑字。`);
  }
  const vague = countHits(lines, VAGUE_TIME);
  if (sum(vague)) {
    add('vagetime', '空泛时间词', 'note', `「${[...vague.keys()].join('、')}」失之空泛，若能落到具体的时与物更实。`);
  }

  // 生造嫌疑：抽象字 + 自然字，且不是现成的词
  const coins = new Set();
  for (const l of lines) {
    const cs = han(l);
    for (let i = 0; i + 1 < cs.length; i++) {
      const bg = cs[i] + cs[i + 1];
      if (ABSTRACT.includes(cs[i]) && NATURE.includes(cs[i + 1]) && !REAL_WORDS.has(bg)) coins.add(bg);
    }
  }
  if (coins.size) {
    add('coinage', '生造嫌疑', 'note', `「${[...coins].join('、')}」不像现成的词，若是为凑平仄硬拼的，须换。`);
  }

  // 尺度 / 身份 / 情绪 / 器物：四堵墙（只提示）
  for (const m of sceneMismatches(scene, fields, lines)) add(m.field, { scale: '尺度脱钩', identity: '身份错位', emotion: '小愁大悲', object: '器物失真' }[m.field] || m.field, 'note', m.text);
  for (const m of allusionGrounding(fields, lines)) add('allusion-bare', '用典未落地', 'warn', m.text);

  // 境界：代字（三十四则，只提示）、「既着色又说破」（三则，宜改）、造境/写境（二则，只提示）
  for (const m of substituteFindings(lines)) add('substitute', '用了代字', 'note', m.text);
  for (const m of realmFindings(lines)) add('realm-broken', '境界说破', 'warn', m.text);
  const make = makeOf(lines, scene, String(fields.realm || ''));
  for (const m of makeFindings(make)) add('make', '造境写境与自报不合', 'note', m.text);
  // 隔：只报「眼前空着」这一种明明白白的隔，绝不报「不隔」（第四十、四十一则）
  // 隔分两档：明显则提示；「雾里看花」那一档（典是实景三倍以上）才退稿
  for (const m of geFindings(lines)) add('ge', '隔（眼前空着）', detectGe(lines).severe ? 'warn' : 'note', m.text);
  // 真景物真感情（第六则）：景语皆情语，只摆物不动情的是布景板
  for (const m of staticFindings(lines)) add('static', '只摆物、不动情', 'note', m.text);
  // 一字境界全出（第七则）：先报活字（功），再核它自己的指认（过）
  for (const m of eyeFindings(fields, lines)) add(m.field, m.field === 'eye-claim' ? '指认的那个字对不上' : '没指出那一个字', m.severity || 'note', m.text);
  // 忌游词（第六十一则）：空泛不切的垫字句
  for (const m of youciFindings(lines)) add('youci', '游词（说了等于没说）', 'note', m.text);
  // 一切景语皆情语：情景两张皮
  for (const m of qingJing(lines)) add('qingjing', '情景两张皮', 'note', m.text);

  /* ---- 二、意象 ---- */

  const joined = lines.join('');
  for (const [a, b] of SEASON_CLASH) {
    const ha = a.filter((w) => joined.includes(w));
    const hb = b.filter((w) => joined.includes(w));
    if (ha.length && hb.length) {
      add('wuhou', '物候相冲', 'warn', `「${ha.join('、')}」与「${hb.join('、')}」不同时，同框即破境。`);
      break;
    }
  }
  const north = NORTH.filter((w) => joined.includes(w));
  const south = SOUTH.filter((w) => joined.includes(w));
  if (north.length && south.length) {
    add('geo', '地理相混', 'note', `北地「${north.join('、')}」与南国「${south.join('、')}」同篇。若是今昔对照则无妨，否则须改。`);
  }

  // 妆束（第八轮 · 第五十六则）：生造、套语、代字，三样凑在一起就是「矫揉妆束之态」
  // 「大家之作……其辞脱口而出，无矫揉妆束之态。以其所见者真，所知者深也。」
  // 单一样出现时前面各有小提示，不重复说话；两样以上同时上身，才是**妆饰过了头**。
  {
    const subsHit = SUBSTITUTE.filter((x) => joined.includes(x.word));
    const dressed = [
      coins.size ? `生造（${[...coins].slice(0, 3).join('、')}）` : '',
      sum(cliche) >= 2 ? `套语（${[...cliche.keys()].slice(0, 3).join('、')}）` : '',
      subsHit.length ? `代字（${subsHit.slice(0, 3).map((x) => x.word).join('、')}）` : '',
    ].filter(Boolean);
    if (dressed.length >= 2) {
      add('dressed', '矫揉妆束', 'note',
        `${dressed.join('；')} —— ${dressed.length} 样同时上身。王国维说大家之作「其辞脱口而出，无矫揉妆束之态」：` +
        `妆饰一多，露出来的就不是所见者真，而是用力。挑最要紧的一处留下，其余脱掉。`);
    }
  }

  // 感官单一：只写看，不写听嗅触（三十五、三十六）
  const heard = /闻|听|声|响|喧|鸣|语|唤|歌|啸|啼|吟|唱|泣|咽|吼|嘶|滴|溅|敲|拍|打|萧萧|潺|泠|咽/.test(joined);
  const felt = /寒|冷|暖|热|湿|润|涩|滑|重|压|疼|痛|倦|醉|饥|渴|香|臭|腥|冻|燠|燥/.test(joined);
  if (!heard && !felt && lines.length >= 6) {
    add('sense', '只用了眼睛', 'note',
      '通篇以视觉为主，未及声音、温度、气味、身体感。若能添一处听觉或触觉，境会更立体 —— 若有意只写目之所见，可以不管。');
  }

  /* ---- 三、声律 ---- */

  // 重韵：同一个字做了两次韵脚（叠句不算）
  const rhymeIdx = [];
  // 近体诗首句**入韵**时，首句末字也是一个韵脚。第六轮实测踩到过：
  // 一首五律的韵脚是「身、尘、人、身」——首句与末句同字，是货真价实的重韵，
  // 而第一版只数偶句（2、4、6、8），首句不在其中，漏了。
  const evenEnds = [];
  for (let i = 1; i < lines.length; i += 2) {
    const c = han(lines[i]).slice(-1)[0];
    if (c) evenEnds.push(c);
  }
  if (evenEnds.length >= 2) {
    const first = han(lines[0]).slice(-1)[0];
    // 首句末字与其余韵脚同属一个平水韵目 → 认定首句入韵
    const firstMu = first ? new Set(pingYunListOf(first) || []) : new Set();
    const shares = firstMu.size && evenEnds.some((c) => (pingYunListOf(c) || []).some((m) => firstMu.has(m)));
    if (first && shares) rhymeIdx.push(0);
  }
  for (let i = 1; i < lines.length; i += 2) rhymeIdx.push(i);
  const seen = new Map();
  for (const i of rhymeIdx.sort((a, b) => a - b)) {
    const last = han(lines[i]).slice(-1)[0];
    if (!last) continue;
    if (seen.has(last)) {
      const prev = seen.get(last);
      if (i - prev > 1) add('chongyun', '重韵', 'warn', `「${last}」做了两次韵脚（第 ${prev + 1} 句、第 ${i + 1} 句）。近体与词皆忌重韵。`);
    } else seen.set(last, i);
  }

  // 重字：近体诗最忌；词里允许（尤其叠句），只提示
  const charPos = new Map();
  lines.forEach((l, i) => {
    const cs = han(l);
    cs.forEach((c, k) => {
      if (!charPos.has(c)) charPos.set(c, []);
      charPos.get(c).push({ line: i, col: k });
    });
  });
  const dupes = [];
  for (const [c, ps] of charPos) {
    if (ps.length < 2) continue;
    // 叠字（「萧萧」「漫漫」）与紧邻重复放过
    const allAdjacent = ps.every((p, k) => k === 0 || (p.line === ps[k - 1].line && p.col === ps[k - 1].col + 1));
    if (allAdjacent) continue;
    // 顶真（上一句末字＝下一句首字）是有意的修辞，放过
    const dingzhen = ps.some((p, k) => {
      if (k === 0) return false;
      const q = ps[k - 1];
      return p.line === q.line + 1 && p.col === 0 && q.col > 0 && lines[q.line].endsWith(c);
    });
    if (dingzhen) continue;
    // 韵脚重复已由重韵那条管，这里只在非韵脚处报
    dupes.push(c);
  }
  // 只报「提示」，不当成必改 —— 李商隐《锦瑟》「一弦一柱」、崔颢《黄鹤楼》
  // 三复「黄鹤」，都是有意复叠；把名作判成病，工具就没人信了。
  if (dupes.length) {
    add('chongzi', '重字', 'note',
      `「${dupes.slice(0, 8).join('、')}」重复出现${shi ? '。近体诗本忌重字，但顶真、复叠是有意的修辞 —— 若非有意，宜换' : '。词里不忌，若非有意呼应，宜换'}。`);
  }

  // 上尾：律诗出句末字若**声调全同**，一顺到底就塌了（第八条）。
  // 注意要比的是上/去/入，不是平/仄 —— 杜甫《春望》出句收「在、泪、月、短」，
  // 去、去、入、上四声各异，是好的；只比平仄就会把它冤判成上尾（实测踩到过）。
  if (shi && shi.couplets >= 3) {
    const oddEnds = [];
    for (let i = 0; i < lines.length; i += 2) {
      const c = han(lines[i]).slice(-1)[0];
      if (c) oddEnds.push({ i, c, d: diaoOf(c) });
    }
    const known = oddEnds.filter((x) => x.d && x.d !== '多');
    if (known.length >= 4) {
      const same = known.every((x) => x.d === known[0].d);
      if (same) {
        add('shangwei', '上尾', 'note',
          `出句（第 ${oddEnds.map((x) => x.i + 1).join('、')} 句）的末字全是${known[0].d}声，一顺到底就塌了。宜上去入相间。`);
      }
    }
  }

  // 摞眼 / 四平头：中间四句的第 2、3 字平仄组合全同，或起首二字同类（第八条）
  const mid = coupletsOf(form, lines);
  if (mid.length >= 2) {
    const four = [mid[0].a, mid[0].b, mid[1].a, mid[1].b];
    const pat = four.map((l) => {
      const cs = han(l);
      return [toneOf(cs[1]), toneOf(cs[2])].map((t) => t || '?').join('');
    });
    if (pat.every((p) => p === pat[0] && !p.includes('?'))) {
      add('luoyan', '摞眼', 'note', `中间四句的第 2、3 字平仄组合全同（${pat[0]}），句式摞在一起，读来平板。`);
    }
    const heads = four.map((l) => han(l).slice(0, 1)[0]);
    const grp = heads.map((c) => SYN_GROUPS.findIndex((g) => g.includes(c)));
    if (grp.every((g) => g >= 0 && g === grp[0])) {
      add('siping', '四平头', 'note', `中间四句都以「${heads.join('、')}」一类字起头，词性结构全同，是为四平头。`);
    }
  }

  /* ---- 四、合掌（第七条） ---- */

  if (mid.length) {
    for (const { c, a, b } of mid) {
      const A = han(a);
      const B = han(b);
      const bad = [];
      for (let i = 0; i < Math.min(A.length, B.length); i++) {
        for (const g of SYN_GROUPS) {
          const wa = g.filter((w) => [...w].length > 1 && a.startsWith(w, i));
          const wb = g.filter((w) => [...w].length > 1 && b.startsWith(w, i));
          const sameChar = g.includes(A[i]) && g.includes(B[i]) && A[i] !== B[i];
          if ((wa.length && wb.length && wa[0] !== wb[0]) || sameChar) {
            bad.push(`第 ${i + 1} 字「${wa[0] || A[i]}」对「${wb[0] || B[i]}」`);
            break;
          }
        }
      }
      if (bad.length) {
        add('hezhang', '合掌', 'warn', `第 ${c + 1} 联上下句意思重复：${bad.join('、')}。同义相对是合掌，两句只说了一件事。`);
      }
    }
  }

  /* ---- 五、用典（第四十六、四十八、五十六、一百零八） ---- */

  const allusion = String(fields.allusion || '').trim();
  if (allusion && !/无用典|不用典|无$/.test(allusion) && allusionMenu.length) {
    // 典目里给出的出处名（书名、人名、典故名）都算数
    const named = allusionMenu.filter((m) => allusion.includes(m));
    const cites = allusion.match(/《[^》]{1,12}》|[\u4e00-\u9fff]{2,4}(?=诗|词|赋|记|传|曰|云|语)/g) || [];
    if (!named.length && cites.length) {
      add('allusion-src', '用典出处存疑', 'note',
        `所举出处（${cites.slice(0, 4).join('、')}）不在本次给你的典目里。若确有其典，请写明；若是记错了，改掉 —— 这是最容易犯的错。`);
    }
  }

  /* ---- 六、声情（第一、二、十五条） ---- */

  // 声情由 server/voice.mjs 算（诗用平水韵、词用词林正韵），只作展示与提醒。
  //
  // 这里**不判**「出韵」：逐组判出韵是 server/validator.mjs 的活儿，它有词谱的
  // rhymeGroups 与 groupChars，知道哪几句同属一组。本自检原先也判了一次，
  // 用的是「全部韵脚同属一部」这个粗判据 —— 结果把《定风波》错叶的仄韵冤判成出韵
  // （自出题循环实测踩到）。同一件事两处判、其中一处还是错的，是最坏的做法，
  // 所以那条检查整个删掉，删得干净些。
  const plan = rhymePlan(rhymeChars.length ? rhymeChars : defaultRhymeChars(lines), shi ? '平水韵' : '词林正韵');
  // 自报的韵部与实际不符（上两轮实测挑出来的）
  for (const m of claimMismatch(fields.rhyme, plan)) add('rhyme-claim', '自报与实际不符', 'note', m.text);
  for (const m of claimMismatchShi(fields.rhyme, plan)) add('rhyme-claim', '自报与实际不符', 'note', m.text);
  // 第十一轮：把《人间词话》里**最objective的几条**从「提示」提到「宜改」，
  // 让它们真正进改写回路 —— 否则它们只是摊在页面上，诗一点没变。
  // 只提四条，都是王国维的原话且判据是词表/字面比对，改起来便宜：
  //   游词（六十一则）、妆束（五十六则）、没指出那一个字（七则）。
  // **代字不提** —— 王国维自己也只是「惜以桂华代月耳」，是遗憾不是错；
  //   逼它为一个代字重写全篇，反而可能丢掉好句。这条留在「提示」。
  // 其余几条（隔、布景板、情景两张皮、尺度）判据是代理，仍留在「提示」——
  // 代理不该有权退稿。
  // CIHUA_WARN=0 可关掉这一提升（做对照实验用）。
  if (isOn('CIHUA_WARN')) {
    for (const f of F) {
      if (['youci', 'dressed', 'eye-none'].includes(f.id)) f.severity = 'warn';
    }
  }
  const level = F.some((f) => f.severity === 'warn') ? 'warn' : F.length ? 'note' : 'ok';
  return {
    level,
    findings: F,
    plan,
    realm: realm(lines),
    make,
    live: liveChars(lines),
    stats: {
      句: lines.length,
      重字: dupes.length,
      套语: sum(cliche),
      颜色: sum(colors),
      数字: sum(nums),
    },
  };
}

/** 没给押韵位置时（诗）：偶句末字即韵脚 */
function defaultRhymeChars(lines) {
  const chars = [];
  for (let i = 1; i < lines.length; i += 2) {
    const c = han(lines[i]).slice(-1)[0];
    if (c) chars.push(c);
  }
  return chars;
}

/** 把自检结果整理成给模型看的整改意见（只有「宜改」才喂回去） */
export function diseaseFeedback(d) {
  const warn = (d && d.findings ? d.findings : []).filter((f) => f.severity === 'warn');
  if (!warn.length) return '';
  return '【诗病】\n' + warn.map((f) => `- ${f.name}：${f.text}`).join('\n');
}

/* ============================================================
 * 四、尺度、身份、情绪、器物 —— 四堵「情境断裂」的墙
 *
 * 这一节的由来：站长拿两首词来对质，说得很准 ——
 *   场景是「散课钟歇、书一合、斜光搁在空台前」这种小事，
 *   词里却开出「大块沉沉，孤鸿隐隐，浮云尽南」；
 *   学生写作业，却自称「枯儒」；
 *   一点黄昏的茫然，却写成「为谁郁怒、无故悲酣、未销勇色、不怕难堪」。
 * 三处都是同一个病：**意象的尺度、身份、情绪强度与场景脱了钩**。
 * 它比出律难看得多，而它偏偏是能查的 —— 只要把「场景里有什么词」与
 * 「词里有什么词」摆在一起看。
 *
 * 分寸：一律只报「提示」，理由写清楚是哪个词对不上哪个词。
 * 场景词表必有边界，判定的东西不能拿来退稿。
 * ============================================================ */

/** 小场景：案头、课堂、屋里、巷子这类日常微观的物与人 */
const MICRO = ['书案', '课', '作业', '学堂', '教室', '灯', '纸', '笔', '钟', '桌', '窗', '屋', '巷',
  '小阁', '台', '本子', '书包', '饭', '碗', '厨', '床', '伞', '镜', '抽屉', '信封', '车', '街'];

/** 大语汇：一开口就是天地宇宙万古千山的那一套 */
const MACRO = ['大块', '乾坤', '宇宙', '苍茫', '八荒', '四海', '九霄', '万里', '千山', '万流', '孤鸿',
  '天下', '河山', '江山', '沧海', '星辰', '星河', '长空', '天穹', '昆仑', '中原', '九州',
  '万古', '千秋', '风雷', '雷霆', '瀚海', '天山', '寥廓', '洪荒', '混茫'];

/** 古人自称里带身份的那一类：用在今人身上就错位了 */
const IDENTITY = ['枯儒', '老夫', '山人', '野老', '迁客', '骚人', '词客', '幽人', '隐者', '布衣', '儒冠', '狂生', '壮士'];

/** 强情绪：一点小事配这些词，就是「为赋新词强说愁」 */
const STRONG_FEEL = ['郁怒', '悲酣', '悲壮', '壮怀', '断肠', '泣血', '吞声', '孤愤', '壮心', '勇色',
  '难堪', '长啸', '狂歌', '怒', '愤', '泣', '恨'];

/** 场景里的「淡」信号：静、散、闲、呆、懒、迟 —— 与强情绪相冲 */
const CALM = ['闲', '静', '呆', '散', '淡', '微', '轻', '寻常', '无事', '独坐', '闲坐', '迟', '慢', '懒', '倦', '搁', '停'];

/** 今物：场景里出现这些，诗里就不该长出砚台、蜡烛、更漏来 */
const MODERN_OBJECT = ['钢笔', '圆珠笔', '中性笔', '铅笔', '作业', '课本', '键盘', '鼠标', '手机', '电脑', '屏幕', '台灯', '电灯', '作业本'];
const OLD_OBJECT = ['砚', '研墨', '磨墨', '蘸', '朱墨', '银烛', '画烛', '蜡烛', '更漏', '玉漏', '铜壶', '香篆', '篆香', '金猊'];

const hitsOf = (text, table) => table.filter((w) => String(text || '').includes(w));

/** 尺度、身份、情绪、器物四堵墙；只在「两边都有词」时才说话 */
function sceneMismatches(scene, fields, bodyLines) {
  const out = [];
  const s = String(scene || '') + '　' + String(fields.scene || '');
  const poem = (Array.isArray(bodyLines) ? bodyLines : []).join('');

  const micro = hitsOf(s, MICRO);
  const macro = hitsOf(poem, MACRO);
  if (micro.length && macro.length >= 2) {
    out.push({
      field: 'scale',
      text: `场景是「${micro.slice(0, 3).join('、')}」这样案头身边的小事，词里却开出「${macro.slice(0, 4).join('、')}」这类天地万古的大语汇。` +
        `先甩几个大词撑场面，是拼贴惯技。请从场景里真实的物去找诗意（斜光、纸角、笔搁、钟声），把架子收回来。
        （王国维说「境界有大小，不以是而分优劣」—— 判的不是词大字大，是它与场景不相称、又大而无当。）`,
    });
  }

  const ident = hitsOf(poem, IDENTITY);
  if (micro.length && ident.length) {
    out.push({
      field: 'identity',
      text: `词里自称「${ident.join('、')}」，而场景写的是今人的日常（${micro.slice(0, 2).join('、')}）。身份对不上 —— 一个散课发呆的人不会自认枯儒野老。`,
    });
  }

  const strong = hitsOf(poem, STRONG_FEEL);
  const calm = hitsOf(s, CALM);
  if (calm.length && strong.length >= 2) {
    out.push({
      field: 'emotion',
      text: `场景里的情绪是「${calm.slice(0, 3).join('、')}」这一路的淡，词里却是「${strong.slice(0, 4).join('、')}」——` +
        `小愁大悲，是强说愁。情绪要落在具体处境上，不必拉到悲壮。`,
    });
  }

  const modern = hitsOf(s, MODERN_OBJECT);
  const old = hitsOf(poem, OLD_OBJECT);
  if (modern.length && old.length) {
    out.push({
      field: 'object',
      text: `场景是今物（${modern.slice(0, 2).join('、')}），词里却出现「${old.join('、')}」。今物按今物写：笔痕、纸角、灯光都在，` +
        `不必拿砚台蜡烛替它 —— 那是拿古意盖住实感，物象就失真了。王国维说「一代有一代之文学」（唐之诗、宋之词、元之曲）—— 写这一代的书案与钟声，本身就是这一代的诗，不必借古人的壳。`,
    });
  }

  return out;
}

/** 用典须在正文落地：自述用了某典，正文里连那两个字都没有，就是硬塞 */
function allusionGrounding(fields, bodyLines) {
  const a = String(fields.allusion || '').trim();
  if (!a || /无用典|不用典/.test(a)) return [];
  const poem = (Array.isArray(bodyLines) ? bodyLines : []).join('');
  // 从典故名里取二字片段（「无弦琴」→ 无弦、弦琴），正文里一个都不出现即为未落地
  const names = [...a.matchAll(/[《「『]([^》」』]{2,8})[》」』]|([\u4e00-\u9fff]{2,6}(?:典|琴|台|楼|赋|诗|记|传))/g)]
    .map((m) => m[1] || m[2])
    .filter(Boolean);
  const bare = [];
  for (const n of names) {
    const grams = [];
    for (let i = 0; i + 1 < n.length; i++) grams.push(n.slice(i, i + 2));
    if (grams.length && !grams.some((g) => poem.includes(g))) bare.push(n);
  }
  if (bare.length) {
    return [{
      field: 'allusion',
      text: `自述用了「${bare.join('、')}」，正文里却找不到它的痕迹 —— 典与景两不相干，是硬塞。要么让它落到字面上，要么撤掉。`,
    }];
  }
  return [];
}
/* ============================================================
 * 五、境界（王国维《人间词话》）
 *
 * 三轮，逐则落。已落：
 *   第一轮　词忌用替代字（三十四则）
 *   第二轮　有我之境 / 无我之境（三则）
 * 判不出的一律不写，判得出的写清「凭什么是这一条」。
 * ============================================================ */

/**
 * 第一轮 · 代字表（《人间词话》第三十四则「词忌用替代字」）。
 * 美成「桂华流瓦」境界极妙，王国维仍说「惜以桂华代月耳」—— 可见这是**格调**上的挑剔，
 * 不是错。所以本表只出「提示」，绝不退稿。
 */
const SUBSTITUTE = [
  { word: '桂华', real: '月' }, { word: '蟾光', real: '月' }, { word: '蟾宫', real: '月' },
  { word: '冰轮', real: '月' }, { word: '玉盘', real: '月' }, { word: '婵娟', real: '月' },
  { word: '玉兔', real: '月' }, { word: '金乌', real: '日' }, { word: '羲和', real: '日' },
  { word: '六出', real: '雪' }, { word: '玉龙', real: '雪' }, { word: '琼瑶', real: '雪' },
  { word: '章台', real: '柳' }, { word: '灞岸', real: '柳' }, { word: '长条', real: '柳' },
  { word: '红雨', real: '落花' }, { word: '绿绮', real: '琴' }, { word: '菱花', real: '镜' },
  { word: '双鲤', real: '书信' }, { word: '尺素', real: '书信' }, { word: '管城', real: '笔' },
  { word: '鲛珠', real: '泪' }, { word: '翠微', real: '山色' }, { word: '巽二', real: '风' },
  { word: '玉友', real: '酒' }, { word: '椒浆', real: '酒' }, { word: '松滋侯', real: '墨' },
];

/** 代字不在正文里承担景语，就是多余的妆束 */
function substituteFindings(lines) {
  const poem = lines.join('');
  const out = [];
  for (const { word, real } of SUBSTITUTE) {
    if (!poem.includes(word)) continue;
    // 本字已出现，代字只是换个说法说同一物 —— 那更没必要
    if (poem.includes(real)) {
      out.push(`「${word}」是「${real}」的代字，而正文里「${real}」本字也出现了：一物两样说法，删一个。`);
    } else {
      out.push(`「${word}」是代「${real}」的字。既没写「${real}」，何不直说 —— 词忌用替代字（《人间词话》三十四则，美成「桂华流瓦」尚被挑剔）。`);
    }
  }
  return out.length ? [{
    field: 'substitute',
    text: `${out.slice(0, 3).join('；')}。代字听着雅，实则是隔了一层；用本字，境界反而更出。`,
  }] : [];
}

/**
 * 第二轮 · 有我之境 / 无我之境（第三则）。
 *
 * 「有我之境，以我观物，故物皆著我之色彩；无我之境，以物观物，故不知何者为我。」
 * 判法只用两个数，不训练、不猜：
 *   着色物象 = 情绪字与自然物**相邻**（寒山、愁云、悲风）—— 物著我之色彩；
 *   直说      = 同一句里既有第一人称又有情绪字（我愁、吾悲）—— 把话说破了。
 * 有一首里两者都占，就是**既借物着色、又直说破**，境界掉出来 —— 这一条是「宜改」。
 *
 * 分寸：「孤」「独」这类**处境**词不算情绪（王维「王孙自可留」也非抒情），
 * 判定边界写在 .test/craft-test.mjs 里，拿《山居秋暝》（无我）与《登高》（有我）校过。
 */
const FEELING = [...'愁恨悲喜怜叹怨哀怕苦欢怒愤伤惜怅'];
const SELF_REF = [...'我吾予余侬妾'];
const NATURAL = [...'云月风雨烟霜雪花山水露霞波林江天日星柳雁鸿猿鸟竹松梅石泉钟灯船舟草苔春秋夏冬夜晓暮'];

function realm(lines) {
  const colored = [];
  const plain = [];
  lines.forEach((l, i) => {
    const cs = [...l];
    cs.forEach((c, k) => {
      if (!FEELING.includes(c)) return;
      const near = [cs[k - 1], cs[k + 1]].filter(Boolean);
      if (near.some((x) => NATURAL.includes(x))) colored.push({ line: i, text: l, word: `${c}${near.find((x) => NATURAL.includes(x))}` });
      if (SELF_REF.some((s) => l.includes(s))) plain.push({ line: i, text: l });
    });
  });
  // 分类的判据是**全篇有没有情绪与主体**，不是「情绪字有没有紧贴自然物」。
  // 第一版只看着色，结果把杜甫《登高》判成无我 —— 它明明是有我之境的标本
  //（「万里悲秋常作客」「艰难苦恨繁霜鬓」：悲、苦、恨都在，只是不着色于物）。
  // 着色与直说是**另一件事**，只用来判「说破」，不参与分类。
  const all = [...lines.join('')];
  const feelings = all.filter((c) => FEELING.includes(c));
  const selfs = SELF_REF.filter((c) => lines.join('').includes(c));
  const type = feelings.length || selfs.length ? '有我之境' : '无我之境';
  return { type, colored, plain, feelings: [...new Set(feelings)], selfs };
}

function realmFindings(lines) {
  const r = realm(lines);
  const out = [];
  if (r.colored.length && r.plain.length) {
    out.push({
      field: 'realm',
      text: `既借物着色（「${[...new Set(r.colored.map((x) => x.word))].slice(0, 3).join('、')}」），又直说破（第 ${r.plain.map((x) => x.line + 1).join('、')} 句「我」字当句）——` +
        `物既已著我之色彩，就不必再自己开口。说破一处，境界掉一层。`,
    });
  }
  return out;
}
/* ============================================================
 * 七、隔与不隔（第四轮 · 《人间词话》第四十、四十一则）
 *
 * 「语语都在目前，便是不隔。」「白石写景之作……虽格韵高绝，然如雾里看花，终隔一层。」
 *
 * 这一轮的落法与前三轮不同，且**故意不对称**：
 *   只报「隔的嫌疑」，绝不报「不隔」。
 * 理由是王国维自己那条最难的例子：白石「二十四桥仍在，波心荡、冷月无声」，
 * 格韵高绝而被判为「隔」—— 这一层微妙，一个词表代理看不出来。
 * 我的代理在那句上会算出「实景很多」，若它敢报「不隔」，就是替王国维下了一个错的判词。
 * 所以：**只有「除典与代字之外眼前什么都没有」这种明明白白的隔，才出声**；
 * 其余一律沉默 —— 沉默不是「不隔」，只是「我不判」。
 *
 * 两个量（写在左栏，供人自己看）：
 *   实分 = 目前可见之物 + 动作 + 声音/温度/光
 *   隔分 = 代字×2 + 僻典词×3 + 抽象词×1
 * ============================================================ */

/** 目前可见可触之物：有它，读者眼前就有东西 */
const CONCRETE = [...'云月风雨烟霜雪花山水露霞波林江天日星柳雁鸿猿鸟竹松梅石泉钟灯船舟草苔桥窗案纸笔帘砌阶檐院井炉杯酒影光声香泥梁燕苔萍菱荷菊枫蓬茅屋墙径岸汀洲渚蒲苇'];
/** 动作：有它，句子就在动（静景也靠动作写出静来） */
// 活字：让静物动起来的那一类（「春意闹」「花弄影」的闹与弄就在这里）。
// 第一版漏了「闹」「弄」，于是本轮的「找活字」一个也找不出来 —— 自查抓到，补上。
const ACTIONS = [...'生落流照吹惊鸣飞滴摇倚凭推掩掀拂转叠卷洗挂系敲拍扫数望看听闻坐眠归坠压浮横斜侵咽度宿闹弄破荡啼泣笑妒惹牵连衔吐吞含抱拥拈剪催逐送迎叩扣掠点逗挑'];
/** 僻典词：不解说就看不见的（王国维的「谢家池上，江淹浦畔」正是这一类） */
const ABSTRUSE = ['谢家', '江淹', '浦畔', '章台', '灞岸', '铜雀', '金谷', '玉关', '蓝桥', '楚台',
  '巫山', '洛浦', '鲛绡', '雁足', '鱼腹', '青鸟', '烂柯', '辽鹤', '庄生', '望帝', '湘灵', '汉皋',
  '阳台', '高唐', '神女', '五陵', '三楚', '六朝', '丁令', '王粲', '潘岳', '陆机', '江令'];

/** 隔的两端：实的东西少，靠典与代字撑 */
function g_severe(real, veil) {
  return veil >= 12 && veil >= real * 3;
}

export function detectGe(lines) {
  const s = (Array.isArray(lines) ? lines : []).join('');
  const concrete = CONCRETE.filter((c) => s.includes(c));
  const actions = ACTIONS.filter((c) => s.includes(c));
  const abstruse = ABSTRUSE.filter((c) => s.includes(c));
  const subs = SUBSTITUTE.filter((x) => s.includes(x.word));
  const senses = /[闻听声响喧鸣语唤歌啸啼吟滴溅敲萧萧潺泠]/.test(s) ? 1 : 0;
  const warm = /[寒暖凉热湿润冻燥]/.test(s) ? 1 : 0;
  const light = /[光明暗影照晖皎]/.test(s) ? 1 : 0;

  const real = concrete.length + actions.length + senses * 2 + warm * 2 + light * 2;
  const veil = subs.length * 2 + abstruse.length * 3;
  return { real, veil, severe: g_severe(real, veil), concrete, actions, abstruse, subs: subs.map((x) => x.word) };
}

function geFindings(lines) {
  const g = detectGe(lines);
  // 只在「明明白白的隔」时出声：典与代字的分量是眼前实物的**两倍以上**，且本身够多。
  // 第一版写的是「隔分≥6 且 实分≤4」，于是把「谢家池上／江淹浦畔／蓝桥／洛浦」
  // 那一组（隔 15、实 5 —— 霜、江、草、桥四样物）挡在门外：绝对阈值不是这条判据的本意。
  // 隔与不隔不在于有没有物，在于**典压不压得住景**，所以改用分量对比。
  // 报「隔」的**门槛**：明显是 `veil >= real*2`（只展示）；
  // 退稿（宜改）要更高的门槛：`veil >= real*3 且 veil >= 12` —— 站长说「不要雾里看花」，
  // 这是王国维对白石那句的原话，也是唯一一处我肯让一个**代理**去退稿的地方，
  // 所以门槛压到「典与代字的分量是眼前实物的三倍以上、且本身够密」。
  const severe = g.veil >= 12 && g.veil >= g.real * 3;
  if (g.veil >= 6 && g.veil >= g.real * 2) {
    return [{
      field: 'ge',
      text:
        `这几句眼前看不见东西：僻典「${g.abstruse.slice(0, 4).join('、')}」` +
        (g.subs.length ? `、代字「${g.subs.slice(0, 3).join('、')}」` : '') +
        `撑着全篇，而可见之物与动作只有 ${g.real} 处。` +
        `王国维说「语语都在目前，便是不隔」—— 隔不是写得不好，是读者眼前空着。`,
    }];
  }
  return [];
}

/* ============================================================
 * 十二、一切景语皆情语（第十轮 · 《人间词话》删稿）
 *
 * 第五轮做的是反面（只摆物不动情＝布景板）。这一轮补正面：**情与景要在同一句里**。
 * 判据：全篇一句交融的都没有，而纯景句与纯情句各自都有两句以上 —— 那是「情景两张皮」。
 *
 * 分寸：马致远《天净沙》前四句纯景、末句「断肠人在天涯」纯情，交融句为零 ——
 * 只数「有没有交融句」会冤判它。所以纯情句要**两句以上**才说话（《天净沙》只有一句）。
 * ============================================================ */

function qingJing(lines) {
  const pureScene = [];
  const pureFeeling = [];
  const mixed = [];
  (Array.isArray(lines) ? lines : []).forEach((l, i) => {
    const s = String(l || '');
    const hasThing = [...CONCRETE, ...NATURAL].some((c) => s.includes(c));
    const hasFeeling = FEELING.some((c) => s.includes(c));
    if (hasThing && hasFeeling) mixed.push(i + 1);
    else if (hasThing) pureScene.push(i + 1);
    else if (hasFeeling) pureFeeling.push(i + 1);
  });
  if (mixed.length) return [];
  if (pureScene.length >= 2 && pureFeeling.length >= 2) {
    return [{
      field: 'qingjing',
      text:
        '第 ' + pureScene.join('、') + ' 句是纯景，第 ' + pureFeeling.join('、') + ' 句是纯情，没有一句是交融的。' +
        '王国维说「一切景语皆情语」—— 景要带着情出来（「风急天高猿啸哀」的「哀」就长在景上），' +
        '而不是景写完了另起一句说情。把情挪回它该在的那件物上。',
    }];
  }
  return [];
}
/* ============================================================
 * 十一、忌游词（第七轮 · 《人间词话》第六十一则）
 *
 * 「词忌游词。」（王国维举的例子：「世上悠悠不识真，姜芽尽是捧心人」——游词也。）
 * 游词就是**空泛不切、说了等于没说**的话：一句里没有一个看得见的物、没有一个动作，
 * 只有「悠悠」「茫茫」「万般」这一类垫字。
 *
 * 分寸：**只用极窄的一张表**（这几个字眼本身就是空的），且必须同时满足「一句里没有物、
 * 也没有动作」。宽表会误伤真诗 —— 韦应物「世事茫茫难自料」、李煜「往事知多少」都不是游词，
 * 但结构上看也很像，所以宁可窄。（实测：七首名作一处都不碰。）
 * ============================================================ */

// 自评：第一版表里还收了「无端」「浮生」，于是李商隐「锦瑟无端五十弦」被冤判 ——
// 「无端」在义山那里是「没来由」，是实义不是垫字；李白「浮生若梦」同理。
// 窄表才用得：只留本身就是空的几个。
const YOUCI = ['悠悠', '茫茫', '纷纷', '扰扰', '万般', '千般', '百般', '端的', '一味'];

function youciFindings(lines) {
  const out = [];
  (Array.isArray(lines) ? lines : []).forEach((l, i) => {
    const hit = YOUCI.filter((w) => String(l).includes(w));
    if (!hit.length) return;
    const hasThing = [...CONCRETE, ...NATURAL].some((c) => String(l).includes(c));
    const hasAction = ACTIONS.some((a) => String(l).includes(a));
    if (!hasThing && !hasAction) out.push({ line: i + 1, word: hit[0] });
  });
  if (!out.length) return [];
  return [{
    field: 'youci',
    text:
      `第 ${out.map((x) => x.line).join('、')} 句只有「${[...new Set(out.map((x) => x.word))].join('、')}」这类垫字，` +
      `既看不见物，也没有动作 —— 王国维说「词忌游词」，说的就是这种说了等于没说的话。` +
      `换成一件具体的东西或一个具体的动作。`,
  }];
}

/* ============================================================
 * 十、一字境界全出（第六轮 · 《人间词话》第七则）
 *
 * 「『红杏枝头春意闹』，著一『闹』字而境界全出。『云破月来花弄影』，著一『弄』字而境界全出。」
 *
 * 这一则与前几则不同：它说的是**好处**，不是毛病。所以这一轮做两件事 ——
 *   一、**找出活字**（功，摊给人看）：一句里有个动作字，紧挨着自然物，
 *       就是「闹」「弄」那一类：让静物动起来的字。找到了就报出来，这是要留的。
 *   二、**核对它自己的指认**（过，可判）：`<appraisal>` 里应当指出「那一个字」。
 *       指不出 → 提示；指出来的字**不在正文里** → 报「必改」（与「自报韵部」同类，
 *       但这一条更硬：字在不在诗里，是数得出来的）；指出的是物名（月、花、风）而不是
 *       让物动起来的字 → 提示「那不是『一字境界全出』的那个字」。
 * ============================================================ */

/** 一句里的活字：动作字紧挨着自然物（拟人式的搭配，「花弄影」「春意闹」皆此类） */
export function liveChars(lines) {
  const out = [];
  (Array.isArray(lines) ? lines : []).forEach((l, i) => {
    const cs = [...String(l || '')];
    cs.forEach((c, k) => {
      if (!ACTIONS.includes(c)) return;
      // 物与活字不必紧挨着：「红杏枝头春意闹」里「闹」离「春」隔着一个「意」。
      // 第一版只取紧邻（±1），于是这个正例一个也找不到 —— 自查抓到，放宽到 ±3。
      for (let d = 1; d <= 3; d++) {
        const near = [cs[k - d], cs[k + d]].filter(Boolean).find((x) => NATURAL.includes(x) || CONCRETE.includes(x));
        if (near) {
          out.push({ line: i, word: d === 1 ? `${near}${c}` : `${near}…${c}`, char: c });
          break;
        }
      }
    });
  });
  return out;
}

/** 它自己指认的那一个字，与实际对不对得上 */
function eyeFindings(fields, lines) {
  const poem = (Array.isArray(lines) ? lines : []).join('');
  const a = String(fields.appraisal || '');
  const eyeRaw = String(fields.eye || '').trim();
  if (!a && !eyeRaw) return [];
  // 优先看专门的字段 <eye>（第十一轮加的）：实测同题三遍，把这件事写在 <appraisal> 那段话里，
  // 三次有两次被模型漏掉 —— 单独立一个字段就漏不掉了。
  // 没有 <eye> 时退回：从 <appraisal> 里认「闹」/“闹”这样带引号的单字。
  // 「未有」「无」是格式里许可的答法（找不到就是找不到），不许当成指认错误
  const quoted = eyeRaw
    ? /^(未有|无|没有|none)$/.test(eyeRaw)
      ? []
      : [...eyeRaw].filter((c) => /[\u4e00-\u9fff]/.test(c)).slice(0, 1)
    : [...a.matchAll(/[「“『'"]([\u4e00-\u9fff])[」”』'"]/g)].map((m) => m[1]);
  const out = [];
  // 它明说「未有」时不再唠叨：找不到活字不算毛病，只提示一次即可（此处选择沉默）。
  if (!quoted.length && /^(未有|无|没有|none)$/.test(eyeRaw)) return [];
  if (!quoted.length) {
    out.push({
      field: 'eye-none',
      text:
        '这一稿没有指出「那一个字」。王国维说「红杏枝头春意闹」著一「闹」字而境界全出 ——' +
        '请回看有没有这样一个字：它让静物动了起来。若确实没有，就直说没有，不必硬找。',
    });
    return out;
  }
  for (const c of quoted.slice(0, 3)) {
    if (!poem.includes(c)) {
      out.push({
        field: 'eye-claim',
        severity: 'warn',
        text: `你指出「${c}」是全篇最见精神的那一个字，可正文里没有这个字 —— 看错了自己的稿子。`,
      });
      continue;
    }
    const isThing = (CONCRETE.includes(c) || NATURAL.includes(c)) && !ACTIONS.includes(c);
    if (isThing) {
      out.push({
        field: 'eye-claim',
        text:
          `你指的「${c}」是一个物名。王国维举的两个字是「闹」与「弄」—— 都是让静物动起来的那类字，` +
          `不是把物名再点一遍。再找找：哪一句里有一个字把死物写活了？`,
      });
    }
  }
  return out;
}

/* ============================================================
 * 八、真景物真感情（第五轮 · 《人间词话》第六则与删稿）
 *
 * 「能写真景物、真感情者，谓之有境界；否则谓之无境界。」
 * 「一切景语皆情语也。」
 *
 * 落成一条可数的判据：**把物摆着而不动、也不动情的句子，是布景板**。
 *   静态句 = 句中的可见之物 ≥2，而既没有动作字、也没有情绪字、也没有「我」。
 * 一首里这样的句子过了六成，就是拿景物当背景板，不是写境。
 *
 * 分寸（这一条尤其容易冤枉人）：
 *   马致远《天净沙》「枯藤老树昏鸦」「古道西风瘦马」也是纯名词句，可它整首并不静 ——
 *   有「小桥流水」的流、有「夕阳西下」的落、有「断肠人在天涯」的情。
 *   所以判的是**整首的六成**，不是单句；单句再静也不说话。
 * ============================================================ */

/** 一句是不是「只把物摆着」 */
function isStaticLine(line) {
  const s = String(line || '');
  const things = CONCRETE.filter((c) => s.includes(c)).length;
  if (things < 2) return false;
  const hasAction = ACTIONS.some((a) => s.includes(a));
  const hasFeeling = FEELING.some((f) => s.includes(f));
  const hasSelf = SELF_REF.some((x) => s.includes(x));
  return !hasAction && !hasFeeling && !hasSelf;
}

function staticFindings(lines) {
  if (lines.length < 3) return [];
  const statics = lines.map((l, i) => ({ l, i })).filter((x) => isStaticLine(x.l));
  const rate = statics.length / lines.length;
  if (rate < 0.6) return [];
  return [{
    field: 'static',
    text:
      `${lines.length} 句里有 ${statics.length} 句只是把物摆着（第 ${statics.map((x) => x.i + 1).join('、')} 句），` +
      `既没有动作也没有情。王国维说「一切景语皆情语」—— 静景也得有动（或由动见静），` +
      `否则就是布景板：物在那儿，人不在那儿。`,
  }];
}

/* ============================================================
 * 九、自报与实际不符（第四轮欠下的一条）
 *
 * 连着两轮实测：模型在 `<rhyme>` 里自报的韵部，与它实际写出来的韵脚对不上
 * （一次自报江阳而实为鱼虞模，一次自报尤侯而实为真文元）。它说的与它做的是两回事，
 * 而这句话就摊在站长眼前的「选韵」一行里。既已摆在眼前，就该由机器指出来。
 * 只在**能确证**时说话：自报里点名了「第 N 部」或某个韵目，而实际不是那一个。
 * ============================================================ */

/** 词林正韵十九部的名字与常见韵目简称，用来认自报里的说法 */
const BU_ALIAS = {
  1: ['东钟', '一东', '二冬', '东冬'], 2: ['江阳', '三江', '七阳'], 3: ['支微', '支微齐', '四支', '五微', '八齐'],
  4: ['鱼虞', '鱼虞模', '六鱼', '七虞'], 5: ['佳灰'], 6: ['真文', '真文元', '十一真', '十二文', '十三元'],
  7: ['元寒', '寒删先', '十四寒', '十五删', '一先'], 8: ['萧肴', '萧肴豪', '二萧', '三肴', '四豪'],
  9: ['歌戈', '五歌'], 10: ['家麻', '六麻'], 11: ['庚青', '庚青蒸', '八庚', '九青', '十蒸'],
  12: ['尤侯', '十一尤'], 13: ['侵寻', '十二侵'], 14: ['覃盐', '覃盐咸', '十三覃', '十四盐', '十五咸'],
  15: ['屋沃'], 16: ['质陌'], 17: ['物月'], 18: ['合洽'], 19: ['药铎'],
};

export function claimMismatch(rhymeNote, plan) {
  const s = String(rhymeNote || '');
  if (!s || !plan || plan.mixed) return [];
  const out = [];
  // 一、自报里点名了「第 N 部」
  const nums = [...s.matchAll(/第\s*([一二三四五六七八九十]{1,3})\s*部/g)].map((m) => {
    const t = m[1];
    const map = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
    if (t.length === 1) return map[t] || 0;
    if (t === '十一') return 11;
    if (t === '十二') return 12;
    if (t === '十三') return 13;
    if (t === '十四') return 14;
    if (t === '十五') return 15;
    if (t === '十六') return 16;
    if (t === '十七') return 17;
    if (t === '十八') return 18;
    if (t === '十九') return 19;
    return 0;
  }).filter(Boolean);
  if (nums.length && plan.bu && !nums.includes(plan.bu)) {
    out.push(`你自报用的是第 ${nums.join('、')} 部，而实际韵脚落在第 ${plan.bu} 部（${plan.name}）。`);
  }
  // 二、自报里点了韵目名（江阳、尤侯、真文…），与实际不符
  const named = Object.entries(BU_ALIAS).filter(([bu, list]) => list.some((x) => s.includes(x))).map(([bu]) => Number(bu));
  if (named.length && plan.bu && !named.includes(plan.bu)) {
    out.push(`自报里说的韵目（${named.map((b) => (BU_ALIAS[b] || [])[0]).join('、')}）与实际（第 ${plan.bu} 部 ${plan.name}）不是一处。`);
  }
  if (!out.length) return [];
  return [{
    field: 'rhyme-claim',
    text:
      out.join('') +
      `说出的与实际做出来的不是一回事 —— 这一栏是给站长核对的，宁可不说，不要说错。`,
  }];
}

/** 平水韵三十个平声韵目的末字，用来认诗那一侧的自报（「下平八庚」「十一真」…） */
const PINGSHUI_TAIL = '东冬江支微鱼虞齐佳灰真文元寒删先萧肴豪歌麻阳庚青蒸尤侵覃盐咸';
const PINGSHUI_NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

/**
 * 诗的「自报韵部」核对（第七轮欠下的）。
 * 词那一侧比的是词林正韵的部号；诗这一侧没有「第几部」，比的是**平水韵目**
 * （「下平八庚」「十一真」这样的说法）。做法：从自报里认出韵目字，
 * 与实际算出来的平水韵目（plan.yunmu / plan.name）对一对。
 */
export function claimMismatchShi(rhymeNote, plan) {
  const s = String(rhymeNote || '');
  if (!s || !plan || plan.book !== '平水韵' || plan.mixed || !plan.yunmu || !plan.yunmu.length) return [];
  const tails = new Set([...plan.yunmu].map((n) => [...String(n)].slice(-1)[0]));
  // 认法要严：「上平/下平 + 数字 + 韵目字」，或「数字 + 韵目字」——单一个韵目字容易误认（江东、东风）
  const found = [];
  for (const m of s.matchAll(/([上下])?平([一二三四五六七八九十]{0,2})([\u4e00-\u9fff])/g)) {
    if (!PINGSHUI_TAIL.includes(m[3])) continue;
    found.push({ mu: m[3], num: m[2] ? PINGSHUI_NUM[m[2]] || 0 : 0 });
  }
  if (!found.length) return [];
  const gotTails = new Set(found.map((x) => x.mu));
  if ([...gotTails].some((t) => tails.has(t))) return []; // 说对了
  return [{
    field: 'rhyme-claim',
    text:
      `你自报用的是「${found.map((x) => (x.num ? x.num + x.mu : x.mu)).join('、')}」韵，` +
      `而实际韵脚落在${plan.yunmu.join('、')} —— 说的与实际不是一处。这一栏是给站长核对的，宁可不说，不要说错。`,
  }];
}

/* ============================================================
 * 六、造境 / 写境（第三轮 · 《人间词话》第二则）
 *
 * 「有造境，有写境，此理想与写实二派之所由分。然二者颇难分别。因大诗人所造之境，
 *   必合乎自然，所写之境，亦必邻于理想故也。」
 *
 * 王国维自己就说「二者颇难分别」，所以这里**绝不下判词**，只做一件事：
 *   把「它自报写的是哪一种」与「诗里露出来的证据」摆在一起。
 * 证据是两个可数的量，都明说是代理，不是定论：
 *   · 场景相接的实字 —— 场景里的字有多少落进了诗里（写境应当有，造境可以没有）；
 *   · 虚拟与夸张 —— 若/如/似/疑/恐/欲/拟/恍 与 三千/九万/万里 的密度（造境常见）。
 * 两者与自报不合时，只提示「你说的与写的不像同一种，自己看一眼」。
 * ============================================================ */

/** 虚拟与设想之词：造境的门轴 */
const VIRTUAL = ['若', '如', '似', '疑', '恐', '欲', '拟', '恍', '仿', '纵', '倘', '恰似', '浑如'];
/** 夸张之数：三千尺、九万里 —— 造境的常客（也是它的俗套） */
const HYPERBOLE = ['三千', '九万', '万里', '千尺', '万丈', '九霄', '千年', '万古', '八千', '百万'];

const STOPCHAR = new Set([...'之其而以于与共独犹尚未莫何谁尔又亦皆尽更复只惟乃遂即使令被所为的了着是在不无有人一中上下大小多少来去出入和与']);

/** 场景与诗共有的**实字**（单字，不比二字词）。 */
function realChars(text) {
  return new Set([...String(text || '')].filter((c) => /[\u3400-\u9FFF]/.test(c) && !STOPCHAR.has(c)));
}

/**
 * 造境 / 写境：返回 { make, overlap, overlapChars, virtual, hyperbole, declared }
 *
 * 自评（这一版是矫正过的）：第一版拿**场景的二字词**去诗里找，结果把
 * 「假末夜半，书案灯下…」写成「小阁灯昏夜向晨」这一首判成了「与场景无关」——
 * 它明明是写境，只是把场景的词重写了一遍（书案灯下 → 小阁灯昏），二字词自然对不上。
 * 矫正两处：一、改按**实字**计数；二、**只在证据强烈矛盾时才说话**。
 * 王国维自己说「二者颇难分别」，一个词表代理更没资格下判词 ——
 * 所以常态是「难分」，只把数字摊出来给人看。
 */
export function makeOf(lines, scene, realmNote = '') {
  const poem = (Array.isArray(lines) ? lines : []).join('');
  const sc = realChars(scene);
  const pm = realChars(poem);
  const overlapChars = [...sc].filter((c) => pm.has(c));
  const overlap = overlapChars.length;

  const virtual = VIRTUAL.filter((w) => poem.includes(w));
  const hyperbole = HYPERBOLE.filter((w) => poem.includes(w));
  const im = virtual.length + hyperbole.length;

  // 只有两种情形证据够硬：
  //   自报写境，而这篇与场景几乎没有一个实字相接、又满是虚拟夸张 → 另造了一境；
  //   自报造境，而句句都落在场景实有之物上、一个虚拟夸张都没有 → 其实是写境。
  let make = '难分';
  if (overlap <= 1 && im >= 2) make = '造境';
  else if (overlap >= 6 && im === 0) make = '写境';

  const declared = /造境/.test(realmNote) ? '造境' : /写境/.test(realmNote) ? '写境' : '';
  return { make, overlap, overlapChars, virtual, hyperbole, declared };
}

/** 自报与证据强烈矛盾时才提示；常态（难分、或一致）一律不说话 */
function makeFindings(make) {
  if (!make.declared || make.make === '难分' || make.declared === make.make) return [];
  return [{
    field: 'make',
    text:
      `你自报写的是「${make.declared}」，而证据更像「${make.make}」` +
      `（与场景相接的实字 ${make.overlap} 个${make.overlapChars.length ? '：' + make.overlapChars.slice(0, 8).join('') : ''}，` +
      `虚拟/夸张词 ${[...make.virtual, ...make.hyperbole].join('、') || '无'}）。` +
      `王国维说造境写境「二者颇难分别」，故不下判词 —— 自己看一眼：想写的与写出来的，是不是一回事。`,
  }];
}

/* ============================================================
 * 四、注释与翻译这一层（站长拿截图报过两次）
 *
 * 实测到的两种坏法：
 *   一、模型跑飞，写出一整段乱码中文，里面还夹着它自己的特殊标记
 *       （「OPEN_END|>」「<:」这类）。这些字直接摊在页面上，比出律难看得多。
 *   二、**注释所注的词根本不在诗里** —— 它照着想象中另一首诗写了一套注释，
 *       「东君」「山程窄」「趋若喘牛」，而正文里一个字都没有。
 *
 * 这两样都能机械抓：前者查特殊标记与症状，后者只要拿注释的词去正文里找。
 * 抓到的是「必改」—— 不是诗写得不好，是这一栏根本不能用。
 * ============================================================ */

/** 模型特殊标记的残渣：<|OPEN_END|>、|>、<| … 一律是泄漏，不是文字 */
const SPECIAL_TOKEN = /<\|[^|\n]{0,20}\|>|\|>|<\|[A-Z_]{2,}|OPEN_END|\[INST\]/;

/** 一段话是不是「跑飞了」：连续标点、连续同字、过多 ASCII */
function looksBroken(s) {
  const t = String(s || '');
  if (!t) return '';
  if (SPECIAL_TOKEN.test(t)) return '混进了模型的特殊标记';
  if (/[，。、；：？！]{3,}/.test(t)) return '有一串连着的标点，不成句';
  if (/(.)\1{2,}/.test(t)) return '有连着重复三个以上的字';
  const ascii = (t.match(/[A-Za-z0-9|<>{}[\]\\/]/g) || []).length;
  if (ascii / Math.max(1, [...t].length) > 0.12) return '夹了过多非中文符号';
  return '';
}

/**
 * 查注释与白话翻译这一层。
 * @param {object} fields 模型交回来的字段（notes / translation）
 * @param {string[]} bodyLines 正文（一句一行）
 * @returns {Array<{field:string, text:string}>} 空数组表示这一层是干净的
 */
export function fieldIssues(fields = {}, bodyLines = []) {
  const out = [];
  const poem = (Array.isArray(bodyLines) ? bodyLines : []).join('');

  /* ---- 词语注释 ---- */
  const notes = String(fields.notes || '').trim();
  if (notes && !/^无须注/.test(notes)) {
    const broken = looksBroken(notes);
    if (broken) out.push({ field: 'notes', text: `词语注释${broken}，这一栏不能用。` });
    else {
      const lines = notes.split('\n').map((l) => l.trim()).filter(Boolean);
      const stray = [];
      const malformed = [];
      for (const l of lines) {
        const m = l.match(/^(.{1,8}?)\s*[｜|：:]/);
        if (!m) {
          malformed.push(l.slice(0, 10));
          continue;
        }
        const word = m[1].replace(/[《》（）()\s]/g, '');
        // 所注之词必须真的出现在正文里 —— 否则就是照着别处写的注释
        if (word && !poem.includes(word)) stray.push(word);
      }
      if (malformed.length) {
        out.push({ field: 'notes', text: `词语注释没写成「词｜注」的样子：${malformed.slice(0, 3).join('／')}。每行一条，前头是被注的词。` });
      }
      if (stray.length) {
        out.push({ field: 'notes', text: `注释里的「${stray.slice(0, 5).join('、')}」在正文里找不到。注的词必须是诗里真有的字。` });
      }
    }
  }

  /* ---- 白话翻译 ---- */
  const tr = String(fields.translation || '').trim();
  if (tr) {
    const broken = looksBroken(tr);
    if (broken) out.push({ field: 'translation', text: `白话翻译${broken}，这一栏不能用。` });
    else if ([...tr].length < 25) out.push({ field: 'translation', text: '白话翻译太短，没把全篇说清楚。' });
    else if (!/[。！？]$/.test(tr)) out.push({ field: 'translation', text: '白话翻译没有收尾的句号，像是没写完。' });
    else {
      // 「白话」必须是白话：现代汉语几乎离不了这些虚词。整段一个都没有，
      // 说明它不是翻译，是模型跑飞后拼出来的字块（实测见过一整段这样）。
      const huayu = ['的', '了', '着', '是', '在', '把', '被', '和', '就', '都', '这', '那', '什么', '没有', '一个', '我们'];
      const hits = huayu.reduce((n, w) => n + (tr.includes(w) ? 1 : 0), 0);
      if (hits < 2) out.push({ field: 'translation', text: '这段白话里没有「的了是在」这类白话虚词，读不成句，不像翻译。' });
    }
  }

  return out;
}

/**
 * 把坏掉的字段清掉。**宁可空着，也不能把乱码摊给读者看。**
 */
export function stripBadFields(fields = {}, bodyLines = []) {
  const bad = fieldIssues(fields, bodyLines);
  if (!bad.length) return { fields, dropped: [] };
  const dropped = [...new Set(bad.map((b) => b.field))];
  const out = { ...fields };
  for (const f of dropped) out[f] = '';
  return { fields: out, dropped };
}

export const __debug = { CLICHE, COLORS, NUMBERS, SYN_GROUPS, SEASON_CLASH, SPECIAL_TOKEN };
