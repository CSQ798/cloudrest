// cloudrest 部署前自检
//
// 用法：在本目录（有 wrangler.toml 的那一层）执行
//     node doctor.mjs
// 不联网、不花钱，只检查文件和配置对不对。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 用 fileURLToPath 正确解析（路径里有空格，不可自己拼）
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => {
  console.log(`  ✗ ${m}`);
  failed = true;
};
let failed = false;

console.log('\ncloudrest 部署前自检\n' + '─'.repeat(46));

/* 1. 是不是在项目根目录 */
console.log('\n[1] 目录');
const must = ['wrangler.toml', 'package.json', 'worker.mjs', 'public', 'server'];
const missing = must.filter((f) => !fs.existsSync(path.join(HERE, f)));
if (missing.length === 0) {
  ok(`项目本身完整：${HERE}`);
} else {
  bad(`项目文件不全，缺少：${missing.join('、')}`);
  console.log(`      项目目录是：${HERE}`);
}

// 关键：wrangler / npm 认的是「你当前所在的目录」，不是这个脚本所在的目录。
// 上一轮就是在这里踩的坑——从家目录跑 npm install 与 npx wrangler，
// 于是读不到 wrangler.toml，报「Required Worker name missing」。
const cwd = process.cwd();
const same = path.resolve(cwd).toLowerCase() === path.resolve(HERE).toLowerCase();
if (same) {
  ok('你当前就在项目目录里（npm / wrangler 能找到配置）');
} else {
  bad(`你当前不在项目目录里！现在的目录是：${cwd}`);
  console.log('      npm install 与 npx wrangler 必须在项目目录里执行，');
  console.log('      否则读不到 wrangler.toml，会报 Required Worker name missing。');
  console.log('      请先执行（整段复制）：');
  console.log(`        cd "${HERE}"`);
  if (/^[A-Za-z]:\\/.test(HERE)) {
    // Windows 路径转成 WSL 路径：C:\a\b → /mnt/c/a/b
    const wsl = '/mnt/' + HERE[0].toLowerCase() + HERE.slice(2).split('\\').join('/');
    console.log('      WSL 用户请用：');
    console.log(`        cd "${wsl}"`);
  }
}

/* 2. wrangler.toml —— 这是**Pages**的配置（默认走 Pages，因为 pages.dev 大陆能开） */
console.log('\n[2] wrangler.toml（Pages 路线）');
try {
  const toml = fs.readFileSync(path.join(HERE, 'wrangler.toml'), 'utf8');
  const name = toml.match(/^\s*name\s*=\s*["']([^"']+)["']/m)?.[1];
  const pdir = toml.match(/^\s*pages_build_output_dir\s*=\s*["']([^"']+)["']/m)?.[1];
  // 这两条踩过坑，写成硬检查：
  //   缺 pages_build_output_dir → wrangler 会警告「missing ... required by Pages」并忽略配置
  //   出现 main → 说明把 Workers 的配置放到默认文件名上了，Pages 命令会走偏
  name === 'cloudrest' ? ok(`name = "${name}"`) : bad(`name 应为 cloudrest，实际是 ${name || '（缺失）'}`);
  if (!pdir) {
    bad('缺少 pages_build_output_dir，wrangler 会忽略这个配置并报警告');
  } else {
    fs.existsSync(path.join(HERE, pdir, 'index.html'))
      ? ok(`pages_build_output_dir = "${pdir}"（含 index.html）`)
      : bad(`pages_build_output_dir 指向的目录里没有 index.html：${pdir}`);
  }
  if (/^\s*main\s*=/m.test(toml)) {
    bad('wrangler.toml 里出现了 main —— 这是 Workers 的字段，应放到 wrangler.worker.toml');
  } else {
    ok('没有 main 字段（确认是 Pages 配置，不是 Workers 配置）');
  }
} catch {
  bad('读不到 wrangler.toml');
}

