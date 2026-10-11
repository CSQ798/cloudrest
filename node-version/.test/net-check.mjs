// 网络可达性诊断：判断到底是哪一层不通，并给出对应出路
// 用法：node .test/net-check.mjs [域名]
//
// 为什么要同时测 pages.dev：
//   *.workers.dev 在大陆常被阻断，而 *.pages.dev 常常是通的。
//   所以「本站打不开」不等于「Cloudflare 用不了」，
//   这个脚本把两者分开测，好判断该走哪条路线。

const HOST = (process.argv[2] || 'cloudrest.2640172486.workers.dev')
  .replace(/^https?:\/\//, '')
  .replace(/\/.*$/, '');

const line = '─'.repeat(56);

async function probe(url) {
  try {
    const r = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(12000) });
    return { ok: true, status: r.status };
  } catch (e) {
    return { ok: false, code: String(e.cause?.code || e.name || e.message) };
  }
}

console.log(`诊断目标：${HOST}\n${line}`);

console.log('\n[1] 目标域名能否连上（443 端口）');
const target = await probe(`https://${HOST}/`);
if (target.ok) {
  console.log(`  ✓ 连上了，HTTP ${target.status}`);
} else {
  console.log(`  ✗ 连不上：${target.code}`);
  if (/TIMEOUT|UND_ERR/.test(target.code)) {
    console.log('     → 典型的**出口被阻断**：DNS 也许能解析，但 443 连不上。');
    console.log('       浏览器里表现为一直转圈，最后「无法访问此网站 / 连接超时」。');
  } else if (/ENOTFOUND|EAI_AGAIN/.test(target.code)) {
    console.log('     → 域名解析不了：DNS 被污染，或解析器不可用。');
  } else if (/CERT|SSL|TLS/i.test(target.code)) {
    console.log('     → TLS 握手失败：可能被中间设备干扰（证书被替换）。');
  } else if (/REFUSED/.test(target.code)) {
    console.log('     → 端口被拒绝：本地代理/防火墙拒绝，或服务未监听。');
  }
}

console.log('\n[2] 对照：Cloudflare 两条免费路线的域名，以及大陆可用的站点');
const controls = [
  ['https://cloudrest.pages.dev', 'Pages 路线（本项目 Pages 版部署后就是它）'],
  ['https://pages.dev', 'Pages 平台根域名 —— 它通，Pages 版基本就能开'],
  ['https://workers.dev', 'Workers 平台根域名'],
  ['https://www.cloudflare.com', 'Cloudflare 主站'],
  ['https://api.deepseek.com', '模型接口（诗是它写的）'],
  ['https://www.baidu.com', '基准：本机网络本身没问题'],
];
const got = {};
for (const [u, why] of controls) {
  const r = await probe(u);
  got[new URL(u).host] = r;
  if (r.ok) console.log(`  ✓ ${String(r.status).padEnd(4)}${u.padEnd(32)}${why}`);
  else console.log(`  ✗ ${r.code.padEnd(4)}${u.padEnd(32)}${why}`);
}

console.log('\n' + line);
console.log('结论与出路\n');

const pagesOk = got['pages.dev']?.ok || got['cloudrest.pages.dev']?.ok;
const workersOk = got['workers.dev']?.ok;
const netOk = got['www.baidu.com']?.ok;

if (target.ok) {
  console.log('本机可以访问目标域名。');
  console.log('如果浏览器打不开，多半是浏览器的代理设置和命令行不一致。');
} else if (!netOk) {
  console.log('诊断：连百度都连不上 —— 本机网络本身有问题，先修网络。');
  console.log('      可试：换 DNS 为 1.1.1.1 / 8.8.8.8，或关掉会拦截的代理。');
} else if (pagesOk) {
  console.log('诊断：workers.dev 被阻断，但 pages.dev 是通的。');
  console.log('      → 走 Pages 路线，同一个应用换一个能打开的域名。\n');
  console.log('在项目目录执行（四条，按顺序）：\n');
  console.log('  npx wrangler pages project create cloudrest        # 只做一次');
  console.log('  npx wrangler pages secret put DEEPSEEK_API_KEY --project-name cloudrest');
  console.log('  npx wrangler pages secret list --project-name cloudrest');
  console.log('  npx wrangler pages deploy public --branch production\n');
  console.log('第一条建项目（只做一次）—— 漏了会报 Project "cloudrest" does not exist；');
  console.log('第二条把密钥存成 Secret（粘贴 sk-... 回车）；第三条确认真的存上了；');
  console.log('第四条部署到生产分支。');
  console.log('★ --branch 不能省：目录不是 git 仓库时 wrangler 会自己编一个分支名，');
  console.log('  于是部署成预览，主域名 cloudrest.pages.dev 仍然是空的（表现为 404）。');
  console.log('  后面填你建项目时用的生产分支名（本项目说明按 production 写）。\n');
  console.log('成功后会打印 https://cloudrest.pages.dev');
  console.log('（首次部署可能要等一两分钟证书才签发好，期间访问会提示不安全。）\n');
  console.log('★ 密钥按环境分开：生产环境的密钥只有生产部署看得见，');
  console.log('  预览域名提示没配 Key 是正常的。\n');
  console.log('★ Pages 命令不能加 --config：wrangler 3 会报');
  console.log('  「Pages does not support custom paths for the Wrangler configuration file」。');
  console.log('  它读的就是默认文件名 wrangler.toml，本包已经把 Pages 配置放在那里了。');
} else if (workersOk) {
  console.log('诊断：目标域名连不上，但 workers.dev 根域名能连。');
  console.log('      可能是该 Worker 的域名还没生效，或部署到了别的账号。');
  console.log('      用 npx wrangler deployments list 确认，或重新 npx wrangler deploy。');
} else {
  console.log('诊断：两条免费路线的域名都不通。\n');
  console.log('按推荐顺序：\n');
  console.log('  1) 绑自己的域名（最彻底）');
  console.log('     Cloudflare 控制台 → Workers & Pages → cloudrest → Settings');
  console.log('     → Domains & Routes → Add → Custom Domain，填一个已托管在 Cloudflare 的域名。');
  console.log('     绑好之后不经过 workers.dev / pages.dev，直接用自己的域名访问。\n');
  console.log('  2) 挂代理再访问，仅作临时验证用。\n');
  console.log('  3) 不做对外部署，回到本地跑');
  console.log('     npx wrangler dev            → http://localhost:8787');
  console.log('     或 Node 版：cd ../qiyun && node server.js → http://127.0.0.1:7788');
}

console.log('\n注意：域名能不能打开，与「部署成功了没有」是两件事。');
console.log('     部署是否成功 = wrangler 是否报 Success；');
console.log('     能否打开 = 你的网络到那个域名的路由。');
