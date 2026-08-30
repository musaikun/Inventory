/**
 * 完了後レポート（ホストのみ・金額を含む）。
 *
 * 品目を1行ずつ追う前に「この棚卸が信用できるか」を判断するための面。
 * ここで固定するのは、**数字を誤読させない**ための表示条件:
 *   ・ゲストには出さない（金額を含む）
 *   ・単価未設定で金額に入っていない品目があれば、金額の隣で必ず警告する
 *   ・前回が無いときに 0 や ∞ を出さない
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

let app = null
let host = null

const item = (name, qty, unitPrice) => ({
  item: name, qty, unit: '個', unitPrice,
  subtotal: qty != null && unitPrice != null ? Math.round(qty * unitPrice) : null,
  code: '', flagged: false, category: null,
})

const SNAPSHOT = {
  date: '2026-08-30',
  savedAt: new Date().toISOString(),
  sessionId: 'sess-now',
  items: [item('トマト', 5, 100), item('レタス', 3, 50), item('キャベツ', null, 80)],
  totalValue: 650,
  entryLog: [], participants: null, flaggedItems: [], auditLog: [],
  activeMs: 90 * 60_000,
  axisNames: ['', ''],
}

async function mount(props = {}) {
  const { default: Page } = await import('./SessionDetailPage.vue')
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp({
    render: () => h(Page, { snapshot: SNAPSHOT, isHost: true, shopCode: 'ABCDEF', ...props }),
  })
  app.mount(host)
  for (let i = 0; i < 4; i++) await nextTick()
  return host
}

const reportTab = () => [...host.querySelectorAll('.tab-btn')].find(b => b.textContent.includes('レポート'))

async function openReport() {
  reportTab().dispatchEvent(new MouseEvent('click', { bubbles: true }))
  for (let i = 0; i < 3; i++) await nextTick()
}

afterEach(() => {
  app?.unmount()
  host?.remove()
  app = null; host = null
  vi.restoreAllMocks()
})

describe('完了後レポート', () => {
  it('ゲストにはタブを出さない（金額を含むため）', async () => {
    await mount({ isHost: false })
    expect(reportTab()).toBeFalsy()
  })

  it('在庫金額・件数・所要時間を出す', async () => {
    await mount()
    await openReport()
    const text = host.querySelector('.report-panel').textContent

    expect(host.querySelector('.rp-value-num').textContent).toContain('650')
    expect(text).toContain('1時間30分')
    // 3品目中2品目入力、1品目未入力
    const cells = [...host.querySelectorAll('.rp-cell')].map(c => c.textContent)
    expect(cells[0]).toContain('2')
    expect(cells[0]).toContain('/3')
    expect(cells[1]).toContain('1')
  })

  // 金額に入っていない品目を黙らせると、半分しか計上されていない数字を
  // 正しい在庫金額として読ませてしまう。
  it('単価未設定の品目があれば金額のすぐ隣で警告する', async () => {
    const snap = { ...SNAPSHOT, items: [item('トマト', 5, 100), item('レタス', 3, null)], totalValue: 500 }
    await mount({ snapshot: snap })
    await openReport()

    const warn = host.querySelector('.rp-value .rp-warn')
    expect(warn).toBeTruthy()
    expect(warn.textContent).toContain('1品目')
    expect(warn.textContent).toContain('含まれていません')
  })

  it('全品目に単価があれば警告を出さない', async () => {
    await mount()
    await openReport()
    expect(host.querySelector('.rp-value .rp-warn')).toBeFalsy()
  })

  it('前回が無ければ比較欄に「比較はありません」と出す（0や∞を出さない）', async () => {
    await mount()
    await openReport()
    const text = host.querySelector('.report-panel').textContent
    expect(text).toContain('比較はありません')
    expect(host.querySelector('.rp-diff-num')).toBeFalsy()
  })

  it('レポートを開いている間は品目一覧のスライド面を出さない', async () => {
    await mount()
    expect(host.querySelector('.tab-panels-wrapper')).toBeTruthy()
    await openReport()
    expect(host.querySelector('.tab-panels-wrapper')).toBeFalsy()
    expect(host.querySelector('.report-panel')).toBeTruthy()
  })
})
