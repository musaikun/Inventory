/**
 * 閲覧用の品目一覧の検索。**絞り込むだけ**の検索で、入力画面のような
 * 「無ければ追加」へは繋がない（完了済みの記録に品目を足す意味が無い）。
 *
 * 1000品目規模の一覧が実運用に出ているため、目で探すのは現実的でない。
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

let app = null
let host = null

const item = (name) => ({
  item: name, qty: 1, unit: '個', unitPrice: 100, subtotal: 100,
  code: '', flagged: false, category: null,
})

const SNAPSHOT = {
  date: '2026-08-30',
  savedAt: new Date().toISOString(),
  sessionId: 'sess-now',
  items: [item('トマト'), item('冷凍カットナス'), item('スモークサーモン500g'), item('レタス')],
  totalValue: 400,
  entryLog: [], participants: null, flaggedItems: [], auditLog: [],
  activeMs: 1000, axisNames: ['', ''],
}

async function mount(props = {}) {
  const { default: Page } = await import('./SessionDetailPage.vue')
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp({ render: () => h(Page, { snapshot: SNAPSHOT, isHost: true, shopCode: 'ABCDEF', ...props }) })
  app.mount(host)
  for (let i = 0; i < 4; i++) await nextTick()
  return host
}

const searchBox = () => host.querySelector('.item-search')
// 品目名のセル。バッジ（「追加」など）も同じ要素に入るので、先頭のテキストノードだけ見る
const itemNames = () => [...host.querySelectorAll('.tab-panel-items .name-main')]
  .map(e => (e.firstChild?.textContent ?? '').trim())
  .filter(Boolean)

async function type(text) {
  const el = searchBox()
  el.value = text
  el.dispatchEvent(new Event('input', { bubbles: true }))
  for (let i = 0; i < 3; i++) await nextTick()
}

afterEach(() => {
  app?.unmount()
  host?.remove()
  app = null; host = null
  vi.restoreAllMocks()
})

describe('閲覧用の品目検索', () => {
  it('品目一覧タブに検索欄が出る', async () => {
    await mount()
    expect(searchBox()).toBeTruthy()
  })

  it('部分一致で絞り込む', async () => {
    await mount()
    const before = itemNames()
    expect(before).toContain('トマト')
    expect(before.length).toBeGreaterThan(1)

    await type('ナス')
    const after = itemNames()
    expect(after).toContain('冷凍カットナス')
    expect(after).not.toContain('トマト')
  })

  it('クリアすると元に戻る', async () => {
    await mount()
    const before = itemNames().length

    await type('ナス')
    expect(itemNames().length).toBeLessThan(before)

    host.querySelector('.item-search-clear').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    for (let i = 0; i < 3; i++) await nextTick()
    expect(itemNames().length).toBe(before)
  })

  it('該当が無ければ0件になる（勝手に候補を出さない）', async () => {
    await mount()
    await type('存在しない品目')
    expect(itemNames()).toHaveLength(0)
  })

  // 入力画面の検索は「無ければ追加」へ繋がる。閲覧用にその導線を持ち込まない。
  it('追加の導線を出さない', async () => {
    await mount()
    await type('存在しない品目')
    const text = host.querySelector('.tab-panel-items')?.textContent ?? ''
    expect(text).not.toContain('追加')
  })

  it('他のタブでは検索欄を出さない', async () => {
    await mount()
    const reportTab = [...host.querySelectorAll('.tab-btn')].find(b => b.textContent.includes('レポート'))
    reportTab.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    for (let i = 0; i < 3; i++) await nextTick()
    expect(searchBox()).toBeFalsy()
  })
})
