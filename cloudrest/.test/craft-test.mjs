// 诗病自检与声情的自证
//
// 为什么要有它：server/disease.mjs 是一整套**词表判定**，词表最容易出的错是
// 冤枉好诗。一个把杜甫《登高》判成合掌、把李商隐《锦瑟》判成重字的检查器，
// 不但没用，还会把模型带坏。所以这个测试的头一条就是：
//
//   **七首名作，一处「宜改」都不许有。**
//
// 第二条反过来：一首真坏的诗，该报的必须报出来（不然就是个摆设）。
// 声情那部分同理：杜甫《登高》不能被判出韵（词林正韵把平水韵的「十灰」
// 拆成了两部，拿它判律诗就会冤判 —— 这个坑是实测踩到的）。
//
// 用法：node .test/craft-test.mjs

import { diagnose, diseaseFeedback } from '../server/disease.mjs';
import { rhymePlan, voiceAdvice, BU_VOICE, PINGSHUI_VOICE } from '../server/voice.mjs';

let bad = 0;
const ok = (c, label, extra = '') => {
  if (!c) bad++;
  console.log(`  ${c ? '✓' : '✗'} ${label}${extra ? '　' + extra : ''}`);
};

/* ---------------- 一、名作不许被冤枉 ---------------- */
console.log('— 名作里不许出现「宜改」—');
const FAMOUS = {
  登高: ['七言律诗', ['风急天高猿啸哀', '渚清沙白鸟飞回', '无边落木萧萧下', '不尽长江滚滚来', '万里悲秋常作客', '百年多病独登台', '艰难苦恨繁霜鬓', '潦倒新停浊酒杯']],
  春望: ['五言律诗', ['国破山河在', '城春草木深', '感时花溅泪', '恨别鸟惊心', '烽火连三月', '家书抵万金', '白头搔更短', '浑欲不胜簪']],
  山居秋暝: ['五言律诗', ['空山新雨后', '天气晚来秋', '明月松间照', '清泉石上流', '竹喧归浣女', '莲动下渔舟', '随意春芳歇', '王孙自可留']],
  锦瑟: ['七言律诗', ['锦瑟无端五十弦', '一弦一柱思华年', '庄生晓梦迷蝴蝶', '望帝春心托杜鹃', '沧海月明珠有泪', '蓝田日暖玉生烟', '此情可待成追忆', '只是当时已惘然']],
  黄鹤楼: ['七言律诗', ['昔人已乘黄鹤去', '此地空余黄鹤楼', '黄鹤一去不复返', '白云千载空悠悠', '晴川历历汉阳树', '芳草萋萋鹦鹉洲', '日暮乡关何处是', '烟波江上使人愁']],
  春晓: ['五言绝句', ['春眠不觉晓', '处处闻啼鸟', '夜来风雨声', '花落知多少']],
  静夜思: ['五言绝句', ['床前明月光', '疑是地上霜', '举头望明月', '低头思故乡']],
};
{
  const wronged = [];
  const notes = [];
  for (const [name, [form, lines]] of Object.entries(FAMOUS)) {
    const d = diagnose({ form, bodyLines: lines });
    const w = d.findings.filter((f) => f.severity === 'warn');
    if (w.length) wronged.push(`${name}(${w.map((x) => x.name).join('、')})`);
    notes.push(`${name} ${d.findings.length}`);
  }
  ok(wronged.length === 0, `${Object.keys(FAMOUS).length} 首名作，一处「宜改」都没有`, wronged.length ? wronged.join(' ') : `提示数 ${notes.join('／')}`);
}

/* ---------------- 二、坏诗该报的必须报出来 ---------------- */
console.log('\n— 一首坏诗，该报的都得报 —');
{
  const bad1 = [
    '孤舟独望碧云天', '只船遥看青霄寒', '雪落荷塘梅共荷', '浊酒青衫泪满襟',
    '流年岁月空悲切', '心云梦月恨千端', '神州自古多豪杰', '华夏从来有俊贤',
  ];
  const d = diagnose({ form: '七言律诗', bodyLines: bad1, fields: { allusion: '《杜工部集》诗云' }, allusionMenu: ['杜甫', '李白'] });
  const ids = new Set(d.findings.map((f) => f.id));
  const want = ['cliche', 'color', 'coinage', 'wuhou', 'chongzi', 'allusion-src'];
  const miss = want.filter((i) => !ids.has(i));
  ok(miss.length === 0, `坏诗报出 ${d.findings.length} 处，该报的都在`, miss.length ? `缺 ${miss.join('、')}` : want.join('、'));
  const warns = d.findings.filter((f) => f.severity === 'warn');
  ok(warns.length >= 2, `其中「宜改」${warns.length} 处（会退回重写）`);
  ok(/【诗病】/.test(diseaseFeedback(d)), '整理成给模型的整改意见');
  ok(!diseaseFeedback({ findings: d.findings.filter((f) => f.severity === 'note') }), '只有「提示」时不喂回模型（词表判定不退货）');
}

