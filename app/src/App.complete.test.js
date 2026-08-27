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
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
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
// サーバー側では完了しているのに応答だけ失われた状況を作る
let completeLosesResponse = false
// 別内容で既に確定済み（409 completion_intent_conflict）
let completeConflict = false
// PUT /sessions/:id（status 更新）の記録。active の書き戻しを検出する
let sessionUpdates = []
// GET /store/:code/sessions の応答（サーバー側の状態確認）
let serverSessions = []
// GET /store/:code/sessions を通信断にする（サーバーの状態を読めない = unreachable）
let sessionsUnreachable = false

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
      if (completeConflict) {
        const err = new Error('別の内容で完了済みです')
        err.status = 409
        err.code   = 'completion_intent_conflict'
        throw err
      }
      if (completeLosesResponse) {
        // サーバーは完了を書き終えている。返り道だけが切れた
        serverSessions = [{ id: 'sess-1', status: 'completed', itemCount: 1, type: 'stock' }]
        throw new Error('Network request failed')   // status を持たない = 結果不明
      }
      if (completeShouldFail) {
        const err = new Error('サービスが一時的に利用できません')
        err.status = 503
        err.body   = { retryable: true }
        throw err
      }
      // 契約は session 種別で分かれる（DATA-002 §1）。
      //   stock … snapshotSaved:true が成功条件
      //   order … `{ itemCount }` だけを受け取り snapshotSaved:false を返す
      const sent = completeBodies[completeBodies.length - 1]
      if (completeResponse) return completeResponse
      if (sent?.snapshot) return { ok: true, type: 'stock', snapshotSaved: true }
      return { ok: true, type: 'order', itemCount: sent?.itemCount ?? 0, snapshotSaved: false }
    }
    // PUT /store/:code/sessions/:id — active / completed の状態更新
    if (/\/sessions\/[^/]+$/.test(path) && options?.method === 'PUT') {
      sessionUpdates.push(JSON.parse(options?.body ?? '{}'))
      return { ok: true }
    }
    // GET /store/:code — 空オブジェクトを返すと loadStore が shopCode を undefined で
    // 上書きし、以降の session API が「店舗コード無し」で黙って no-op になる。
    if (/\/store\/[A-Z0-9]+$/.test(path)) return { shopCode: 'ABCDEF', activeRoom: null, plan: 'free' }
    // 完了後はセッション一覧へ遷移する。配列を返さないと一覧の computed が落ちる
    if (/\/sessions(\?|$)/.test(path)) {
      if (sessionsUnreachable) throw new Error('Network request failed')
      return serverSessions
    }
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
const leaveRoom           = vi.fn()
// 同期接続の世代（新しいルームを張ると進む）。App の解散遅延処理が参照する
let syncConnectionGen = 0

let sessionEndedCallback = null
let dissolvedCallback = null

