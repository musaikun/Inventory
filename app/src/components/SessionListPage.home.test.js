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
  can: () => true, canSeeMoney: { value: true }, canSeeReport: { value: true }, denyMessage: p => p, staffNames: { value: [] }, loadStaffNames: async () => [],
  getSessions:     vi.fn(async () => sessionList),
  createSession:   (...a) => createSession(...a),
  deleteSession:   (...a) => deleteSession(...a),
  updateSession:   vi.fn(),
  getDiscardedSessions: vi.fn(async () => discardedList),
  restoreSession:  (...a) => restoreImpl(...a),
  logout:          vi.fn(),
  isAuthenticated: { value: true },
  isAdmin:         { value: true },
  currentStaff:    { value: null }, ownerName: { value: '無才' }, storeName: { value: '本店' }, updateStoreName: vi.fn(), updateOwnerName: vi.fn(),
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
async function mountPage({ items = true, props = {} } = {}) {
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
    ...props,
  })
  app.mount(host)
  for (let i = 0; i < 6; i++) await nextTick()
  return host
}
const tick = async (n = 4) => { for (let i = 0; i < n; i++) await nextTick() }
async function click(el) { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); await tick() }
const btn = (root, label) => [...root.querySelectorAll('button')].find(b => b.textContent.includes(label))
const sheet = () => host.querySelector('.sh')
// 棚卸・発注の開始はホームのショートカットだけ（在庫タブには置かない・User決定 2026-10-10）
const shortcut = label => [...host.querySelectorAll('.ht-grid .ht-sc')].find(b => b.querySelector('b')?.textContent === label)

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear()
  vi.resetModules()
  sessionList = []
  createSession.mockClear(); deleteSession.mockClear()
})
afterEach(() => { app?.unmount(); host?.remove(); app = null; host = null; vi.restoreAllMocks() })

describe('ホームの骨組み', () => {
  it('在庫タブは表だけ（並び替えはホームの「数える順」・棚卸・発注の開始はホームだけ）・下部ナビ（ホーム／在庫／日誌／レポート／管理）', async () => {
    await mountPage()
    expect(host.querySelector('.sp .inventory-table, .sp table')).not.toBeNull()
    expect(host.querySelector('.sp .act')).toBeNull()
    expect(host.querySelector('.home-top .sc')).toBeNull()
    expect(shortcut('数える順')).toBeTruthy()
    expect(shortcut('棚卸')).toBeTruthy()
    expect(shortcut('発注')).toBeTruthy()
    expect([...host.querySelectorAll('.bnav button')].map(b => b.textContent.replace(/\s/g, ''))).toEqual(['ホーム', '在庫', '日誌', 'レポート', '設定'])
  }, 20_000)   // ファイルの最初のテストで、全件を並べて走らせると読み込みに5秒を超えることがある

  it('品目が無ければ（サンプルのままでも）表と操作ボタンの代わりに登録の入口', async () => {
    const { useConfig } = await import('../composables/useConfig.js')
    useConfig().resetToDefault?.()
    await mountPage({ items: false })
    expect(host.textContent).toContain('最初の品目を追加')
    expect(host.querySelector('.home-top .sc')).toBeNull()
  })

  it('日誌・レポート・管理はホームのタブ（日誌はお店のカレンダー・週の帯）', async () => {
    await mountPage()
    // 日誌＝お店のカレンダー（2026-10-25）。開いたら記録を取り込み直す
    await click(btn(host.querySelector('.bnav'), '日誌'))
    expect(host.querySelector('.jp')).not.toBeNull()
    expect(host.querySelector('.jp .jm')).not.toBeNull()
    expect(events).toContainEqual(['calendarShown'])
    // レポート＝在庫分析（重ねて開かず、タブの中）。履歴カレンダーの入口はもう無い
    await click(btn(host.querySelector('.bnav'), 'レポート'))
    expect(host.querySelector('.rt-hist')).toBeNull()
    expect(host.querySelector('.report-tab .dash-embedded')).not.toBeNull()
    expect(host.querySelector('.report-tab').textContent).not.toContain('直近の棚卸')   // 詳細で見られる情報は出さない
    // 管理＝データ管理を統合（取込・書き出し等の下に、発注の設定・各種設定など）
    await click(btn(host.querySelector('.bnav'), '設定'))
    expect(host.querySelector('.mp.embedded')).not.toBeNull()
    expect(host.querySelector('.mp-header')).toBeNull()
    // 「各種設定」の中身を直接並べる（2026-10-16）
    for (const label of ['発注日・締切', '発注点', '通知', 'カレンダーの天気', '表示の不具合をリセット', 'フィードバック', 'アプリ情報']) {
      expect(host.querySelector('.mp').textContent).toContain(label)
    }
    expect(host.querySelector('.mp').textContent).not.toContain('各種設定')
    // 入出庫の記録・記録の確認は置かない（User 2026-10-04。入出庫は品目シートでその場で）。練習モードも置かない
    expect(host.querySelector('.manage').textContent).not.toContain('入出庫の記録')
    expect(host.querySelector('.manage').textContent).not.toContain('記録の確認')
    expect(host.querySelector('.manage').textContent).not.toContain('仕入れ')
    expect(host.querySelector('.manage').textContent).not.toContain('練習')
  })

  it('管理タブから発注基準・発注日の設定を開ける', async () => {
    await mountPage()
    await click(btn(host.querySelector('.bnav'), '設定'))
    await click(btn(host.querySelector('.manage'), '発注点'))
    expect(document.body.querySelector('.ob-sheet')).not.toBeNull()
  })
})

