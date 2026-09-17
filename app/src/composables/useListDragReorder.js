/**
 * 一覧のカードを長押しして掴み、上下へ運んで並べ替える操作。
 *
 * 分類先（グループ）の並べ替えと、分類先の中の品目の並べ替えで**同じ操作**にするため、
 * ここに1つだけ持つ。片方だけ手を入れて操作感がずれるのを防ぐ（`useRowHideSwipe` と同じ理由）。
 *
 * ## 掴み方
 * 掴むのは「並べ替えたいカードそのもの」を長押ししたとき。つまみだけを掴ませると
 * 狙いが 44px の細い柱になり、一覧をなぞる指が当たって意図しない入れ替えが起きる。
 * カード全体なら狙いを外さないが、その代わり触れた瞬間に掴んではいけないので長押しにする。
 *
 * ## スクロールとの関係
 * 一覧にも行にも `touch-action` を置かない＝待っている間はブラウザが普通にスクロールする
 * （指が流れればブラウザが `pointercancel` を投げ、こちらは待つのをやめる）。
 * **掴み切った後だけ** `touchmove` を `preventDefault` してこちらが引き取る。長押しの間は
 * 指が止まっていてスクロールがまだ始まっていないため、この時点の `preventDefault` が間に合う。
 *
 * ## 保存の時機
 * DOM の並びを先に完成させ、保存は指を離した時に1回だけ行う。ドラッグ中に Vue の
 * keyed patch を走らせると、周囲の FLIP animation と競合して片方向が飛ぶ。
 *
 * @param {object}   opts
 * @param {import('vue').Ref<HTMLElement|null>} opts.listEl 行の親（スクロールする要素）
 * @param {string}   opts.rowSelector    行に付けている class セレクタ
 * @param {string}   [opts.ignoreSelector] この中を押したときは掴まない（行の上のボタン類）
 * @param {string}   [opts.keyAttr]      行のキーを持つ dataset のキー名（既定 'key' = data-key）
 * @param {Function} opts.currentOrder   () => string[] 現在の並び（保存済みの値）
 * @param {Function} opts.commitOrder    (string[]) => void 指を離したときに1回だけ呼ぶ
 * @param {Function} [opts.focusAfterKeyboard] (rowEl) => void 上下キーで動かした後の焦点
 */
export const HOLD_MS = 220
// 指の震えで持ち損なわないよう、判定はやや緩くする（8pxだと押し続けているつもりでも外れる）
export const HOLD_SLOP = 14

const FLIP_MS = 620
const FLIP_EASE = 'cubic-bezier(.4, 0, .2, 1)'
const FLIP_MS_REDUCED = 180                 // 「視差効果を減らす」でも 0 にはしない。
const FLIP_EASE_REDUCED = 'linear'          // どの行がどこへ動いたかは飾りではなく情報のため
const DROP_MS = 280
const DROP_EASE = 'cubic-bezier(.22, .8, .28, 1)'
// 20件近くあると、下の行を上まで運ぶのに一覧のスクロールが要る。
const EDGE = 64, EDGE_SPEED = 10

const SEP = String.fromCharCode(1)   // 並びの比較用。品目名に現れない区切り
const pointerMatches = (e, id) => id == null || e.pointerId == null || e.pointerId === id