vi.mock('./composables/useSync.js', async (importOriginal) => {
  const actual = await importOriginal()
  const { computed, reactive } = await import('vue')
  return {
    ...actual,
    setSessionEndedCallback: (fn) => { sessionEndedCallback = fn },
    setDissolvedCallback:    (fn) => { dissolvedCallback = fn },
    captureSyncConnection:   () => ({ gen: syncConnectionGen }),
    isSyncConnectionStale:   (t) => !t || t.gen !== syncConnectionGen,
    broadcastSessionEnd,
    useSync: () => ({
      state: reactive({ error: '', connected: false, participants: [], messages: [] }),
      isActive: computed(() => syncIsActive.value),
      isHost:   computed(() => syncIsHost.value),
      participantList: computed(() => []),
      createRoom: vi.fn(), joinRoom: vi.fn(), leaveRoom,
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

// App のモジュールグラフを先に温める。
// 初回 import は transform とモジュール評価で2秒以上かかり、これを test 本体で
// 支払うと既定の 5 秒 testTimeout の大半を食う（hook の既定は 10 秒）。
// 温めた直後に registry を捨てるので、各 test は毎回まっさらなモジュール状態から
// 始まる（transform 結果だけが再利用されて軽くなる）。
beforeAll(async () => { await import('./App.vue'); vi.resetModules() })

/** localStorage を「進行中セッションのある端末」の状態にする */
function seedDevice({ session = SESSION, inventory = { トマト: { qty: 3, unit: '個', updatedAt: Date.now() } } } = {}) {
  localStorage.setItem(STORAGE_KEYS.authToken, 'test-token')
  localStorage.setItem(STORAGE_KEYS.shopCode, 'ABCDEF')
  localStorage.setItem(STORAGE_KEYS.pendingSession, JSON.stringify(session))
  localStorage.setItem(STORAGE_KEYS.inventory, JSON.stringify({
    date:        new Date().toISOString().slice(0, 10),   // 当日でないと読み捨てられる
    data:        inventory,
    recountFlags: {},
    entryLog:    Object.keys(inventory),
    completedAt: null,
  }))
}

// App の非同期ハンドラで投げられた例外を受け取る。
// dev build の Vue は errorHandler が無いと再throwし、Promise chain の外へ出て
// runner の unhandled rejection になる（false positive の温床）。
// 握り潰さず配列へ集め、想定外のものが混ざっていないか afterEach で検査する。
let appErrors = []
const EXPECTED_ERRORS = ['dissolve failed']

async function mountOnly() {
  const { default: App } = await import('./App.vue')
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp(App)
  app.config.errorHandler = (err) => { appErrors.push(err) }
  app.mount(host)
  for (let i = 0; i < 8; i++) await nextTick()
  return host
}

/** 想定外の例外が出ていないか（各 afterEach から呼ぶ） */
function assertNoUnexpectedAppErrors() {
  const unexpected = appErrors.filter(e => !EXPECTED_ERRORS.includes(e?.message))
  expect(unexpected.map(e => e?.message ?? String(e))).toEqual([])
}

async function mountApp(opts) {
  seedDevice(opts)
  return mountOnly()
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
    completeLosesResponse = false
    completeConflict = false
    sessionUpdates = []
    serverSessions = []
    sessionsUnreachable = false
    sessionEndedCallback = null
    syncIsActive.value = false
    syncIsHost.value   = false
    vi.stubGlobal('confirm', vi.fn(() => true))
    vi.stubGlobal('scrollTo', vi.fn())
    appErrors = []
  })
  afterEach(() => {
    if (app)  { app.unmount(); app = null }
    if (host) { host.remove();  host = null }
    vi.unstubAllGlobals()
    vi.resetModules()
    assertNoUnexpectedAppErrors()
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
    completeLosesResponse = false
    completeConflict = false
    sessionUpdates = []
    serverSessions = []
    sessionsUnreachable = false
    sessionEndedCallback = null
    syncIsActive.value = false
    syncIsHost.value   = false
    vi.stubGlobal('confirm', vi.fn(() => true))
    vi.stubGlobal('scrollTo', vi.fn())
    appErrors = []
  })
  afterEach(() => {
    if (app)  { app.unmount(); app = null }
    if (host) { host.remove();  host = null }
    vi.unstubAllGlobals()
    vi.resetModules()
    assertNoUnexpectedAppErrors()
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
    completeLosesResponse = false
    completeConflict = false
    sessionUpdates = []
    serverSessions = []
    sessionsUnreachable = false
    sessionEndedCallback = null
    syncIsActive.value = false
    syncIsHost.value   = false
    vi.stubGlobal('confirm', vi.fn(() => true))
    vi.stubGlobal('scrollTo', vi.fn())
    appErrors = []
  })
  afterEach(() => {
    if (app)  { app.unmount(); app = null }
    if (host) { host.remove();  host = null }
    vi.unstubAllGlobals()
    vi.resetModules()
    assertNoUnexpectedAppErrors()
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

// ── 完了処理中の離脱（第2セッション §1）──────────────────────────────────────
//
// 完了要求の送信中は isCompleted がまだ false のため、ホームを押すと
// markSessionActive() が `PUT /sessions/:id {status:'active'}` を送っていた。
// 完了APIより後に届けば、サーバー側で確定した completed が active へ巻き戻る
// （明細と履歴を持ったまま「進行中」に見えるセッションになる）。
describe('App — 完了処理中に離脱しようとしても active を書き戻さない', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    completeShouldFail = false
    completeCalls = 0
    completeBodies = []
    completeGate = null
    completeResponse = null
    completeLosesResponse = false
    completeConflict = false
    sessionUpdates = []
    serverSessions = []
    sessionsUnreachable = false
    sessionEndedCallback = null
    syncIsActive.value = false
    syncIsHost.value   = false
    vi.stubGlobal('confirm', vi.fn(() => true))
    vi.stubGlobal('scrollTo', vi.fn())
    appErrors = []
  })
  afterEach(() => {
    if (app)  { app.unmount(); app = null }
    if (host) { host.remove();  host = null }
    vi.unstubAllGlobals()
    vi.resetModules()
    assertNoUnexpectedAppErrors()
  })

  it('完了送信の直後にホームを押しても active 要求は0件', async () => {
    let release
    completeGate = new Promise(r => { release = r })
    await mountApp()

    completeBtn().dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle(2)
    homeBtn().dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle(2)

    // 完了中は画面を離れない
    expect(completeBtn()).not.toBeNull()
    expect(sessionUpdates.filter(u => u.status === 'active')).toHaveLength(0)

    release()
    await settle()
    expect(completeCalls).toBe(1)
    expect(sessionUpdates.filter(u => u.status === 'active')).toHaveLength(0)
  })

  it('完了中はブラウザバックでも離脱しない', async () => {
    let release
    completeGate = new Promise(r => { release = r })
    await mountApp()

    completeBtn().dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle(2)
    window.dispatchEvent(new PopStateEvent('popstate'))
    await settle(2)

    expect(completeBtn()).not.toBeNull()
    expect(sessionUpdates.filter(u => u.status === 'active')).toHaveLength(0)

    release()
    await settle()
  })

  it('完了中はホームボタンが無効になっている', async () => {
    completeGate = new Promise(() => {})
    await mountApp()

    expect(homeBtn().disabled).toBe(false)
    completeBtn().dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle(3)
    expect(homeBtn().disabled).toBe(true)
    expect(completeBtn().disabled).toBe(true)
  })

  it('サーバーで完了した後に応答が失われても active を送らない', async () => {
    completeLosesResponse = true
    await mountApp()
    await clickComplete()

    // 結果不明。画面に留まり、履歴も確定しない
    expect(completeBtn()).not.toBeNull()
    expect(historyEntries()).toHaveLength(0)
    expect(sessionUpdates.filter(u => u.status === 'active')).toHaveLength(0)

    // 不明のままホームを押しても active は飛ばない。
    // サーバー状態を確認し、同じ完了要求を送り直して収束する
    completeLosesResponse = false
    homeBtn().dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle(16)

    expect(sessionUpdates.filter(u => u.status === 'active')).toHaveLength(0)
    expect(completeCalls).toBe(2)
    expect(completeBodies[0].snapshot.sessionId).toBe(completeBodies[1].snapshot.sessionId)
    expect(completeBtn()).toBeNull()             // 一覧へ遷移した
    expect(historyEntries()).toHaveLength(1)
  })

  it('結果不明のまま再度「完了」を押しても要求は増えず収束する', async () => {
    completeLosesResponse = true
    await mountApp()
    await clickComplete()
    expect(completeCalls).toBe(1)

    completeLosesResponse = false
    await clickComplete()

    expect(completeCalls).toBe(2)
    expect(completeBtn()).toBeNull()
    expect(historyEntries()).toHaveLength(1)
    expect(sessionUpdates.filter(u => u.status === 'active')).toHaveLength(0)
  })
})

// ── 本番の完了経路はすべて同じ payload を作る（第2セッション §2）─────────────
describe('App — snapshot なしで完了APIを呼ぶ経路が無い', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    completeShouldFail = false
    completeCalls = 0
    completeBodies = []
    completeGate = null
    completeResponse = null
    completeLosesResponse = false
    completeConflict = false
    sessionUpdates = []
    serverSessions = []
    sessionsUnreachable = false
    sessionEndedCallback = null
    syncIsActive.value = false
    syncIsHost.value   = false
    vi.stubGlobal('confirm', vi.fn(() => true))
    vi.stubGlobal('scrollTo', vi.fn())
    appErrors = []
  })
  afterEach(() => {
    if (app)  { app.unmount(); app = null }
    if (host) { host.remove();  host = null }
    vi.unstubAllGlobals()
    vi.resetModules()
    assertNoUnexpectedAppErrors()
  })

  it('session_ended（ホスト自身の完了通知）も snapshot 付きで送る', async () => {
    syncIsActive.value = true
    syncIsHost.value   = true
    await mountApp()
    expect(typeof sessionEndedCallback).toBe('function')

    await sessionEndedCallback('completed', 'sess-1', 1)
    await settle()

    expect(completeCalls).toBe(1)
    expect(completeBodies[0].snapshot).toBeTruthy()
    expect(completeBodies[0].snapshot.sessionId).toBe('sess-1')
    expect(completeBodies[0].snapshot.items.length).toBeGreaterThan(0)
  })

  it('完了済みセッションをホームで離れる経路も snapshot 付きで送る', async () => {
    // 完了は成立したのに後片付けの途中（ルーム解散）で止まり、
    // 「完了済み表示のまま棚卸画面に残る」状態を作る。この画面のホームが
    // 以前 snapshot 無しで完了APIを呼んでいた経路。
    syncIsActive.value = true
    syncIsHost.value   = true
    dissolveRoom.mockRejectedValueOnce(new Error('dissolve failed'))
    await mountApp()
    await clickComplete()

    expect(completeCalls).toBe(1)
    expect(host.querySelector('.btn-new-session')).not.toBeNull()   // 完了済み表示
    expect(localStorage.getItem(STORAGE_KEYS.pendingSession)).toContain('sess-1')

    // サーバー側は完了済み（端末側の確定だけが途中で止まっている）
    serverSessions = [{ id: 'sess-1', status: 'completed', itemCount: 1, type: 'stock' }]
    homeBtn().dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle(16)

    // 2本目も**保存済みの同じ body**（snapshot 付き）で送っている
    expect(completeCalls).toBe(2)
    expect(completeBodies[1]).toEqual(completeBodies[0])
    expect(completeBodies[1].snapshot).toBeTruthy()
    expect(completeBodies[1].snapshot.sessionId).toBe('sess-1')
    expect(completeBodies[1].snapshot.items.length).toBeGreaterThan(0)
    // 完了済みを active へ戻さない
    expect(sessionUpdates.filter(u => u.status === 'active')).toHaveLength(0)
  })

  // 結果不明のあいだ画面に閉じ込めない。サーバーが落ちている・通信が切れている間ずっと
  // 出られないのは、入力も再送用の body も端末に残っていることを考えると重すぎる。
  describe('結果不明のまま一覧へ戻れる', () => {
    it('サーバーへ届かないときは確認のうえ離脱できる', async () => {
      vi.stubGlobal('confirm', vi.fn(() => true))
      completeLosesResponse = true
      await mountApp()
      await clickComplete()          // 応答喪失 → 結果不明
      expect(homeBtn()).not.toBeNull()

      sessionsUnreachable = true
      homeBtn().dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await settle(16)

      // 一覧へ出ている（セッション画面ではない）
      expect(completeBtn()).toBeNull()
      // **active は書かない**（サーバーが完了を記録済みなら巻き戻してしまう）
      expect(sessionUpdates.filter(u => u.status === 'active')).toHaveLength(0)
      // **再送用の body と session は残す**（同じ内容で確定し直せる）
      expect(localStorage.getItem(STORAGE_KEYS.completionIntent)).toContain('sess-1')
      expect(localStorage.getItem(STORAGE_KEYS.pendingSession)).toContain('sess-1')
    })

    it('確認をキャンセルしたら留まる', async () => {
      // 完了ボタン自身の confirm は通し、離脱の confirm だけ断る
      vi.stubGlobal('confirm', vi.fn(msg => !String(msg).includes('一覧に戻りますか')))
      completeLosesResponse = true
      await mountApp()
      await clickComplete()

      sessionsUnreachable = true
      homeBtn().dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await settle(16)

      expect(completeBtn()).not.toBeNull()
    })

    it('サーバーは読めたが該当セッションが無い場合は離脱を勧めない', async () => {
      vi.stubGlobal('confirm', vi.fn(() => true))
      completeLosesResponse = true
      await mountApp()
      await clickComplete()

      serverSessions = []            // 読めるが not_found
      homeBtn().dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await settle(16)

      // 通信の問題ではないので、通信復帰を促す離脱確認は出さない
      // （confirm は完了ボタンの「棚卸を完了しますか？」で既に1回使われている）
      expect(completeBtn()).not.toBeNull()
      const asked = globalThis.confirm.mock.calls.map(c => String(c[0]))
      expect(asked.some(t => t.includes('一覧に戻りますか'))).toBe(false)
    })
  })

  it('完了済みセッションのホームが失敗しても active へ戻さない', async () => {
    syncIsActive.value = true
    syncIsHost.value   = true
    dissolveRoom.mockRejectedValueOnce(new Error('dissolve failed'))
    await mountApp()
    await clickComplete()

    completeShouldFail = true
    homeBtn().dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle(16)

    // 画面に留まり、完了済みのまま。active も送らない
    expect(host.querySelector('.btn-new-session')).not.toBeNull()
    expect(sessionUpdates.filter(u => u.status === 'active')).toHaveLength(0)
    expect(localStorage.getItem(STORAGE_KEYS.pendingSession)).toContain('sess-1')
  })

  // 発注は `{ itemCount }` だけを完了APIへ送る（DATA-002 §1 order）。
  // 汎用 PUT で completed にすると server が 409 use_complete_endpoint を返し、
  // snapshot / 非空 inventory を送ると 400 snapshot_not_allowed になる。
  it('発注のみのセッションは itemCount だけを完了APIへ送る', async () => {
    localStorage.setItem('order_draft_ord_sess-2', JSON.stringify({
      トマト: { orderQty: 2, unit: '箱', stock: null, lot: '' },
    }))
    await mountApp({
      session: { id: 'sess-2', shopCode: 'ABCDEF', startedAt: '2026-08-09T00:00:00Z', status: 'active', itemCount: 0, type: 'order' },
      inventory: {},
    })

    expect(completeBtn()).not.toBeNull()
    await clickComplete()

    expect(completeCalls).toBe(1)
    expect(completeBodies[0]).toEqual({ itemCount: 1 })
    // 汎用 PUT で completed にしない
    expect(sessionUpdates.filter(u => u.status === 'completed')).toHaveLength(0)
    expect(completeBtn()).toBeNull()             // 一覧へ遷移した
    expect(historyEntries()).toHaveLength(0)     // 中身の無い履歴を作らない
  })

  it('発注セッションで在庫も入力していても snapshot / inventory を送らない', async () => {
    localStorage.setItem('order_draft_ord_sess-2', JSON.stringify({
      トマト: { orderQty: 2, unit: '箱', stock: null, lot: '' },
    }))
    await mountApp({
      session: { id: 'sess-2', shopCode: 'ABCDEF', startedAt: '2026-08-09T00:00:00Z', status: 'active', itemCount: 0, type: 'order' },
      inventory: { トマト: { qty: 3, unit: '個', updatedAt: Date.now() } },
    })
    await clickComplete()

    expect(completeCalls).toBe(1)
    expect(completeBodies[0]).not.toHaveProperty('snapshot')
    expect(completeBodies[0]).not.toHaveProperty('inventory')
    expect(completeBodies[0]).toEqual({ itemCount: 1 })
  })

  it('棚卸で明細が組み立てられない場合は完了APIを呼ばない', async () => {
    // 在庫が空のまま session_ended が届く（ゲスト在庫が同期されていない等）
    await mountApp({ inventory: {} })
    await sessionEndedCallback?.('completed', 'sess-1', 0)
    await settle()

    expect(completeCalls).toBe(0)
    expect(sessionUpdates.filter(u => u.status === 'completed')).toHaveLength(0)
  })
})

