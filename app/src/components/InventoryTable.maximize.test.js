// 品目の表の最大化（User 2026-10-06）。見出し行のボタンで画面いっぱい⇔元の大きさ。
// ボタンを押しても全グループの開閉は動かない。戻る操作・Esc でも元に戻る。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

let app = null, host = null
const tick = async () => { for (let i = 0; i < 3; i++) await nextTick() }
const section = () => host.querySelector('.inventory-section')
const maxBtn = () => host.querySelector('.th-max')

beforeEach(async () => {
  localStorage.clear(); vi.resetModules()
  const { useConfig } = await import('../composables/useConfig.js')
  const cfg = useConfig(); cfg.setEmptyList()
  cfg.addItem('トマト', 120, '野菜', '個'); cfg.addItem('豚バラ', 800, '肉', 'kg')
  const { default: Table } = await import('./InventoryTable.vue')
  host = document.createElement('div'); document.body.appendChild(host)
  app = createApp({ render: () => h(Table, { inventory: {}, filledCount: 0 }) }); app.mount(host)
  await tick()
})
afterEach(() => { app?.unmount(); host?.remove(); app = null; host = null })

describe('表の最大化', () => {
  it('ボタンで広げて戻せる。押しても全グループの開閉は変わらない', async () => {
    const arrow = () => host.querySelector('.th-arrow').textContent
    const before = arrow()
    maxBtn().dispatchEvent(new MouseEvent('click', { bubbles: true })); await tick()
    expect(section().classList.contains('maxed')).toBe(true)
    expect(section().classList.contains('fill')).toBe(true)
    expect(maxBtn().getAttribute('aria-label')).toBe('表を元の大きさに戻す')
    expect(arrow()).toBe(before)
    maxBtn().dispatchEvent(new MouseEvent('click', { bubbles: true })); await tick()
    expect(section().classList.contains('maxed')).toBe(false)
  })

  it('戻る操作と Esc で元の大きさに戻る', async () => {
    const { consumeInnerLayerBack } = await import('../composables/appMenuState.js')
    maxBtn().dispatchEvent(new MouseEvent('click', { bubbles: true })); await tick()
    expect(consumeInnerLayerBack()).toBe(true); await tick()
    expect(section().classList.contains('maxed')).toBe(false)
    expect(consumeInnerLayerBack()).toBe(false)
    maxBtn().dispatchEvent(new MouseEvent('click', { bubbles: true })); await tick()
    section().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await tick()
    expect(section().classList.contains('maxed')).toBe(false)
  })
})