/* ---------------- 三、合掌要认得出，也不许乱认 ---------------- */
console.log('\n— 合掌 —');
{
  const hezhang = diagnose({
    form: '七言律诗',
    bodyLines: ['春来江水绿如蓝', '日出江花红胜火', '孤舟一系故园心', '独舸频惊客梦深', '无边落木萧萧下', '不尽长江滚滚来', '此身合是诗人未', '细雨骑驴入剑门'],
  });
  ok(hezhang.findings.some((f) => f.id === 'hezhang'), '「孤舟」对「独舸」判为合掌');
  // 数量对数量是正对，不是合掌 —— 杜甫「万里悲秋」对「百年多病」曾被冤判
  ok(!diagnose(FAMOUS.登高 ? { form: '七言律诗', bodyLines: FAMOUS.登高[1] } : {}).findings.some((f) => f.id === 'hezhang'),
    '「万里」对「百年」不判合掌（数量对数量是正对）');
  ok(!diagnose({ form: '五言律诗', bodyLines: FAMOUS.春望[1] }).findings.some((f) => f.id === 'hezhang'), '《春望》不判合掌');
}

/* ---------------- 四、上尾要比声调，不是比平仄 ---------------- */
console.log('\n— 上尾 —');
{
  // 春望出句收「在、泪、月、短」：去、去、入、上 —— 四声各异，是好的
  ok(!diagnose({ form: '五言律诗', bodyLines: FAMOUS.春望[1] }).findings.some((f) => f.id === 'shangwei'),
    '《春望》出句四声各异，不判上尾');
  const same = diagnose({
    form: '五言律诗',
    bodyLines: ['空山新雨后', '天气晚来秋', '明月松间照', '清泉石上流', '竹喧归浣女', '莲动下渔舟', '随意春芳歇', '王孙自可留'],
  });
  ok(!same.findings.some((f) => f.id === 'shangwei'), '《山居秋暝》也不判上尾');
}

/* ---------------- 五、声情：诗用平水韵，词用词林正韵 ---------------- */
console.log('\n— 声情 —');
{
  const denggao = rhymePlan(['哀', '回', '来', '台', '杯'], '平水韵');
  ok(denggao && !denggao.mixed, '《登高》韵脚（哀回台来杯）在平水韵里同韵', denggao.text);
  ok(denggao.text.includes('上平十灰'), '报出的是平水韵目');
  ok(rhymePlan(['哀', '回', '来', '台', '杯'], '词林正韵').mixed === true,
    '同一组韵脚按词林正韵会被拆成两部 —— 所以律诗绝不能用词林正韵去判（这个坑留着当证据）');

  const ci = rhymePlan(['风', '空'], '词林正韵');
  ok(ci && ci.bu === 1 && ci.voice === BU_VOICE[1].voice, '词：风/空 → 词林正韵第一部（东钟）', ci.text);
  ok(rhymePlan(['深', '心'], '词林正韵').bu === 13, '词：深/心 → 第十三部（侵寻）');
  ok(Object.keys(BU_VOICE).length === 19, '词林正韵十九部都有声情');
  ok(Object.keys(PINGSHUI_VOICE).length === 30, '平水韵三十个平声韵目都有声情');

  ok(/不相称/.test(voiceAdvice(['深', '心'], '写登临慷慨', '词林正韵')), '幽细韵写豪壮，出声提醒');
  ok(/不相称/.test(voiceAdvice(['江', '阳'], '悼亡哀痛', '词林正韵')), '洪亮韵写哀情，出声提醒');
  ok(voiceAdvice(['哀', '回', '来', '台', '杯'], '万里悲秋常作客', '平水韵') === '', '登高的韵与情相称，不出声');
  ok(voiceAdvice(['天', '年'], '夜坐闲静', '平水韵') === '', '清远韵写闲静，不出声');
  ok(voiceAdvice(['风', '寒'], '随便', '平水韵') === '', '出韵时不谈声情（另有出韵那条管）');
}