// ── 再送は同じ body（第2セッション §7 / 409 completion_intent_conflict）──────
//
// server は canonical snapshot 全体から fingerprint を作り、内容が違う再送を
// 409 で拒否する（除外は savedAt / activeMs だけ）。応答を取りこぼした要求が
// サーバー側で確定していた場合、組み立て直した body では二度と確定できない。
describe('App — 結果不明のあとは同じ内容で再送する', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    completeShouldFail = false
    completeCalls = 0
    completeBodies = []
    completeGate = null
    completeResponse = null
    completeLosesResponse = false
    completeConflict = false
    sessionUpdates = []
    serverSessions = []
    sessionsUnreachable = false
    sessionEndedCallback = null
    syncIsActive.value = false
    syncIsHost.value   = false
    vi.stubGlobal('confirm', vi.fn(() => true))
    vi.stubGlobal('scrollTo', vi.fn())
    appErrors = []
  })
  afterEach(() => {
    if (app)  { app.unmount(); app = null }
    if (host) { host.remove();  host = null }
    vi.unstubAllGlobals()
    vi.resetModules()
    assertNoUnexpectedAppErrors()
  })

  it('結果不明のあとに入力を変えても、再送の body は1回目と同一', async () => {
    completeLosesResponse = true
    await mountApp()
    await clickComplete()
    expect(completeCalls).toBe(1)

    // 結果不明のまま端末側で入力を変える
    const { useInventory } = await import('./composables/useInventory.js')
    useInventory().setItem('トマト', 99, '個', false, 'tester')
    await settle(4)

    completeLosesResponse = false
    await clickComplete()

    expect(completeCalls).toBe(2)
    // fingerprint が一致しないと 409 になるため、1文字も変えずに送る
    expect(completeBodies[1]).toEqual(completeBodies[0])
    expect(completeBtn()).toBeNull()   // 確定して一覧へ
  })

  it('サーバーが拒否した失敗（4xx）のあとは、最新の入力で組み立て直す', async () => {
    completeResponse = { ok: true, type: 'stock' }   // snapshotSaved を欠く = 明確な失敗
    await mountApp()
    await clickComplete()
    expect(completeCalls).toBe(1)

    const { useInventory } = await import('./composables/useInventory.js')
    useInventory().setItem('トマト', 42, '個', false, 'tester')
    await settle(4)

    completeResponse = null
    await clickComplete()

    expect(completeCalls).toBe(2)
    expect(completeBodies[1].inventory['トマト'].qty).toBe(42)
    expect(completeBodies[1]).not.toEqual(completeBodies[0])
  })

  it('409 completion_intent_conflict は再送せず、active も書かない', async () => {
    await mountApp()
    // 別内容で確定済み（共有モックのフラグ。実装を差し替えると後続testへ漏れる）
    completeConflict = true

    await clickComplete()
    expect(completeCalls).toBe(1)
    // 履歴は端末へ確定しない（サーバーの内容が正）
    expect(historyEntries()).toHaveLength(0)

    // ホームで離脱できる。active は1件も送らない
    homeBtn().dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle(16)
    expect(sessionUpdates.filter(u => u.status === 'active')).toHaveLength(0)
    expect(completeCalls).toBe(1)   // 再送しない
  })
})

