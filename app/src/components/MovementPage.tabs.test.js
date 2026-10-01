// 入出庫ページ（旧「仕入れ」）は記録するだけの画面（画面遷移図の課題①・2026-10-01）。
// 在庫の確認・発注の開始はホーム、発注基準・発注日の設定は管理タブへ移した。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

vi.mock('../composables/useStore.js', () => ({
  saveMovementToD1: vi.fn(),
  shopCode: { value: 'ABCDEF' },
}))

let app = null, host = null

async function mountPage(props = {}) {
  const { default: MovementPage } = await import('./MovementPage.vue')
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp({ render: () => h(MovementPage, { onBack: () => {}, onSaved: () => {}, ...props }) })
  app.mount(host)
  for (let i = 0; i < 4; i++) await nextTick()
}
const button = label => [...host.querySelectorAll('button')].find(b => b.textContent.includes(label))
async function click(el) { el.click(); for (let i = 0; i < 4; i++) await nextTick() }

beforeEach(async () => {
  localStorage.clear()
  vi.resetModules()
  const { useConfig } = await import('../composables/useConfig.js')
  const cfg = useConfig()
  cfg.setEmptyList()
  cfg.addItem('トマト', 120, '', '個')
})
afterEach(() => { app?.unmount(); host?.remove(); app = null; host = null })

describe('入出庫ページ', () => {
  it('タブは入庫と出庫だけ。在庫・発注・設定の入口を持たない', async () => {
    await mountPage()
    const tabs = [...host.querySelectorAll('.mv-tab')].map(t => t.textContent.trim())
    expect(tabs).toEqual(['📥 入庫', '📤 出庫'])
    expect(host.querySelector('.mv-gear')).toBeNull()
    expect(button('発注基準')).toBeUndefined()
    expect(host.querySelector('.mv-title').textContent).toContain('入出庫')
  })

  it('既定は入庫。initialTab で出庫を開ける。古いタブ名（在庫・発注）は入庫へ倒す', async () => {
    await mountPage()
    expect(host.querySelector('.mv-tab.on').textContent).toContain('入庫')
    app.unmount(); host.remove()
    await mountPage({ initialTab: 'out' })
    expect(host.querySelector('.mv-tab.on').textContent).toContain('出庫')
    app.unmount(); host.remove()
    await mountPage({ initialTab: 'view' })
    expect(host.querySelector('.mv-tab.on').textContent).toContain('入庫')
  })

  it('未反映の発注を入庫へ反映できる', async () => {
    const { useOrders } = await import('../composables/useOrders.js')
    useOrders().saveOrder({
      date: new Date().toISOString().slice(0, 10),
      supplier: '青果A',
      lines: [{ item: 'トマト', qty: 2, unit: '個', lot: 1 }],
    })
    await mountPage()
    expect(host.textContent).toContain('入庫として未反映の発注があります')
    await click(button('反映する'))
    expect(host.querySelector('.mv-savebar').textContent).toContain('入庫 1品目')
    expect(host.textContent).toContain('の発注を入庫にプリフィル済み')
  })

  it('記録しても同じタブに残る', async () => {
    await mountPage({ initialTab: 'out' })
    const row = [...host.querySelectorAll('.item-row')].find(r => r.textContent.includes('トマト'))
    await click(row)
    await click(button('3'))
    await click(button('この数量にする'))
    await click(button('出庫を記録'))
    expect(host.querySelector('.mv-tab.on').textContent).toContain('出庫')
  })
})
