# cloudrest · Cloudflare 部署说明

这是「栖云」的 **Cloudflare 版**。项目名就是 `cloudrest`。

三条路线，功能完全一样（后端是同一份代码），只是部署方式与域名不同：

| 路线 | 怎么做 | 域名 | 适合谁 |
| --- | --- | --- | --- |
| **A. 浏览器拖拽** | 把 `cloudrest-拖拽上传.zip` 拖进控制台 | `cloudrest.pages.dev` | **不想碰命令行的**（推荐） |
| **B. Wrangler + Pages** | `npx wrangler pages deploy public --branch production` | `cloudrest.pages.dev` | 已有终端环境 |
| **C. Wrangler + Workers** | `npx wrangler deploy --config wrangler.worker.toml` | `*.workers.dev` | 域名在大陆打不开，一般不用 |

**不确定走哪条**，先跑这个（它分别测两个域名，然后直接告诉你走哪条）：

```bash
node .test/net-check.mjs
```

---

## 路线 A：浏览器拖拽（不用命令行）

> **账号与额度**（注册登录、免费 5 次、密钥、1 元 10 次）需要额外配三样东西：
> D1 数据库绑定（变量名必须是 `DB`）、`SESSION_SECRET`、`ACCESS_KEY`。
> 完整步骤、以及「为什么个人收款码无法自动识别付款」的说明，见
> [ACCOUNTS.md](ACCOUNTS.md)。没配 D1 时免费那条路会**关闭**（只有密钥能过），
> 页面顶部会挂红色告警条说明缺什么。

### 为什么需要专门打一个 zip

控制台的拖拽上传**不会编译 `functions/` 目录**。Cloudflare 官方文档原文：

> Drag and drop deployments made from the Cloudflare dashboard do not currently
> support compiling a `functions` folder of Pages Functions. To deploy a
> `functions` folder, you must use Wrangler.
>
> However, note that a `_worker.js` file **is** supported by both Wrangler and
> drag and drop deployments made from the dashboard.

所以路线 A 用的是 Pages 的**高级模式**：整个后端就是输出目录根上的**一个
`_worker.js`**，平台不需要编译它。本包已用 esbuild 把 `worker.mjs` 打成了这个
单文件，产物就是 **`cloudrest-拖拽上传.zip`**，它的根上只有四个文件：

```
index.html      style.css      app.js      _worker.js
```

`_worker.js` 由 `pages-entry.mjs` 打包而来，逻辑一行都没重写 —— 它直接调用
`worker.mjs` 里那个已经测过的 `onRequest`。静态资源也由它转发
（高级模式里 `env.ASSETS.fetch(request)` 是必须的，否则整站除 `/api` 外全坏，
这一点 `.test/dashboard-worker-test.mjs` 专门守着）。

### 步骤

1. **先配密钥**（纯点选）：

   > Workers & Pages → `cloudrest` → Settings → Variables and Secrets
   > → Production 环境 → Add → 类型 **Secret** → 名称 `DEEPSEEK_API_KEY` → 值 `sk-…`

2. **上传**：

   > Workers & Pages → `cloudrest` → **Create deployment**
   > → 环境选 **Production**（选 Preview 会得到预览域名）
   > → 拖入 **`cloudrest-拖拽上传.zip`** → Save and deploy

   ⚠ 不要拖 `cloudrest.zip`。那是整包源码，根上是 `cloudrest/` 与 `开始这里.txt`，
   传上去首页会变成 `/cloudrest/public/index.html`，根路径没有 `index.html`。

3. **验收**：

   ```bash
   node .test/probe-api.mjs https://cloudrest.pages.dev
   # /api/health  200 application/json   ← 成了
   # /api/health  404 空                 ← 后端没带上
   ```

4. 改了源码之后，重新生成上传包：`node build-dashboard.mjs`

---

## 路线 B：Wrangler + Pages

在**本目录**执行：

```bash
npm install
npx wrangler pages project create cloudrest
npx wrangler pages secret put DEEPSEEK_API_KEY --project-name cloudrest
npx wrangler pages secret list --project-name cloudrest
npx wrangler pages deploy public --branch production
```