// ── レビュー指摘の回帰（第2セッション 追補）──────────────────────────────────
describe('App — 完了結果不明・session_ended・入力ロック', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    completeShouldFail = false
    completeCalls = 0
    completeBodies = []
    completeGate = null
    completeResponse = null
    completeLosesResponse = false
    completeConflict = false
    sessionUpdates = []
    serverSessions = []
    sessionsUnreachable = false
    sessionEndedCallback = null
    syncIsActive.value = false
    syncIsHost.value   = false
    vi.stubGlobal('confirm', vi.fn(() => true))
    vi.stubGlobal('scrollTo', vi.fn())
    appErrors = []
  })
  afterEach(() => {
    if (app)  { app.unmount(); app = null }
    if (host) { host.remove();  host = null }
    vi.unstubAllGlobals()
    vi.resetModules()
    assertNoUnexpectedAppErrors()
  })

  // 指摘1: 結果不明がメモリだけだと、再読込で active セッションとして復帰し、
  // 組み立て直した body では 409 になって二度と確定できない。
  it('応答喪失のあと再読込しても、同じ body で再送する', async () => {
    completeLosesResponse = true
    await mountApp()
    await clickComplete()
    expect(completeCalls).toBe(1)
    const sentBody = completeBodies[0]

    // 再読込（同じ localStorage で App を作り直す）
    app.unmount(); app = null
    host.remove(); host = null
    vi.resetModules()
    completeLosesResponse = false
    await mountOnly()

    // 進行中セッションとして復帰し、完了ボタンが出ている
    expect(completeBtn()).not.toBeNull()
    await clickComplete()

    expect(completeCalls).toBe(2)
    expect(completeBodies[1]).toEqual(sentBody)     // 1文字も変えずに再送
    expect(sessionUpdates.filter(u => u.status === 'active')).toHaveLength(0)
  })

  it('再読込直後にホームを押しても active を送らない', async () => {
    completeLosesResponse = true
    await mountApp()
    await clickComplete()

    app.unmount(); app = null
    host.remove(); host = null
    vi.resetModules()
    await mountOnly()

    homeBtn().dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle(16)
    expect(sessionUpdates.filter(u => u.status === 'active')).toHaveLength(0)
  })

  // 指摘3: 完了中・結果不明中に入力できると、キャッシュした body と画面がずれる。
  it('完了中は入力できない', async () => {
    completeGate = new Promise(() => {})
    await mountApp()
    expect(host.querySelector('.voice-section')).not.toBeNull()

    completeBtn().dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle(4)
    expect(host.querySelector('.voice-section')).toBeNull()
  })

  it('結果不明のあいだも入力できない', async () => {
    completeLosesResponse = true
    await mountApp()
    await clickComplete()
    expect(host.querySelector('.voice-section')).toBeNull()
  })

  // 指摘5: 古いルームから遅延した session_ended が、いま開いているセッションを完了させない。
  it('別セッションの session_ended では完了しない', async () => {
    syncIsActive.value = true
    syncIsHost.value   = true
    await mountApp()

    await sessionEndedCallback('completed', 'sess-OLD', 1)
    await settle()

    expect(completeCalls).toBe(0)
    expect(sessionUpdates).toHaveLength(0)
    expect(completeBtn()).not.toBeNull()
  })

  it('sessionId を持たない session_ended でも完了しない（fail-closed）', async () => {
    syncIsActive.value = true
    syncIsHost.value   = true
    await mountApp()

    await sessionEndedCallback('completed', '', 1)
    await settle()

    expect(completeCalls).toBe(0)
  })

  it('同じセッションの session_ended は従来どおり完了する', async () => {
    syncIsActive.value = true
    syncIsHost.value   = true
    await mountApp()

    await sessionEndedCallback('completed', 'sess-1', 1)
    await settle()

    expect(completeCalls).toBe(1)
    expect(completeBodies[0].snapshot.sessionId).toBe('sess-1')
  })
})

