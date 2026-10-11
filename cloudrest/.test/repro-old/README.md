# 这是一份「最小复现」，不是运行代码

留着当证据用。它复现的是一次真实事故：

```
X [ERROR] Deployment failed!
  Failed to publish your Function. Got error:
  Uncaught SyntaxError: Unexpected reserved word
    at functionsWorker-0.373272764727409.js:19:4
```

## 它在证明什么

当初 `server/validator.mjs` 与 `server/allusions.mjs` 是这样加载韵书与典故库的：

```js
let rhymeMod = null;
try {
  rhymeMod = await import('./rhyme.mjs');   // ← 动态 import
} catch { /* 韵书未就绪 */ }
```

看着很稳妥（韵书不在就降级），但它让 esbuild 为了保持动态 import 的惰性语义，
把**整张模块图**改写成惰性初始化，产出这样的东西：

```js
var __esm = (fn, res) => function __init() { … };   // 同步包装函数
var init_tunes = __esm({
  "../server/tunes.mjs"() {
    await init_functionsRoutes_0_…();               // 里面却出现了 await
  }
});
```

同步函数里出现 `await`，workerd 一解析就报 `Unexpected reserved word`。

## 怎么自己跑一遍

```bash
# 在 cloudrest 目录
ES=node_modules/@esbuild/win32-x64/esbuild.exe   # Windows 是这个名字，Linux 换成 @esbuild/linux-x64/esbuild

"$ES" .test/repro-old/entry.mjs --bundle --format=esm --platform=neutral \
      --target=es2022 --outfile=.test/repro-old/out-old.js

node .test/inspect-bundle.mjs .test/repro-old/out-old.js
```

`inspect-bundle.mjs` 会报 `__esm 2 次`、`await init_ 1 次`，判为不健康。

再把同一份代码改成静态 import（就是现在的正式代码），打同一份包：

```bash
"$ES" 'functions/api/[[path]].js' --bundle --format=esm --platform=neutral \
      --target=es2022 --outfile=.test/out-bundle.js

node .test/inspect-bundle.mjs .test/out-bundle.js
```

这次是 `__esm 0 次`、`await init_ 0 次`，判为健康。
—— 这就是修好与没修好的全部差别。

## 文件

| 文件 | 角色 |
| --- | --- |
| `entry.mjs` | 入口，相当于 `worker.mjs` |
| `main.mjs` | 里面有一处动态 `import()`，相当于当初的 `validator.mjs` |
| `data.mjs` | 被动态 import 的数据模块，且自身带顶层 await（相当于 wrangler 注入的 `functionsRoutes`） |
| `mid.mjs` | 自己不写 await，却静态依赖 `data.mjs`（相当于当初的 `tunes.mjs`） |

`out-old.js` 是跑出来的产物，不入库、也不进发布包；
`bundle-safety-test.mjs` 是它的静态版守卫，不依赖 esbuild，每次都能跑。
