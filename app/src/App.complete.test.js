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

vi.mock('./utils/api.js', () => ({
  // '' にすると useStore 側の D1 保存は no-op（本testの対象外）。
  // useAuth は HTTP_BASE を見ずに apiFetch を呼ぶので、完了経路はそのまま通る。
  HTTP_BASE: '',
  WS_BASE: '',
  apiFetch: vi.fn(async (path) => {
    if (path.endsWith('/complete')) {
      completeCalls++
      if (completeShouldFail) throw new Error('network down')
      return { ok: true }
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

vi.mock('./composables/useSync.js', async (importOriginal) => {
  const actual = await importOriginal()
  const { computed, reactive } = await import('vue')
  return {
    ...actual,
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

async function clickComplete() {
  completeBtn().dispatchEvent(new MouseEvent('click', { bubbles: true }))
  for (let i = 0; i < 12; i++) await nextTick()
}

describe('App — 棚卸完了がサーバーへ書けなかったとき', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    completeShouldFail = false
    completeCalls = 0
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

