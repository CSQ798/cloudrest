// 页面结构与元素引用的自检
//
// 为什么要有它：从 HTML 里删元素、却没删 JS 里的引用，addEventListener 会在 null
// 上抛错，整个工具栏直接死掉 —— 这是最容易犯、也最难一眼看出的错。
// 所以每改一次页面结构，都把「JS 要找的元素」与「HTML 里真实存在的元素」对一遍。
//
// 用法：node .tools/check-dom-ids.mjs

import fs from 'node:fs';
import { getMarks } from '../server/tunes.mjs';
import { layoutPoem } from '../server/format.mjs';

let bad = 0;
const ok = (c, label) => {
  if (!c) bad++;
  console.log(`  ${c ? '✓' : '✗'} ${label}`);
};

const index = fs.readFileSync('public/index.html', 'utf8');
const accountPage = fs.readFileSync('public/account.html', 'utf8');
const adminPage = fs.readFileSync('public/admin.html', 'utf8');
const accountJs = fs.readFileSync('public/account.js', 'utf8');
const appJs = fs.readFileSync('public/app.js', 'utf8');
const css = fs.readFileSync('public/style.css', 'utf8');

const has = (html, id) => html.includes(`id="${id}"`);
const idsIn = (list, html, who) => {
  const missing = list.filter((id) => !has(html, id));
  ok(missing.length === 0, `${who} 要用的 ${list.length} 个 id 都在` + (missing.length ? `（缺 ${missing.join('、')}）` : ''));
};

console.log('— 主页 —');
idsIn(
  ['toolbar', 'tbUser', 'tbQuota', 'tbLogin', 'tbLogout', 'tbKey', 'tbKeyGo', 'tbAsk', 'hint'],
  index,
  'account.js'
);
idsIn(
  [
    'scene', 'wish', 'compose', 'refine', 'hint', 'hint2', 'status', 'formNote', 'clearForm',
    'forms', 'ownForm', 'ownFormNote', 'poets', 'poetNote', 'poemWrap', 'verdict', 'actions',
    'toast', 'mind', 'copy', 'again', 'save',
  ],
  index,
  'app.js'
);

console.log('\n— 账号页 —');
idsIn(
  ['auEmail', 'auPass', 'auMsg', 'auLogin', 'auRegister', 'who', 'whoSub', 'auLogout', 'auUnkey', 'ask'],
  accountPage,
  'account-page.js'
);

console.log('\n— 管理页 —');
idsIn(
  ['akey', 'asave', 'amsg', 'arefresh', 'cmsg', 'claims', 'ncount', 'ncredits', 'nnote', 'agen', 'codes'],
  adminPage,
  'admin.js'
);

console.log('\n— 你明确要求过的几件事 —');
// 「卡在中间还要滚，别扭」→ 不做弹窗，单独开一页
ok(!index.includes('class="sheet"') && !index.includes('sheet-card'), '主页上没有居中弹窗');
ok(index.includes('href="/account.html"'), '「登录 / 注册」是跳转链接');
ok(index.includes('href="/account.html#ask"'), '「小启」是跳转链接');
ok(accountPage.includes('1876148307@qq.com'), '邮箱在账号页上');
ok(accountPage.includes('小启'), '账号页上有小启');

// 「删掉所有 qiyun 这种东西」
ok(![index, accountPage, adminPage].some((h) => /qiyun/i.test(h)), '三个页面里都没有 qiyun 这类拉丁名');

// 「中间那两条杠去掉，上部压紧」
ok(!/\.topbar\s*\{[^}]*border-bottom/.test(css), '顶栏没有下框线');
const motto = css.match(/\.motto\s*\{[^}]*\}/);
ok(Boolean(motto) && !/border-bottom/.test(motto[0]), '题记没有下框线');

// 「输入框放下面，诗放上面」
ok(index.indexOf('poem-wrap') < index.indexOf('class="composer"'), '中栏是「诗在上、输入在下」');

// 「诗不要在标题下显示类型」
ok(!index.includes('poem-form') && !appJs.includes('poem-form'), '标题下没有诗体行');