逐条说明：

1. **`npm install`** —— 装 wrangler。
2. **`pages project create cloudrest`** —— 建 Pages 项目。**只做一次**，以后不用再跑。
   漏了这一步，部署会报 `Project "cloudrest" does not exist`。
   它问 production branch（生产分支）时填什么，`--branch` 就要填什么；
   本包按填 `production` 写的，若你填的是别的名字，把 `--branch` 改掉。
3. **`pages secret put` / `secret list`** —— 存密钥并**确认真的存上了**。
4. **`pages deploy public --branch production`** —— 部署到生产分支。

### ★ 部署输出里必须出现这两行

```
✨ Uploading Functions bundle
✨ Uploading _routes.json
```

**没有这两行，就说明你不在 `cloudrest` 目录里。** wrangler 找 `functions/`
看的是**当前目录**；不在项目目录里跑，它会只上传 `public/` 里的静态文件，
而且**成功退出、不报任何错**。结果就是：页面能打开，一取 `/api/health` 却是空 404。

### ★ `--branch` 不能省

这个目录不是 git 仓库，wrangler 会自己编一个分支名（通常是 `main`），
于是部署成**预览**，主域名 `cloudrest.pages.dev` 仍然是空的。
表现就是「部署报了 Success，但主域名打不开或没有后端」。

> 首次部署后一两分钟内，访问可能提示「证书无效 / 不安全」，
> 那是 `pages.dev` 证书还在签发，等一会儿刷新即可。

### 密钥是分环境的（预览域名提示没配 Key，多半是这个）

Cloudflare Pages 的密钥**按环境分开**：生产环境的密钥只有生产部署
（`cloudrest.pages.dev`）看得见；预览部署（`main.cloudrest.pages.dev` 等）
要用**另一份**密钥。所以「密钥存了，但预览域名还是提示没有配置 Key」
是正常的，不是没存上。

### 以后改代码，重新部署只要一条

```bash
npx wrangler pages deploy public --branch production
```

密钥不用再配；只有**密钥变了**才需要重新部署让它生效。

---

## 路线 C：Wrangler + Workers

```bash
npm install
npx wrangler secret put DEEPSEEK_API_KEY
npx wrangler deploy --config wrangler.worker.toml
```

成功后打印 `https://cloudrest.xxxx.workers.dev`。

> 大陆网络下这个域名很可能连不上（DNS 能解析、TCP 被丢包，表现为一直转圈）。
> **这不是部署失败**——`wrangler deploy` 走的是 `api.cloudflare.com`，
> 那是通的；打不开只是你的网络到 `workers.dev` 的路由被阻断了。

---

## 先说你上次为什么打不开

**纯静态的 Cloudflare Pages 只能托管文件，跑不了服务端代码。**

这个站的诗是**服务端调用 DeepSeek 生成的**。纯静态托管上——

- `index.html`、`style.css`、`app.js` 能正常下载，所以**页面看起来是好的**；
- 但没有任何东西能响应 `/api/choose` 与 `/api/compose`；
- 于是**一点「落笔」就没反应**（或报 404）。

把 `server.js` 一起传上去也没用：浏览器只会把它当文本下载，不会执行。

**现在不一样了**：Pages 除了静态文件，还能放 **Pages Functions**。
本项目已写好适配层 `functions/api/[[path]].js`，它把 `/api/*` 交给与 Worker **完全相同**的
那个 `onRequest`。所以两条路线都是完整的全栈应用。真正的区别只剩域名能不能连通。

---

## 路线 A：Pages（默认，大陆能打开）

在**本目录**执行：

```bash
npm install
npx wrangler pages project create cloudrest
npx wrangler pages secret put DEEPSEEK_API_KEY --project-name cloudrest
npx wrangler pages secret list --project-name cloudrest
npx wrangler pages deploy public --branch production
```

逐条说明：

