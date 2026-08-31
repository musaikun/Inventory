/**
 * 招待リンクで参加しただけのゲストが、戻るでホスト側の面へ入らない。
 *
 * セッション一覧は**ホストの面**（過去の棚卸・履歴・削除・データ管理への入口）。
 * ゲストは店舗にログインしていないので、そこへ入れてはいけない。
 * 実際には「ルームに参加 → 戻る → セッション一覧が開く」状態になっていた。
 *
 * ゲストの出口はランディング。ルームからは退出する。
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { createApp, nextTick } from 'vue'
import { STORAGE_KEYS } from './utils/storageKeys.js'

vi.mock('./utils/api.js', () => ({
  HTTP_BASE: '',
  WS_BASE: '',
  apiFetch: vi.fn(async (path) => {
    if (/\/store\/[A-Z0-9]+$/.test(path)) return { shopCode: 'ABCDEF', activeRoom: null, plan: 'free' }
    if (/\/sessions(\?|$)/.test(path)) return []
    return {}
  }),
  setAuthInvalidatedHandler: vi.fn(),
}))
vi.mock('./utils/analytics.js', () => ({
  initAnalytics: vi.fn(), track: vi.fn(), resetAnalytics: vi.fn(),
}))

// 同期はゲストとして接続済みの状態にする（WS は張らない）。
// フラグは **mock の中で reactive にする**。素のオブジェクトを computed から読むと
// 依存として追跡されず、参加後に true にしても画面が接続中に切り替わらない。
let syncFlags = null
const leaveRoom = vi.fn()
const joinRoom  = vi.fn()

vi.mock('./composables/useSync.js', async (importOriginal) => {
  const actual = await importOriginal()
  const { computed, reactive } = await import('vue')
  syncFlags = reactive({ active: false, host: false })
  joinRoom.mockImplementation(async () => { syncFlags.active = true; syncFlags.host = false })
  return {
    ...actual,
    setSessionEndedCallback: vi.fn(),
    setDissolvedCallback:    vi.fn(),
    captureSyncConnection:   () => ({ gen: 0 }),
    isSyncConnectionStale:   () => false,
    broadcastSessionEnd:     vi.fn(),
    useSync: () => ({
      state: reactive({ error: '', connected: true, participants: [], messages: [] }),
      isActive: computed(() => syncFlags.active),
      isHost:   computed(() => syncFlags.host),
      participantList: computed(() => []),
      createRoom: vi.fn(), joinRoom, leaveRoom,
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

const flush = async (n = 8) => { for (let i = 0; i < n; i++) await nextTick() }
const view  = () => document.body.dataset.view

beforeAll(async () => { await import('./App.vue'); vi.resetModules() })

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()          // ゲストは**ログインしていない**
  // 初回オンボーディングは戻るを1回消費する。ここで見たいのはその先なので、
  // 「once 見た」状態から始める（実機でも2回目以降はこの状態）。
  localStorage.setItem('tanaoro_onboarded', '1')
  if (syncFlags) { syncFlags.active = false; syncFlags.host = false }
  leaveRoom.mockClear()
  joinRoom.mockClear()
})

afterEach(() => {
  if (app)  { app.unmount(); app = null }
  if (host) { host.remove(); host = null }
  window.history.replaceState({}, '', '/')
})

/** 招待リンク（?store=CODE）でアプリを開き、名前を入れて参加する */
async function joinAsGuest() {
  window.history.replaceState({}, '', '/?store=ABCDEF')
  const { default: App } = await import('./App.vue')
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp(App)
  app.mount(host)
  await flush()

  const input = host.querySelector('.name-modal input, input[type="text"]')
  expect(input, '名前の入力欄が出ていない').toBeTruthy()
  input.value = 'ゲスト端末'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await flush(2)

  const ok = [...host.querySelectorAll('button')].find(b => /参加|OK|決定/.test(b.textContent))
  expect(ok, '参加ボタンが見つからない').toBeTruthy()
  ok.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await flush()
  return host
}

async function deviceBack() {
  window.dispatchEvent(new PopStateEvent('popstate'))
  await flush()
}

describe('ゲストの戻る', () => {
  it('参加するとセッション画面に入る', async () => {
    await joinAsGuest()
    expect(view()).toBe('session')
    expect(joinRoom).toHaveBeenCalledTimes(1)
  })

  // 本題。ここが 'sessions' になっていた。
  it('戻るでセッション一覧へ行かない（ランディングへ返す）', async () => {
    await joinAsGuest()
    expect(view()).toBe('session')

    await deviceBack()
    await flush()

    expect(view()).not.toBe('sessions')
    expect(view()).toBe('landing')
  })

  it('戻るときはルームから退出する', async () => {
    await joinAsGuest()
    await deviceBack()
    await flush()
    expect(leaveRoom).toHaveBeenCalled()
  })
})
