export function useHorizontalSwipe({ onLeft, onRight, threshold = 55, onDrag } = {}) {
  let startX = 0
  let startY = 0
  let tracking = false
  let dragging = false

  function onTouchStart(e) {
    const t = e.changedTouches[0]
    startX = t.clientX
    startY = t.clientY
    tracking = true
    dragging = false
  }

  function onTouchMove(e) {
    if (!tracking) return
    const t = e.changedTouches[0]
    const dx = t.clientX - startX
    const dy = t.clientY - startY
    if (!dragging) {
      if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return
      if (Math.abs(dy) > Math.abs(dx)) return  // vertical: don't track
      dragging = true
    }
    onDrag?.(dx)
  }

  function onTouchEnd(e) {
    if (!tracking) return
    tracking = false
    dragging = false
    onDrag?.(0)
    const t = e.changedTouches[0]
    const dx = t.clientX - startX
    const dy = t.clientY - startY
    if (Math.abs(dx) < threshold) return
    if (Math.abs(dx) < Math.abs(dy) * 1.5) return
    if (dx < 0) onLeft?.()
    else        onRight?.()
  }

  return { onTouchStart, onTouchMove, onTouchEnd }
}
