// ホーム（画面の再設計「表がホーム」・proposals.md 2026-09-30）。
// 起動したら品目・在庫の表。上の段は 中断中の帯 → 今日の帯 → 操作ボタン（棚卸・発注・入出庫）。
// 下部ナビは 在庫／履歴／管理。確認はブラウザの confirm ではなく下から出るシートで訊く。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, nextTick } from 'vue'

vi.mock('../utils/api.js', () => ({
  HTTP_BASE: 'https://worker.test',
  apiFetch: vi.fn(async () => ({})),
  setAuthInvalidatedHandler: vi.fn(),
}))
let sessionList = []
let discardedList = []
let restoreImpl = async () => ({ ok: false })
const createSession = vi.fn(async (type) => ({ id: type === 'order' ? 'ord-new' : 'stk-new', type: type ?? 'stock', status: 'active', startedAt: new Date().toISOString() }))
const deleteSession = vi.fn(async () => ({}))
vi.mock('../composables/useAuth.js', () => ({
  can: () => true, canSeeMoney: { value: true }, denyMessage: p => p,
  getSessions:     vi.fn(async () => sessionList),
  createSession:   (...a) => createSession(...a),
  deleteSession:   (...a) => deleteSession(...a),
  updateSession:   vi.fn(),
  getDiscardedSessions: vi.fn(async () => discardedList),
  restoreSession:  (...a) => restoreImpl(...a),
  logout:          vi.fn(),
  isAuthenticated: { value: true },
  isAdmin:         { value: true },
  currentStaff:    { value: null },
  ROLE_LABELS:     { owner: 'オーナー', admin: '管理者', shain: '社員', arbeit: 'アルバイト' },
  listStaff: vi.fn(async () => ({ staff: [], invites: [] })), createStaffInvite: vi.fn(), revokeStaffInvite: vi.fn(), staffAction: vi.fn(),
  storeName:       { value: 'テスト店' },
}))
vi.mock('../composables/useSync.js', () => ({ fetchRoomStatus: vi.fn(async () => null) }))

const now = new Date()
const iso = d => d.toISOString()
const DONE_TODAY = { id: 'today', type: 'stock', status: 'completed', startedAt: iso(new Date(now - 3600_000)), endedAt: iso(now) }
const ACTIVE_STOCK = { id: 's1', type: 'stock', status: 'active', startedAt: iso(new Date(now - 600_000)), itemCount: 12 }
const ACTIVE_ORDER = { id: 'o1', type: 'order', status: 'active', startedAt: iso(new Date(now - 600_000)), itemCount: 3 }

let app = null, host = null, events
async function mountPage({ items = true } = {}) {
  const { useConfig } = await import('../composables/useConfig.js')
  const cfg = useConfig()
  cfg.setEmptyList()
  if (items) { cfg.addItem('トマト', 100, '野菜', '個'); cfg.addItem('豚バラ', 800, '肉', 'kg') }
  const { default: Page } = await import('./SessionListPage.vue')
  host = document.createElement('div')
  document.body.appendChild(host)
  events = []
  const on = name => (...a) => events.push([name, ...a])
  app = createApp(Page, {
    onStartSession: on('startSession'), onResumeSession: on('resumeSession'), onCalendarShown: on('calendarShown'),
    onDeleteSession: on('deleteSession'), onOpenMaster: on('openMaster'), onOpenMovement: on('openMovement'),
    onStartPractice: on('startPractice'), onOpenFeedback: on('openFeedback'), onViewSession: on('viewSession'),
  })
  app.mount(host)
  for (let i = 0; i < 6; i++) await nextTick()
  return host
}
const tick = async (n = 4) => { for (let i = 0; i < n; i++) await nextTick() }
async function click(el) { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); await tick() }
const btn = (root, label) => [...root.querySelectorAll('button')].find(b => b.textContent.includes(label))
const sheet = () => host.querySelector('.sh')

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear()
  vi.resetModules()
  sessionList = []
  createSession.mockClear(); deleteSession.mockClear()
})
afterEach(() => { app?.unmount(); host?.remove(); app = null; host = null; vi.restoreAllMocks() })