// 纸笺
const card = appJs.slice(appJs.indexOf('function downloadCard'), appJs.indexOf('/* ---------------- 启动'));
ok(!card.includes('H - 54'), '纸笺上没有第二处落款（左下角那行已删）');
ok((card.match(/fillText\('云卷'|fillText\('云舒'/g) || []).length === 2, '纸笺上「云卷云舒」只以名章形式出现');
ok(card.includes('COLS'), '纸笺有乌丝栏（等距竖格）');

// 「你确定定风波每一句话后面都是句号吗？」→ 标点改由句读表决定，不再按韵位
const formatJs = fs.readFileSync('server/format.mjs', 'utf8');
ok(!/rhymeMap/.test(formatJs), '排版不再按韵位断句');
ok(/getMarks/.test(formatJs), '排版用的是词牌的句读标点表');
const dfb = getMarks('定风波');
ok(Boolean(dfb) && dfb.some((m) => m === '，') && dfb.filter((m) => m === '。').length === 4, '《定风波》十一个小句里有七个逗号、四个句号');
ok(layoutPoem('定风波', ['小庭深树自盘桓', '一角青山俯画栏', '不语看花尽落', '庭寒', '北风卷地送微澜'])[0] === '小庭深树自盘桓，一角青山俯画栏。', '《定风波》头两句并成一行、以句号收');

// 「中栏一行太长会折行，别把一句从中间劈开」
ok(appJs.includes("className = 'ju'"), 'app.js 把每个小句各自包了一层（折行只发生在标点之后）');
ok(/\.poem-body \.line \.ju\s*\{[^}]*inline-block/.test(css), '.ju 在样式里是 inline-block');
ok(!/\(\?<=/.test(appJs.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')), 'app.js 没用后行断言（老 Safari 会整份脚本语法失败）');

// 「我希望你在合适的时候，在诗句中添加一些哲思」→ 诗的末句要有一层想头，
// 而且要让站长看得见落在哪一句，所以左栏加一条「立意」。
const promptJs = fs.readFileSync('server/prompt.mjs', 'utf8');
const coreJs = fs.readFileSync('server/core.mjs', 'utf8');
ok(/【诗里要有一层想头，但绝不是格言】/.test(promptJs), '诗心准则里加了「要有一层想头，但绝不是格言」');
ok(/理在景中/.test(promptJs) && /人生如梦、世事无常/.test(promptJs), '想头要藏在景里，并点名了几种讲道理的写法');
ok(/<insight>/.test(promptJs), '输出格式里有 <insight>（立意）标签');
ok(coreJs.includes("'insight'"), 'TAGS 白名单里有 insight（否则模型写了也会被静默丢掉）');
ok(/insight: \(f\.insight/.test(coreJs), 'result 事件带上了立意');
ok(appJs.includes('立意'), '左栏有「立意」这一条');

// 「平仄这么多不合是不是有些太过分了」
ok(/MAX_TRIES: 5/.test(coreJs), '改写次数从 4 提到 5');
ok(/mustRewrite/.test(promptJs), '平仄只差几处时改用「只换那几个字」的改法，不再重写全篇');
ok(/只把点到的字换掉/.test(fs.readFileSync('server/validator.mjs', 'utf8')), '整改意见里写明了「只换点到的字」');

// 「能否将纸笺中的字体更换为与图示一样的字体」
// 纸笺原来写的是 '27px -serif' —— 少一个字母，`-serif` 不是通用族名，
// 浏览器当成不存在的字体名回退到默认字体，于是屏幕上一个样、纸笺另一个样。
{
  const cardJs = fs.readFileSync('public/card-layout.mjs', 'utf8');
  // 注释里留着那句「原来是 '27px -serif'」的说明，所以先把注释剥掉再看代码
  const cardCode = cardJs.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const { SERIF } = await import('../public/card-layout.mjs');
  const cssSerif = (css.match(/--serif:\s*([^;]+);/) || [, ''])[1].replace(/\s+/g, ' ').trim();
  ok(!/'[^']*\d+px\s+-/.test(cardCode), '纸笺字体串里没有 `-serif` 这个错字');
  ok(cssSerif.includes('Source Han Serif SC') && cssSerif.includes('宋体'), `style.css 里的 --serif 是衬线栈`);
  ok(SERIF.replace(/\s+/g, ' ').trim() === cssSerif, '纸笺的退路字体栈与 style.css 的 --serif 一字不差');
  ok(appJs.includes("getPropertyValue('--serif')"), '纸笺直接从 CSS 变量 --serif 取字体（不在两处各写一份）');
  ok(/fonts\b/.test(appJs) && !/FONT\./.test(appJs), '绘制用的是 layoutCard 交回来的字体，不再另取一份常量');
}


// 「这个网页的图标怎么还是一个『栖』字」——2026 年 10 月站长报的。
// 病根：改名之后 index.html 的图标没跟着换（还是旧名「栖」＋旧的靛蓝），
// 而 account.html 早就换对了。图标藏在 data URI 的百分号编码里，肉眼扫不出来，
// 所以这条必须由测试盯着：三个页面一字不差，且编码的是「云」（%E4%BA%91）。
{
  const pages = ['index.html', 'account.html', 'admin.html'];
  const icons = pages.map((f) => {
    const h = fs.readFileSync(`public/${f}`, 'utf8');
    return (h.split('\n').find((l) => l.includes('rel="icon"')) || '').trim();
  });
  ok(icons.every(Boolean), '三个页面都有 favicon', icons.filter((x) => !x).length ? '缺 ' + pages.filter((_, i) => !icons[i]).join('、') : '');
  ok(new Set(icons).size === 1, '三个页面的图标一字不差（改名后漏改一个页面，正是这次报的毛病）');
  ok(icons[0].includes('%E4%BA%91'), '图标上编码的是「云」（%E4%BA%91）');
  ok(!icons[0].includes('%E6%A0%96'), '图标里没有旧名那个「栖」字（%E6%A0%96）');
  ok(/fill=.'?%233d7ff0/.test(icons[0]), '图标底色是现在的强调色 #3d7ff0，不是旧的 #5E6AD2');
  ok(!icons[0].includes('5E6AD2'), '图标里没有旧的靛蓝 #5E6AD2');
}
console.log('\n— 未使用的 JS 变量（会静默失效的那种）—');
ok(!/const formEl\b/.test(appJs), 'app.js 里没有残留的 formEl');
ok(!/\bformEl\b/.test(appJs), 'app.js 里完全没有 formEl 了');

console.log('\n' + '─'.repeat(56));
console.log(bad === 0 ? '页面结构自检通过' : `${bad} 项未通过`);
process.exit(bad ? 1 : 0);
