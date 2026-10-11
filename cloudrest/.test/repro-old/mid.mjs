// 自身没有顶层 await，但**静态依赖**一个惰性初始化的模块。
// 当初 tunes.mjs 就是这个角色：自己没 TLA，却被 esbuild 在 init 里
// 插进了一句 `await init_functionsRoutes_...()`。
import { LIST } from './data.mjs';

export const M = LIST.length;
