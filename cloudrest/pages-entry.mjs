// 云卷云舒 · Cloudflare **Pages 高级模式**入口（`_worker.js`）
//
// 为什么需要它：
//   控制台的「拖拽上传」**不会编译 functions/ 目录**（Cloudflare 官方文档原文：
//   "Drag and drop deployments made from the Cloudflare dashboard do not currently
//    support compiling a `functions` folder of Pages Functions."）。
//   但它支持 `_worker.js` —— 高级模式：整个后端就是一个文件，不需要平台去编译。
//
//   所以把 worker.mjs 用 esbuild 打成**单个自包含文件** public/_worker.js，
//   就能做到「只靠浏览器拖拽、完全不碰命令行」地部署出带后端的站点。
//   生成脚本：build-dashboard.mjs，产物在 dist-upload/。
//
// 逻辑一行都没有重写 —— 全部走 worker.mjs 里那个已经测过的 onRequest。
// 静态资源也交给它（它内部对非 /api 的请求会调 env.ASSETS.fetch）。

import { onRequest } from './worker.mjs';

export default {
  fetch(request, env, ctx) {
    return onRequest({ request, env, ctx });
  },
};
