// 云卷云舒 · 界面效果（与诗词逻辑无关的那一层）
//
// 设计系统里有两个 signature 必须靠 JS 才能实现，其余都用纯 CSS：
//
//   1. 跟随鼠标的柔光（[data-spot]）—— 把光标位置写进 --mx/--my，
//      CSS 那边用 radial-gradient 画一个 300px 的光斑跟着走。
//      这比在 JS 里不断改 style.background 便宜得多（只改两个自定义属性）。
//
//   2. 入场交错 —— 已经在 CSS 里用 animation-delay 做掉了，这里不再重复。
//
// 两条规矩写在这里，免得以后被改坏：
//   · 用 requestAnimationFrame 合帧：mousemove 一秒能来上百次，
//     每次都触碰 DOM 会让滚动发涩。
//   · 指到 `prefers-reduced-motion` 就直接不装监听器（不是装了再判断），
//     省掉无用的事件开销。

const reduce = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
const spots = [...document.querySelectorAll('[data-spot]')];

if (!reduce && spots.length) {
  /** 每一帧最多处理一次指针位置 */
  let queued = null;

  const apply = () => {
    queued = null;
    for (const el of spots) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      // 指针离开这个面板时，把光斑推到面板外，视觉上就等于没有
      const inside = pointer.x >= r.left && pointer.x <= r.right && pointer.y >= r.top && pointer.y <= r.bottom;
      el.style.setProperty('--mx', `${inside ? pointer.x - r.left : -999}px`);
      el.style.setProperty('--my', `${inside ? pointer.y - r.top : -999}px`);
    }
  };

  const pointer = { x: -999, y: -999 };

  globalThis.addEventListener(
    'pointermove',
    (e) => {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      if (queued == null) queued = requestAnimationFrame(apply);
    },
    { passive: true }
  );

  // 指针离开窗口时收掉所有光斑
  globalThis.addEventListener('pointerleave', () => {
    pointer.x = pointer.y = -999;
    if (queued == null) queued = requestAnimationFrame(apply);
  });
}
