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

  /**
   * ジェスチャがシステムに取られたとき（iOS の画面端スワイプ、通知・着信、
   * ブラウザが横スワイプを戻る操作として拾ったとき）。touchend は来ない。
   *
   * 受けずにいると tracking が立ったまま、onDrag で動かした分がその位置で固定される
   * （タブが半分ずれたまま止まる）。取り消しなので **左右の確定は呼ばず**、引きかけを戻す。
   */
  function onTouchCancel() {
    if (!tracking) return
    tracking = false
    dragging = false
    onDrag?.(0)
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

  return { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel }
}

/**
 * 縦のスワイプ（カレンダーの月送り・User決定 2026-10-04）。左右はタブの切り替えに残すので、
 * 縦の動きだけを拾い、横の動きには何もしない（親へそのまま伝わる）。
 * 上へ払う = onUp（次へ）、下へ払う = onDown（前へ）。onDrag(dy) で指に追従させる。
 */
export function useVerticalSwipe({ onUp, onDown, threshold = 50, onDrag } = {}) {
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
      if (Math.abs(dx) > Math.abs(dy)) { tracking = false; return }   // 横はタブの切り替えに任せる
      dragging = true
    }
    onDrag?.(dy)
  }
  function onTouchCancel() {
    if (!tracking) return
    tracking = false
    dragging = false
    onDrag?.(0)
  }
  function onTouchEnd(e) {
    if (!tracking) return
    tracking = false
    const wasDragging = dragging
    dragging = false
    onDrag?.(0)
    if (!wasDragging) return
    const t = e.changedTouches[0]
    const dx = t.clientX - startX
    const dy = t.clientY - startY
    if (Math.abs(dy) < threshold) return
    if (Math.abs(dy) < Math.abs(dx) * 1.5) return
    if (dy < 0) onUp?.()
    else        onDown?.()
  }
  return { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel }
}
