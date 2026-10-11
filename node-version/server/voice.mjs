// 云卷云舒 · 声情：这个韵部听起来是什么调子
//
// 为什么要有这个文件：
//   「平仄合律」只保证字音的高低对，不保证**声情**对 ——
//   写悲壮却挑了拖长的平声细韵，写幽怨却用了洪亮开阔的江阳，念起来就不对味。
//   古人选韵是有讲究的，这套说法从元人周德清《中原音韵》到清人王骥德《曲律》、
//   近人吴梅《顾曲麈谈》一脉相承，是通行常识，不是谁的一家之言。
//
// 做法：不另立一套韵表。韵部归属直接问 server/rhyme.mjs（词林正韵十九部，
//   buOf 返回 1~19），这里的表只回答「第 N 部听起来是什么调子」。
//   具体的韵目名从韵脚字本身反查（pingYunOf），所以不会因为我把韵目抄错而出错。
//
// 局限（如实说明）：
//   · 词林正韵后五部是入声，诸家对入声各部的声情说法本就有出入，这里取通行说法；
//   · 声情只是「大体倾向」，古人亦有反用（用洪亮韵写哀情而愈见其哀），
//     所以这张表只用在提示与「自检」里，绝不当成硬规则去判错。

import { buOf } from './rhyme.mjs';
import { pingYunListOf, toneOf } from './pingshui.mjs';

/**
 * 词林正韵十九部 → 声情。
 * 前十四部为平、上、去（同部），后五部为入声。
 */
export const BU_VOICE = {
  1: { name: '东钟', voice: '洪亮沉雄', use: '宜豪壮、怀古、大场面' },
  2: { name: '江阳', voice: '开阔宏亮', use: '宜登临、壮阔、慷慨' },
  3: { name: '支微齐', voice: '细密柔婉', use: '宜幽怨、相思、低诉' },
  4: { name: '鱼虞模', voice: '呜咽含混', use: '宜郁结、羁旅、不遇' },
  5: { name: '佳灰', voice: '低回顿挫', use: '宜感旧、迟暮、叹逝' },
  6: { name: '真文元', voice: '沉郁顿挫', use: '宜忧思、悼亡、伤时' },
  7: { name: '元寒删先', voice: '清远轻扬', use: '宜清景、远思、闲旷' },
  8: { name: '萧肴豪', voice: '高亢嘹亮', use: '宜悲慨、豪宕、登高' },
  9: { name: '歌戈', voice: '圆转和缓', use: '宜咏物、闲适、流丽' },
  10: { name: '家麻', voice: '放达开朗', use: '宜旷达、谐趣、写景' },
  11: { name: '庚青蒸', voice: '清厉激越', use: '宜慷慨、警策、励志' },
  12: { name: '尤侯幽', voice: '幽咽低回', use: '宜愁思、怀人、羁愁' },
  13: { name: '侵寻', voice: '幽细绵密', use: '宜深静、独处、夜坐' },
  14: { name: '覃盐咸', voice: '含蓄沉咽', use: '宜怨慕、悼念、隐忍' },
  // 入声五部：短促、顿挫、逼仄是它们的共同底色，各部的差别在于收尾的开口
  15: { name: '入声（屋沃类）', voice: '短促沉郁', use: '宜悲壮、拗怒、不平' },
  16: { name: '入声（质陌类）', voice: '逼仄斩截', use: '宜激愤、决绝、斩钉截铁' },
  17: { name: '入声（物月类）', voice: '峭劲哽咽', use: '宜悲凉、幽愤、呜咽' },
  18: { name: '入声（合洽类）', voice: '顿挫迫促', use: '宜急切、哀痛、急促' },
  19: { name: '入声（药铎类）', voice: '沉着激楚', use: '宜慷慨、悲歌、激楚' },
};

/** 这个韵部是不是入声部（十五部以后都是入声） */
export const isRuShengBu = (bu) => Number(bu) >= 15;

