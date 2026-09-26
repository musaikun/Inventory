// 完了後レポートの「前回と数量で比べた一覧」と、品目一覧 ⇄ レポートのスワイプ移動。
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import { STORAGE_KEYS } from '../utils/storageKeys.js'

let app = null
let host = null

const item = (name, qty, unit = '個') => ({ item: name, qty, unit, unitPrice: null, subtotal: null, code: '', flagged: false, category: null })
const base = { entryLog: [], participants: null, flaggedItems: [], auditLog: [], axisNames: ['', ''], totalValue: null }
const PREV = { ...base, date: '2026-08-23', savedAt: '2026-08-23T10:00:00.000Z', sessionId: 'sess-prev',
  items: [item('トマト', 5), item('レタス', 4), item('玉ねぎ', 10)] }
const NOW = { ...base, date: '2026-08-30', savedAt: '2026-08-30T10:00:00.000Z', sessionId: 'sess-now',
  items: [item('トマト', 0), item('レタス', 9), item('玉ねぎ', 4)] }

async function mount(props = {}) {
  const { default: Page } = await import('./SessionDetailPage.vue')
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp({ render: () => h(Page, { snapshot: NOW, isHost: true, shopCode: 'ABCDEF', ...props }) })
  app.mount(host)
  for (let i = 0; i < 4; i++) await nextTick()
}
const tab = label => [...host.querySelectorAll('.tab-btn')].find(b => b.textContent.includes(label))
const active = () => host.querySelector('.tab-btn.active')?.textContent.trim()
async function click(el) { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); for (let i = 0; i < 3; i++) await nextTick() }
function touch(type, x) { const ev = new Event(type, { bubbles: true }); ev.changedTouches = [{ clientX: x, clientY: 100 }]; return ev }
async function swipe(el, dx) {
  el.dispatchEvent(touch('touchstart', 200)); el.dispatchEvent(touch('touchmove', 200 + dx / 2)); el.dispatchEvent(touch('touchend', 200 + dx))
  for (let i = 0; i < 3; i++) await nextTick()
}

beforeEach(() => {
  localStorage.clear()
  vi.resetModules()
  localStorage.setItem(STORAGE_KEYS.history, JSON.stringify({ 'sess-prev': PREV, 'sess-now': NOW }))
})
afterEach(() => {
  app?.unmount(); host?.remove()
  app = null; host = null
})

describe('レポート — 前回と数量で比べた一覧', () => {
  it('前回は入力・今回0／多すぎ／少なすぎを出す', async () => {
    await mount()
    await click(tab('レポート'))
    const panel = host.querySelector('.report-panel')
    const zero = panel.querySelector('.rp-qty.zero')
    expect(zero.textContent).toContain('前回は入力、今回0の品目（1件）')
    expect(zero.textContent).toContain('トマト')
    expect(panel.querySelector('.rp-qty.much').textContent).toContain('レタス')
    expect(panel.querySelector('.rp-qty.much').textContent).toContain('×2.3')
    expect(panel.querySelector('.rp-qty.little').textContent).toContain('玉ねぎ')
  })
})

describe('品目一覧 ⇄ レポートのスワイプ', () => {
  it('品目一覧で右へ払うとレポート、レポートで左へ払うと品目一覧', async () => {
    await mount()
    expect(active()).toBe('品目一覧')
    await swipe(host.querySelector('.tab-panels-wrapper'), 90)
    expect(active()).toBe('レポート')
    await swipe(host.querySelector('.report-panel'), -90)
    expect(active()).toBe('品目一覧')
  })

  it('ゲストは品目一覧で右へ払ってもレポートへ行かない', async () => {
    await mount({ isHost: false })
    await swipe(host.querySelector('.tab-panels-wrapper'), 90)
    expect(active()).toBe('品目一覧')
    expect(host.querySelector('.report-panel')).toBeNull()
  })
})
