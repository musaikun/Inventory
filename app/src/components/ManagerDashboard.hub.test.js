// 在庫分析: トップは要約と項目カードだけにし、押した分析だけを別画面で見せる。
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

let app = null
let host = null
let closed = 0

const it_ = (item, qty, unitPrice, category, unit = '個') =>
  ({ item, qty, unit, unitPrice, subtotal: unitPrice == null || qty == null ? null : qty * unitPrice, category })
const snap = (date, items) => ({ date, items, totalValue: items.reduce((s, i) => s + (i.subtotal ?? 0), 0) })

async function mount(snapshots) {
  const { default: Dash } = await import('./ManagerDashboard.vue')
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp({ render: () => h(Dash, { snapshots, onClose: () => { closed++ } }) })
  app.mount(host)
  await nextTick()
}
async function click(el) { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); await nextTick() }
const card = title => [...host.querySelectorAll('.dash-card')].find(c => c.textContent.includes(title))
const title = () => host.querySelector('.dash-title').textContent.trim()

const TWO_MONTHS = [
  snap('2026-08-31', [it_('牛肉', 2, 2000, '肉'), it_('トマト', 10, 80, '野菜')]),
  snap('2026-09-30', [it_('牛肉', 8, 2000, '肉'), it_('トマト', 10, 80, '野菜')]),
]

afterEach(() => {
  app?.unmount(); host?.remove()
  app = null; host = null; closed = 0
  vi.resetModules()
})

describe('在庫分析 — トップは要約と項目カード', () => {
  it('トップに各分析の中身は出さず、カードだけを並べる', async () => {
    await mount(TWO_MONTHS)
    expect(title()).toBe('📊 在庫分析')
    expect(host.querySelector('.dash-total').textContent).toContain('16,800')
    expect(host.querySelector('.dash-trend')).toBeNull()
    expect(host.querySelector('.dash-abc-bars')).toBeNull()
    expect([...host.querySelectorAll('.dash-card')].map(c => c.querySelector('.dash-card-head').textContent.trim()))
      .toEqual(['📈在庫金額の推移', '🗂ジャンル別在庫金額', '🔔前回差アラート', '🅰ABC分析'])
    expect(card('ジャンル別').querySelector('.dash-card-value').textContent).toBe('肉 95%')
  })

  it('カードを押すとその分析だけの画面、戻るでトップへ、もう一度戻ると閉じる', async () => {
    await mount(TWO_MONTHS)
    await click(card('ABC分析'))
    expect(title()).toBe('ABC分析')
    expect(host.querySelector('.dash-abc-bars')).not.toBeNull()
    expect(host.querySelector('.dash-cards')).toBeNull()
    expect(host.querySelector('.dash-context').textContent).toContain('2026年9月')

    await click(host.querySelector('.dash-back'))
    expect(title()).toBe('📊 在庫分析')
    expect(closed).toBe(0)
    await click(host.querySelector('.dash-back'))
    expect(closed).toBe(1)
  })

  it('前回差は前の月が無ければ理由つきで押せない', async () => {
    await mount([TWO_MONTHS[1]])
    const c = card('前回差')
    expect(c.disabled).toBe(true)
    expect(c.textContent).toContain('前の月の棚卸が必要です')
    expect(card('在庫金額の推移').disabled).toBe(true)
  })

  it('単価が無ければジャンル別・ABCは押せない', async () => {
    await mount([snap('2026-09-30', [it_('牛肉', 2, null, '肉')])])
    expect(card('ジャンル別').disabled).toBe(true)
    expect(card('ABC分析').textContent).toContain('単価が未設定です')
  })

  it('異常値があるときだけ「要確認」カードが出て、中身を理由つきで見られる', async () => {
    await mount([
      snap('2026-08-31', [it_('牛肉', 2, 2000, '肉', 'kg')]),
      snap('2026-09-30', [it_('牛肉', 2, 2000, '肉', 'g')]),
    ])
    await click(card('要確認'))
    expect(host.textContent).toContain('単位が変わりました（kg → g）')
  })
})

describe('在庫分析 — カレンダーに無い棚卸', () => {
  it('sessions に無い記録をカードで知らせ、中身から削除を依頼できる', async () => {
    const deleted = []
    const snaps = [
      { ...TWO_MONTHS[0], sessionId: 'gone' },
      { ...TWO_MONTHS[1], sessionId: 'kept' },
    ]
    const { default: Dash } = await import('./ManagerDashboard.vue')
    host = document.createElement('div')
    document.body.appendChild(host)
    app = createApp({ render: () => h(Dash, { snapshots: snaps, sessions: [{ id: 'kept', startedAt: '2026-09-30T10:00:00Z' }], onDeleteOrphan: s => deleted.push(s.sessionId) }) })
    app.mount(host)
    await nextTick()
    const c = card('カレンダーに無い棚卸')
    expect(c.querySelector('.dash-card-value').textContent).toBe('1件')
    await click(c)
    expect(host.textContent).toContain('2026/8/31')
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await click(host.querySelector('.dash-orphan-del'))
    expect(deleted).toEqual(['gone'])
  })

  it('sessions が渡されなければカードを出さない', async () => {
    await mount(TWO_MONTHS.map((x, i) => ({ ...x, sessionId: 'z' + i })))
    expect(card('カレンダーに無い棚卸')).toBeUndefined()
  })
})
