// 右へ引いてホームへ戻る（下のタブはやめた・User決定 2026-11-28）
import { describe, it, expect, vi, afterEach } from 'vitest'
import { ref } from 'vue'
import { useSwipeBack, _excluded } from './useSwipeBack.js'

const touch = (target, x, y) => ({ target, touches: [{ clientX: x, clientY: y }], cancelable: true, preventDefault() {} })
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = '' })

function setup() {
  vi.useFakeTimers()
  document.body.innerHTML = '<section id="p"><div id="in"></div><input id="q"><table><tr class="item-row" id="row"><td>x</td></tr></table></section>'
  const el = document.getElementById('p')
  Object.defineProperty(el, 'clientWidth', { value: 400 })
  const onBack = vi.fn()
  const h = useSwipeBack(ref(el), { onBack })
  return { el, onBack, h }
}

describe('useSwipeBack', () => {
  it('右へ大きく引いて離すと戻る。画面は指についてきて、終われば transform を外す', () => {
    const { el, onBack, h } = setup()
    const t = document.getElementById('in')
    h.onTouchStart(touch(t, 50, 300))
    h.onTouchMove(touch(t, 120, 302))
    expect(el.style.transform).toBe('translateX(70px)')
    h.onTouchMove(touch(t, 250, 305))
    h.onTouchEnd()
    vi.advanceTimersByTime(300)
    expect(onBack).toHaveBeenCalledTimes(1)
    expect(el.style.transform).toBe('')
  })

  it('少しだけ引いて離すと戻らずに元へ。左・縦の動きには何もしない', () => {
    const { el, onBack, h } = setup()
    const t = document.getElementById('in')
    h.onTouchStart(touch(t, 50, 300)); h.onTouchMove(touch(t, 80, 300))
    vi.advanceTimersByTime(1000)     // ゆっくり（払っていない）
    h.onTouchEnd(); vi.advanceTimersByTime(300)
    expect(onBack).not.toHaveBeenCalled()
    expect(el.style.transform).toBe('')
    h.onTouchStart(touch(t, 300, 300)); h.onTouchMove(touch(t, 150, 305)); h.onTouchEnd()   // 左（行の非表示など）
    h.onTouchStart(touch(t, 200, 300)); h.onTouchMove(touch(t, 210, 500)); h.onTouchEnd()   // 縦（スクロール・月送り）
    vi.advanceTimersByTime(300)
    expect(onBack).not.toHaveBeenCalled()
    expect(el.style.transform).toBe('')
  })

  it('入力欄と、左へ引いて「非表示」を出している行の上で始めた動きは使わない', () => {
    const { el, onBack, h } = setup()
    expect(_excluded(document.getElementById('q'), el)).toBe(true)
    const row = document.getElementById('row')
    expect(_excluded(row.firstChild, el)).toBe(false)
    row.style.transform = 'translateX(-96px)'
    expect(_excluded(row.firstChild, el)).toBe(true)
    h.onTouchStart(touch(row.firstChild, 50, 300)); h.onTouchMove(touch(row.firstChild, 300, 300)); h.onTouchEnd()
    vi.advanceTimersByTime(300)
    expect(onBack).not.toHaveBeenCalled()
  })
})
