/**
 * 横スワイプの取り消し（touchcancel）。
 *
 * iOS の画面端スワイプ、通知・着信、ブラウザが横スワイプを「戻る」として拾ったときは
 * **touchend が来ない**。受け口が無いと tracking が立ったままになり、onDrag で動かした分が
 * その位置で固定される（タブが半分ずれたまま止まる・パネルが戻らない）。
 * 取り消しなので左右の確定は呼ばず、引きかけだけを戻す。
 */
import { describe, it, expect, vi } from 'vitest'
import { useHorizontalSwipe } from './useSwipe.js'

const ev = (x, y = 0) => ({ changedTouches: [{ clientX: x, clientY: y }] })

describe('useHorizontalSwipe — 取り消し', () => {
  it('touchcancel は引きかけを戻し、左右の確定を呼ばない', () => {
    const onLeft = vi.fn(), onRight = vi.fn(), onDrag = vi.fn()
    const s = useHorizontalSwipe({ onLeft, onRight, onDrag })

    s.onTouchStart(ev(300))
    s.onTouchMove(ev(200))          // 閾値を越える横移動
    expect(onDrag).toHaveBeenLastCalledWith(-100)

    s.onTouchCancel()

    expect(onDrag).toHaveBeenLastCalledWith(0)   // 位置は戻す
    expect(onLeft).not.toHaveBeenCalled()        // ページ送りはしない
    expect(onRight).not.toHaveBeenCalled()
  })

  it('取り消し後の touchmove は追従しない（次に触れるまで無視する）', () => {
    const onDrag = vi.fn()
    const s = useHorizontalSwipe({ onDrag })

    s.onTouchStart(ev(300))
    s.onTouchMove(ev(200))
    s.onTouchCancel()
    onDrag.mockClear()

    s.onTouchMove(ev(150))
    expect(onDrag).not.toHaveBeenCalled()
  })

  it('触れていないときの touchcancel は何もしない', () => {
    const onDrag = vi.fn()
    const s = useHorizontalSwipe({ onDrag })

    s.onTouchCancel()
    expect(onDrag).not.toHaveBeenCalled()
  })

  it('通常の touchend は従来どおり左右を確定する', () => {
    const onLeft = vi.fn()
    const s = useHorizontalSwipe({ onLeft })

    s.onTouchStart(ev(300))
    s.onTouchMove(ev(200))
    s.onTouchEnd(ev(200))

    expect(onLeft).toHaveBeenCalledTimes(1)
  })
})