describe('ホームの骨組み', () => {
  it('表・操作ボタン2つ＋並び替え（入出庫は品目シートで入れる）・下部ナビ（在庫／カレンダー／レポート／管理）', async () => {
    await mountPage()
    expect(host.querySelector('.sp .inventory-table, .sp table')).not.toBeNull()
    expect([...host.querySelectorAll('.acts .act')].map(b => b.textContent.replace(/\s/g, ''))).toEqual(['👥棚卸', '🧾発注'])
    expect([...host.querySelectorAll('.bnav button')].map(b => b.textContent.replace(/\s/g, ''))).toEqual(['在庫', 'カレンダー', 'レポート', '管理'])
    expect(host.querySelector('.acts .st').textContent).toContain('並び替え')
  })

  it('品目が無ければ（サンプルのままでも）表と操作ボタンの代わりに登録の入口', async () => {
    const { useConfig } = await import('../composables/useConfig.js')
    useConfig().resetToDefault?.()
    await mountPage({ items: false })
    expect(host.textContent).toContain('最初の品目を追加')
    expect(host.querySelector('.acts')).toBeNull()
  })

  it('カレンダー・レポート・管理はホームのタブ（履歴カレンダーはカレンダーのタブ）', async () => {
    await mountPage()
    // カレンダー＝履歴カレンダー＋予定・やること。開いたら記録を取り込み直す
    await click(btn(host.querySelector('.bnav'), 'カレンダー'))
    expect(host.querySelector('.hcp.embedded')).not.toBeNull()
    expect(events).toContainEqual(['calendarShown'])
    // レポート＝在庫分析（重ねて開かず、タブの中）。履歴カレンダーの入口はもう無い
    await click(btn(host.querySelector('.bnav'), 'レポート'))
    expect(host.querySelector('.rt-hist')).toBeNull()
    expect(host.querySelector('.report-tab .dash-embedded')).not.toBeNull()
    expect(host.querySelector('.report-tab').textContent).not.toContain('直近の棚卸')   // 詳細で見られる情報は出さない
    // 管理＝データ管理を統合（取込・書き出し等の下に、発注の設定・各種設定など）
    await click(btn(host.querySelector('.bnav'), '管理'))
    expect(host.querySelector('.mp.embedded')).not.toBeNull()
    expect(host.querySelector('.mp-header')).toBeNull()
    for (const label of ['取り込む', '発注日・締切', '発注点', '各種設定', 'フィードバック']) {
      expect(host.querySelector('.mp').textContent).toContain(label)
    }
    // 入出庫の記録・記録の確認は置かない（User 2026-10-04。入出庫は品目シートでその場で）。練習モードも置かない
    expect(host.querySelector('.manage').textContent).not.toContain('入出庫の記録')
    expect(host.querySelector('.manage').textContent).not.toContain('記録の確認')
    expect(host.querySelector('.manage').textContent).not.toContain('仕入れ')
    expect(host.querySelector('.manage').textContent).not.toContain('練習')
  })

  it('管理タブから発注基準・発注日の設定を開ける', async () => {
    await mountPage()
    await click(btn(host.querySelector('.bnav'), '管理'))
    await click(btn(host.querySelector('.manage'), '🎯'))
    expect(document.body.querySelector('.ob-sheet')).not.toBeNull()
  })
})

describe('棚卸を始める', () => {
  it('開始シートで「ひとりで／みんなで」を選ぶ。みんなではルームを作る印を付けて開始する', async () => {
    await mountPage()
    await click(host.querySelector('.act.stock'))
    expect(sheet().textContent).toContain('棚卸を始める')
    await click(btn(sheet(), 'みんなで始める'))
    expect(events).toContainEqual(['startSession', expect.objectContaining({ id: 'stk-new' }), 'stock', { room: true }])
  })

  it('同じ日の2回目は、ブラウザの確認ではなくシートで「続きから／新しく」を訊く', async () => {
    sessionList = [DONE_TODAY]
    await mountPage()
    const spy = vi.spyOn(window, 'confirm')
    await click(host.querySelector('.act.stock'))
    await click(btn(sheet(), 'ひとりで始める'))
    expect(spy).not.toHaveBeenCalled()
    expect(createSession).not.toHaveBeenCalled()
    expect(sheet().textContent).toContain('今日はもう棚卸をしています')
    await click(btn(sheet(), '続きから開く'))
    expect(events).toContainEqual(['resumeSession', DONE_TODAY])
  })

  it('同じ日でも「別の棚卸として新しく始める」を選べば新しく作る', async () => {
    sessionList = [DONE_TODAY]
    await mountPage()
    await click(host.querySelector('.act.stock'))
    await click(btn(sheet(), 'ひとりで始める'))
    await click(btn(sheet(), '別の棚卸として新しく始める'))
    expect(events).toContainEqual(['startSession', expect.objectContaining({ id: 'stk-new' }), 'stock', { room: false }])
  })

  it('開始シートに「練習してみる」は出さない', async () => {
    await mountPage()
    await click(host.querySelector('.act.stock'))
    expect(btn(sheet(), '練習')).toBeUndefined()
  })
})

describe('発注を始める', () => {
  it('開始シートで「記録のみ（仕入先へ送信しない）」を一度はっきり言う', async () => {
    await mountPage()
    await click(host.querySelector('.act.order'))
    expect(sheet().textContent).toContain('仕入先へは送信されません')
    await click(btn(sheet(), 'ひとりで始める'))
    expect(createSession).toHaveBeenCalledWith('order')
    expect(events).toContainEqual(['startSession', expect.objectContaining({ id: 'ord-new' }), 'order', { room: false }])
  })
})

