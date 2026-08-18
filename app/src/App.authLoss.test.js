// DATA-001 §1/§2 — 401 で作業を消さない / 不完全な履歴で詳細を騙らない（App level）
//
// 守りたいのは2つ。
//  1. 別端末ログインで token が失効しても、入力中の棚卸・下書き・進行中セッションが残り、
//     同じ店舗へ戻れば同じ sessionId で完了できる
//  2. 端末に中身の無いスナップショットしか無いとき、それを「詳細」として見せず
//     sessionId でサーバーの明細を取り直す
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { createApp, nextTick } from 'vue'
import { STORAGE_KEYS } from './utils/storageKeys.js'

let authInvalidatedHandler = null
let linesCalls = []
let linesResponse = null

vi.mock('./utils/api.js', () => ({
  HTTP_BASE: '',
  WS_BASE: '',
  apiFetch: vi.fn(async (path) => {
    if (/\/store\/[A-Z0-9]+$/.test(path)) return { shopCode: 'ABCDEF', activeRoom: null, plan: 'free' }
    if (/\/lines$/.test(path)) {
      linesCalls.push(path)
      if (!linesResponse) { const e = new Error('not found'); e.status = 404; throw e }
      return linesResponse
    }
    if (/\/sessions(\?|$)/.test(path)) return [TODAY_DONE]
    return {}
  }),
  setAuthInvalidatedHandler: (fn) => { authInvalidatedHandler = fn },
}))
vi.mock('./utils/analytics.js', () => ({
  initAnalytics: vi.fn(), track: vi.fn(), resetAnalytics: vi.fn(),
}))

vi.mock('./composables/useSync.js', async (importOriginal) => {
  const actual = await importOriginal()
  const { computed, reactive } = await import('vue')
  return {
    ...actual,
    useSync: () => ({
      state: reactive({ error: '', connected: false, participants: [], messages: [] }),
      isActive: computed(() => false),
      isHost:   computed(() => false),
      participantList: computed(() => []),
      createRoom: vi.fn(), joinRoom: vi.fn(), leaveRoom: vi.fn(),
      dissolveRoom: vi.fn(async () => {}),
      unreadCount: computed(() => 0),
      auditLog: [],
    }),
    getSavedGuestSession: () => null,
    hasHostToken: () => false,
    fetchRoomStatus: async () => null,
    fetchRoomResult: async () => null,
  }
})

let app = null
let host = null

// App のモジュールグラフを先に温める（既定 5 秒 testTimeout の枯渇対策）。
// 初回 import は transform とモジュール評価で数秒かかる。test 本体でこれを払うと
// 環境が混み合ったときに 5 秒へ届く。hook（既定 10 秒）で払い、直後に registry を
// 捨てることで、各 test は毎回まっさらなモジュール状態から軽く始められる。
beforeAll(async () => { await import('./App.vue'); vi.resetModules() })


// 履歴カレンダーは「今日」を**ローカル日付**（getFullYear/getMonth/getDate）で決め、
// セッションの日付キーは ISO 文字列の先頭10文字（＝UTC日付）で作る。
// `toISOString()` から作ると、UTC とローカルの日付がずれる時間帯（例: JST 00:00〜09:00、
// UTC+14 の終日）で「今日」のセルに並ばず、詳細行を開けずに落ちる。
// カレンダーが選ぶ日と必ず一致するよう、**ローカル日付**でキーを作る。
function _localDateKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const TODAY = _localDateKey()
const TODAY_DONE = {
  id: 'sess-9', shopCode: 'ABCDEF', type: 'stock', status: 'completed',
  startedAt: `${TODAY}T00:00:00.000Z`, endedAt: `${TODAY}T01:00:00.000Z`, itemCount: 1,
}

const SESSION      = { id: 'sess-1', shopCode: 'ABCDEF', startedAt: '2026-08-09T00:00:00Z', status: 'active', itemCount: 1 }

async function mountApp() {
  const { default: App } = await import('./App.vue')
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp(App)
  app.mount(host)
  for (let i = 0; i < 10; i++) await nextTick()
  return host
}