1. **`npm install`** —— 装 wrangler。
2. **`pages project create cloudrest`** —— 建 Pages 项目。**只做一次**，以后不用再跑。
   漏了这一步，部署会报 `Project "cloudrest" does not exist`。
   它问 production branch（生产分支）时填什么，后面 `--branch` 就要填什么；
   本包按填 `production` 写的，若你填的是别的名字，把下面的 `--branch` 改掉。
3. **`pages secret put` / `secret list`** —— 存密钥并**确认真的存上了**。
   存了但列表里没有，说明上一步没成。
4. **`pages deploy public --branch production`** —— 部署到生产分支。
   **`--branch` 不能省**：这个目录不是 git 仓库，wrangler 会自己编一个分支名
   （通常是 `main`），于是部署成**预览**，主域名 `cloudrest.pages.dev` 仍然是空的。
   这正是「部署报了 Success 但主域名 404」的原因。

> 首次部署后一两分钟内，访问可能提示「证书无效 / 不安全」，
> 那是 `pages.dev` 证书还在签发，等一会儿刷新即可。

### 密钥是分环境的（预览域名提示没配 Key，多半是这个）

Cloudflare Pages 的密钥**按环境分开**：

- 生产环境的密钥，只有生产部署（`cloudrest.pages.dev`）看得见；
- 预览部署（`main.cloudrest.pages.dev`、`<hash>.cloudrest.pages.dev`）要用**另一份**密钥。

所以「密钥存了，但预览域名还是提示没有配置 Key」是正常的，不是没存上。
只想用一个域名的话，部署到 production 用 `cloudrest.pages.dev` 即可；
想让预览域名也能用，去控制台给 Preview 环境再加一条：

> Workers & Pages → `cloudrest` → Settings → Variables and Secrets
> → Production / Preview 两个环境各加一条 `DEEPSEEK_API_KEY`

### 以后改代码，重新部署只要一条

```bash
npx wrangler pages deploy public --branch production
```

密钥不用再配；只有**密钥变了**才需要重新部署让它生效。

---

## 路线 B：Workers

```bash
npm install
npx wrangler secret put DEEPSEEK_API_KEY
npx wrangler deploy --config wrangler.worker.toml
```

成功后打印 `https://cloudrest.xxxx.workers.dev`。

> 大陆网络下这个域名很可能连不上（DNS 能解析、TCP 被丢包，表现为一直转圈）。
> **这不是部署失败**——`wrangler deploy` 走的是 `api.cloudflare.com`，
> 那是通的；打不开只是你的网络到 `workers.dev` 的路由被阻断了。

---

## 两个配置文件的安排（这里踩过坑，务必看清）

| 文件 | 给谁用 | 关键字段 |
| --- | --- | --- |
| `wrangler.toml` | **Pages**（默认文件名） | `name`、`pages_build_output_dir` |
| `wrangler.worker.toml` | **Workers** | `name`、`main`、`[assets]`、`run_worker_first` |

**为什么 Pages 的配置必须占着默认文件名 `wrangler.toml`：**

wrangler 3 的 Pages 命令**不支持自定义配置文件路径**。写
`npx wrangler pages deploy --config wrangler-pages.toml` 会直接报：

```
ERROR  Pages does not support custom paths for the Wrangler configuration file
```

所以 Pages 的配置只能放在默认的 `wrangler.toml` 里，命令里**一个 `--config` 都不要加**。
反过来，Workers 命令支持 `--config`，所以 Workers 的配置可以另起一个名字。

**另一个坑**：`wrangler.toml` 里若缺 `pages_build_output_dir`，wrangler 会警告

```
WARNING  ... missing the "pages_build_output_dir" field, required by Pages.
         Ignoring configuration file for now.
```

然后忽略整份配置。这条警告不会让部署失败，但会让人以为哪里配错了——
所以该字段是必需项，`doctor.mjs` 会硬检查它。

```toml
# wrangler.toml —— Pages
name = "cloudrest"
compatibility_date = "2024-11-06"
pages_build_output_dir = "./public"
```

```toml
# wrangler.worker.toml —— Workers
name = "cloudrest"
main = "worker.mjs"
compatibility_date = "2024-11-06"

[assets]
directory = "./public"
binding = "ASSETS"
run_worker_first = true   # 必须布尔值；["/api/*"] 是 wrangler 4 才支持的写法
```