describe('中断中のセッションと破棄', () => {
  it('中断中は帯を出さず、棚卸・発注のボタンが「再開」になる', async () => {
    sessionList = [ACTIVE_STOCK, ACTIVE_ORDER]
    await mountPage()
    expect(host.querySelector('.strip')).toBeNull()
    const stock = host.querySelector('.act.stock.resume')
    expect(stock.textContent).toContain('棚卸を再開')
    expect(stock.textContent).toContain('12品目')
    expect(host.querySelector('.act.order.resume').textContent).toContain('発注を再開')
    await click(stock)
    expect(events).toContainEqual(['resumeSession', ACTIVE_STOCK])
  })

  it('棚卸の画面の ☰ から破棄してホームへ戻ると、件数を見せて確認する（ブラウザの確認は出さない）', async () => {
    sessionList = [ACTIVE_STOCK]
    const { pendingDiscardId } = await import('../composables/appMenuState.js')
    pendingDiscardId.value = 's1'
    const spy = vi.spyOn(window, 'confirm')
    await mountPage()
    expect(sheet().textContent).toContain('この棚卸を破棄しますか？')
    expect(sheet().textContent).toContain('12品目')
    expect(sheet().textContent).toContain('「棚卸」のボタンから元に戻して始められます')
    await click(btn(sheet(), '破棄する'))
    expect(spy).not.toHaveBeenCalled()
    expect(deleteSession).toHaveBeenCalledWith('s1', expect.anything())
    expect(events).toContainEqual(['deleteSession', 's1'])
  })

  it('破棄の確認で「やめる」なら何もしない', async () => {
    sessionList = [ACTIVE_ORDER]
    const { pendingDiscardId } = await import('../composables/appMenuState.js')
    pendingDiscardId.value = 'o1'
    await mountPage()
    expect(sheet().textContent).toContain('この発注を破棄しますか？')
    await click(btn(sheet(), 'やめる'))
    expect(deleteSession).not.toHaveBeenCalled()
    expect(sheet()).toBeNull()
  })
})

describe('破棄したセッション（24時間は元に戻せる）', () => {
  const later = new Date(Date.now() + 3600_000 * 16 + 60_000).toISOString()
  const d = (id, type = 'stock') => ({ id, type, itemCount: 3, startedAt: new Date().toISOString(), restorableUntil: later })
  const flushAll = async () => { for (let i = 0; i < 8; i++) await nextTick() }

  it('ホームの上には出さず、棚卸のボタンの開始シートから元に戻して始める（残り時間つき）', async () => {
    discardedList = [d('a'), d('b', 'order')]
    restoreImpl = async (id) => ({ ok: true, session: { id, type: 'stock', status: 'active', startedAt: new Date().toISOString() }, payload: {} })
    await mountPage(); await flushAll()
    expect(host.querySelector('.strip')).toBeNull()
    await click(host.querySelector('.act.stock'))
    const b = btn(sheet(), '↩︎')
    expect(b.textContent).toContain('破棄した棚卸を元に戻して始める（あと16時間）')
    expect(sheet().textContent).not.toContain('破棄した発注')
    discardedList = []
    await click(b); await flushAll()
    expect(events).toContainEqual(['resumeSession', expect.objectContaining({ id: 'a' })])
    restoreImpl = async () => ({ ok: false })
  })

  it('破棄した発注は発注の開始シートに出る', async () => {
    discardedList = [d('b', 'order')]
    await mountPage(); await flushAll()
    await click(host.querySelector('.act.order'))
    expect(sheet().textContent).toContain('破棄した発注を元に戻して始める')
    discardedList = []
  })
})

describe('レポートタブ（整理後）', () => {
  it('金額なしの黄色い注意は出さず、分析の月の棚卸から詳細へ行ける', async () => {
    const { STORAGE_KEYS } = await import('../utils/storageKeys.js')
    localStorage.setItem(STORAGE_KEYS.history, JSON.stringify({
      s1: { sessionId: 's1', date: '2026-09-30', savedAt: '2026-09-30T10:00:00Z', items: [{ item: 'トマト', qty: 3, unit: '個' }] },
    }))
    sessionList = [{ id: 's1', type: 'stock', status: 'completed', startedAt: '2026-09-30T05:00:00Z', endedAt: '2026-09-30T10:00:00Z' }]
    await mountPage()
    await click(btn(host.querySelector('.bnav'), 'レポート'))
    expect(host.querySelector('.dash-warn')).toBeNull()
    await click(host.querySelector('.dash-open'))
    expect(events.find(e => e[0] === 'viewSession')?.[1]?.id).toBe('s1')
    sessionList = []
  })
})
