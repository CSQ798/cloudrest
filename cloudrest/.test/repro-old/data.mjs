// 被动态 import() 的数据模块，且**自身带顶层 await**
// （当初的真实情形：wrangler 注入的 functionsRoutes 模块就是这种角色）
export const LIST = ['a', 'b', 'c'];
export const CONFIG = await Promise.resolve({ ok: true });
