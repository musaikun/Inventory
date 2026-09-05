/**
 * 発注セッションの一覧で、入力済みの発注数をどこに出すか。
 *
 * User報告 2026-09-05: 発注数が品目名の隣の緑タグに出ていた。名前が長い行では
 * 折り返して行の高さが揃わず、「いくつ発注したか」を列として上から下へ読めない。
 * 在庫を入れる欄の左に、数字として置く。
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

const qtyCells = () => [...host.querySelectorAll('.td-qty')]
const orderNums = () => [...host.querySelectorAll('.order-qty-n')].map(e => e.textContent.trim())

describe('発注数の置き場所', () => {
  it('在庫の欄の左に、数字として出す（品目名の隣のタグではない）', async () => {
    await mount({ 新: { orderQty: 1, by: 'タカキスマホ' } })
    expect(host.querySelector('.order-chip'), '名前の隣のタグは無くなった').toBeNull()

    const cell = qtyCells()[0]
    const num = cell.querySelector('.order-qty-n')
    const box = cell.querySelector('.qty-display')
    expect(num.textContent.trim()).toBe('1')
    // 同じセルの中で、発注数が在庫の欄より先に来る＝左に出る
    expect(num.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('見出しが、2つ並んだ数字のどちらが何かを言う', async () => {
    await mount({})
    expect(host.querySelector('.th-qty').textContent.trim()).toBe('発注 / 在庫')
  })

  it('未発注の行は記号を重ねず、場所だけ取って桁をそろえる', async () => {
    await mount({ 新: { orderQty: 1, by: 'A' } })
    const empty = qtyCells()[1].querySelector('.order-qty.empty')
    expect(empty, '場所は取る').not.toBeNull()
    expect(empty.textContent.trim()).toBe('')   // 在庫欄が既に「—」と言っている
  })

  it('1人だけで発注しているときは、端末名を出さない', async () => {
    await mount({
      新: { orderQty: 1, by: 'タカキスマホ' },
      プロントワッフル: { orderQty: 2, by: 'タカキスマホ' },
    })
    expect(orderNums()).toEqual(['1', '2'])
    expect(host.querySelectorAll('.order-qty-by')).toHaveLength(0)
  })

  it('2人以上が発注したときだけ、誰が発注したかを出す', async () => {
    await mount({
      新: { orderQty: 1, by: 'タカキスマホ' },
      プロントワッフル: { orderQty: 2, by: '厨房タブレット' },
    })
    expect([...host.querySelectorAll('.order-qty-by')].map(e => e.textContent.trim()))
      .toEqual(['タカキスマホ', '厨房タブレット'])
  })
})
