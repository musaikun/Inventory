// グループの中の並び（User 2026-10-04）。
// ジャンルの中は商品コード順（無い品目は品目リスト＝取込ファイルの順で後ろ）。
// 並び替え（軸）の中は、その並び替えで決めた順。並び替えの操作は品目リストの順を書き換えない。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

let app = null, host = null, cfg
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
const chip = label => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === label)

beforeEach(async () => {
  localStorage.clear()
  vi.resetModules()
  const { useConfig } = await import('../composables/useConfig.js')
  cfg = useConfig()
  cfg.setEmptyList()
  cfg.addItem('C品', 0, '野菜', '個', '30')
  cfg.addItem('コード無し', 0, '野菜', '個')
  cfg.addItem('A品', 0, '野菜', '個', '10')
  cfg.addItem('B品', 0, '野菜', '個', '20')
  // 以前の並び替え操作で品目リストの順が崩れた店を再現する
  cfg.config.order.splice(0, 4, 'C品', 'コード無し', 'A品', 'B品')
})
afterEach(() => { app?.unmount(); host?.remove(); app = null; host = null })

describe('グループの中の並び', () => {
  it('ジャンルの中は商品コード順。コードの無い品目は取込ファイルの順で後ろ', async () => {
    await mount()
    await openAll()
    expect(names()).toEqual(['A品', 'B品', 'C品', 'コード無し'])
  })

  it('並び替えの中は、その並び替えで決めた順。ジャンルの順は変わらない', async () => {
    cfg.setAxisName(0, '場所')
    cfg.addAxisGroup(0, '棚')
    for (const n of ['A品', 'B品', 'C品', 'コード無し']) cfg.setItemTag(n, 0, '棚')
    cfg.setAxisItemOrder(0, ['コード無し', 'C品', 'B品', 'A品'])
    await mount()
    await openAll()
    expect(names()).toEqual(['A品', 'B品', 'C品', 'コード無し'])
    chip('場所').dispatchEvent(new MouseEvent('click', { bubbles: true })); await tick()
    await openAll()
    expect(names()).toEqual(['コード無し', 'C品', 'B品', 'A品'])
  })
})

describe('並び替えの順の引き継ぎ（以前は品目リストの順を書き換えていた）', () => {
  it('並び替えの順を持たない設定では、振り分け済みの軸だけ今の品目リストの順を引き継ぐ', async () => {
    const { STORAGE_KEYS } = await import('../utils/storageKeys.js')
    localStorage.setItem(STORAGE_KEYS.config, JSON.stringify({
      order: ['b', 'a'], axisNames: ['場所', '仕入先'], tagsA: { a: ['棚'] }, tagsB: {},
    }))
    vi.resetModules()
    const { useConfig } = await import('../composables/useConfig.js')
    const c = useConfig()
    expect(c.config.axisItemOrderA).toEqual(['b', 'a'])
    expect(c.config.axisItemOrderB).toEqual([])
  })
})