// ══ 再レビュー: 送信前のdurable化と、保存済みbodyでの収束（App level）═════════
describe('App — 送信中に端末が落ちても保存済みbodyで収束する', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    completeShouldFail = false
    completeCalls = 0
    completeBodies = []
    completeGate = null
    completeResponse = null
    completeLosesResponse = false
    completeConflict = false
    sessionUpdates = []
    serverSessions = []
    sessionsUnreachable = false
    sessionEndedCallback = null
    syncIsActive.value = false
    syncIsHost.value   = false
    vi.stubGlobal('confirm', vi.fn(() => true))
    vi.stubGlobal('scrollTo', vi.fn())
    appErrors = []
  })
  afterEach(() => {
    if (app)  { app.unmount(); app = null }
    if (host) { host.remove();  host = null }
    vi.unstubAllGlobals()
    vi.resetModules()
    assertNoUnexpectedAppErrors()
  })

  const savedIntent = () => {
    const raw = localStorage.getItem(STORAGE_KEYS.completionIntent)
    return raw ? JSON.parse(raw) : null
  }

  /** 応答が返らないまま端末が落ちる（catch も finally も走らない） */
  async function crashDuringComplete() {
    completeGate = new Promise(() => {})       // resolve も reject もしない
    await mountApp()
    completeBtn().dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle(4)
  }

  it('APIの応答を待っている時点で、完全なbodyが端末に残っている', async () => {
    await crashDuringComplete()

    expect(completeCalls).toBe(1)
    const saved = savedIntent()
    expect(saved).not.toBeNull()
    expect(saved.body).toEqual(completeBodies[0])   // 送ったものと同一
    expect(saved.body.snapshot.items.length).toBeGreaterThan(0)
    // 端末側はまだ何も確定していない
    expect(historyEntries()).toHaveLength(0)
    expect(localStorage.getItem(STORAGE_KEYS.pendingSession)).toContain('sess-1')
  })

  it('再読込後、現在の在庫が送信時と違っても保存済みbodyで再送する', async () => {
    await crashDuringComplete()
    const sentBody = completeBodies[0]

    // 端末が落ちて再起動。復帰後の在庫は送信時と違う（数量が変わっている）
    app.unmount(); app = null
    host.remove(); host = null
    vi.resetModules()
    completeGate = null
    const inv = JSON.parse(localStorage.getItem(STORAGE_KEYS.inventory))
    inv.data['トマト'].qty = 99
    localStorage.setItem(STORAGE_KEYS.inventory, JSON.stringify(inv))
    await mountOnly()

    await clickComplete()

    // 送るのは保存済みの版。現在の在庫（99）から作り直さない
    expect(completeCalls).toBe(2)
    expect(completeBodies[1]).toEqual(sentBody)
    expect(completeBodies[1].inventory['トマト'].qty).toBe(3)
    // 履歴も送った版で確定する
    const entry = historyEntries()[0]
    expect(entry.items.find(i => i.item === 'トマト').qty).toBe(3)
    // 端末側の確定が終わったので保存分は消える
    expect(savedIntent()).toBeNull()
  })

  it('再読込後、在庫が失われていても保存済みbodyから収束できる', async () => {
    await crashDuringComplete()
    const sentBody = completeBodies[0]

    app.unmount(); app = null
    host.remove(); host = null
    vi.resetModules()
    completeGate = null
    localStorage.removeItem(STORAGE_KEYS.inventory)   // 在庫キャッシュが消えた端末
    await mountOnly()

    // 在庫が無いので完了ボタンは出ない。ホーム経由で結果不明の収束へ入る
    serverSessions = [{ id: 'sess-1', status: 'completed', itemCount: 1, type: 'stock' }]
    const home = homeBtn()
    expect(home).not.toBeNull()
    home.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle(20)

    expect(completeCalls).toBe(2)
    expect(completeBodies[1]).toEqual(sentBody)
    expect(historyEntries()).toHaveLength(1)
    expect(savedIntent()).toBeNull()
    expect(sessionUpdates.filter(u => u.status === 'active')).toHaveLength(0)
  })

  it('API成功後・履歴確定前に落ちても、保存済みbodyから再開できる', async () => {
    // 履歴確定の直前で失敗させる（ホストのルーム解散が失敗して後片付けが止まる）
    syncIsActive.value = true
    syncIsHost.value   = true
    dissolveRoom.mockRejectedValueOnce(new Error('dissolve failed'))
    await mountApp()
    await clickComplete()

    // API は成功しているが、後片付けが終わっていないので保存分は残る
    expect(completeCalls).toBe(1)
    expect(savedIntent()).not.toBeNull()
    expect(savedIntent().phase).toBe('confirmed')
  })

  it('端末へ保存できないときは完了APIを呼ばない（入力は残す）', async () => {
    await mountApp()
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (k, v) {
      if (k === STORAGE_KEYS.completionIntent) throw new DOMException('QuotaExceededError')
      return Storage.prototype.setItem.wrappedMethod.call(this, k, v)
    })
    await clickComplete()
    setItem.mockRestore()

    expect(completeCalls).toBe(0)
    // 画面に留まり、入力・セッションは残る
    expect(completeBtn()).not.toBeNull()
    expect(host.querySelector('.btn-new-session')).toBeNull()
    expect(localStorage.getItem(STORAGE_KEYS.pendingSession)).toContain('sess-1')
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.inventory)).data['トマト'].qty).toBe(3)
    expect(historyEntries()).toHaveLength(0)
  })
})