function seedActiveSession() {
  localStorage.setItem(STORAGE_KEYS.authToken, 'test-token')
  localStorage.setItem(STORAGE_KEYS.shopCode, 'ABCDEF')
  localStorage.setItem(STORAGE_KEYS.dataOwner, 'ABCDEF')
  localStorage.setItem(STORAGE_KEYS.pendingSession, JSON.stringify(SESSION))
  localStorage.setItem(STORAGE_KEYS.inventory, JSON.stringify({
    // useInventory の当日判定は UTC（`toISOString`）なので、ここは UTC のまま合わせる
    date:        new Date().toISOString().slice(0, 10),
    data:        { トマト: { qty: 3, unit: '個', updatedAt: Date.now() } },
    recountFlags: {},
    entryLog:    ['トマト'],
    completedAt: null,
  }))
}

describe('App — 401（別端末ログイン）で作業を消さない', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    authInvalidatedHandler = null
    linesCalls = []
    linesResponse = null
    vi.stubGlobal('confirm', vi.fn(() => true))
    vi.stubGlobal('scrollTo', vi.fn())
  })
  afterEach(() => {
    if (app)  { app.unmount(); app = null }
    if (host) { host.remove();  host = null }
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('失効しても入力値・下書き・進行中セッションが端末に残る', async () => {
    seedActiveSession()
    await mountApp()
    localStorage.setItem('inv_draft_sess-1', JSON.stringify({ inv: { トマト: { qty: 3 } }, activeMs: 0 }))
    expect(typeof authInvalidatedHandler).toBe('function')

    authInvalidatedHandler()
    for (let i = 0; i < 6; i++) await nextTick()

    // 認証だけが落ちる
    expect(localStorage.getItem(STORAGE_KEYS.authToken)).toBeNull()
    // 作業は残る（旧実装は clearSession() / reset() でここを全部消していた）
    expect(localStorage.getItem(STORAGE_KEYS.pendingSession)).toContain('sess-1')
    expect(localStorage.getItem('inv_draft_sess-1')).not.toBeNull()
    const inv = JSON.parse(localStorage.getItem(STORAGE_KEYS.inventory))
    expect(inv.data['トマト'].qty).toBe(3)
  })

  it('失効時に下書きが無くても、入力中の内容が下書きとして書き出される', async () => {
    seedActiveSession()
    await mountApp()
    // 入力直後の下書きはデバウンス保存に依存する。まだ書かれていない状況を作る
    localStorage.removeItem('inv_draft_sess-1')

    authInvalidatedHandler()
    for (let i = 0; i < 6; i++) await nextTick()

    const draft = JSON.parse(localStorage.getItem('inv_draft_sess-1'))
    expect(draft.inv['トマト'].qty).toBe(3)
  })

  it('同じ店舗へ戻れば、同じ sessionId の棚卸を続けられる', async () => {
    seedActiveSession()
    await mountApp()
    authInvalidatedHandler()
    for (let i = 0; i < 6; i++) await nextTick()

    // 再ログイン相当（同じ店舗）でアプリを開き直す
    app.unmount(); app = null
    host.remove(); host = null
    vi.resetModules()
    localStorage.setItem(STORAGE_KEYS.authToken, 'new-token')
    localStorage.setItem(STORAGE_KEYS.shopCode, 'ABCDEF')
    await mountApp()

    expect(host.querySelector('.btn-complete')).not.toBeNull()
    expect(localStorage.getItem(STORAGE_KEYS.pendingSession)).toContain('sess-1')
  })
})

