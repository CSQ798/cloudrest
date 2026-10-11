// 模拟当初 validator.mjs 的写法：动态 import 包在 try 里
export const DATA = [1, 2, 3];

let extra = null;
try {
  extra = await import('./data.mjs');
} catch {
  /* 未就绪 */
}
export const hasExtra = Boolean(extra);