/**
 * 平水韵三十个平声韵目的声情。**近体诗要用这一张，不能用词林正韵那张** ——
 * 词林正韵把平水韵的「十灰」拆进了第三部与第五部，拿它判律诗的韵，
 * 杜甫《登高》（哀回台来杯）会被冤判成出韵。这是实测踩到的坑。
 * 键取韵目名的末字（「上平十四寒」→ 寒）。
 */
export const PINGSHUI_VOICE = {
  东: '洪亮沉雄', 冬: '沉稳浑厚', 江: '峭拔', 支: '细密柔婉', 微: '柔婉低回',
  鱼: '呜咽含混', 虞: '沉缓', 齐: '清脆', 佳: '低回', 灰: '顿挫',
  真: '沉郁', 文: '绵密', 元: '浑厚', 寒: '清远', 删: '轻扬', 先: '清越轻扬',
  萧: '高亢', 肴: '峭劲', 豪: '豪宕', 歌: '圆转', 麻: '放达',
  阳: '宏亮开阔', 庚: '清厉', 青: '清冷', 蒸: '激越',
  尤: '幽咽低回', 侵: '幽细绵密', 覃: '含蓄', 盐: '沉咽', 咸: '迫促',
};

const voiceOfYunmu = (name) => PINGSHUI_VOICE[[...String(name || '')].slice(-1)[0]] || '';

/**
 * 一首诗/词用了哪个韵部、听起来是什么调子。
 *
 * @param {string[]} rhymeChars 韵脚字（按出现次序）
 * @param {'平水韵'|'词林正韵'} book 近体诗用平水韵，词用词林正韵。默认平水韵。
 * @returns {object|null}
 */
export function rhymePlan(rhymeChars, book = '平水韵') {
  const chars = (Array.isArray(rhymeChars) ? rhymeChars : []).map((c) => String(c || '')).filter(Boolean);
  if (!chars.length) return null;

  // ── 出韵判定：按各自的书来 ──
  //   诗：平水韵目。字可兼属数目（多音字），取交集，非空才算同韵。
  //   词：词林正韵部号（buOf 返回的是**数组**，同样取交集）。
  let inter = null;
  let all = [];
  if (book === '词林正韵') {
    const sets = chars.map((c) => buOf(c)).filter((a) => Array.isArray(a) && a.length);
    if (!sets.length) return null;
    inter = sets[0].slice();
    for (const s of sets.slice(1)) inter = inter.filter((b) => s.includes(b));
    all = [...new Set(sets.flat())].sort((a, b) => a - b);
  } else {
    const sets = chars.map((c) => pingYunListOf(c)).filter((a) => Array.isArray(a) && a.length);
    if (!sets.length) return null;
    inter = sets[0].slice();
    for (const s of sets.slice(1)) inter = inter.filter((b) => s.includes(b));
    all = [...new Set(sets.flat())];
  }
  let mixed = inter.length === 0;

  // 错叶的词牌（《定风波》《相见欢》等）：一个韵组里本就插着另一个部的仄韵，
  // 混在一起算必然「出韵」，可那不是病，是词牌的规矩。碰到这种就**只取平声韵脚**
  // 来定声情，并说明清楚 —— 与其报一句错的，不如只报那一半对的。
  let narrowed = false;
  if (mixed) {
    const pingChars = chars.filter((c) => toneOf(c) === '平');
    if (pingChars.length >= 2) {
      const sets2 = pingChars.map((c) => buOf(c)).filter((a) => Array.isArray(a) && a.length);
      if (sets2.length) {
        let inter2 = sets2[0].slice();
        for (const s of sets2.slice(1)) inter2 = inter2.filter((b) => s.includes(b));
        if (inter2.length) {
          narrowed = true;
          mixed = false;
          inter = inter2;
          all = [...new Set(sets2.flat())].sort((a, b) => a - b);
        }
      }
    }
  }
  const yunmu = mixed ? all : inter;

  if (book === '词林正韵') {
    const bu = (mixed ? all : inter)[0];
    const v = BU_VOICE[bu] || { name: `第 ${all.join('、')} 部`, voice: '', use: '' };
    const pingmu = [...new Set(chars.map((c) => (pingYunListOf(c) || []).slice(-1)[0]).filter(Boolean))];
    const text =
      (mixed ? `韵脚分属 ${all.length} 个韵部（第 ${all.join('、')} 部），出韵` : `词林正韵第 ${bu} 部（${v.name}）`) +
      (narrowed ? '（错叶词牌：仄韵另属一组，此处只按主平韵定声情）' : '') +
      (pingmu.length ? `，平水韵近${pingmu.join('、')}` : '') +
      (v.voice ? `，声情${v.voice}` : '') +
      (v.use ? `，${v.use}` : '');
    return { book, bu, name: v.name, voice: v.voice, use: v.use, rusheng: isRuShengBu(bu), yunmu: pingmu, mixed, all, text };
  }

  const names = mixed ? all : inter;
  const voice = voiceOfYunmu(names[0]);
  const text =
    (mixed ? `韵脚分属 ${all.length} 个韵目（${all.join('、')}），出韵` : `平水韵${names[0]}`) +
    (voice ? `，声情${voice}` : '');
  return { book, bu: null, name: mixed ? all.join('、') : names[0], voice, use: '', rusheng: false, yunmu: names, mixed, all, text };
}