/* ---------------- 六、词：按词谱的韵位取韵脚 ---------------- */
console.log('\n— 词的韵脚按词谱取 —');
{
  const { rhymeCharsOf } = await import('../server/core.mjs');
  const ding = rhymeCharsOf('定风波', ['小庭深树自盘桓', '一角青山俯画栏', '不语看花花尽落', '庭寒', '北风卷地送微澜', '纵有鲲鹏九万转', '应咽', '劫痕累累我自安', '铁干已生千尺蒜', '谁伴', '半竿斜照满江山']);
  ok(ding.join('') === '桓栏落寒澜', '《定风波》取主韵组（上片五句的平韵），错叶的仄韵另属一组、不算出韵', ding.join(''));
  const huan = rhymeCharsOf('浣溪沙', ['一曲新词酒一杯', '去年天气旧亭台', '夕阳西下几时回', '无可奈何花落去', '似曾相识燕归来', '小园香径独徘徊']);
  ok(huan.join('') === '杯台回来徊', '《浣溪沙》取五句韵脚（第四句不押）', huan.join(''));
  const qi = rhymeCharsOf('七言律诗', ['风急天高猿啸哀', '渚清沙白鸟飞回', '无边落木萧萧下', '不尽长江滚滚来', '万里悲秋常作客', '百年多病独登台', '艰难苦恨繁霜鬓', '潦倒新停浊酒杯']);
  ok(qi.join('') === '回来台杯', '律诗取四个偶句的末字（首句入韵与否留给押韵判定去容错）', qi.join(''));
}