describe('棚卸を始める', () => {
  it('開始シートで「ひとりで／みんなで」を選ぶ。みんなではルームを作る印を付けて開始する', async () => {
    await mountPage()
    await click(shortcut('棚卸'))
    expect(sheet().textContent).toContain('棚卸を始める')
    await click(btn(sheet(), 'みんなで始める'))
    expect(events).toContainEqual(['startSession', expect.objectContaining({ id: 'stk-new' }), 'stock', { room: true }])
  })

  it('同じ日の2回目は、ブラウザの確認ではなくシートで「続きから／新しく」を訊く', async () => {
    sessionList = [DONE_TODAY]
    await mountPage()
    const spy = vi.spyOn(window, 'confirm')
    await click(shortcut('棚卸'))
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
    await click(shortcut('棚卸'))
    await click(btn(sheet(), 'ひとりで始める'))
    await click(btn(sheet(), '別の棚卸として新しく始める'))
    expect(events).toContainEqual(['startSession', expect.objectContaining({ id: 'stk-new' }), 'stock', { room: false }])
  })

  it('開始シートに「練習してみる」は出さない', async () => {
    await mountPage()
    await click(shortcut('棚卸'))
    expect(btn(sheet(), '練習')).toBeUndefined()
  })
})

describe('発注を始める', () => {
  it('開始シートで「記録のみ（仕入先へ送信しない）」を一度はっきり言う', async () => {
    await mountPage()
    await click(shortcut('発注'))
    expect(sheet().textContent).toContain('仕入先へは送信されません')
    await click(btn(sheet(), 'ひとりで始める'))
    expect(createSession).toHaveBeenCalledWith('order')
    expect(events).toContainEqual(['startSession', expect.objectContaining({ id: 'ord-new' }), 'order', { room: false }])
  })
})

