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

async function mount(orderMap, orderNone = null) {
  const { default: Table } = await import('./InventoryTable.vue')
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp({
    render: () => h(Table, {
      inventory: { プロントワッフル: { qty: 4, unit: '個' } },
      filledCount: 1,
      configSource: cfg.config,
      orderMap, orderNone, orderMode: true, hideAmount: true,
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

  it('「発注なしで確定」した行は 0 と出し、入力済みに数える（未入力の — と分ける・2026-10-17）', async () => {
    await mount({ 新: { orderQty: 2, unit: '個', lot: 1 } }, ['プロントワッフル'])
    const tr = rowOf('プロントワッフル')
    expect(val(tr, 'oq-order')).toBe('0個')
    expect(tr.querySelector('.oq-box').classList.contains('zero')).toBe(true)
    expect(tr.querySelector('.oq-box').classList.contains('filled')).toBe(false)
    expect(val(rowOf('ふんわりバームクーヘンD'), 'oq-order')).toBe('—')
  })

  it('「保留」は出さない（2026-09-28 廃止）', async () => {
    await mount({ プロントワッフル: { orderQty: 0, stock: 6, unit: '個', lot: 1 } })
    expect(host.textContent).not.toContain('保留')
  })
})

describe('発注の入力状況で絞り込む', () => {
  it('確認済み／未確認で絞る。発注数か在庫のどちらかが入っていれば確認済み（User決定 2026-10-17）', async () => {
    // プロントワッフルは在庫4があるが発注していない → 確認済み
    await mount({ 新: { orderQty: 1, unit: '個', lot: 1 } })
    segBtn('確認済み').click(); await nextTick()
    expect(host.querySelectorAll('.oq-box').length).toBe(2)
    expect(rowOf('プロントワッフル')).toBeTruthy()

    segBtn('未確認').click(); await nextTick()
    expect(host.querySelectorAll('.oq-box').length).toBe(1)
    expect(rowOf('ふんわりバームクーヘンD')).toBeTruthy()
  })

  it('進捗は、発注数か在庫か発注なし（0）のどれかが入った品目の数', async () => {
    await mount({ 新: { orderQty: 1 } })
    expect(host.querySelector('.progress').textContent.replace(/\s+/g, '')).toBe('2/3件確認済み')
    app.unmount(); host.remove()
    await mount({ 新: { orderQty: 1 } }, ['ふんわりバームクーヘンD'])
    expect(host.querySelector('.progress').textContent.replace(/\s+/g, '')).toBe('3/3件確認済み')
  })
})
