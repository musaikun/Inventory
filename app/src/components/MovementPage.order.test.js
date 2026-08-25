// 「仕入れ」ページの発注タブ（B: 統合カード）の回帰。
// 守りたい契約:
//   ・発注はこのページで完結せず、既存の発注セッション（複数人・ルーム同期）へ渡す
//   ・βであること、仕入先へ自動送信しないことが画面に出る
//   ・未反映の発注は入庫へ渡せる（発注レコードと入庫レコードは別のまま）
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

let sessionsResponse = []
const createSessionMock = vi.fn(async (type) => ({ id: 'new-order', type, status: 'active', startedAt: new Date().toISOString() }))

vi.mock('../composables/useStore.js', () => ({
  saveMovementToD1:      vi.fn(),
  importPastSessionToD1: vi.fn(),
  cancelPastImportOnD1:  vi.fn(),
  shopCode: { value: 'ABCDEF' },
}))
vi.mock('../composables/usePdfImporter.js', () => ({
  assertSpreadsheetFile: vi.fn(),
  excelToCsv:            vi.fn(async () => ''),
}))
vi.mock('../composables/useAuth.js', () => ({
  getSessions:   vi.fn(async () => sessionsResponse),
  createSession: (...a) => createSessionMock(...a),
}))

let app = null
let host = null
let events
let cfg

async function mountPage(props = {}) {
  const { default: MovementPage } = await import('./MovementPage.vue')
  host = document.createElement('div')
  document.body.appendChild(host)
  events = { startSession: [], resumeSession: [] }
  app = createApp({
    render: () => h(MovementPage, {
      ...props,
      onBack: () => {}, onSaved: () => {},
      onStartSession:  (s, mode) => events.startSession.push([s, mode]),
      onResumeSession: (s) => events.resumeSession.push(s),
    }),
  })
  app.mount(host)
  for (let i = 0; i < 6; i++) await nextTick()
  return host
}

function button(label) {
  return [...host.querySelectorAll('button')].find(b => b.textContent.includes(label))
}
async function click(el) { el.click(); for (let i = 0; i < 4; i++) await nextTick() }
async function openOrderTab() { await click(button('🧾 発注')) }

beforeEach(async () => {
  localStorage.clear()
  vi.resetModules()
  sessionsResponse = []
  createSessionMock.mockClear()
  const { useConfig } = await import('../composables/useConfig.js')
  cfg = useConfig()
  cfg.setEmptyList()
  cfg.addItem('トマト', 120, '', '個')
})
afterEach(() => {
  app?.unmount(); host?.remove()
  app = null; host = null
})

describe('仕入れページ — 発注タブ', () => {
  it('βであることと、自動送信しないことを出す', async () => {
    await mountPage()
    await openOrderTab()
    expect(host.textContent).toContain('自動送信されません')
    expect(host.textContent).toContain('複数人で同時に入力できます')
  })

  it('発注タブでは品目一覧を出さない（入力はセッション側）', async () => {
    await mountPage()
    await openOrderTab()
    expect(host.querySelector('.inventory-section')).toBeNull()
  })

  it('進行中の発注が無ければ、開始してセッションを渡す', async () => {
    await mountPage()
    await openOrderTab()
    await click(button('発注を開始'))

    expect(createSessionMock).toHaveBeenCalledWith('order')
    expect(events.startSession).toHaveLength(1)
    expect(events.startSession[0][1]).toBe('order')
  })

  it('進行中の発注があれば、再開を渡す（新しく作らない）', async () => {
    sessionsResponse = [{ id: 'o1', type: 'order', status: 'active', startedAt: '2026-08-20T02:00:00Z' }]
    await mountPage()
    await openOrderTab()
    await click(button('記録を再開する'))

    expect(createSessionMock).not.toHaveBeenCalled()
    expect(events.resumeSession).toEqual([sessionsResponse[0]])
  })

  it('棚卸セッションを発注と取り違えない', async () => {
    sessionsResponse = [{ id: 's1', type: 'stock', status: 'active', startedAt: '2026-08-20T02:00:00Z' }]
    await mountPage()
    await openOrderTab()
    expect(button('記録を再開する')).toBeUndefined()
    expect(button('発注を開始')).not.toBeUndefined()
  })

  it('品目が無ければ開始できない', async () => {
    cfg.setEmptyList()
    await mountPage()
    await openOrderTab()
    expect(button('発注を開始').disabled).toBe(true)
    expect(host.textContent).toContain('先に品目マスタを登録してください')
  })

  it('未反映の発注を入庫タブへ渡してプリフィルする', async () => {
    const { useOrders } = await import('../composables/useOrders.js')
    useOrders().saveOrder({
      date: new Date().toISOString().slice(0, 10),
      supplier: '青果A',
      lines: [{ item: 'トマト', qty: 2, unit: '個', lot: 1 }],
    })
    await mountPage()
    await openOrderTab()

    expect(host.textContent).toContain('入庫として未反映の発注')
    await click(button('入庫へ'))

    // 入庫タブへ移り、発注ぶんが入力済みになる
    expect(host.querySelector('.mv-savebar').textContent).toContain('入庫 1品目')
    expect(host.textContent).toContain('の発注を入庫にプリフィル済み')
  })

  it('発注日・締切は歯車から開く（どのタブからでも）', async () => {
    await mountPage()
    expect(host.querySelector('.os-title')).toBeNull()
    await click(host.querySelector('.mv-gear'))
    expect(host.querySelector('.os-title').textContent).toContain('発注スケジュール')
  })

  it('登録済みのスケジュールを名前つきで全件出す', async () => {
    cfg.setOrderSchedules([
      { name: '青果', days: [2, 5], deadline: '15:00' },
      { name: '肉',   days: [1] },
    ])
    await mountPage()
    await openOrderTab()

    const rows = [...host.querySelectorAll('.mv-sched-sum')]
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain('青果')
    expect(rows[0].textContent).toContain('火・金')
    expect(rows[1].textContent).toContain('肉')
    expect(rows[1].textContent).toContain('月')
  })

  // 発注セッションから戻ったとき、App が発注タブを指定して開き直す
  it('initialTab で開始タブを指定できる', async () => {
    await mountPage({ initialTab: 'order' })
    expect(host.querySelector('.mv-tab.on').textContent).toContain('発注')
  })

  it('initialTab の既定は在庫', async () => {
    await mountPage()
    expect(host.querySelector('.mv-tab.on').textContent.trim()).toBe('在庫')
  })

  it('未設定なら設定を促す', async () => {
    await mountPage()
    await openOrderTab()
    expect(host.querySelector('.mv-sched').textContent).toContain('発注スケジュールを設定')
  })
})
