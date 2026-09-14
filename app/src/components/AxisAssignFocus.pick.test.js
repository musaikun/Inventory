// 品目を長押しして、その品目の分類先をその場で選ぶ（振り分けの逆向き）。
//
// 既定の振り分けは「分類先を固定して品目を連打する」向きで、同じ分類先が続く限りは
// それが最速。分類先がばらばらな品目が続くときだけ、ホイールを回し直す往復が要る。
// 長押しはその往復を消すための入口で、置き換えではない（行タップの意味は変えない）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import { LONG_PRESS_MS, LONG_PRESS_SLOP } from '../composables/useLongPressPick.js'

let app = null
let host = null
let cfg

async function mount() {
  const { default: Focus } = await import('./AxisAssignFocus.vue')
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp({ render: () => h(Focus, { initialAxis: 0 }) })
  app.mount(host)
  await nextTick()
  for (const head of host.querySelectorAll('.af-cat-head')) {
    if (head.querySelector('.af-cat-arrow').textContent.trim() !== '▶') continue
    head.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  }
  await nextTick()
  return host
}

// jsdom は TouchEvent を持たないので、ハンドラが見る changedTouches だけを載せる
function touch(el, type, x, y) {
  const ev = new Event(type, { bubbles: true, cancelable: true })
  ev.changedTouches = [{ clientX: x, clientY: y }]
  el.dispatchEvent(ev)
}
const rowOf = name => [...host.querySelectorAll('.af-item[data-item]')]
  .find(r => r.getAttribute('data-item') === name)
const picker   = () => host.querySelector('.af-pick')
const options  = () => [...host.querySelectorAll('.af-pick-opt')]
const optNames = () => options().map(b => b.querySelector('.af-pick-gname').textContent.trim())
const optOf    = name => options().find(b => b.querySelector('.af-pick-gname').textContent.trim() === name)
const centre   = () => host.querySelector('.af-gcard.on .af-gname')?.textContent.trim()

async function click(el) {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await nextTick()
}
// 長押しを成立させる（押す → 時間を進める → 離す）
async function longPress(name, { move = 0 } = {}) {
  const el = rowOf(name)
  touch(el, 'touchstart', 300, 100)
  if (move) touch(el, 'touchmove', 300, 100 + move)
  vi.advanceTimersByTime(LONG_PRESS_MS + 10)
  await nextTick()
  return el
}
async function release(el) {
  touch(el, 'touchend', 300, 100)
  await nextTick()
}

beforeEach(async () => {
  vi.useFakeTimers()
  localStorage.clear()
  vi.resetModules()
  const { useConfig } = await import('../composables/useConfig.js')
  cfg = useConfig()
  cfg.setEmptyList()
  cfg.addItem('トマト', 120, '野菜', '個')
  cfg.addItem('レタス', 200, '野菜', '個')
  cfg.addItem('豚バラ', 800, '肉', 'kg')
  cfg.setAxisName(0, '場所')
  cfg.addAxisGroup(0, '冷蔵庫')
  cfg.addAxisGroup(0, '冷凍庫')
  cfg.addAxisGroup(0, '常温棚')
  await nextTick()
})
afterEach(() => {
  app?.unmount(); host?.remove()
  app = null; host = null
  vi.useRealTimers()
})

describe('AxisAssignFocus — 品目を長押しして分類先を選ぶ', () => {
  it('長押しで、その品目の分類先を選ぶシートが開く', async () => {
    await mount()
    expect(picker()).toBeNull()
    await longPress('トマト')
    expect(picker()).toBeTruthy()
    expect(picker().getAttribute('aria-label')).toContain('トマト')
    expect(optNames()).toEqual(expect.arrayContaining(['冷蔵庫', '冷凍庫', '常温棚']))
  })

  it('短く押しただけでは開かない（ふつうのタップは今までどおり）', async () => {
    await mount()
    const el = rowOf('トマト')
    touch(el, 'touchstart', 300, 100)
    vi.advanceTimersByTime(LONG_PRESS_MS - 60)
    await nextTick()
    expect(picker()).toBeNull()
  })

  it('指が動いたら長押しは降りる（一覧のスクロールを妨げない）', async () => {
    await mount()
    await longPress('トマト', { move: LONG_PRESS_SLOP + 6 })
    expect(picker()).toBeNull()
  })

  it('選んだ分類先へ入る。ホイールの中央（連打用の分類先）は動かさない', async () => {
    await mount()
    const before = centre()
    const el = await longPress('トマト')
    await release(el)
    vi.advanceTimersByTime(500)                       // ghost click の窓を抜ける
    await click(optOf('常温棚'))
    expect(cfg.config.tagsA['トマト']).toEqual(['常温棚'])
    expect(picker()).toBeNull()                       // 1タップで閉じる
    expect(centre()).toBe(before)
  })

  it('開いた直後に降ってくる click は選択として拾わない', async () => {
    await mount()
    const el = await longPress('トマト')
    await release(el)
    await click(optOf('常温棚'))                       // 指を離した直後の ghost click
    expect(cfg.config.tagsA['トマト']).toBeUndefined()
    expect(picker()).toBeTruthy()
  })

  it('長押しの直後の click で、行タップの振り分けが走らない', async () => {
    await mount()
    const el = await longPress('トマト')
    await release(el)
    await click(el)
    expect(cfg.config.tagsA['トマト']).toBeUndefined()
  })

  it('既に入っている分類先は上に出て、押すと外れる', async () => {
    cfg.addItemToGroup(0, 'トマト', '常温棚')
    await mount()
    const el = await longPress('トマト')
    await release(el)
    vi.advanceTimersByTime(500)
    expect(optNames()[0]).toBe('常温棚')
    expect(optOf('常温棚').getAttribute('aria-pressed')).toBe('true')
    await click(optOf('常温棚'))
    expect(cfg.config.tagsA['トマト'] ?? []).toEqual([])
  })

  it('同じジャンルの品目が集まっている分類先を上へ出す', async () => {
    // 野菜（レタス）が常温棚に居る。トマトも野菜なので、常温棚を先に見せる。
    cfg.addItemToGroup(0, 'レタス', '常温棚')
    await mount()
    const el = await longPress('トマト')
    await release(el)
    vi.advanceTimersByTime(500)
    expect(optNames()[0]).toBe('常温棚')
    expect(optOf('常温棚').querySelector('.af-pick-why').textContent).toContain('野菜')
    // ジャンルが違う豚バラには推さない
    await click(host.querySelector('.af-pick-close'))
    const el2 = await longPress('豚バラ')
    await release(el2)
    vi.advanceTimersByTime(500)
    expect(optOf('常温棚').querySelector('.af-pick-why')).toBeNull()
  })

  it('分類先が1つも無いときは開かず、作り方を出す', async () => {
    cfg.clearAxis(0)
    cfg.setAxisName(0, '場所')
    await nextTick()
    await mount()
    await longPress('トマト')
    expect(picker()).toBeNull()
    expect(host.querySelector('.af-flashbar')?.textContent).toContain('先に分類先を作ってください')
  })

  it('戻るは、画面を閉じる前にシートを閉じる', async () => {
    const { consumeInnerLayerBack } = await import('../composables/appMenuState.js')
    await mount()
    const el = await longPress('トマト')
    await release(el)
    expect(consumeInnerLayerBack()).toBe(true)
    await nextTick()
    expect(picker()).toBeNull()
  })
})
