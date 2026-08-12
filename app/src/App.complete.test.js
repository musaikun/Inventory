// DATA-001 — 棚卸完了がサーバーへ書けなかったときに作業状態を捨てない（App level）
//
// 純関数ではなく App をマウントして、完了ボタンを実際に押した結果を見る。
// 守りたいのは「サーバーに完了が記録されていないのに、端末側の作業状態だけが消えて、
// やり直す手段も無い」状態を作らないこと。
//
// 修正前の実装は completeSessionD1 が ok:false でもトーストを出すだけで、
// broadcastSessionEnd / dissolveRoom / _clearDraft / clearSession / 画面遷移 /
// 完了analytics をそのまま実行していた。
//
// 認証・セッションAPIはモックせず、localStorage のトークンと `utils/api.js` の
// apiFetch だけを差し替えて実経路（useAuth → useSession → App）を通す。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, nextTick } from 'vue'
import { STORAGE_KEYS } from './utils/storageKeys.js'

// ── apiFetch: パスごとに応答を決める。既定は成功 ──────────────────────────────
let completeShouldFail = false
let completeCalls = 0
let completeBodies = []
// 完了APIを保留させる（通信中の状態を作る）。null = 保留しない
let completeGate = null
// 完了APIの応答を差し替える（snapshotSaved を欠く応答など）
let completeResponse = null

vi.mock('./utils/api.js', () => ({
  // '' にすると useStore 側の D1 保存は no-op（本testの対象外）。
  // useAuth は HTTP_BASE を見ずに apiFetch を呼ぶので、完了経路はそのまま通る。
  HTTP_BASE: '',
  WS_BASE: '',
  apiFetch: vi.fn(async (path, options) => {
    if (path.endsWith('/complete')) {
      completeCalls++
      completeBodies.push(JSON.parse(options?.body ?? '{}'))
      if (completeGate) await completeGate
      if (completeShouldFail) {
        const err = new Error('サービスが一時的に利用できません')
        err.status = 503
        err.body   = { retryable: true }
        throw err
      }
      // snapshot を載せた完了は snapshotSaved:true が成功条件（handleSessionComplete の契約）
      return completeResponse ?? { ok: true, snapshotSaved: true }
    }
    // GET /store/:code — 空オブジェクトを返すと loadStore が shopCode を undefined で
    // 上書きし、以降の session API が「店舗コード無し」で黙って no-op になる。
    if (/\/store\/[A-Z0-9]+$/.test(path)) return { shopCode: 'ABCDEF', activeRoom: null, plan: 'free' }
    // 完了後はセッション一覧へ遷移する。配列を返さないと一覧の computed が落ちる
    if (/\/sessions(\?|$)/.test(path)) return []
    return {}
  }),
  setAuthInvalidatedHandler: vi.fn(),
}))
vi.mock('./utils/analytics.js', () => ({
  initAnalytics: vi.fn(), track: vi.fn(), resetAnalytics: vi.fn(),
}))

// ── 同期（ルーム）: 既定はソロ。ホスト経路のtestでフラグを立てる ────────────────
const syncIsActive = { value: false }
const syncIsHost   = { value: false }
const broadcastSessionEnd = vi.fn()
const dissolveRoom        = vi.fn(async () => {})

let sessionEndedCallback = null

