// 棚卸の一覧を導線の順で（User決定 2026-10-30）。導線があれば最初は導線の並び、場所の順・場所の中の順、
// どの場所にも入っていない品目は最後に「導線に入っていない」でまとめる
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

let app = null, host = null, cfg, ROUTE
const tick = async () => { for (let i = 0; i < 3; i++) await nextTick() }
async function mount() {
  const { default: Table } = await import('./InventoryTable.vue')
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp({ render: () => h(Table, { inventory: {}, filledCount: 0 }) })
  app.mount(host)
  await tick()
}
const openAll = async () => { host.querySelector('thead tr').dispatchEvent(new MouseEvent('click', { bubbles: true })); await tick() }
const names = () => [...host.querySelectorAll('.item-row')].map(r => r.dataset.item)
const heads = () => [...host.querySelectorAll('tr.group-header-row')].map(r => r.dataset.glabel)

beforeEach(async () => {
  localStorage.clear()
  vi.resetModules()
  const m = await import('../composables/useConfig.js')
  ROUTE = m.ROUTE
  cfg = m.useConfig()
  cfg.setEmptyList()
  for (const n of ['米', '牛乳', 'アイス', 'バター', '塩']) cfg.addItem(n, 0, '食材', '個')
})
afterEach(() => { app?.unmount(); host?.remove(); app = null; host = null })

describe('棚卸の一覧：導線の並び', () => {
  it('導線が無ければ今までどおり（導線のチップも出ない）', async () => {
    await mount()
    expect([...host.querySelectorAll('button')].some(b => b.textContent.includes('導線'))).toBe(false)
  })

  it('導線があれば最初から導線の順。場所の順・場所の中の順・入っていない品目は最後', async () => {
    cfg.addAxisGroup(ROUTE, '冷凍庫')
    cfg.addAxisGroup(ROUTE, '冷蔵庫')
    cfg.addItemToGroup(ROUTE, 'アイス', '冷凍庫')
    cfg.addItemToGroup(ROUTE, '牛乳', '冷蔵庫')
    cfg.addItemToGroup(ROUTE, 'バター', '冷蔵庫')
    cfg.addItemToGroup(ROUTE, 'バター', '冷凍庫')   // 2か所にある品目は両方に出る
    cfg.setAxisItemOrder(ROUTE, ['バター', 'アイス', '牛乳'])
    await mount()
    await openAll()
    expect(heads()).toEqual(['冷凍庫', '冷蔵庫', '導線に入っていない'])
    expect(names()).toEqual(['バター', 'アイス', 'バター', '牛乳', '米', '塩'])
  })
})