export function useListDragReorder({
  listEl, rowSelector, ignoreSelector = '', keyAttr = 'key',
  currentOrder, commitOrder, focusAfterKeyboard,
}) {
  const reduceMotion = typeof matchMedia === 'function'
    && matchMedia('(prefers-reduced-motion: reduce)').matches

  let _dragRow = null, _dragCaptureEl = null, _dragPointerId = null, _dragY0 = 0, _dragOrder = null
  let _holdTimer = null, _holdRow = null, _holdPointerId = null
  let _holdX = 0, _holdY = 0, _holdLastY = 0
  let _edgeRaf = 0, _edgeDir = 0
  const _rowShift = new WeakMap()
  const _shiftAnimations = new Set()

  const rowKey = row => row?.dataset?.[keyAttr]
  const domOrder = () => [...(listEl.value?.children ?? [])].map(rowKey).filter(k => k != null)

  // ── 掴むまで ──────────────────────────────────────────────
  function _stopHoldTimer() {
    clearTimeout(_holdTimer)
    _holdTimer = null
    _holdRow?.classList.remove('holding')
    _holdRow = null
  }
  function _clearHold() {
    _stopHoldTimer()
    _holdPointerId = null
  }
  // 持ち切ったところで掴む。開始位置はここでの指の位置にする（押した場所を基準にすると、
  // 持っている間のわずかなぶれの分だけ行が最初に跳ねる）。
  function _armDrag(y) {
    const row = _holdRow
    row?.classList.remove('holding')
    _clearHold()
    if (!row || _dragRow) return
    // 直前のswapでこの行自身がまだ移動中なら、WAAPIのtransformが指追従の
    // inline transformより優先される前に、その補間を終点へ戻す。
    cancelRowShift(row)
    _dragRow = row
    // 動かす行やその子へcaptureを置くと、DOM順を入れ替えた瞬間にスマホが
    // lostpointercaptureを発火し、1段目でドラッグが終わる。移動しない一覧側で捕捉する。
    _dragCaptureEl = listEl.value
    _dragY0 = y
    _dragOrder = [...currentOrder()]
    row.classList.add('drag')
    listEl.value?.classList.add('dragging')
    if (_dragPointerId != null) _dragCaptureEl?.setPointerCapture?.(_dragPointerId)
    navigator.vibrate?.(10)
  }

  function onDown(e) {
    if (_dragRow || _holdTimer || e.isPrimary === false) return
    if (ignoreSelector && e.target.closest?.(ignoreSelector)) return
    const row = e.target.closest?.(rowSelector)
    if (!row || !listEl.value?.contains(row)) return
    _holdRow = row
    _holdPointerId = e.pointerId ?? null
    _dragPointerId = _holdPointerId
    _holdX = e.clientX; _holdY = e.clientY; _holdLastY = e.clientY
    row.classList.add('holding')
    _holdTimer = setTimeout(() => _armDrag(_holdLastY), HOLD_MS)
  }

  function onMove(e) {
    // まだ掴んでいない指。動いたら掴む意図ではなかったとみて降り、スクロールはブラウザに任せる
    if (!_dragRow && _holdPointerId != null && pointerMatches(e, _holdPointerId)) {
      if (_holdTimer
          && (Math.abs(e.clientX - _holdX) > HOLD_SLOP || Math.abs(e.clientY - _holdY) > HOLD_SLOP)) {
        _clearHold()
        _dragPointerId = null
      }
      _holdLastY = e.clientY
      return
    }
    if (!_dragRow || !pointerMatches(e, _dragPointerId)) return
    if (e.cancelable) e.preventDefault()
    _dragRow.style.transition = 'none'
    _dragRow.style.transform = `translateY(${e.clientY - _dragY0}px)`
    edgeScroll(e.clientY)
    // 掴んだ行は指に追従しているので、指の位置でいちばん上に居るのは常に自分自身。
    // 重なり全部から自分以外の最初の行を選ばないと、入れ替え先が永久に見つからない。
    const over = document.elementsFromPoint(e.clientX, e.clientY)
      .map(el => el.closest?.(rowSelector))
      .find(r => r && r !== _dragRow)
    if (!over) return
    const rows = [...(listEl.value?.children ?? [])]
    const from = rows.indexOf(_dragRow), to = rows.indexOf(over)
    if (from < 0 || to < 0) return
    // 触れた時点では入れ替えない。中点を越えてから動かす（触れただけで避けると
    // 「避けすぎ」に見えるうえ、境界で行ったり来たりしてぶれる）。
    const box = over.getBoundingClientRect()
    const mid = box.top + box.height / 2
    if (to > from ? e.clientY < mid : e.clientY > mid) return

    flipRows(() => {
      listEl.value.insertBefore(_dragRow, from < to ? over.nextSibling : over)
    })
    _dragOrder = domOrder()
    _dragY0 = e.clientY                      // 入れ替えた行は指の位置へ移っている
    _dragRow.style.transform = ''
    navigator.vibrate?.(6)
  }

  function onUp(e) {
    if (_holdPointerId != null && (!e || pointerMatches(e, _holdPointerId))) {
      // 持ち切る前に離した＝掴む意図ではなかった。何も起こさない
      _clearHold()
      if (!_dragRow) _dragPointerId = null
    }
    if (!_dragRow || (e && !pointerMatches(e, _dragPointerId))) return
    const row = _dragRow
    const captureEl = _dragCaptureEl
    const pointerId = _dragPointerId
    const order = _dragOrder
    row.style.transition = `transform ${reduceMotion ? FLIP_MS_REDUCED : DROP_MS}ms ${reduceMotion ? FLIP_EASE_REDUCED : DROP_EASE}`
    row.style.transform = ''
    row.classList.remove('drag')
    listEl.value?.classList.remove('dragging')
    _dragRow = null
    _dragCaptureEl = null
    _dragPointerId = null
    _dragOrder = null
    stopEdgeScroll()
    // stateを先に片付ける。release直後のlostpointercaptureが同期発火しても二重確定しない。
    try { if (pointerId != null) captureEl?.releasePointerCapture?.(pointerId) } catch (_) { /* 既に解放済み */ }
    if (order && order.join(SEP) !== currentOrder().join(SEP)) commitOrder(order)
  }

  // 掴んでいる間だけ既定の動作（一覧のスクロール）を止める
  function onTouchMove(e) {
    if (_dragRow && e.cancelable) e.preventDefault()
  }

  function moveByKeyboard(key, delta) {
    if (_dragRow || !delta) return
    const rows = [...(listEl.value?.children ?? [])]
    const from = rows.findIndex(row => rowKey(row) === key)
    const to = Math.max(0, Math.min(rows.length - 1, from + delta))
    if (from < 0 || to === from) return
    const row = rows[from]
    const over = rows[to]
    flipRows(() => {
      listEl.value.insertBefore(row, from < to ? over.nextSibling : over)
    })
    commitOrder(domOrder())
    focusAfterKeyboard?.(row)
  }
  function onKeydown(e, key) {
    if (!['ArrowUp', 'ArrowDown'].includes(e.key)) return
    e.preventDefault()
    e.stopPropagation()
    moveByKeyboard(key, e.key === 'ArrowUp' ? -1 : 1)
  }

  // ── 入れ替えの見せ方（FLIP）──────────────────────────────
  // 並べ替えは「どれがどこへ動いたか」が分からないと結果を確かめられないので、
  // 瞬間移動させず、退く行が滑って場所を空ける。掴んでいる行は指の下に居るべきなので動かさない。
  function flipRows(mutate) {
    const rows = [...(listEl.value?.children ?? [])]
    // 走っているanimation込みの「いま目に見えている位置」を先に取る。DOMを動かした後で
    // 以前のanimationを外し、新しい終点との差を取り直すと、連続swapや反転でも瞬間移動しない。
    const before = new Map(rows.map(r => [r, r.getBoundingClientRect().top]))
    mutate()
    const ms   = reduceMotion ? FLIP_MS_REDUCED : FLIP_MS
    const ease = reduceMotion ? FLIP_EASE_REDUCED : FLIP_EASE
    for (const r of rows) {
      if (r === _dragRow) continue
      cancelRowShift(r)
      const d = before.get(r) - r.getBoundingClientRect().top
      if (!d) continue
      animateRowShift(r, d, ms, ease)
    }
  }

  function cancelRowShift(row) {
    const animation = _rowShift.get(row)
    if (animation) {
      _rowShift.delete(row)
      _shiftAnimations.delete(animation)
      try { animation.cancel() } catch (_) { /* 既に終了済み */ }
    }
    // Web Animations API が無い環境で使うfallbackのinline styleも終点へ戻す。
    if (row !== _dragRow) {
      row.style.transition = ''
      row.style.transform = ''
    }
  }

  function animateRowShift(row, delta, ms, ease) {
    const frames = [
      { transform: `translateY(${delta}px)` },
      { transform: 'translateY(0)' },
    ]
    if (typeof row.animate === 'function') {
      const animation = row.animate(frames, { duration: ms, easing: ease })
      if (animation) {
        _rowShift.set(row, animation)
        _shiftAnimations.add(animation)
        const clear = () => {
          if (_rowShift.get(row) === animation) _rowShift.delete(row)
          _shiftAnimations.delete(animation)
        }
        animation.onfinish = clear
        animation.oncancel = clear
      }
      return
    }
    // 古いWebView向けfallback。開始位置を確定してから終点へ補間する。
    row.style.transition = 'none'
    row.style.transform = frames[0].transform
    void row.offsetHeight
    row.style.transition = `transform ${ms}ms ${ease}`
    row.style.transform = frames[1].transform
  }

  function edgeScroll(y) {
    const el = listEl.value
    if (!el) return
    const r = el.getBoundingClientRect()
    _edgeDir = y < r.top + EDGE ? -1 : y > r.bottom - EDGE ? 1 : 0
    if (!_edgeDir) return stopEdgeScroll()
    if (_edgeRaf) return
    const step = () => {
      if (!_dragRow || !_edgeDir) return stopEdgeScroll()
      el.scrollTop += _edgeDir * EDGE_SPEED
      _edgeRaf = requestAnimationFrame(step)
    }
    _edgeRaf = requestAnimationFrame(step)
  }
  function stopEdgeScroll() { cancelAnimationFrame(_edgeRaf); _edgeRaf = 0; _edgeDir = 0 }

  /** 画面を閉じるときに必ず呼ぶ。掴んだままの行と走っているanimationを片付ける */
  function cleanup() {
    _clearHold()
    if (_dragRow) onUp()
    stopEdgeScroll()
    for (const animation of _shiftAnimations) {
      try { animation.cancel() } catch (_) { /* 既に終了済み */ }
    }
    _shiftAnimations.clear()
  }

  return { onDown, onMove, onUp, onTouchMove, onKeydown, moveByKeyboard, cleanup }
}
