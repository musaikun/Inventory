/**
 * 発注セッションの一覧で、発注数と在庫をどう出すか・どう絞り込むか。
 *
 * User報告 2026-09-05: 発注数が品目名の隣の緑タグで、長い名前の行で折り返して列として読めなかった。
 * User報告 2026-09-29: 数字だけが2か所に並び、どちらが発注でどちらが在庫か一瞬分からなかった。
 * → 1つの枠に「発注」「在庫」と名前を付けて並べる。絞り込みは発注数の有無で行う。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

let app = null, host = null, cfg

async function mount(orderMap) {
  const { default: Table } = await import('./InventoryTable.vue')
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp({
    render: () => h(Table, {
      inventory: { プロントワッフル: { qty: 4, unit: '個' } },
      filledCount: 1,
      configSource: cfg.config,
      orderMap, orderMode: true, hideAmount: true,
    }),
  })
  app.mount(host)
  await nextTick()
}

beforeEach(async () => {
  localStorage.clear()
  vi.resetModules()
  const { useConfig } = await import('../composables/useConfig.js')
  cfg = useConfig()
  cfg.setEmptyList()
  for (const n of ['新', 'プロントワッフル', 'ふんわりバームクーヘンD']) cfg.addItem(n, 0, '', '個')
  await nextTick()
})
afterEach(() => { app?.unmount(); host?.remove(); app = null; host = null })

const rowOf = name => [...host.querySelectorAll('tr')].find(tr => tr.querySelector('.td-name, .td-item')?.textContent.includes(name) && tr.querySelector('.oq-box'))
const val = (tr, cls) => tr.querySelector(`.${cls} .oq-val`).textContent.trim()
const segBtn = label => [...host.querySelectorAll('.seg-btn')].find(b => b.textContent.trim() === label)

describe('発注と在庫を1つの枠に名前付きで出す', () => {
  it('発注数と在庫がそれぞれ「発注」「在庫」の名前付きで並ぶ', async () => {
    await mount({ プロントワッフル: { orderQty: 3, unit: '個', lot: 1, by: 'A' } })
    const tr = rowOf('プロントワッフル')
    expect([...tr.querySelectorAll('.oq-label')].map(e => e.textContent.trim())).toEqual(['発注', '在庫'])
    expect(val(tr, 'oq-order')).toBe('3個')
    expect(val(tr, 'oq-stock')).toBe('4個')
    expect(tr.querySelector('.oq-box').classList.contains('filled')).toBe(true)
  })

  it('入数が2以上なら発注数は「口」で出す', async () => {
    await mount({ 新: { orderQty: 2, unit: '個', lot: 12 } })
    expect(val(rowOf('新'), 'oq-order')).toBe('2口')
  })

  it('発注していない行は「—」で、枠は緑にしない', async () => {
    await mount({})
    const tr = rowOf('プロントワッフル')
    expect(val(tr, 'oq-order')).toBe('—')
    expect(val(tr, 'oq-stock')).toBe('4個')
    expect(tr.querySelector('.oq-box').classList.contains('filled')).toBe(false)
  })

  it('1人だけで発注しているときは端末名を出さない。2人なら出す', async () => {
    await mount({ 新: { orderQty: 1, by: 'A' }, プロントワッフル: { orderQty: 2, by: 'A' } })
    expect(host.querySelector('.order-qty-by')).toBeNull()
    app.unmount(); host.remove()
    await mount({ 新: { orderQty: 1, by: 'A' }, プロントワッフル: { orderQty: 2, by: 'B' } })
    expect(host.querySelectorAll('.order-qty-by').length).toBe(2)
  })

  it('「保留」は出さない（2026-09-28 廃止）', async () => {
    await mount({ プロントワッフル: { orderQty: 0, stock: 6, unit: '個', lot: 1 } })
    expect(host.textContent).not.toContain('保留')
  })
})

describe('発注の入力状況で絞り込む', () => {
  it('発注済み／未発注で絞る（在庫を入れただけの品目は未入力）', async () => {
    // プロントワッフルは在庫4があるが発注していない
    await mount({ 新: { orderQty: 1, unit: '個', lot: 1 } })
    segBtn('発注済み').click(); await nextTick()
    expect(host.querySelectorAll('.oq-box').length).toBe(1)
    expect(rowOf('新')).toBeTruthy()

    segBtn('未発注').click(); await nextTick()
    expect(host.querySelectorAll('.oq-box').length).toBe(2)
    expect(rowOf('新')).toBeUndefined()
  })

  it('進捗は発注数を入れた品目の数', async () => {
    await mount({ 新: { orderQty: 1 } })
    expect(host.querySelector('.progress').textContent.replace(/\s+/g, '')).toBe('1/3件発注済み')
  })
})