// ══ 再レビュー: await をまたいだ後の stale 再確認（App level）══════════════════
//
// 完了APIやルーム解散を待っている間にアカウント・セッションが切り替わると、
// 旧 callback の続きが**現在のアカウントの作業**を消せる。
describe('App — awaitをまたいだ旧処理が現在のセッションを壊さない', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    completeShouldFail = false
    completeCalls = 0
    completeBodies = []
    completeGate = null
    completeResponse = null
    completeLosesResponse = false
    completeConflict = false
    sessionUpdates = []
    serverSessions = []
    sessionsUnreachable = false
    sessionEndedCallback = null
    syncIsActive.value = false
    syncIsHost.value   = false
    vi.stubGlobal('confirm', vi.fn(() => true))
    vi.stubGlobal('scrollTo', vi.fn())
    appErrors = []
  })
  afterEach(() => {
    if (app)  { app.unmount(); app = null }
    if (host) { host.remove();  host = null }
    vi.unstubAllGlobals()
    vi.resetModules()
    assertNoUnexpectedAppErrors()
  })

  const OTHER = { id: 'sess-2', shopCode: 'ABCDEF', startedAt: '2026-08-10T00:00:00Z', status: 'active', itemCount: 1 }

  /** 待機中に別セッションへ移る（アカウント切替と同じく lifecycle 世代が進む） */
  async function switchSession() {
    const { useSession } = await import('./composables/useSession.js')
    useSession().begin({ ...OTHER })
    await settle(2)
  }

  const savedSession = () => localStorage.getItem(STORAGE_KEYS.pendingSession)

  // ゲスト経路は完了APIの await のあとに leaveRoom() する。待機中に別セッションへ
  // 移っていると、**いま参加しているルーム**を閉じてしまう。
  it('session_ended: 完了APIの待機中に別セッションへ移ったら退出処理をしない', async () => {
    syncIsActive.value = true
    syncIsHost.value   = false      // ゲスト（mount 前に決める。mock は非reactive）
    let release
    completeGate = new Promise(r => { release = r })
    await mountApp()

    const ended = sessionEndedCallback('completed', 'sess-1', 1)
    await settle(3)
    expect(completeCalls).toBe(1)

    // 応答を待っている間に別セッションへ移る
    await switchSession()
    leaveRoom.mockClear()

    release()
    await Promise.resolve(ended).catch(() => {})
    await settle(8)

    // いまのルーム・セッションには手を出さない
    expect(leaveRoom).not.toHaveBeenCalled()
    expect(savedSession()).toContain('sess-2')
  })

  it('session_ended: 待機中に別セッションへ移ったら完了通知も出さない', async () => {
    syncIsActive.value = true
    syncIsHost.value   = true       // ホスト自身の通知
    let release
    completeGate = new Promise(r => { release = r })
    await mountApp()

    const ended = sessionEndedCallback('completed', 'sess-1', 1)
    await settle(3)

    await switchSession()

    release()
    await Promise.resolve(ended).catch(() => {})
    await settle(8)

    // 別セッションの通知を、いま開いているセッションの完了として見せない
    const toast = host.querySelector('.toast')?.textContent ?? ''
    expect(toast).not.toContain('棚卸セッションが完了しました')
    expect(savedSession()).toContain('sess-2')
  })

  it('_finishSession: ルーム解散の待機中に別セッションへ移ったら、現在のセッションをclearしない', async () => {
    syncIsActive.value = true
    syncIsHost.value   = true
    let releaseDissolve
    dissolveRoom.mockImplementationOnce(() => new Promise(r => { releaseDissolve = r }))
    await mountApp()

    completeBtn().dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle(8)
    expect(completeCalls).toBe(1)

    // 解散の応答を待っている間に別セッションへ移る
    await switchSession()

    releaseDissolve()
    await settle(12)

    // 現在（sess-2）のセッション参照が消されていない
    expect(savedSession()).toContain('sess-2')
  })

  it('端末へ保存できない理由を専用の文言で説明する', async () => {
    await mountApp()
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (k, v) {
      if (k === STORAGE_KEYS.completionIntent) throw new DOMException('QuotaExceededError')
      return Storage.prototype.setItem.wrappedMethod.call(this, k, v)
    })
    await clickComplete()
    setItem.mockRestore()

    expect(completeCalls).toBe(0)
    const toast = host.querySelector('.toast')?.textContent ?? ''
    expect(toast).toContain('この端末')
    expect(toast).not.toContain('サーバーへ完了を記録できませんでした')
  })
})