> `run_worker_first` 写成 `true` 则 wrangler 3 与 4 都能用，不必为了部署去升级工具。
> 写成数组在 wrangler 3 下会报
> `Expected "assets.run_worker_first" to be of type boolean`。
> 注意这条**只在 Workers 路线**会出现，Pages 根本不读这个字段。

Pages 侧还有两个额外文件：

```
functions/api/[[path]].js   # 适配层：只接管 /api/*，其余交给静态资源
public/_routes.json         # 只让 /api/* 调用函数，静态页面不占用函数额度
```

`_routes.json` 的内容：

```json
{ "version": 1, "include": ["/api/*"], "exclude": [] }
```

没有它的话，**每个请求**（包括 `style.css`、`app.js`）都会调用一次函数、
占用免费额度；有了它，纯静态请求是无限免费的。

---

## 请求进来后的分工（两条路线一致）

| 路径 | 谁处理 |
| --- | --- |
| `/`、`/style.css`、`/app.js` | 静态资源 |
| `/api/health` | 后端：报告体裁、诗人、典故、韵书状态 |
| `/api/choose` | 后端：由场景择体、挑典故 |
| `/api/compose` | 后端：成诗 / 润色，**流式**返回 |

`worker.mjs` 与 Node 版**共用同一份内核** `server/core.mjs`，
所以择体、成诗、校律重写、自评润色这些逻辑三边（Node / Workers / Pages）完全一致——
改一处，三边都对。Pages 的 `functions/api/[[path]].js` 更是直接 import 同一个
`onRequest`，没有第二份实现。

流式：Workers 版用 `TransformStream` 把响应交回浏览器的同时，在 `ctx.waitUntil()` 里
把诗写完，边写边往流里推；Pages 版用 `context.waitUntil()`，道理相同。
所以诗句是**逐句浮现**的。

---

## 部署前想先本地试

**最省事的一招**（不用 wrangler、不用装依赖，直接跑线上那份代码）：

```bash
node .test/serve-local.mjs          # → http://127.0.0.1:7788
```

它用一个几十行的 Node 服务器把 `worker.mjs` 托起来，并伪造 `env.ASSETS` 指向
`public/`，所以「静态页面 + `/api/*`」在本地就是完整可用的，和线上走的是同一条代码路径。

用 wrangler 本地模拟：

```bash
cp .dev.vars.example .dev.vars     # Windows: copy .dev.vars.example .dev.vars
# 编辑 .dev.vars，填入你的密钥
npx wrangler pages dev public                                  # Pages 版
npx wrangler dev --config wrangler.worker.toml                 # Workers 版 → localhost:8787
```

或者完全不用 wrangler，直接跑 Node 版：`cd ../qiyun && node server.js` → `127.0.0.1:7788`。

> `.dev.vars` 含密钥，**不要提交到任何公开仓库**（本包已附 `.gitignore` 挡住它）。

---

## 常见问题

**Q：部署报了 Success，但主域名 `cloudrest.pages.dev` 是 404，
而 `main.cloudrest.pages.dev` 能打开。**
那次部署进了 **preview（预览）分支**。加上生产分支再来一次：

```bash
npx wrangler pages deploy public --branch production
```

（`production` 要换成你建项目时填的那个生产分支名。）

**Q：密钥明明存了，页面还是提示「服务端还没有配置 API Key」。**
三种可能，按概率排：
1. **你看的是预览域名，而密钥只存在生产环境**（见上文「密钥是分环境的」）。
2. 存完密钥**没有重新部署**，旧部署里还是空的。
3. `pages secret put` 其实没成 —— 用 `pages secret list --project-name cloudrest` 确认。

**Q：报错 `Deployment failed ... Uncaught SyntaxError: Unexpected reserved word`。**
包里的 `server/validator.mjs` 或 `server/allusions.mjs` 是旧版：里面有
`await import('./rhyme.mjs')` 这种**动态 import**。esbuild 为了保持它的惰性语义，
会把整张模块图改写成 `__esm({ "x.mjs"() { await init_y(); … } })` —— 同步包装里
带 `await`，workerd 一解析就报这个错，Pages 部署直接失败（Workers 那边则是运行时才炸）。
改成文件顶部的静态 import 即可；`node .test/bundle-safety-test.mjs` 会指名道姓
告诉你哪个文件第几行有问题。

