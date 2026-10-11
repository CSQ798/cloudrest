// 云卷云舒 · 环境开关（唯一允许碰 process 的地方）
//
// 为什么要有这个文件：
//   2026 年 10 月站长发来一张截图：页面上只写着 **process is not defined**。
//   那是我自己引进的 —— 为了做对照实验，我在 prompt.mjs 与 disease.mjs 里直接写了
//   `process.env.CIHUA_OFF`。Node 里当然有 process，可 **Cloudflare Workers 里没有
//   这个全局**（workerd 只给 Web 标准那一套），于是每次成诗都在这一行炸掉。
//
//   打包安全检查（.test/bundle-safety-test.mjs）当时查的是 node: 引用、动态 import、
//   顶层 await —— 而 `process.` 是**全局引用**，不是 import，所以从它眼皮底下过去了。
//   现在两条一起补上：
//     一、所有环境变量只从这个文件读（bundle 里只许这里出现 process）；
//     二、打包检查新增一条：bundle 链上除本文件外，出现 `process.` 即失败。
//
// 写法上只用 `typeof` 试探，绝不直接引用 —— `typeof 未声明的标识符` 在 JS 里永远安全。

/**
 * 读一个环境开关。Node 里读得到就返回它的值；Workers 里返回 undefined（当作没设）。
 * @param {string} name
 * @returns {string|undefined}
 */
export function flag(name) {
  try {
    if (typeof process !== 'undefined' && process && process.env) return process.env[name];
  } catch {
    /* Workers 里连 typeof process 都可能被拦，那就当没设 */
  }
  return undefined;
}

/** 开关是否打开；off 时返回 false */
export function isOn(name) {
  const v = flag(name);
  return !(v === '0' || v === 'false' || v === 'off');
}
