// 横スワイプ検出（縦スクロールと区別する）
export function useHorizontalSwipe({ onLeft, onRight, threshold = 55 } = {}) {
  let startX = 0
  let startY = 0
  let tracking = false

  function onTouchStart(e) {
    const t = e.changedTouches[0]
    startX = t.clientX
    startY = t.clientY
    tracking = true
  }

  function onTouchEnd(e) {
    if (!tracking) return
    tracking = false
    const t = e.changedTouches[0]
    const dx = t.clientX - startX
    const dy = t.clientY - startY
    if (Math.abs(dx) < threshold) return
    if (Math.abs(dx) < Math.abs(dy) * 1.5) return   // 縦移動が大きければスクロールとみなす
    if (dx < 0) onLeft?.()
    else        onRight?.()
  }

  return { onTouchStart, onTouchEnd }
}