**Q：`Project "cloudrest" does not exist`。**
Pages 项目还没建。先跑 `npx wrangler pages project create cloudrest`（只做一次）。

**Q：`Pages does not support custom paths for the Wrangler configuration file`。**
命令里带了 `--config`。**Pages 命令不能带**，去掉：
`npx wrangler pages deploy public`。

**Q：`Pages now has wrangler.toml support ... missing the "pages_build_output_dir" field`。**
`wrangler.toml` 缺 `pages_build_output_dir`。本包已加上；若还出现，说明你手里的是旧版配置。

**Q：`You are not authenticated` / 401。**
`npx wrangler login` 的最后一步会跳 `welcome.developers.workers.dev` 再回本机，
而那个域名在大陆被阻断，于是浏览器停在超时页——**但 token 往往已经拿到**，
再跑一次命令试试。反复不行就用 API Token 绕开浏览器流程：
到 `https://dash.cloudflare.com/profile/api-tokens`（你这边能打开）
建一个 `Edit Cloudflare Workers` 模板的 token，然后
`export CLOUDFLARE_API_TOKEN=...` 再跑 wrangler。

**Q：页面能打开，但红字说「连不上服务端」，体裁和诗人列表也是空的。**
说明这次部署**没带上后端函数**：`/api/*` 既没命中静态文件、也没有函数接管，
返回的是 Cloudflare 的空 404，前端于是走了 catch 分支。先用探针确认：

```bash
node .test/probe-api.mjs https://你的域名
# /api/health  →  200 application/json   ✓ 后端在
# /api/health  →  404 空响应             ✗ 没带上函数
```

两种原因：

1. **命令不是在项目目录里跑的。** wrangler 找 `functions/` 看的是**当前目录**，
   不在 `cloudrest/` 里跑，它就只上传 `public/` 里的静态文件，而且会**成功退出**、
   不报任何错。判断方法：部署输出里必须有这两行 ——

   ```
   ✨ Uploading Functions bundle
   ✨ Uploading _routes.json
   ```

   没有这两行，就是没带上后端。
2. **函数发布失败**（`server/` 还是旧代码，见下一条）。输出里会有
   `X [ERROR] Failed to publish your Function`。

**Q：`/api/*` 全是空 404，只有 `main.cloudrest.pages.dev` 是好的。**
那次生产部署没带上后端。路线 A 请确认拖的是 `cloudrest-拖拽上传.zip`
（里面必须有 `_worker.js`）；路线 B 就看输出里有没有 `Uploading Functions bundle`。

**Q：拖拽上传以后首页 404，或者地址里多了一层 `cloudrest/`。**
拖的是 `cloudrest.zip`（整包源码）。要拖 **`cloudrest-拖拽上传.zip`**，
它根上直接就是 `index.html`、`style.css`、`app.js`、`_worker.js`。

**Q：控制台里找不到「改生产分支」的开关。**
Direct Upload 项目没有这个开关——Cloudflare 文档说明需要用 API 的
Update Project 端点才行。所以别在 Settings 里翻，直接重新部署时
把环境选成 **Production**（路线 A），或加 `--branch production`（路线 B）更快。

**Q：部署报了 Success，但主域名 `cloudrest.pages.dev` 是 404，
而 `main.cloudrest.pages.dev` 能打开。**
那次部署进了 **preview（预览）分支**。加上生产分支再来一次：

```bash
npx wrangler pages deploy public --branch production
```

**Q：密钥明明存了，页面还是提示「服务端还没有配置 API Key」。**
三种可能，按概率排：
1. **你看的是预览域名，而密钥只存在生产环境**（见上文「密钥是分环境的」）。
2. 存完密钥**没有重新部署**，旧部署里还是空的。
3. `pages secret put` 其实没成 —— 用 `pages secret list --project-name cloudrest` 确认。