console.log('\n— 错叶词牌不许被判出韵 —');
{
  // 《定风波》平仄韵错叶是词牌的规矩：上片「桓栏／落／寒澜」分属不同韵组。
  // 曾拿「全部韵脚同属一部」去判，把错叶的仄韵冤判成出韵（自出题循环里挑出来的）。
  const { diagnose } = await import('../server/disease.mjs');
  const d = diagnose({
    form: '定风波',
    bodyLines: ['小庭深树自盘桓', '一角青山俯画栏', '不语看花花尽落', '庭寒', '北风卷地送微澜', '纵有鲲鹏九万转', '应咽', '劫痕累累我自安', '铁干已生千尺蒜', '谁伴', '半竿斜照满江山'],
  });
  ok(!d.findings.some((f) => f.id === 'mixedbu'), '《定风波》错叶不被自检判成出韵');
  ok(d.plan && d.plan.book === '词林正韵', '词的声情按词林正韵算', d.plan ? d.plan.text : '');
  const { rhymeCharsOf } = await import('../server/core.mjs');
  ok(rhymeCharsOf('定风波', ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸', '子']).length === 5,
    '主韵组取五个（rhymeGroups[0] 存的是小句下标，不再多套一层韵序换算）');
}


/* ---------------- 七、站长拿两首词对质出来的四堵墙 ---------------- */
console.log('\n— 情境断裂：尺度、身份、情绪、器物、用典落地 —');
{
  const scene = '学堂散课钟歇，学生把书一合，墨字与他们坐得认不识。黄昏斜光搁在空台前。';
  const ci = ['大块沉沉', '孤鸿隐隐', '浮云尽南', '认灯下书', '问心安在', '纸上尘缘一例芟', '且问枯儒',
    '尔有何碌', '为谁郁怒', '无故悲酣', '未销勇色', '不怕难堪', '从此去', '只乱山方寸', '掩碧回三'];
  const d = diagnose({ form: '沁园春', bodyLines: ci, scene, fields: { allusion: '无弦琴，出《宋书·隐逸传》' } });
  const ids = new Set(d.findings.map((f) => f.id));
  ok(ids.has('scale'), '案头小事却开「大块、孤鸿」→ 尺度脱钩');
  ok(ids.has('identity'), '学生自称「枯儒」→ 身份错位');
  ok(ids.has('emotion'), '淡场景写「郁怒、悲酣」→ 小愁大悲');
  ok(ids.has('allusion-bare') && d.findings.find((f) => f.id === 'allusion-bare').severity === 'warn',
    '自述「无弦琴」而正文无痕 → 用典未落地（这条是「宜改」，会退回重写）');

  // 今物配古器：作业与砚台同篇
  const d2 = diagnose({ form: '五言律诗', scene: '台灯下补作业，钢笔没水了。',
    bodyLines: ['灯下补遗业', '研墨写新诗', '笔尖干已久', '窗白未知疲', '一纸从头起', '三更独自欺', '明朝仍课室', '且尽此中痴'], fields: {} });
  ok(d2.findings.some((f) => f.id === 'object'), '今物（作业、台灯）配古器（研墨）→ 器物失真');

  // 尺度相称的一首，不许被冤枉
  const good = diagnose({ form: '七言绝句', scene: '午后教室将散未散，窗外白杨摇影，斜阳落在纸边。',
    bodyLines: ['斜阳一寸落人前', '课表掀风不敢眠', '掐指霜钟还几杵', '挑山未了又沾先'], fields: {} });
  const wrong = good.findings.filter((f) => ['scale', 'identity', 'emotion', 'object', 'allusion-bare'].includes(f.id));
  ok(wrong.length === 0, '尺度与场景相称的一首，这五条一条都不报', wrong.map((f) => f.name).join('、'));
}

/* ---------------- 八、《人间词话》逐则（第一、二轮） ---------------- */
console.log('\n— 境界：有我 / 无我（三则）与代字（三十四则）—');
{
  const REALM = [
    ['山居秋暝', '五言律诗', ['空山新雨后', '天气晚来秋', '明月松间照', '清泉石上流', '竹喧归浣女', '莲动下渔舟', '随意春芳歇', '王孙自可留'], '无我之境'],
    ['鸟鸣涧', '五言绝句', ['人闲桂花落', '夜静春山空', '月出惊山鸟', '时鸣春涧中'], '无我之境'],
    ['鹿柴', '五言绝句', ['空山不见人', '但闻人语响', '返景入深林', '复照青苔上'], '无我之境'],
    ['登高', '七言律诗', ['风急天高猿啸哀', '渚清沙白鸟飞回', '无边落木萧萧下', '不尽长江滚滚来', '万里悲秋常作客', '百年多病独登台', '艰难苦恨繁霜鬓', '潦倒新停浊酒杯'], '有我之境'],
    ['春望', '五言律诗', ['国破山河在', '城春草木深', '感时花溅泪', '恨别鸟惊心', '烽火连三月', '家书抵万金', '白头搔更短', '浑欲不胜簪'], '有我之境'],
  ];
  const wrong = REALM.filter(([n, f, l, want]) => diagnose({ form: f, bodyLines: l }).realm.type !== want);
  ok(wrong.length === 0, '五首名作的我有无我之境全部判对', wrong.map((x) => x[0]).join('、'));

  // 第一版只看「情绪字是否紧贴自然物」，把《登高》判成了无我 —— 留个反向断言防复发
  ok(diagnose({ form: '七言律诗', bodyLines: REALM[3][2] }).realm.feelings.length > 0,
    '《登高》判为有我（「悲」「苦」「恨」都在，只是不着色于物）—— 这个坑留证');

  // 代字：桂华流瓦（王国维的原例）
  const d = diagnose({ form: '七言律诗', bodyLines: ['桂华流瓦小楼西', '冰轮碾玉露华滋', '玉盘高挂无人见', '六出飞花入户时', '翠微深处一僧归', '绿绮声中酒力微', '双鲤不来江水阔', '菱花空对鬓边丝'] });
  ok(d.findings.some((f) => f.id === 'substitute' && /桂华/.test(f.text)), '「桂华」被判为代字（三十四则的原例）');
  ok(d.findings.find((f) => f.id === 'substitute').severity === 'note', '代字只报提示，不当成错（王国维也只是「惜」）');

  // 既着色又说破 → 宜改
  const d2 = diagnose({ form: '七言绝句', bodyLines: ['愁云压树晚风凉', '独倚危楼望故乡', '我自悲秋心欲碎', '一声孤雁过寒塘'] });
  ok(d2.findings.some((f) => f.id === 'realm-broken' && f.severity === 'warn'), '既借物着色、又直说破 → 宜改');
  // 只着色不说破，不许报
  const d3 = diagnose({ form: '七言绝句', bodyLines: ['愁云压树晚风凉', '独倚危楼望故乡', '一片寒砧催木叶', '几声孤雁过寒塘'] });
  ok(!d3.findings.some((f) => f.id === 'realm-broken'), '只着色、不说破的，不报「说破」');
}

/* ---------------- 九、《人间词话》第三轮：造境 / 写境（第二则） ---------------- */
console.log('\n— 造境 / 写境（二则）—');
{
  const { makeOf } = await import('../server/disease.mjs');
  // 王国维自己说「二者颇难分别」——所以本轮的验收标准首先是**不许乱判**
  const xie = makeOf(['小阁灯昏夜向晨', '一编未了独凝神', '明朝也是堂中客', '墨渍空黏纸上春'],
    '假末夜半，书案灯下，翻至末页，笔搁纸边，无雨无声，人只是坐着不肯睡。', '写境：只写眼前');
  ok(xie.make === '难分', '写境的一首把场景的词重写了（书案灯下→小阁灯昏），代理判「难分」而不是硬判 —— 不许乱判', xie.make);

  const zao = makeOf(['飞流直下三千尺', '疑是银河落九天'], '庐山瀑布', '造境：以理想造境');
  ok(zao.make === '造境' && zao.declared === '造境', '造境的一首（三千尺、疑是银河）判「造境」，与自报一致', zao.make);

  // 自报写境、却另造一境：这才是要抓的（站长说的「先甩几个大词撑场面」）
  const d = diagnose({
    form: '七言绝句',
    bodyLines: ['大块沉沉孤鸿隐', '疑是银河落九天', '三千世界一微尘', '万古苍茫独倚栏'],
    scene: '书案灯下，翻至末页，笔搁纸边',
    fields: { realm: '写境：只写眼前' },
  });
  const f = d.findings.find((x) => x.id === 'make');
  ok(Boolean(f) && f.severity === 'note', '自报「写境」而证据像「造境」→ 提示（不下判词）');
  ok(Boolean(f) && /颇难分别/.test(f.text), '提示里引了王国维「二者颇难分别」，说明白这是倾向不是定论');

  // 反例：自报写境且与场景相接，不许报
  const d2 = diagnose({
    form: '七言绝句',
    bodyLines: ['书案灯昏夜向晨', '一编未了独凝神', '笔搁纸边人未睡', '明朝依旧堂中身'],
    scene: '书案灯下，翻至末页，笔搁纸边，无雨无声，人只是坐着不肯睡',
    fields: { realm: '写境：只写眼前' },
  });
  ok(!d2.findings.some((x) => x.id === 'make'), '自报写境且句子落在场景实有之物上，不报');
}

/* ---------------- 十、《人间词话》第四轮：隔与不隔（四十、四十一则） ---------------- */
console.log('\n— 隔与不隔（四十、四十一则）—');
{
  const { detectGe } = await import('../server/disease.mjs');
  const quiet = (l) => !diagnose({ form: '七言绝句', bodyLines: l }).findings.some((f) => f.id === 'ge');

  // 王国维的正例：语语都在目前 —— 必须**沉默**（我不报「不隔」，只报「隔」）
  ok(quiet(['池塘生春草', '园柳变鸣禽']), '「池塘生春草，园柳变鸣禽」→ 沉默');
  ok(quiet(['暗牖悬蛛网', '空梁落燕泥']), '「空梁落燕泥」→ 沉默');
  ok(quiet(['阑干十二独凭春', '晴碧远连云']), '欧阳修「阑干十二独凭春」→ 沉默');

  // 反例：堆僻典而眼前空着 —— 必须报
  const d = diagnose({ form: '七言绝句', bodyLines: ['谢家池上春无主', '江淹浦畔草空生', '蓝桥捣尽玄霜白', '洛浦空传说佩人'] });
  const f = d.findings.find((x) => x.id === 'ge');
  ok(Boolean(f), '「谢家池上，江淹浦畔」这类堆僻典的 → 报「隔」');
  ok(Boolean(f) && /语语都在目前/.test(f.text), '提示里引「语语都在目前，便是不隔」，说清隔在哪里');

  // 这一条是这轮最要紧的**已知局限**：白石「二十四桥仍在，波心荡、冷月无声」格韵高绝而被
  // 王国维判为「隔」，我的代理算出来实景很多 —— 若它敢报「不隔」就是替王国维下了错判词。
  // 所以本轮的规则是**只报隔、绝不报不隔**；这一句必须沉默。
  const bai = diagnose({ form: '七言绝句', bodyLines: ['二十四桥仍在否', '波心荡处冷月声', '渐黄昏清角吹寒', '都在空城雪未晴'] });
  // 隔的两档（站长：「不要雾里看花」）——明显则提示，雾里看花那一档才退稿
  const mild = diagnose({ form: '七言绝句', bodyLines: ['谢家池上春无主', '江淹浦畔草空生'] }).findings.find((x) => x.id === 'ge');
  ok(Boolean(mild) && mild.severity === 'note', '用几个僻典 → 只提示');
  const fog = diagnose({ form: '七言绝句', bodyLines: ['谢家池上春无主', '江淹浦畔草空生', '蓝桥捣尽玄霜白', '洛浦空传说佩人'] }).findings.find((x) => x.id === 'ge');
  ok(Boolean(fog) && fog.severity === 'warn', '堆典到雾里看花（典是实景三倍以上）→ 才退稿');
  ok(!bai.findings.some((x) => x.id === 'ge'),
    '白石那一句（王国维判隔而我判不出）→ 沉默，不硬判 —— 只报隔、绝不报不隔');
  ok(detectGe(['二十四桥仍在', '波心荡冷月无声']).real >= 4, '它实景确实很多（所以代理没有资格说它隔）', String(detectGe(['二十四桥仍在', '波心荡冷月无声']).real));
}

/* ---------------- 十一、《人间词话》第五轮：真景物真感情（六则）＋自报核对 ---------------- */
console.log('\n— 真景物真感情（六则）与自报核对 —');
{
  const { claimMismatch } = await import('../server/disease.mjs');
  const quiet = (l) => !diagnose({ form: '七言绝句', bodyLines: l }).findings.some((f) => f.id === 'static');

  // 这一条最容易冤枉人：马致远《天净沙》前三句都是纯名词
  ok(quiet(['枯藤老树昏鸦', '小桥流水人家', '古道西风瘦马', '夕阳西下', '断肠人在天涯']),
    '《天净沙》纯名词句在前，整首并不静 → 沉默（判的是整首六成，不是单句）');
  ok(quiet(['空山新雨后', '天气晚来秋', '明月松间照', '清泉石上流']), '《山居秋暝》有「照」「流」的动作 → 沉默');

  const d = diagnose({ form: '七言绝句', bodyLines: ['远山寒树孤村', '古渡荒桥野草', '寒沙白露残荷', '冷月疏星断岸'] });
  ok(d.findings.some((f) => f.id === 'static'), '四句全是「物摆着，不动也不动情」→ 报布景板');
  ok(/一切景语皆情语/.test((d.findings.find((f) => f.id === 'static') || {}).text || ''), '提示里引「一切景语皆情语」');

  // 自报的韵部与实际不符：连着两轮实测都是它说谎
  // 用一首韵脚可控的《浣溪沙》来验（五处韵脚都在真文元第六部）。
  // 为什么不用近体诗：平水韵那一侧没有「第几部」的说法，比对要另写一套韵目名解析 ——
  // 那是下一轮的活；而实测出现的两次说谎都在词上，先把词这一侧钉死。
  const lines = ['春风吹雨过江滨', '小阁灯昏夜向晨', '一编未了独凝神', '檐前滴水打苔痕', '明朝依旧此中身', '一盏孤灯照旧尘'];
  const bad = diagnose({ form: '浣溪沙', bodyLines: lines, fields: { rhyme: '平声尤侯，即《词林正韵》第十二部' } });
  ok(bad.findings.some((f) => f.id === 'rhyme-claim'),
    '自报第十二部（尤侯）而实际是第六部（真文元）→ 报出来（连着两轮实测它就是这么说错的）');
  const good = diagnose({ form: '浣溪沙', bodyLines: lines, fields: { rhyme: '取《词林正韵》第六部真文元' } });
  ok(!good.findings.some((f) => f.id === 'rhyme-claim'), '自报与实际相符时，不说话');
  ok(claimMismatch('', good.plan).length === 0, '没自报就不核对');
}

/* ---------------- 十二、《人间词话》第六轮：一字境界全出（七则） ---------------- */
console.log('\n— 一字境界全出（七则）与境界有大小（八则）—');
{
  const { liveChars } = await import('../server/disease.mjs');
  // 王国维的两个正例：活字必须被**找出来**（这一轮是找功，不是挑错）
  const hong = liveChars(['红杏枝头春意闹', '绿杨烟外晓寒轻']).map((x) => x.char);
  ok(hong.includes('闹'), '「红杏枝头春意闹」→ 找出活字「闹」', hong.join(''));
  const nong = liveChars(['云破月来花弄影', '风不定人初静']).map((x) => x.char);
  ok(nong.includes('弄'), '「云破月来花弄影」→ 找出活字「弄」', nong.join(''));

  const eye = (a, l = ['云破月来花弄影', '风不定人初静']) =>
    diagnose({ form: '七言绝句', bodyLines: l, fields: { appraisal: a } }).findings.filter((f) => f.id.startsWith('eye'));

  ok(eye('最见精神的是「闹」字。', ['红杏枝头春意闹', '绿杨烟外晓寒轻']).length === 0, '指认的活字确在诗中 → 不说话');
  const thing = eye('我取「月」字。');
  ok(thing.length === 1 && thing[0].severity === 'note' && /物名/.test(thing[0].text), '指认物名（月）→ 提示「那不是让静物动起来的那类字」');
  const ghost = eye('我取「怒」字。');
  ok(ghost.length === 1 && ghost[0].severity === 'warn', '指认的字不在正文里 → 必改（字在不在诗里，数得出来）');
  const none = eye('我最认可第二句的写法。');
  ok(none.length === 1 && none[0].id === 'eye-none' && /直说没有/.test(none[0].text), '指不出那一个字 → 提示，且允许它说「未有」');

  // 境界有大小，不以是而分优劣：尺度那条必须带上这句，免得被当成「禁大词」
  const d = diagnose({
    form: '七言绝句',
    bodyLines: ['大块沉沉孤鸿隐', '乾坤万里一浮萍', '苍茫四海无归处', '九霄云外独行行'],
    scene: '书案灯下，翻至末页，笔搁纸边',
  });
  const f = d.findings.find((x) => x.id === 'scale');
  ok(Boolean(f) && /境界有大小/.test(f.text), '尺度脱钩的提示里带上王国维「境界有大小，不以是而分优劣」—— 判的是不相称，不是词大');
}

/* ---------------- 十三、《人间词话》第七轮：忌游词（六十一则）＋重韵补漏 ---------------- */
console.log('\n— 忌游词（六十一则）与重韵补漏 —');
{
  // 重韵：第六轮实测那首五律「身、尘、人、身」——首句入韵，与末句同字
  const d1 = diagnose({
    form: '五言律诗',
    bodyLines: ['匣底藏残刃', '斑痕记几身', '胶缠柄未脱', '锈蚀口如尘', '手泽犹堪认', '音容杳莫人', '一回亲取看', '暂启却还身'],
  });
  ok(d1.findings.some((f) => f.id === 'chongyun' && f.severity === 'warn'),
    '首句入韵而与末句同字 → 报重韵（第一版只数偶句，漏了；实测踩到才补上）');
  // 首句入韵但不重的三首名作不许被冤枉
  const clean = [
    ['登高', '七言律诗', ['风急天高猿啸哀', '渚清沙白鸟飞回', '无边落木萧萧下', '不尽长江滚滚来', '万里悲秋常作客', '百年多病独登台', '艰难苦恨繁霜鬓', '潦倒新停浊酒杯']],
    ['春望', '五言律诗', ['国破山河在', '城春草木深', '感时花溅泪', '恨别鸟惊心', '烽火连三月', '家书抵万金', '白头搔更短', '浑欲不胜簪']],
    ['山居秋暝', '五言律诗', ['空山新雨后', '天气晚来秋', '明月松间照', '清泉石上流', '竹喧归浣女', '莲动下渔舟', '随意春芳歇', '王孙自可留']],
  ];
  const wronged = clean.filter(([n, f, l]) => diagnose({ form: f, bodyLines: l }).findings.some((x) => x.id === 'chongyun'));
  ok(wronged.length === 0, '首句入韵而不重韵的名作，一条都不报', wronged.map((x) => x[0]).join('、'));

  // 游词
  const d2 = diagnose({ form: '七言绝句', bodyLines: ['世上悠悠不识真', '姜芽尽是捧心人'] });
  ok(d2.findings.some((f) => f.id === 'youci'), '王国维举的游词例（「世上悠悠不识真」）→ 报游词');
  const d3 = diagnose({ form: '七言律诗', bodyLines: clean[0][2] });
  ok(!d3.findings.some((f) => f.id === 'youci'), '《登高》不报游词');
  // 第一版收「无端」「浮生」，把「锦瑟无端五十弦」冤判了 —— 留证
  const d4 = diagnose({ form: '七言律诗', bodyLines: ['锦瑟无端五十弦', '一弦一柱思华年', '庄生晓梦迷蝴蝶', '望帝春心托杜鹃', '沧海月明珠有泪', '蓝田日暖玉生烟', '此情可待成追忆', '只是当时已惘然'] });
  ok(!d4.findings.some((f) => f.id === 'youci'), '《锦瑟》不报游词（「无端」是实义，不是垫字 —— 第一版冤判过，留证）');
}

/* ---------------- 十四、《人间词话》第八轮：无矫揉妆束（五十六则）＋诗的韵部自报 ---------------- */
console.log('\n— 无矫揉妆束之态（五十六则）与诗的韵部自报 —');
{
  // 单一样出现时各报各的，不说「妆束」；两样以上同时上身才是妆饰过了头
  const one = diagnose({ form: '七言绝句', bodyLines: ['心云梦月绕江楼', '一树寒花照水流'] });
  ok(!one.findings.some((f) => f.id === 'dressed'), '只有生造一样 → 不报「妆束」（另有生造那条单独说）');
  const three = diagnose({ form: '七言绝句', bodyLines: ['心云梦月绕孤舟', '浊酒青衫对夕阳', '流年岁月空悠悠', '桂华流瓦照江楼'] });
  const f = three.findings.find((x) => x.id === 'dressed');
  ok(Boolean(f), '生造＋套语＋代字三样上身 → 报「矫揉妆束」');
  ok(Boolean(f) && /脱口而出/.test(f.text), '提示里引「其辞脱口而出，无矫揉妆束之态」');
  const good = diagnose({ form: '五言绝句', bodyLines: ['春眠不觉晓', '处处闻啼鸟', '夜来风雨声', '花落知多少'] });
  ok(!good.findings.some((x) => x.id === 'dressed'), '《春晓》→ 不报妆束');

  // 诗的「自报韵部」核对（词侧上一轮已做，这一轮补诗侧）
  const denggao = ['风急天高猿啸哀', '渚清沙白鸟飞回', '无边落木萧萧下', '不尽长江滚滚来', '万里悲秋常作客', '百年多病独登台', '艰难苦恨繁霜鬓', '潦倒新停浊酒杯'];
  const wrong = diagnose({ form: '七言律诗', bodyLines: denggao, fields: { rhyme: '取平水韵下平八庚' } });
  ok(wrong.findings.some((x) => x.id === 'rhyme-claim'), '诗侧：自报「下平八庚」而实际「上平十灰」→ 报出来（原为欠账，已还）');
  const right = diagnose({ form: '七言律诗', bodyLines: denggao, fields: { rhyme: '取平水韵上平十灰' } });
  ok(!right.findings.some((x) => x.id === 'rhyme-claim'), '诗侧：自报与实际相符 → 不说话');
}

/* ---------------- 十五、总验收：十则逐条必须有据可查 ---------------- */
console.log('\n— 总验收：《人间词话》十则的可复发验证 —');
{
  const { liveChars, detectGe, makeOf } = await import('../server/disease.mjs');
  const F = (f, l, extra = {}) => diagnose({ form: f, bodyLines: l, ...extra });
  // 每一条都用一段**诱发病症**的句子来验，且与 test 里已有的正例互为表里
  const BATTERY = [
    ['代字（三十四则）', () => F('七言绝句', ['桂华流瓦小楼西', '冰轮碾玉露华滋']).findings.some((x) => x.id === 'substitute')],
    ['有我/无我（三则）', () => F('五言绝句', ['空山新雨后', '天气晚来秋']).realm.type === '无我之境' && F('七言律诗', ['万里悲秋常作客', '百年多病独登台']).realm.type === '有我之境'],
    ['造境/写境（二则）', () => makeOf(['大块沉沉孤鸿隐', '疑是银河落九天', '三千世界一微尘'], '书案灯下翻至末页', '写境：只写眼前').make === '造境'],
    ['隔与不隔（四十则）', () => detectGe(['谢家池上春无主', '江淹浦畔草空生']).veil >= 6],
    ['真景物真感情（六则）', () => F('七言绝句', ['远山寒树孤村', '古渡荒桥野草', '寒沙白露残荷', '冷月疏星断岸']).findings.some((x) => x.id === 'static')],
    ['一切景语皆情语（删稿）', () => F('七言绝句', ['远山寒树孤村', '古渡荒桥野草', '一腔愁恨难消', '满怀悲怨谁知']).findings.some((x) => x.id === 'qingjing')],
    ['一字境界全出（七则）', () => liveChars(['红杏枝头春意闹']).some((x) => x.char === '闹')],
    ['境界有大小（八则）', () => F('七言绝句', ['大块沉沉孤鸿隐', '乾坤万里一浮萍', '苍茫四海无归处', '九霄云外独行行'], { scene: '书案灯下，笔搁纸边' }).findings.some((x) => x.id === 'scale')],
    ['忌游词（六十一则）', () => F('七言绝句', ['世上悠悠不识真', '姜芽尽是捧心人']).findings.some((x) => x.id === 'youci')],
    ['无矫揉妆束（五十六则）', () => F('七言绝句', ['心云梦月绕孤舟', '浊酒青衫对夕阳', '流年岁月空悠悠', '桂华流瓦照江楼']).findings.some((x) => x.id === 'dressed')],
  ];
  const missed = BATTERY.filter(([, fn]) => !fn()).map(([name]) => name);
  ok(missed.length === 0, `十则逐条都有可复发的验证（${BATTERY.length} 条）`, missed.length ? '缺 ' + missed.join('、') : '全通');
  // 正例一侧的总闸：七首名作不许被这十则里的任何一条冤判成「宜改」
  const names = Object.entries(FAMOUS).filter(([, [f, l]]) => diagnose({ form: f, bodyLines: l }).findings.some((x) => x.severity === 'warn'));
  ok(names.length === 0, '七首名作在十则检查全部上线之后，仍然一处「宜改」都没有', names.map((x) => x[0]).join('、'));
}

/* ---------------- 十六、任何出口都长一样（第十轮踩到的隐患） ---------------- */
console.log('\n— diagnose 的出口字段（早返回也要齐）—');
{
  const full = Object.keys(diagnose({ form: '七言绝句', bodyLines: ['春风吹雨过江滨', '小阁灯昏夜向晨'] })).sort().join(',');
  const empty = Object.keys(diagnose({ form: '七言绝句', bodyLines: [] })).sort().join(',');
  const blank = Object.keys(diagnose({ form: '七言绝句', bodyLines: ['', '  '] })).sort().join(',');
  ok(empty === full, '空稿的字段与有稿一致（原缺 realm/make/live，左栏「境界」会整行空掉）', empty);
  ok(blank === full, '只给空白的稿子也一样', blank);
  ok(full.includes('realm') && full.includes('make') && full.includes('live'), '境界/造境写境/活字三样都在返回值里', full);
}
console.log('\n' + '─'.repeat(58));
console.log(bad === 0 ? '诗病自检与声情自证通过' : `${bad} 项未通过`);
process.exit(bad ? 1 : 0);