// ══ 再レビュー2: 遅延処理と不一致通知（App level）═════════════════════════════
describe('App — 遅延した解散処理・不一致通知が現在の作業を消さない', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    completeShouldFail = false
    completeCalls = 0
    completeBodies = []
    completeGate = null
    completeResponse = null
    completeLosesResponse = false
    completeConflict = false
    sessionUpdates = []
    serverSessions = []
    sessionsUnreachable = false
    sessionEndedCallback = null
    dissolvedCallback = null
    syncIsActive.value = false
    syncIsHost.value   = false
    syncConnectionGen  = 0
    vi.stubGlobal('confirm', vi.fn(() => true))
    vi.stubGlobal('scrollTo', vi.fn())
    appErrors = []
  })
  afterEach(() => {
    if (app)  { app.unmount(); app = null }
    if (host) { host.remove();  host = null }
    vi.unstubAllGlobals()
    vi.useRealTimers()
    vi.resetModules()
    assertNoUnexpectedAppErrors()
  })

  const OTHER = { id: 'sess-2', shopCode: 'ABCDEF', startedAt: '2026-08-10T00:00:00Z', status: 'active', itemCount: 1 }
  const savedSession = () => localStorage.getItem(STORAGE_KEYS.pendingSession)

  async function switchSession() {
    const { useSession } = await import('./composables/useSession.js')
    useSession().begin({ ...OTHER })
    await settle(2)
  }

  // 指摘3: 解散通知の 3.5 秒後に無条件で clearSession()/reset()/landing を実行していた
  it('解散通知の遅延処理は、待機中に別セッションへ移ったら実行しない', async () => {
    vi.useFakeTimers()
    syncIsActive.value = true
    await mountApp()
    expect(typeof dissolvedCallback).toBe('function')

    dissolvedCallback()          // ホスト以外による解散 → 3.5秒後に片付ける
    await settle(2)

    await switchSession()        // 待機中に別セッションを開始
    const invBefore = localStorage.getItem(STORAGE_KEYS.inventory)

    vi.advanceTimersByTime(4000)
    await settle(4)

    // 現在のセッション・入力は消えない
    expect(savedSession()).toContain('sess-2')
    expect(localStorage.getItem(STORAGE_KEYS.inventory)).toBe(invBefore)
  })

  it('解散通知の遅延処理は、切り替えが無ければ従来どおり片付ける', async () => {
    vi.useFakeTimers()
    syncIsActive.value = true
    await mountApp()

    dissolvedCallback()
    await settle(2)
    vi.advanceTimersByTime(4000)
    await settle(4)

    expect(savedSession()).toBeNull()
  })

  // 指摘4: sessionId 不一致・欠落でも guest 分岐へ進み、現在のルームを退出していた
  it('別セッションの session_ended では退出も通知もしない', async () => {
    syncIsActive.value = true
    syncIsHost.value   = false
    await mountApp()
    leaveRoom.mockClear()

    await sessionEndedCallback('completed', 'sess-OLD', 1)
    await settle(6)

    expect(leaveRoom).not.toHaveBeenCalled()
    expect(completeCalls).toBe(0)
    expect(host.querySelector('.toast')).toBeNull()
    expect(savedSession()).toContain('sess-1')
  })

  it('sessionId を持たない session_ended でも退出しない（fail-closed）', async () => {
    syncIsActive.value = true
    syncIsHost.value   = false
    await mountApp()
    leaveRoom.mockClear()

    await sessionEndedCallback('completed', '', 1)
    await settle(6)

    expect(leaveRoom).not.toHaveBeenCalled()
    expect(completeCalls).toBe(0)
  })

  // 自分のセッションを持たないゲストは、従来どおりホストの完了で退出する
  it('自分のセッションを持たないゲストは、ホストの完了で退出する', async () => {
    syncIsActive.value = true
    syncIsHost.value   = false
    localStorage.clear()
    localStorage.setItem(STORAGE_KEYS.shopCode, 'ABCDEF')
    await mountOnly()
    leaveRoom.mockClear()

    await sessionEndedCallback('completed', 'host-session', 1)
    await settle(6)

    expect(leaveRoom).toHaveBeenCalledTimes(1)
    expect(completeCalls).toBe(0)
  })
})

// ══ 再レビュー3 §2: 同じsessionのまま新しいルームを作った場合 ═════════════════
//
// 解散通知の3.5秒後処理は App の lifecycle 世代（generation/shop/sessionId）だけを
// 見ていた。**同じ pendingSession のまま新しいルームを作る**経路（SyncModal は
// `begin()` を呼ばない）では世代が変わらないため、旧ルームのタイマーが
// 新ルームで使用中のセッション・在庫を消せていた。
describe('App — 同じsessionで新ルームを作ったら旧解散処理を実行しない', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    completeShouldFail = false
    completeCalls = 0
    completeBodies = []
    completeGate = null
    completeResponse = null
    completeLosesResponse = false
    completeConflict = false
    sessionUpdates = []
    serverSessions = []
    sessionsUnreachable = false
    sessionEndedCallback = null
    dissolvedCallback = null
    syncIsActive.value = false
    syncIsHost.value   = false
    syncConnectionGen  = 0
    vi.stubGlobal('confirm', vi.fn(() => true))
    vi.stubGlobal('scrollTo', vi.fn())
    appErrors = []
  })
  afterEach(() => {
    if (app)  { app.unmount(); app = null }
    if (host) { host.remove();  host = null }
    vi.unstubAllGlobals()
    vi.useRealTimers()
    vi.resetModules()
    assertNoUnexpectedAppErrors()
  })

  it('待機中に新しいルームを張ったら、同じsessionでも片付けない', async () => {
    vi.useFakeTimers()
    syncIsActive.value = true
    await mountApp()

    dissolvedCallback()          // 他者による解散 → 3.5秒後に片付ける予定
    await settle(2)

    // 同じ pendingSession のまま新しいルームを作る（begin() は呼ばれない）
    syncConnectionGen++
    await settle(2)
    const invBefore = localStorage.getItem(STORAGE_KEYS.inventory)

    vi.advanceTimersByTime(4000)
    await settle(4)

    expect(localStorage.getItem(STORAGE_KEYS.pendingSession)).toContain('sess-1')
    expect(localStorage.getItem(STORAGE_KEYS.inventory)).toBe(invBefore)
  })

  it('新しいルームを張っていなければ従来どおり片付ける', async () => {
    vi.useFakeTimers()
    syncIsActive.value = true
    await mountApp()

    dissolvedCallback()
    await settle(2)
    vi.advanceTimersByTime(4000)
    await settle(4)

    expect(localStorage.getItem(STORAGE_KEYS.pendingSession)).toBeNull()
  })
})