/**
 * 声情与立意是否搭。返回一句提醒（搭得上就返回空串）。
 *
 * 故意做得松：只在「明显拧着」的时候出声，比如写悲壮却用了幽细的侵寻韵。
 * 古人反用韵部的例子多得是（用亮韵写哀愈见其哀），所以这一条永远只是提醒。
 */
const SAD = /悲|哀|愁|怨|悼|痛|恨|哭|泪|伤逝|凄凉|萧瑟|幽愤|羁旅|不遇|别离|送别|怀人|迟暮/;
const HEROIC = /壮|豪|慷慨|激越|怒|愤|战|边塞|登临|大|阔|怀古|功名|凌云|斩|决绝/;
const QUIET = /闲|静|幽|清景|独处|夜坐|禅|淡|远思|闲适|旷/;

export function voiceAdvice(rhymeChars, brief, book = '平水韵') {
  const plan = rhymePlan(rhymeChars, book);
  if (!plan || plan.mixed) return '';
  const b = String(brief || '');
  // 幽细、呜咽、绵密、沉咽 —— 这些韵托不起豪壮（词林正韵的部号；诗则看韵目名）
  const softNames = /支|微|鱼|虞|佳|灰|尤|侵|覃|盐|齐/;
  const brightNames = /东|冬|江|阳|萧|肴|豪|庚|蒸/;
  const isSoft = plan.book === '词林正韵' ? !plan.rusheng && [3, 4, 5, 13, 14].includes(plan.bu) : softNames.test(plan.name);
  const isBright = plan.book === '词林正韵' ? [1, 2, 8, 11].includes(plan.bu) : brightNames.test(plan.name);
  const hint = plan.book === '词林正韵' ? '江阳、东钟、萧豪或庚青' : '七阳、一东、二萧或八庚';
  const lowHint = plan.book === '词林正韵' ? '支微、尤侯、侵寻、覃盐' : '四支、十一尤、十二侵、十四盐';
  const calmHint = plan.book === '词林正韵' ? '元寒删先、庚青、歌戈' : '十四寒、一先、八庚、五歌';
  if (HEROIC.test(b) && isSoft) {
    return `声情与立意恐不相称：这一首写的是豪壮，而${plan.name}韵${plan.voice}，气不足以举之。若要壮阔，宜${hint}；若要悲壮，宜入声。`;
  }
  if (SAD.test(b) && isBright && !HEROIC.test(b)) {
    return `声情与立意恐不相称：这一首写的是哀情，而${plan.name}韵${plan.voice}，未免太亮。若要低回，宜${lowHint}。`;
  }
  if (QUIET.test(b) && plan.rusheng && !HEROIC.test(b)) {
    return `声情与立意恐有所偏：这一首求闲静，而入声韵${plan.voice}，收得太急。若要清远，宜${calmHint}。`;
  }
  return '';
}