**Q：workers.dev 打不开，是不是白部署了？**
不是。部署本身是成功的，只是域名不可达。跑 `node .test/net-check.mjs` 看诊断，
然后走路线 A（Pages）或绑定自己的域名。

**Q：一首诗要等很久。**
正常。一首诗可能调用模型 2～8 次（择体、多次校律重写、自评润色）。
页面上会显示「正在重写……」「它自己看出了问题，正在改……」，不会假装很快。

**Q：想省 API 额度。**
把 `server/core.mjs` 里的 `LIMITS.MAX_TRIES` 调小（默认 4）。

**Q：要绑定自己的域名（最彻底的办法）。**
- Pages：控制台 → Workers & Pages → `cloudrest` → Custom domains → Add
- Workers：控制台 → Workers & Pages → `cloudrest` → Settings → Domains & Routes → Add → Custom Domain

绑好之后不经过 `workers.dev` / `pages.dev`，直接用自己的域名访问。**不需要改代码。**

---

## 本地验证（不需要 wrangler、不花钱）

```bash
node .test/worker-test.mjs    # Workers 入口：13 项（路由、错误码、择体、流式成诗）
node .test/pages-test.mjs     # Pages Functions 适配层
node .test/dashboard-worker-test.mjs  # 拖拽上传那份 _worker.js：静态转发 + 后端
node .test/script-test.mjs    # 繁体字检测：真作零误报、繁体必命中
node .test/bundle-safety-test.mjs  # 打包安全：不许动态 import / 顶层 await / node: 内置模块
node .test/account-test.mjs   # 账号与额度：同一套用例跑两遍（内存 + 真 SQLite 跑 D1 的 SQL）
node doctor.mjs               # 部署前自检：配置、适配层、目录、密钥
node .test/probe-api.mjs <网址>      # 探针：原样打印状态码与响应体
node .test/net-check.mjs      # 网络诊断：workers.dev 与 pages.dev 分别能不能连
```

账号系统还有一份走真实 HTTP 的端到端验收（要先起本地服务）：

```bash
node .test/serve-local.mjs 8793            # 另开一个终端
node .test/e2e-accounts.mjs http://127.0.0.1:8793
```

它会真的注册一个账号、输入密钥、成一首诗、把免费次数用光、兑换一个码、
提交一次付款认领、再让管理员确认 —— 只做**一次**真实成诗，其余都靠直接改本地
SQLite 把场景造出来，因为每一次成诗都要花钱调模型。

`dashboard-worker-test.mjs` 值得单独说：路线 A 那份 `_worker.js` 是**平台不会再编译**
的产物，所以它的正确性完全由本地这一刻决定。这个测试会真的把它 import 进来，
用假的 `env.ASSETS` 跑一遍 —— 包括高级模式最容易漏的那条
「必须自己把静态资源转发出去」，最后真写一首诗。

`bundle-safety-test.mjs` 值得单独说一句：它是为一次真实事故加的。
`server/validator.mjs` 与 `server/allusions.mjs` 从前用动态 `await import()` 加载
韵书与典故库，esbuild 会把整张模块图改写成惰性初始化包装，产出
**同步函数里带 `await`** 的代码，workerd 解析即报
`Unexpected reserved word`，Pages 部署整个失败。现在改成静态 import，
这条测试守住它不再回来（禁止动态 `import()`、禁止顶层 `await`，
并且会拿当初出事的代码喂给自己验证规则有效）。

`inspect-bundle.mjs` 是配套的取证工具，可以直接查看任意一份 bundle 里
有没有那个致命写法：

```bash
node .test/inspect-bundle.mjs <bundle.js>
# 健康的产物：__esm 0 次、await init_ 0 次
```

`.test/repro-old/` 是当初那个写法的最小复现，用真 esbuild 打包就能看到
`__esm` 包装被生成出来 —— 留着当证据，不是运行代码。

想看「真的一首诗」长什么样，可以本地起服务后跑线上验收脚本：

```bash
node .test/serve-local.mjs 8791              # 另开一个终端
node .test/verify-live.mjs http://127.0.0.1:8791
```