describe('中断中のセッションと破棄', () => {
  it('中断中は帯を出さず、ホームの棚卸・発注が「途中」になり、押すと再開する', async () => {
    sessionList = [ACTIVE_STOCK, ACTIVE_ORDER]
    await mountPage()
    expect(host.querySelector('.strip')).toBeNull()
    const stock = shortcut('棚卸')
    expect(stock.querySelector('.ht-bd').textContent).toBe('途中')
    expect(shortcut('発注').textContent).toContain('途中')
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

  it('破棄すると、その棚卸の最中に手で足した品目も消える。元に戻すと戻る（User決定 2026-10-27）', async () => {
    const { useConfig, setItemAddSession } = await import('../composables/useConfig.js')
    const { config, addItem } = useConfig()
    sessionList = [ACTIVE_STOCK]
    const { pendingDiscardId } = await import('../composables/appMenuState.js')
    pendingDiscardId.value = 's1'
    await mountPage()
    setItemAddSession('s1'); addItem('破棄テストの品目'); setItemAddSession(null)
    addItem('前からの品目')
    await click(btn(sheet(), '破棄する'))
    expect(config.order).toContain('前からの品目')
    expect(config.order).not.toContain('破棄テストの品目')
    app.unmount(); host.remove(); app = null
    sessionList = []
    discardedList = [{ id: 's1', type: 'stock', itemCount: 3, startedAt: new Date().toISOString(), restorableUntil: new Date(Date.now() + 3600_000).toISOString() }]
    restoreImpl = async (id) => ({ ok: true, session: { id, type: 'stock', status: 'active', startedAt: new Date().toISOString() }, payload: {} })
    await mountPage(); for (let i = 0; i < 8; i++) await nextTick()
    await click(shortcut('棚卸'))
    discardedList = []
    await click(btn(sheet(), '↩︎')); for (let i = 0; i < 8; i++) await nextTick()
    expect(config.order).toContain('破棄テストの品目')
    restoreImpl = async () => ({ ok: false })
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
    await click(shortcut('棚卸'))
    const b = btn(sheet(), '↩︎')
    expect(b.textContent).toContain('破棄した棚卸を元に戻して始める（あと16時間）')
    expect(sheet().textContent).not.toContain('破棄した発注')
    discardedList = []
    await click(b); await flushAll()
    expect(events).toContainEqual(['resumeSession', expect.objectContaining({ id: 'a' })])
    restoreImpl = async () => ({ ok: false })
  })

  it('この端末で開いていた棚卸がもう破棄されていたら、手元の数を捨てさせる（User報告 2026-10-27）', async () => {
    discardedList = [d('a')]
    await mountPage({ props: { liveSessionId: 'a' } }); await flushAll()
    expect(events).toContainEqual(['deleteSession', 'a'])
    discardedList = []
  })

  it('破棄した発注は発注の開始シートに出る', async () => {
    discardedList = [d('b', 'order')]
    await mountPage(); await flushAll()
    await click(shortcut('発注'))
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

describe('トップ（ホーム）とやること（User決定 2026-10-07）', () => {
  it('開くとトップ。今日のやることの要約を押すと日誌のリスト。ショートカットで各タブへ', async () => {
    const T = await import('../composables/useTasks.js')
    const { localDateKey } = await import('../utils/localDate.js')
    T.addTask('2000-01-02', '製氷機のフィルター交換')
    T.addTask(localDateKey(), '野菜の検品', null, '11:00')
    await mountPage()
    expect(host.querySelector('.ht')).not.toBeNull()
    expect(host.querySelector('.home-head')).toBeNull()          // トップは自前の見出し
    const today = host.querySelector('.ht-today')
    expect(today.textContent).toContain('期限切れ')
    expect(today.textContent).toContain('11:00')
    expect(today.textContent).toContain('0/1')
    // 押すと日誌の今日のタイムライン。期限切れは終日に赤で
    await click(today)
    expect(host.querySelector('.bnav button.on').textContent).toContain('日誌')
    expect(host.querySelector('.dt .dt-ad.missed')).not.toBeNull()
    await click(btn(host.querySelector('.bnav'), 'ホーム'))
    // ショートカットの「在庫」で在庫タブへ
    const sc = [...host.querySelectorAll('.ht-sc')]
    // 管理者（ここではオーナー）には「スタッフ」も（管理から移した・2026-10-14）
    expect(sc.map(b => b.querySelector('b').textContent)).toEqual(['棚卸', '発注', '数える順', '在庫', '日誌', 'レポート', 'スタッフ', 'データ', '設定'])
    expect(host.querySelector('.ht-sc small')).toBeNull()   // 説明文は出さない（User決定 2026-10-26）
    await click(sc[3])
    expect(host.querySelector('.bnav button.on').textContent).toContain('在庫')
    expect(host.querySelector('.manage')?.textContent ?? '').not.toContain('招待・承認')   // 管理には置かない
  })
})
