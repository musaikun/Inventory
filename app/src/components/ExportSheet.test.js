// 書き出す（User決定 2026-10-17）。種類 → いつ・何回分 → 形式 → 書き出す
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

const downloadSheets = vi.fn(async () => {})
let money = true
vi.mock('../utils/exportFile.js', () => ({ downloadSheets: (...a) => downloadSheets(...a) }))
vi.mock('../composables/useAuth.js', () => ({ can: p => (p === 'money' ? money : true) }))
vi.mock('../composables/useBusy.js', () => ({ runBusy: async (_l, fn) => fn() }))
const SNAPS = [
  { date: '2026-10-31', sessionId: 's3', items: [{ item: 'キャベツ', qty: 14 }, { item: '玉ねぎ', qty: null }], totalValue: 2520 },
  { date: '2026-09-30', sessionId: 's2', items: [{ item: 'キャベツ', qty: 9 }], totalValue: 1620 },
  { date: '2026-08-31', sessionId: 's1', items: [{ item: 'キャベツ', qty: 12 }], totalValue: 2160 },
]
vi.mock('../composables/useHistory.js', () => ({ useHistory: () => ({ getSnapshots: () => SNAPS }) }))
vi.mock('../composables/useOrders.js', () => ({ useOrders: () => ({ getOrders: () => [] }) }))
vi.mock('../composables/useMovements.js', () => ({ useMovements: () => ({ getMovements: () => [] }) }))
vi.mock('../composables/useConfig.js', () => ({ useConfig: () => ({ config: {
  order: ['キャベツ', '玉ねぎ', '豚バラ'], units: {}, prices: { キャベツ: 180 }, categories: {}, codes: {}, categoryCodes: {},
  prevMonths: {}, lotSizes: {}, reorderPoints: {}, dictionary: {}, tagsA: {}, tagsB: {}, axisNames: ['', ''], hiddenItems: ['豚バラ'],
} }) }))

let app = null, host = null, sheet = null
const tick = async () => { for (let i = 0; i < 6; i++) await nextTick() }
const click = async el => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); await tick() }
const btn = label => [...host.querySelectorAll('button')].find(b => b.textContent.includes(label))
async function mount() {
  const { default: C } = await import('./ExportSheet.vue')
  host = document.createElement('div'); document.body.appendChild(host)
  app = createApp({ render: () => h(C, { ref: r => { sheet = r } }) }); app.mount(host); await tick()
}
beforeEach(() => { money = true; downloadSheets.mockClear(); localStorage.clear() })
afterEach(() => { app?.unmount(); host?.remove(); app = null; host = null })

describe('書き出す', () => {
  it('品目リスト: 非表示は選んだときだけ。Excel が既定', async () => {
    await mount()
    await click(btn('品目リスト'))
    expect(btn('書き出す').textContent).toContain('2品目（非表示の1品目は入れない）')
    await click(host.querySelector('.ex-sw[aria-label="非表示の品目も入れる"]'))
    await click(btn('書き出す'))
    const [sheets, format, base] = downloadSheets.mock.calls[0]
    expect(format).toBe('xlsx')
    expect(base).toMatch(/^品目リスト_/)
    expect(sheets[0].rows.map(r => r[0])).toEqual(['品目名', 'キャベツ', '玉ねぎ', '豚バラ'])
  })

  it('棚卸結果: 直近3回 → 並べ方を選べる。形式は前に選んだものを覚える', async () => {
    await mount()
    await click(btn('棚卸結果'))
    expect(btn('書き出す').textContent).toContain('10/31 の1回分')
    expect(host.textContent).not.toContain('並べ方')
    await click(btn('直近3回'))
    expect(btn('書き出す').textContent).toContain('3回分（8/31〜10/31）')
    await click(btn('CSV'))
    await click(btn('1回ずつ'))
    await click(btn('書き出す'))
    const [sheets, format, base] = downloadSheets.mock.calls[0]
    expect(format).toBe('csv')
    expect(sheets.map(s => s.name)).toEqual(['2026-08-31', '2026-09-30', '2026-10-31'])
    expect(base).toBe('棚卸結果_2026-08-31〜2026-10-31')
    expect(localStorage.getItem('tanaoro_export_format')).toBe('csv')
  })

  it('金額を見る権限が無い人には、金額の切り替えを出さず金額なしで出す', async () => {
    money = false
    await mount()
    await click(btn('棚卸結果'))
    expect(host.querySelector('.ex-sw[aria-label="金額を入れる"]')).toBeNull()
    await click(btn('書き出す'))
    expect(downloadSheets.mock.calls[0][0][0].rows[0]).not.toContain('単価')
  })

  it('発注の記録: 期間に何も無ければ書き出せない', async () => {
    await mount()
    await click(btn('発注の記録'))
    expect(btn('書き出す').disabled).toBe(true)
  })
})