describe('App — 中身の無いスナップショットで詳細を騙らない', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    authInvalidatedHandler = null
    linesCalls = []
    linesResponse = null
    vi.stubGlobal('confirm', vi.fn(() => true))
    vi.stubGlobal('scrollTo', vi.fn())
  })
  afterEach(() => {
    if (app)  { app.unmount(); app = null }
    if (host) { host.remove();  host = null }
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  // 履歴カレンダーは既定で「今日」を選ぶので、完了セッションを今日に置くと
  // その明細行（.hc-entry-stock）が描画され、クリックで onViewSession へ入る。
  async function openTodayCompletedSession(localHistory) {
    localStorage.setItem(STORAGE_KEYS.authToken, 'test-token')
    localStorage.setItem(STORAGE_KEYS.shopCode, 'ABCDEF')
    localStorage.setItem(STORAGE_KEYS.dataOwner, 'ABCDEF')
    if (localHistory) localStorage.setItem(STORAGE_KEYS.history, JSON.stringify(localHistory))
    await mountApp()
    // 履歴タブ（ダッシュボード）へ
    const tabs = [...host.querySelectorAll('.tab-btn')]
    const dash = tabs.find(b => !b.className.includes('active')) ?? tabs[1]
    dash?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    for (let i = 0; i < 6; i++) await nextTick()
    const entry = host.querySelector('.hc-entry-stock')
    entry?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    for (let i = 0; i < 8; i++) await nextTick()
    return entry
  }

  it('明細が空のスナップショットしか無ければ、サーバーの明細を取りに行く', async () => {
    // 完了処理が途中で落ちた端末に残る「中身の無い」スナップショット
    linesResponse = {
      sessionId: TODAY_DONE.id, date: TODAY,
      lines: [{ item: 'トマト', qty: 3, unit: '個', unitPrice: null }],
    }
    const entry = await openTodayCompletedSession({
      [TODAY_DONE.id]: { sessionId: TODAY_DONE.id, date: TODAY, savedAt: `${TODAY}T01:00:00Z`, items: [] },
    })
    expect(entry).not.toBeNull()
    // 端末に「ある」ように見えても、中身が無いのでサーバーへ取りに行く
    expect(linesCalls.some(p => p.includes(TODAY_DONE.id))).toBe(true)
    // サーバーの明細で詳細が開く
    expect(host.querySelector('.detail-page')).not.toBeNull()
  })

  it('中身のあるスナップショットならサーバーへは取りに行かない', async () => {
    const entry = await openTodayCompletedSession({
      [TODAY_DONE.id]: {
        sessionId: TODAY_DONE.id, date: TODAY, savedAt: `${TODAY}T01:00:00Z`,
        items: [{ item: 'トマト', qty: 3, unit: '個', unitPrice: null, subtotal: null }],
      },
    })
    expect(entry).not.toBeNull()
    expect(linesCalls).toHaveLength(0)
  })
})

// ── 失効直前のデバウンス保存を失わない（第2セッション §6）────────────────────
//
// 失効ハンドラは shopCode と token を消す。デバウンス中の config / inventory の
// timer はそのまま残り、発火しても「店舗未設定」で捨てられていた。
// 消す前に、失効時点の店舗の未送信キューへ確定させる（送信はしない）。
describe('App — 失効直前のデバウンス保存をキューへ残す', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    authInvalidatedHandler = null
    linesCalls = []
    linesResponse = null
    vi.stubGlobal('confirm', vi.fn(() => true))
    vi.stubGlobal('scrollTo', vi.fn())
  })
  afterEach(() => {
    if (app)  { app.unmount(); app = null }
    if (host) { host.remove();  host = null }
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  const pendingSaves = () => {
    const raw = localStorage.getItem(STORAGE_KEYS.pendingSaves)
    return raw ? (JSON.parse(raw).items ?? []) : []
  }

  it('デバウンス中の品目リスト変更が、失効後もキューに残る', async () => {
    seedActiveSession()
    await mountApp()

    // 品目を追加する = config 変更コールバック → 2秒デバウンス
    const { useConfig } = await import('./composables/useConfig.js')
    useConfig().addItem('新しい品目')
    for (let i = 0; i < 4; i++) await nextTick()

    authInvalidatedHandler()
    for (let i = 0; i < 6; i++) await nextTick()

    const queued = pendingSaves()
    const cfg = queued.find(e => e.kind === 'config')
    expect(cfg).toBeTruthy()
    expect(cfg.shopCode).toBe('ABCDEF')          // 失効時点の店舗へ紐付く
    expect(cfg.payload.order).toContain('新しい品目')
  })

  it('デバウンス中の在庫変更が、失効後もキューに残る', async () => {
    seedActiveSession()
    await mountApp()

    const { useInventory } = await import('./composables/useInventory.js')
    const { setItem } = useInventory()
    // 1回目は「30秒以上経過」扱いで即時送信されるため、デバウンス待ちを作るには2回要る
    setItem('トマト', 4, '個', false, 'tester')
    for (let i = 0; i < 4; i++) await nextTick()
    setItem('トマト', 5, '個', false, 'tester')
    for (let i = 0; i < 4; i++) await nextTick()

    authInvalidatedHandler()
    for (let i = 0; i < 6; i++) await nextTick()

    const inv = pendingSaves().find(e => e.kind === 'inventory')
    expect(inv).toBeTruthy()
    expect(inv.shopCode).toBe('ABCDEF')
    expect(inv.payload.inventory['トマト'].qty).toBe(5)
    expect(inv.payload.sessionId).toBe('sess-1')
  })
})
