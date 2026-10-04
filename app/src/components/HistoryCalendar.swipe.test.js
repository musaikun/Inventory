// カレンダーの月は縦のスワイプで送る（左右はタブの切り替えに残す・User決定 2026-10-04）。
// 縦に送れることは、マスの上下に前後の月をのぞかせて見た目で示す。
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createApp, nextTick } from 'vue'

vi.mock('../utils/api.js', () => ({ HTTP_BASE: '', apiFetch: vi.fn(async () => ({})), setAuthInvalidatedHandler: vi.fn() }))

let app = null, host = null
const tick = async () => { for (let i = 0; i < 4; i++) await nextTick() }
async function mountCal() {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 9, 4, 10))
  const { default: HistoryCalendar } = await import('./HistoryCalendar.vue')
  host = document.createElement('div'); document.body.appendChild(host)
  app = createApp(HistoryCalendar, { sessions: [] }); app.mount(host); await tick()
}
afterEach(() => { app?.unmount(); host?.remove(); app = null; host = null; vi.useRealTimers(); vi.resetModules() })

function touch(type, x, y) {
  const ev = new Event(type, { bubbles: true })
  ev.changedTouches = [{ clientX: x, clientY: y }]
  return ev
}
async function swipe(dx, dy) {
  const el = host.querySelector('.hc-cal')
  const outer = []
  const listen = e => outer.push(e.type)
  document.body.addEventListener('touchend', listen)
  el.dispatchEvent(touch('touchstart', 200, 300))
  el.dispatchEvent(touch('touchmove', 200 + dx / 2, 300 + dy / 2))
  el.dispatchEvent(touch('touchend', 200 + dx, 300 + dy))
  document.body.removeEventListener('touchend', listen)
  await tick()
  return outer
}
const month = () => host.querySelector('.hc-month').textContent

describe('縦のスワイプで月を送る', () => {
  it('上の前の月・下の次の月をのぞかせる（押しても送れる）', async () => {
    await mountCal()
    expect(host.querySelector('.hc-peek.top').textContent).toContain('9月')
    expect(host.querySelector('.hc-peek.bottom').textContent).toContain('11月')
    host.querySelector('.hc-peek.bottom').dispatchEvent(new MouseEvent('click', { bubbles: true })); await tick()
    expect(month()).toBe('2026年11月')
  })

  it('上へ払うと次の月、下へ払うと前の月', async () => {
    await mountCal()
    await swipe(0, -120)
    expect(month()).toBe('2026年11月')
    await swipe(0, 120); await swipe(0, 120)
    expect(month()).toBe('2026年9月')
  })

  it('横に払っても月は変わらず、タブの切り替えへそのまま伝わる', async () => {
    await mountCal()
    const outer = await swipe(-150, 5)
    expect(month()).toBe('2026年10月')
    expect(outer).toContain('touchend')
  })
})
