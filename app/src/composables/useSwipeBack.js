/**
 * 右へ引いてひとつ前（ホーム）へ戻る（User決定 2026-11-28・モック https://claude.ai/artifact/TUPawBbLmYefPR4AKhcfoC）。
 * 下のタブをやめ、業務・在庫はホームの上に重なる画面になった。iPhone のホーム画面から開いたアプリには
 * 端末の「戻る」が無いので、画面のどこからでも右へ引けば戻れるようにする。画面は指についてくる。
 *
 * 横の動きは「戻る」とこの例外だけに使う:
 * - 入力欄・横に流れる列（分類のチップなど）・data-no-swipe-back の中で始めた動き
 * - 在庫の表で左へ引いて「非表示」を出している行（右へ戻すのは行を閉じる操作）
 * 左へ引く・縦の動きには何もしない（行の非表示・カレンダーの月送り・スクロールに渡す）。
 *
 * 終わったら transform を外す（付けたままだと中の position: fixed＝＋のボタンが面に付いてずれる・2026-11-08）。
 *
 * @param {import('vue').Ref<HTMLElement|null>} elRef 動かす画面
 * @param {{ onBack: () => void, enabled?: () => boolean }} opts
 */
const START = 10          // これだけ動いたら向きを決める(px)
const COMMIT_RATIO = 0.3  // 画面幅のこれ以上引いて離したら戻る
const FLICK = 0.5         // これより速く払ったら短くても戻る(px/ms)
const DUR = 220

const _reduce = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** その場所で始めた横の動きを、戻るに使わないか */
export function _excluded(target, root) {
  if (!target?.closest) return false
  if (target.closest('input, textarea, select, [contenteditable="true"], [data-no-swipe-back]')) return true
  const row = target.closest('tr.item-row')
  if (row?.style?.transform && !/translateX\(0(px)?\)/.test(row.style.transform)) return true
  // 横に流れるもの（中身が枠より広く、横スクロールできる）
  for (let el = target; el && el !== root; el = el.parentElement) {
    if (el.scrollWidth > el.clientWidth + 1) {
      const ox = typeof getComputedStyle === 'function' ? getComputedStyle(el).overflowX : ''
      if (ox === 'auto' || ox === 'scroll') return true
    }
  }
  return false
}

export function useSwipeBack(elRef, { onBack, enabled = () => true } = {}) {
  let sx = 0, sy = 0, st = 0, state = 'idle'   // idle | wait | drag | off
  let dx = 0

  const el = () => elRef.value
  function _set(x, anim) {
    const e = el(); if (!e) return
    e.style.transition = anim ? `transform ${DUR}ms cubic-bezier(.3,.7,.2,1)` : 'none'
    e.style.transform = x ? `translateX(${x}px)` : ''
  }
  function _clear() { const e = el(); if (e) { e.style.transition = ''; e.style.transform = '' } }

  function onTouchStart(ev) {
    if (!enabled() || ev.touches?.length !== 1) { state = 'off'; return }
    if (_excluded(ev.target, el())) { state = 'off'; return }
    const t = ev.touches[0]
    sx = t.clientX; sy = t.clientY; st = Date.now(); dx = 0; state = 'wait'
  }
  function onTouchMove(ev) {
    if (state !== 'wait' && state !== 'drag') return
    const t = ev.touches[0]
    const mx = t.clientX - sx, my = t.clientY - sy
    if (state === 'wait') {
      if (Math.abs(mx) < START && Math.abs(my) < START) return
      // 縦が勝つ・左へ → 何もしない（スクロール・行の非表示へ）
      if (Math.abs(my) >= Math.abs(mx) || mx < 0) { state = 'off'; return }
      state = 'drag'
    }
    dx = Math.max(0, mx)
    if (ev.cancelable) ev.preventDefault()   // 引いている間は縦に流さない
    _set(dx, false)
  }
  function _finish(commit) {
    const e = el()
    const w = e?.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 375)
    if (!commit) { _set(0, !_reduce()); setTimeout(_clear, _reduce() ? 0 : DUR); return }
    if (_reduce()) { _clear(); onBack?.(); return }
    _set(w, true)
    setTimeout(() => { onBack?.(); _clear() }, DUR)
  }
  function onTouchEnd() {
    if (state !== 'drag') { state = 'idle'; return }
    state = 'idle'
    const w = el()?.clientWidth || 375
    const v = dx / Math.max(1, Date.now() - st)
    _finish(dx > w * COMMIT_RATIO || (dx > 40 && v > FLICK))
  }
  function onTouchCancel() {
    if (state === 'drag') _finish(false)
    state = 'idle'
  }
  return { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel }
}