// ══ 再レビュー4 §1: 解散が「切替」で中止されたら後片付けもしない ═════════════
describe('App — 解散が切替で中止されたら session・intent・draft を消さない', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    completeShouldFail = false
    completeCalls = 0
    completeBodies = []
    completeGate = null
    completeResponse = null
    completeLosesResponse = false
    completeConflict = false
    sessionUpdates = []
    serverSessions = []
    sessionsUnreachable = false
    sessionEndedCallback = null
    dissolvedCallback = null
    syncIsActive.value = true
    syncIsHost.value   = true
    syncConnectionGen  = 0
    vi.stubGlobal('confirm', vi.fn(() => true))
    vi.stubGlobal('scrollTo', vi.fn())
    appErrors = []
  })
  afterEach(() => {
    if (app)  { app.unmount(); app = null }
    if (host) { host.remove();  host = null }
    vi.unstubAllGlobals()
    vi.resetModules()
    assertNoUnexpectedAppErrors()
  })

  const savedIntent = () => localStorage.getItem(STORAGE_KEYS.completionIntent)

  it('dissolveRoom が connection_changed を返したら後片付けを止める', async () => {
    dissolveRoom.mockResolvedValueOnce({ ok: false, reason: 'connection_changed' })
    await mountApp()
    localStorage.setItem('inv_draft_sess-1', JSON.stringify({ inv: { トマト: { qty: 3 } }, activeMs: 0 }))

    await clickComplete()

    expect(completeCalls).toBe(1)
    // 完了自体は成立しているが、端末側の確定は打ち切る（intent と draft を残す）
    expect(savedIntent()).not.toBeNull()
    expect(localStorage.getItem('inv_draft_sess-1')).not.toBeNull()
    expect(localStorage.getItem(STORAGE_KEYS.pendingSession)).toContain('sess-1')
  })

  it('解散の待機中に新しいルームを張ったら後片付けを止める', async () => {
    let release
    dissolveRoom.mockImplementationOnce(() => new Promise(r => {
      release = () => r({ ok: true })
    }))
    await mountApp()
    localStorage.setItem('inv_draft_sess-1', JSON.stringify({ inv: { トマト: { qty: 3 } }, activeMs: 0 }))

    completeBtn().dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle(8)
    expect(completeCalls).toBe(1)

    syncConnectionGen++            // 待機中に新しいルームを張った
    release()
    await settle(12)

    expect(savedIntent()).not.toBeNull()
    expect(localStorage.getItem('inv_draft_sess-1')).not.toBeNull()
    expect(localStorage.getItem(STORAGE_KEYS.pendingSession)).toContain('sess-1')
  })

  it('切替が無ければ従来どおり後片付けまで進む', async () => {
    await mountApp()
    localStorage.setItem('inv_draft_sess-1', JSON.stringify({ inv: { トマト: { qty: 3 } }, activeMs: 0 }))

    await clickComplete()

    expect(savedIntent()).toBeNull()
    expect(localStorage.getItem('inv_draft_sess-1')).toBeNull()
    expect(localStorage.getItem(STORAGE_KEYS.pendingSession)).toBeNull()
  })
})

// ══ 再レビュー6 §1: 自分の解散マークが正常解散・中止のあとも残らない ═════════
//
// 実 Worker（RoomDO の dissolve）は **送信元ホストを dissolved 通知から除外する**。
// そのためホストが正常に解散しても callback は呼ばれず、boolean のマークは true の
// まま残っていた。中止（connection_changed）でも同じ。残ったマークは、その後に
// 別ルームへゲスト参加してそのルームが解散されたとき「自分が解散した」と誤認させ、
// session・在庫の片付けを飛ばす（別店舗のゲストデータが画面に残る）。
describe('App — 自分の解散マークが別ルームの解散通知に漏れない', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    completeShouldFail = false
    completeCalls = 0
    completeBodies = []
    completeGate = null
    completeResponse = null
    completeLosesResponse = false
    completeConflict = false
    sessionUpdates = []
    serverSessions = []
    sessionsUnreachable = false
    sessionEndedCallback = null
    dissolvedCallback = null
    syncIsActive.value = true
    syncIsHost.value   = true
    syncConnectionGen  = 0
    vi.stubGlobal('confirm', vi.fn(() => true))
    vi.stubGlobal('scrollTo', vi.fn())
    appErrors = []
  })
  afterEach(() => {
    if (app)  { app.unmount(); app = null }
    if (host) { host.remove();  host = null }
    vi.unstubAllGlobals()
    vi.useRealTimers()
    vi.resetModules()
    assertNoUnexpectedAppErrors()
  })

  const toastText = () => host.querySelector('.toast')?.textContent ?? ''

  it('正常解散のあと、別ルームの解散通知は通常どおり片付ける', async () => {
    await mountApp()
    await clickComplete()
    expect(dissolveRoom).toHaveBeenCalledTimes(1)
    expect(toastText()).toContain('完了しました')

    // 別ルームへゲスト参加（新しい接続 = 接続世代が進む）→ そのルームが解散される
    vi.useFakeTimers()
    syncConnectionGen++
    dissolvedCallback()
    await settle(4)

    expect(toastText()).toContain('セッションが破棄されました')
    vi.advanceTimersByTime(4000)
    await settle(8)
    expect(host.querySelector('.lp')).not.toBeNull()
  })

  it('connection_changed で解散を中止したあとも、別ルームの解散通知を片付ける', async () => {
    dissolveRoom.mockResolvedValueOnce({ ok: false, reason: 'connection_changed' })
    await mountApp()
    await clickComplete()
    expect(localStorage.getItem(STORAGE_KEYS.pendingSession)).toContain('sess-1')

    vi.useFakeTimers()
    syncConnectionGen++
    dissolvedCallback()
    await settle(4)

    expect(toastText()).toContain('セッションが破棄されました')
    vi.advanceTimersByTime(4000)
    await settle(8)
    expect(localStorage.getItem(STORAGE_KEYS.pendingSession)).toBeNull()
    expect(host.querySelector('.lp')).not.toBeNull()
  })

  it('同じ接続のまま自分の解散通知が返ってきたら閉鎖として扱う', async () => {
    await mountApp()
    await clickComplete()

    // HTTP 経路の解散（worker/src/RoomDO.js:137）は送信元も含めて配信する。
    // 接続が変わっていなければ、それは自分が閉じたルームの通知。
    vi.useFakeTimers()
    dissolvedCallback()
    await settle(4)

    expect(toastText()).toContain('ルームが閉鎖されました')
    vi.advanceTimersByTime(4000)
    await settle(8)
    expect(host.querySelector('.lp')).toBeNull()
  })
})