/* 3. wrangler.worker.toml —— Workers 路线（备用） */
console.log('\n[3] wrangler.worker.toml（Workers 路线，备用）');
try {
  const toml = fs.readFileSync(path.join(HERE, 'wrangler.worker.toml'), 'utf8');
  const name = toml.match(/^\s*name\s*=\s*["']([^"']+)["']/m)?.[1];
  const main = toml.match(/^\s*main\s*=\s*["']([^"']+)["']/m)?.[1];
  const dir = toml.match(/^\s*directory\s*=\s*["']([^"']+)["']/m)?.[1];
  name === 'cloudrest' ? ok(`name = "${name}"`) : bad(`name 应为 cloudrest，实际是 ${name || '（缺失）'}`);
  main && fs.existsSync(path.join(HERE, main)) ? ok(`main = "${main}"（文件存在）`) : bad(`main 指向的入口文件不存在：${main || '（缺失）'}`);
  if (dir) {
    const abs = path.join(HERE, dir);
    fs.existsSync(path.join(abs, 'index.html')) ? ok(`assets 目录 "${dir}"（含 index.html）`) : bad(`assets 目录里没有 index.html：${abs}`);
  } else {
    bad('缺少 [assets] directory 配置');
  }
  // run_worker_first 必须是布尔值：数组写法是 wrangler 4 才支持的，
  // 写成 ["/api/*"] 在 wrangler 3 下会直接报配置错误。
  const rwfLine = toml.match(/^\s*run_worker_first\s*=\s*(.+)$/m)?.[1]?.trim();
  if (!rwfLine) {
    bad('缺少 run_worker_first，/api/* 会被静态资源层当成找不到的文件而 404');
  } else if (rwfLine === 'true') {
    ok('run_worker_first = true（wrangler 3 与 4 都支持）');
  } else if (/^\[/.test(rwfLine)) {
    bad(`run_worker_first 写成了数组 ${rwfLine}，这是 wrangler 4 才支持的写法，wrangler 3 会报错；请改成 true`);
  } else {
    ok(`run_worker_first = ${rwfLine}`);
  }
} catch {
  bad('读不到 wrangler.worker.toml');
}

/* 4. Pages Functions 适配层 */
console.log('\n[4] Pages Functions 适配层');
const fnFile = path.join(HERE, 'functions', 'api', '[[path]].js');
fs.existsSync(fnFile)
  ? ok('functions/api/[[path]].js（把 /api/* 交给与 Worker 同一份 onRequest）')
  : bad('缺少 functions/api/[[path]].js，Pages 版会没有后端，点「落笔」无反应');
fs.existsSync(path.join(HERE, 'public', '_routes.json'))
  ? ok('public/_routes.json（只让 /api/* 走函数，静态页面不占用函数额度）')
  : bad('缺少 public/_routes.json（缺了不致命，但所有请求都会占用函数调用额度）');

/* 5. 静态资源与后端文件齐不齐 */
console.log('\n[5] 文件');
// 韵书与典故库现在是**静态 import**（动态 import 会让 esbuild 打出
// workerd 解析不了的 bundle，见 .test/bundle-safety-test.mjs），
// 所以这几个文件一个都不能少 —— 少了整份代码在 workerd 里加载即失败。
// 放在这里拦住，比部署完才在线上发现好。
for (const f of [
  'public/index.html',
  'public/style.css',
  'public/app.js',
  'public/account.js',
  'public/admin.html',
  'public/admin.js',
  'public/wechat-pay.jpg',
  'migrations/0001_init.sql',
  'server/core.mjs',
  'server/tunes.mjs',
  'server/shi.mjs',
  'server/script.mjs',
  'server/rhyme.mjs',
  'server/pingshui.mjs',
  'server/allusions.mjs',
  'server/allusions-a.mjs',
  'server/allusions-b.mjs',
  'server/poets.mjs',
  'server/validator.mjs',
  'server/account.mjs',
  'server/store.mjs',
  'server/api-auth.mjs',
]) {
  fs.existsSync(path.join(HERE, f)) ? ok(f) : bad(`缺少 ${f}（它是静态 import 进来的，缺了线上会整站起不来）`);
}

/* 5b. 账号与额度：能不能真的用起来 */
console.log('\n[5b] 账号与额度');
// 这三件事都在 Cloudflare 控制台/命令里配，脚本看不到，所以只提示不判定。
// 但「没配会怎样」要说清楚，否则站长会以为额度已经开了。
console.log('  · 账号与额度需要三样东西，脚本查不到，请自己确认：');
console.log('      1) D1 数据库，绑定名必须是 DB');
console.log('         Storage & Databases → D1 → Create，然后本项目');
console.log('         → Settings → Functions → D1 database bindings → 变量名 DB');
console.log('         （表结构不用管：站点第一次用到时会自己建好）');
console.log('      2) SESSION_SECRET —— 没有它无法签发登录状态，注册/登录会返回 503');
console.log('      3) ACCESS_KEY —— 站点密钥，不设就是默认的 798798');
console.log('    改完这两样都要**重新部署一次**才生效。');
console.log('    没绑定 D1 时：免费那条路会**关闭**（只有密钥能过），');
console.log('    /api/health 里 accounts=false，页面顶部会挂红色告警条。');
console.log('    这是有意的：没有账本就不该对外承诺一个守不住的额度。');
console.log('    本地想试账号功能：node .test/serve-local.mjs（用 SQLite 顶替 D1）');

/* 6. 依赖 */
console.log('\n[6] 依赖');
if (fs.existsSync(path.join(HERE, 'node_modules'))) {
  ok('已安装依赖（node_modules 存在）');
} else {
  console.log('  · 还没装依赖，下一步执行：npm install');
}

/* 7. 密钥（只看本地文件，不去问 Cloudflare，避免卡住） */
console.log('\n[7] 密钥');
if (fs.existsSync(path.join(HERE, '.dev.vars'))) {
  const v = fs.readFileSync(path.join(HERE, '.dev.vars'), 'utf8');
  const m = v.match(/DEEPSEEK_API_KEY\s*=\s*(\S+)/);
  if (m && /^sk-\w{10,}/.test(m[1])) ok('.dev.vars 里有密钥（本地 dev 可用）');
  else console.log('  · .dev.vars 里还是占位符，本地 dev 前记得填');
} else {
  console.log('  · 没有 .dev.vars（本地 dev 才需要）');
}
console.log('  · 线上部署用的是 Secret，两条路线各存一份：');
console.log('      Pages  : npx wrangler pages secret put DEEPSEEK_API_KEY --project-name cloudrest');
console.log('      Workers: npx wrangler secret put DEEPSEEK_API_KEY');
console.log('    查看已设的 Secret：npx wrangler pages secret list --project-name cloudrest');

/* 结论 */
console.log('\n' + '─'.repeat(46));
if (failed) {
  console.log('有项目未通过，按上面的提示处理后重跑。\n');
  process.exit(1);
} else {
  console.log('一切就绪。默认走 Pages（pages.dev 在大陆实测可访问）：\n');
  console.log('  npx wrangler pages project create cloudrest        # 只做一次');
  console.log('  npx wrangler pages secret put DEEPSEEK_API_KEY --project-name cloudrest');
  console.log('  npx wrangler pages secret list --project-name cloudrest   # 确认真的存上了');
  console.log('  npx wrangler pages deploy public --branch production\n');
  console.log('  网址：https://cloudrest.pages.dev\n');
  console.log('  ★ --branch 不能省：这个目录不是 git 仓库，wrangler 会自己编一个分支名');
  console.log('    （通常是 main），于是部署成**预览**，主域名仍然是空的 ——');
  console.log('    表现就是「报了 Success，但 cloudrest.pages.dev 是 404」。');
  console.log('    --branch 后面要填你建项目时填的那个生产分支名。\n');
  console.log('  ★ 密钥是**按环境分开**的：生产环境的密钥只有生产部署看得见，');
  console.log('    预览域名（main.cloudrest.pages.dev）提示没配 Key 是正常的。\n');
  console.log('  以后改代码只要：npx wrangler pages deploy public --branch production');
  console.log('  （密钥没变就不用再配；密钥变了必须重新部署才生效）\n');
  console.log('  注意：Pages 命令**不能**加 --config（wrangler 3 不支持自定义路径）；');
  console.log('  它读的就是默认文件名 wrangler.toml，也就是上面第 2 节检查的那个。\n');
  console.log('  想走 Workers（域名在大陆多半打不开）：');
  console.log('    npx wrangler deploy --config wrangler.worker.toml\n');
  console.log('  不确定该走哪条？先跑：node .test/net-check.mjs');
  console.log('  它会分别测 workers.dev 与 pages.dev，然后告诉你走哪条。\n');
  console.log('  改了 server/ 或 functions/ 里的代码，部署前先跑：');
  console.log('    node .test/bundle-safety-test.mjs');
  console.log('  它会拦住「动态 import / 顶层 await」——那会让 workerd 解析失败，');
  console.log('  表现为部署时报 Uncaught SyntaxError: Unexpected reserved word。\n');
}