vi.mock('./composables/useSync.js', async (importOriginal) => {
  const actual = await importOriginal()
  const { computed, reactive } = await import('vue')
  return {
    ...actual,
    setSessionEndedCallback: (fn) => { sessionEndedCallback = fn },
    broadcastSessionEnd,
    useSync: () => ({
      state: reactive({ error: '', connected: false, participants: [], messages: [] }),
      isActive: computed(() => syncIsActive.value),
      isHost:   computed(() => syncIsHost.value),
      participantList: computed(() => []),
      createRoom: vi.fn(), joinRoom: vi.fn(), leaveRoom: vi.fn(),
      dissolveRoom,
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

const SESSION = { id: 'sess-1', shopCode: 'ABCDEF', startedAt: '2026-08-09T00:00:00Z', status: 'active', itemCount: 1 }

async function mountApp() {
  localStorage.setItem(STORAGE_KEYS.authToken, 'test-token')
  localStorage.setItem(STORAGE_KEYS.shopCode, 'ABCDEF')
  localStorage.setItem(STORAGE_KEYS.pendingSession, JSON.stringify(SESSION))
  localStorage.setItem(STORAGE_KEYS.inventory, JSON.stringify({
    date:        new Date().toISOString().slice(0, 10),   // 当日でないと読み捨てられる
    data:        { トマト: { qty: 3, unit: '個', updatedAt: Date.now() } },
    recountFlags: {},
    entryLog:    ['トマト'],
    completedAt: null,
  }))

  const { default: App } = await import('./App.vue')
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp(App)
  app.mount(host)
  for (let i = 0; i < 8; i++) await nextTick()
  return host
}

const completeBtn = () => host.querySelector('.btn-complete')
const homeBtn     = () => host.querySelector('.home-btn')

async function settle(n = 12) { for (let i = 0; i < n; i++) await nextTick() }

async function clickComplete() {
  completeBtn().dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await settle()
}

const HISTORY_KEY = 'inventory_history_v1'
const historyEntries = () => Object.values(JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '{}'))

describe('App — 棚卸完了がサーバーへ書けなかったとき', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    completeShouldFail = false
    completeCalls = 0
    completeBodies = []
    completeGate = null
    completeResponse = null
    sessionEndedCallback = null
    syncIsActive.value = false
    syncIsHost.value   = false
    vi.stubGlobal('confirm', vi.fn(() => true))
    vi.stubGlobal('scrollTo', vi.fn())
  })
  afterEach(() => {
    if (app)  { app.unmount(); app = null }
    if (host) { host.remove();  host = null }
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('前提: 進行中セッションが復元され、完了ボタンが出ている', async () => {
    await mountApp()
    expect(completeBtn()).not.toBeNull()
    expect(completeBtn().textContent).toContain('完了')
  })

  it('ソロ: 完了保存に失敗したら画面を離れず、pendingSession を保持する', async () => {
    completeShouldFail = true
    await mountApp()
    await clickComplete()

    expect(completeCalls).toBe(1)
    // 棚卸画面に留まる＝完了ボタンがまだある
    expect(completeBtn()).not.toBeNull()
    // 読み取り専用にならない（「＋ 新規棚卸」へ切り替わっていない）
    expect(host.querySelector('.btn-new-session')).toBeNull()
    // 同じセッションを再試行できる
    expect(localStorage.getItem(STORAGE_KEYS.pendingSession)).toContain('sess-1')
  })

  it('ソロ: 完了保存に失敗したら完了analyticsを送らない', async () => {
    const { track } = await import('./utils/analytics.js')
    completeShouldFail = true
    await mountApp()
    await clickComplete()

    expect(track.mock.calls.filter(c => c[0] === 'session_completed')).toHaveLength(0)
  })

  it('ソロ: 再試行が成功したときだけ、後片付けと遷移が1回ずつ走る', async () => {
    const { track } = await import('./utils/analytics.js')
    completeShouldFail = true
    await mountApp()
    await clickComplete()
    expect(completeBtn()).not.toBeNull()      // 1回目は留まる

    completeShouldFail = false
    await clickComplete()

    expect(completeCalls).toBe(2)
    expect(completeBtn()).toBeNull()          // 一覧へ遷移した
    expect(localStorage.getItem(STORAGE_KEYS.pendingSession)).toBeNull()
    expect(track.mock.calls.filter(c => c[0] === 'session_completed')).toHaveLength(1)
  })

  it('ホスト: 完了保存に失敗したらルームを解散せず、終了通知も送らない', async () => {
    syncIsActive.value = true
    syncIsHost.value   = true
    completeShouldFail = true
    await mountApp()
    await clickComplete()

    expect(broadcastSessionEnd).not.toHaveBeenCalled()
    expect(dissolveRoom).not.toHaveBeenCalled()
    expect(completeBtn()).not.toBeNull()
  })

  it('ホスト: 成功時だけ終了通知と解散を各1回行う', async () => {
    syncIsActive.value = true
    syncIsHost.value   = true
    await mountApp()
    await clickComplete()

    expect(broadcastSessionEnd).toHaveBeenCalledTimes(1)
    expect(dissolveRoom).toHaveBeenCalledTimes(1)
    expect(completeBtn()).toBeNull()
  })
})

// ── サーバー成功前にローカルを確定しない（DATA-001 §1）───────────────────────
describe('App — 完了はサーバー成功後にだけローカルへ確定する', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    completeShouldFail = false
    completeCalls = 0
    completeBodies = []
    completeGate = null
    completeResponse = null
    sessionEndedCallback = null
    syncIsActive.value = false
    syncIsHost.value   = false
    vi.stubGlobal('confirm', vi.fn(() => true))
    vi.stubGlobal('scrollTo', vi.fn())
  })
  afterEach(() => {
    if (app)  { app.unmount(); app = null }
    if (host) { host.remove();  host = null }
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('完了APIが503でも入力画面・draft・sessionが残り、履歴だけが作られない', async () => {
    completeShouldFail = true
    await mountApp()
    // 下書きは入力時に作られている前提を作る（セッション単位の inv_draft_）
    localStorage.setItem('inv_draft_sess-1', JSON.stringify({ inv: { トマト: { qty: 3 } }, activeMs: 0 }))
    await clickComplete()

    // 入力画面に留まる（読み取り専用にもならない）
    expect(completeBtn()).not.toBeNull()
    expect(host.querySelector('.btn-new-session')).toBeNull()
    // draft と pendingSession は保持
    expect(localStorage.getItem('inv_draft_sess-1')).not.toBeNull()
    expect(localStorage.getItem(STORAGE_KEYS.pendingSession)).toContain('sess-1')
    // 端末側の完了マークも付かない
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.inventory)).completedAt).toBeNull()
    // **履歴が作られていない**（旧実装はAPI呼び出し前に書いていた）
    expect(historyEntries()).toHaveLength(0)
  })

  it('完了通信中にタブが閉じても、再起動後に同じセッションを再試行できる', async () => {
    // 応答を返さない = 通信中にタブが閉じた状況。この Promise は解決しない
    completeGate = new Promise(() => {})
    await mountApp()

    // 完了ボタンを押した直後＝完了APIの応答が返る前にタブが閉じる相当
    completeBtn().dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle(4)
    expect(completeCalls).toBe(1)

    // この時点の localStorage が、再起動後に読まれる内容
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.inventory)).completedAt).toBeNull()
    expect(localStorage.getItem(STORAGE_KEYS.pendingSession)).toContain('sess-1')
    expect(historyEntries()).toHaveLength(0)

    // 応答が返らないままタブが閉じる。再起動（同じ localStorage で App を作り直す）
    app.unmount(); app = null
    host.remove(); host = null
    vi.resetModules()
    completeGate = null
    completeCalls = 0
    const { default: App } = await import('./App.vue')
    host = document.createElement('div')
    document.body.appendChild(host)
    app = createApp(App)
    app.mount(host)
    await settle(8)

    // 進行中セッションとして復帰し、同じ sessionId で完了し直せる
    expect(completeBtn()).not.toBeNull()
    await clickComplete()
    expect(completeCalls).toBe(1)
    expect(completeBtn()).toBeNull()
  })

  it('snapshot を送ったのに保存されなければ完了扱いにしない', async () => {
    completeResponse = { ok: true }   // snapshotSaved が無い＝明細が入っていない
    await mountApp()
    await clickComplete()

    expect(completeBtn()).not.toBeNull()          // 画面に留まる
    expect(historyEntries()).toHaveLength(0)      // 履歴も作らない
    expect(localStorage.getItem(STORAGE_KEYS.pendingSession)).toContain('sess-1')
  })

  it('成功したら履歴が1件だけ作られ、サーバー確認済みとして記録される', async () => {
    await mountApp()
    await clickComplete()

    const entries = historyEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0].sessionId).toBe('sess-1')
    expect(entries[0].synced).toBe(true)
    expect(entries[0].dirty).toBe(false)
  })
})