部署之后也可以直接验收线上：

```bash
node .test/verify-live.mjs https://cloudrest.pages.dev
```

前几个脚本会把真实代码跑一遍（用假的 `env` 与假的 `ctx`，密钥只从
`~/.dsh/.credentials.yaml` 或环境变量读，不写进任何文件），
调用真实模型写一首诗并检查正文里没有混进平仄谱。

---

## 目录

```
cloudrest/
├─ worker.mjs                    # Workers 入口；同时导出 onRequest 供 Pages 复用
├─ pages-entry.mjs               # 路线 A 的入口（高级模式 _worker.js 的源）
├─ build-dashboard.mjs           # 打成 cloudrest-拖拽上传.zip
├─ migrations/0001_init.sql      # D1 表结构（账号、额度、兑换码、付款认领）
├─ ACCOUNTS.md                   # 账号、额度与付费说明（含付款为何无法自动识别）
├─ wrangler.toml                 # Pages 配置（默认文件名 —— Pages 命令只认它）
├─ wrangler.worker.toml          # Workers 配置（用 --config 指定）
├─ functions/api/[[path]].js     # Pages Functions 适配层
├─ public/                       # index.html / style.css / app.js
│  └─ _routes.json               # 只让 /api/* 走函数
├─ server/                       # 三边共用的全部逻辑与数据
│  ├─ core.mjs                   #   ★ 择体 / 成诗 / 校律 / 润色
│  ├─ prompt.mjs                 #   诗心准则（四病与治法）、句式骨架
│  ├─ tunes.mjs                  #   26 个词牌的格律（自《钦定词谱》抽取并核验）
│  ├─ shi.mjs                    #   近体诗格律（由粘对推出）
│  ├─ rhyme.mjs                  #   词林正韵 19 部
│  ├─ pingshui.mjs               #   平水韵 106 韵目
│  ├─ validator.mjs              #   校律 + 正文清洁
│  ├─ script.mjs                 #   繁简表（740 字）+ 繁体字检测
│  ├─ account.mjs                #   口令散列、会话票据、限速
│  ├─ store.mjs                  #   数据层（D1 / 内存两种实现）
│  ├─ api-auth.mjs               #   注册登录、密钥、额度、兑换码、付款认领
│  ├─ poets.mjs                  #   12 位诗人的笔法提要
│  ├─ allusions.mjs              #   典故索引与「按场景挑典」
│  ├─ allusions-a.mjs            #   典故数据：先秦至唐 64 条
│  ├─ allusions-b.mjs            #   典故数据：宋至近现代 100 条
│  └─ deepseek.mjs               #   与 DeepSeek 的 SSE 流式对话
├─ doctor.mjs                    # 部署前自检
├─ .test/                        # 本地验证脚本（不需要 wrangler）
│  ├─ serve-local.mjs            #   不用 wrangler 起本地服务（跑的是线上那份代码）
│  ├─ verify-live.mjs            #   验收：真写一首诗（可指定任意 BASE 网址）
│  ├─ worker-test.mjs            #   Workers 入口 13 项
│  ├─ pages-test.mjs             #   Pages Functions 适配层
│  ├─ dashboard-worker-test.mjs  #   拖拽上传那份 _worker.js（静态转发 + 后端）
│  ├─ script-test.mjs            #   繁体字检测
│  ├─ bundle-safety-test.mjs     #   打包安全：不许动态 import / 顶层 await
│  ├─ inspect-bundle.mjs         #   查看某份 bundle 有没有那个致命写法
│  ├─ probe-api.mjs              #   探针：原样打印每个路径的状态码与响应体
│  ├─ repro-old/                 #   当初那个写法的最小复现（留作证据）
│  └─ net-check.mjs              #   网络诊断，判断走哪条路线
├─ package.json                  # 只有 wrangler 一个开发依赖
├─ .dev.vars.example             # 本地开发用的密钥模板
├─ .gitignore                    # 挡住 .dev.vars 与 node_modules
└─ README.md                     # 开发说明：数据来源、自测方式、已知局限
```
