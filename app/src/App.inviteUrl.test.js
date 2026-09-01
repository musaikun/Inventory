/**
 * 招待リンクは、参加が済むまでURLに残す。
 *
 * LINE などのアプリ内ブラウザでリンクを開いたあと「別のブラウザで開く」を選ぶと、
 * 移った先へ渡るのは受け取った元のリンクではなく **いま表示しているURL** になる。
 * 起動直後に `history.replaceState` で `?store` / `?s` を消していたため、
 * 渡るのはパラメータの無いURLで、移った先は名前入力に来ないまま
 * ホーム（ホストとして開始）を出していた。
 *
 * 招待は使い切るまで残し、参加できた時点と、結果ビューを閉じた時点で外す。
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { createApp, nextTick } from 'vue'

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

const SID = '11111111-1111-4111-8111-111111111111'

// ルームがライブかどうかはテストごとに差し替える（招待リンク or 完了後の結果リンク）
let roomStatus = null
let roomResult = null
const joinRoom = vi.fn()

vi.mock('./composables/useSync.js', async (importOriginal) => {
  const actual = await importOriginal()
  const { computed, reactive } = await import('vue')
  const flags = reactive({ active: false, host: false })
  joinRoom.mockImplementation(async () => { flags.active = true; flags.host = false })
  return {
    ...actual,
    setSessionEndedCallback: vi.fn(),
    setDissolvedCallback:    vi.fn(),
    captureSyncConnection:   () => ({ gen: 0 }),
    isSyncConnectionStale:   () => false,
    broadcastSessionEnd:     vi.fn(),
    useSync: () => ({
      state: reactive({ error: '', connected: true, participants: [], messages: [] }),
      isActive: computed(() => flags.active),
      isHost:   computed(() => flags.host),
      participantList: computed(() => []),
      createRoom: vi.fn(), joinRoom, leaveRoom: vi.fn(),
      dissolveRoom: vi.fn(async () => {}),
      unreadCount: computed(() => 0),
      auditLog: [],
    }),
    getSavedGuestSession: () => null,
    hasHostToken: () => false,
    fetchRoomStatus: async () => roomStatus,
    fetchRoomResult: async () => roomResult,
  }
})

let app = null
let host = null

const flush = async (n = 8) => { for (let i = 0; i < n; i++) await nextTick() }
const search = () => window.location.search

beforeAll(async () => { await import('./App.vue'); vi.resetModules() })

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()                             // 招待された端末はログインしていない
  localStorage.setItem('tanaoro_onboarded', '1')   // 初回オンボーディングは対象外
  roomStatus = { isActive: true, sessionId: SID }
  roomResult = null
  joinRoom.mockClear()
})

afterEach(() => {
  if (app)  { app.unmount(); app = null }
  if (host) { host.remove(); host = null }
  window.history.replaceState({}, '', '/')
})

async function openLink(url) {
  window.history.replaceState({}, '', url)
  const { default: App } = await import('./App.vue')
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp(App)
  app.mount(host)
  await flush()
  return host
}

const nameInput = () => host.querySelector('.name-modal-input')
const button    = (re) => [...host.querySelectorAll('button')].find(b => re.test(b.textContent))

async function enterName(name) {
  const input = nameInput()
  input.value = name
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await flush(2)
  button(/参加する/).dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await flush()
}

describe('招待リンクのURLパラメータ', () => {
  // 本題。名前を入れている最中に別のブラウザへ移っても、招待が渡るようにする。
  it('名前入力を出している間はURLに招待が残る', async () => {
    await openLink(`/?store=ABCDEF&s=${SID}`)

    expect(nameInput(), '名前の入力欄が出ていない').toBeTruthy()
    expect(search()).toContain('store=ABCDEF')
    expect(search()).toContain(`s=${SID}`)
  })

  it('セッションIDの無い招待（?store のみ）でも残る', async () => {
    await openLink('/?store=ABCDEF')

    expect(nameInput()).toBeTruthy()
    expect(search()).toContain('store=ABCDEF')
  })

  it('参加できたらURLから外す', async () => {
    await openLink(`/?store=ABCDEF&s=${SID}`)
    await enterName('ゲスト端末')

    expect(joinRoom).toHaveBeenCalledTimes(1)
    expect(search()).not.toContain('store=')
    expect(search()).not.toContain(`s=${SID}`)
  })

  // 取り消しは「まだ使っていない」状態。開き直せるようにURLは残す。
  it('名前入力を取り消しても招待は残る', async () => {
    await openLink(`/?store=ABCDEF&s=${SID}`)
    button(/キャンセル/).dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flush()

    expect(nameInput()).toBeFalsy()
    expect(search()).toContain('store=ABCDEF')
  })

  // 完了後の結果リンクは、閉じるまで残す（リロードで結果に戻れる）。
  it('結果ビューを閉じたらURLから外す', async () => {
    roomStatus = { isActive: false, sessionId: null }
    roomResult = { date: '2026-08-09', sessionId: SID, items: [], participants: [], auditLog: [] }

    await openLink(`/?store=ABCDEF&s=${SID}`)
    expect(document.body.dataset.view).toBe('guest-result')
    expect(search()).toContain('store=ABCDEF')

    window.dispatchEvent(new PopStateEvent('popstate'))
    await flush()

    expect(document.body.dataset.view).not.toBe('guest-result')
    expect(search()).not.toContain('store=')
  })

  // 招待以外のクエリ（?delete-account など将来の入口）を巻き込んで消さない
  it('招待以外のクエリは消さない', async () => {
    await openLink(`/?utm=line&store=ABCDEF&s=${SID}`)
    await enterName('ゲスト端末')

    expect(search()).toContain('utm=line')
    expect(search()).not.toContain('store=')
  })
})