// ── 完了要求は常に1本（DATA-001 §1）──────────────────────────────────────────
describe('App — 完了要求が二重に走らない', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    completeShouldFail = false
    completeCalls = 0
    completeBodies = []
    completeGate = null
    completeResponse = null
    sessionEndedCallback = null
    syncIsActive.value = false
    syncIsHost.value   = false
    vi.stubGlobal('confirm', vi.fn(() => true))
    vi.stubGlobal('scrollTo', vi.fn())
  })
  afterEach(() => {
    if (app)  { app.unmount(); app = null }
    if (host) { host.remove();  host = null }
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('完了ボタンの二重押しでも完了要求は1本', async () => {
    let release
    completeGate = new Promise(r => { release = r })
    await mountApp()

    completeBtn().dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle(2)
    completeBtn().dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle(2)

    release()
    await settle()
    expect(completeCalls).toBe(1)
    // 後片付けも1回だけ（履歴が2件に増えない）
    expect(historyEntries()).toHaveLength(1)
  })

  it('完了ボタン＋ホーム＋session_ended が競合しても完了要求は1本', async () => {
    syncIsActive.value = true
    syncIsHost.value   = true
    let release
    completeGate = new Promise(r => { release = r })
    await mountApp()
    expect(typeof sessionEndedCallback).toBe('function')

    // 1) 完了ボタン
    completeBtn().dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle(2)
    // 2) 完了通信中にホームを押す
    const home = homeBtn()
    if (home) home.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle(2)
    // 3) 同時にホスト自身の session_ended が届く
    const ended = sessionEndedCallback('completed', 'sess-1', 1)
    await settle(2)

    release()
    await Promise.resolve(ended).catch(() => {})
    await settle()

    expect(completeCalls).toBe(1)
    // 後片付けも1回だけ
    expect(broadcastSessionEnd).toHaveBeenCalledTimes(1)
    expect(dissolveRoom).toHaveBeenCalledTimes(1)
  })

  it('再試行は同じ sessionId・同じ内容で送る（サーバー側で冪等）', async () => {
    completeShouldFail = true
    await mountApp()
    await clickComplete()
    completeShouldFail = false
    await clickComplete()

    expect(completeBodies).toHaveLength(2)
    expect(completeBodies[0].inventory).toEqual(completeBodies[1].inventory)
    expect(completeBodies[0].snapshot.sessionId).toBe('sess-1')
    expect(completeBodies[1].snapshot.sessionId).toBe('sess-1')
    expect(completeBodies[0].snapshot.items).toEqual(completeBodies[1].snapshot.items)
  })
})

