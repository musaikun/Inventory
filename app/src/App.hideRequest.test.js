/**
 * ホスト側で非表示申請に答えるところ（User 要件）。
 *
 * ゲストは申請しか出せないので、**実際に隠すのはホストの承認だけ**。
 * ここで固定するのは2点:
 *   ・承認すると品目が非表示になり、config が配り直される（全員の一覧から外れる）
 *   ・**同じ品目への申請はまとめて返す**。1件にだけ答えると、もう一方の端末は
 *     「申請中…」のまま返事を待ち続ける（DO は requestId ごとに申請元へ返すため）
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

let syncFlags = null
const broadcastItemHideResponse = vi.fn()
const broadcastItemHideRequest  = vi.fn()
const broadcastConfig = vi.fn()

vi.mock('./composables/useSync.js', async (importOriginal) => {
  const actual = await importOriginal()
  const { computed, reactive } = await import('vue')
  syncFlags = reactive({ active: false, host: false })
  return {
    ...actual,
    setSessionEndedCallback: vi.fn(),
    setDissolvedCallback:    vi.fn(),
    captureSyncConnection:   () => ({ gen: 0 }),
    isSyncConnectionStale:   () => false,
    broadcastSessionEnd:     vi.fn(),
    broadcastItemHideResponse,
    broadcastItemHideRequest,
    broadcastConfig,
    useSync: () => ({
      state: reactive({ error: '', connected: true, participants: [], messages: [] }),
      isActive: computed(() => syncFlags.active),
      isHost:   computed(() => syncFlags.host),
      participantList: computed(() => []),
      createRoom: vi.fn(),
      joinRoom: vi.fn(async () => { syncFlags.active = true; syncFlags.host = false }),
      leaveRoom: vi.fn(),
      dissolveRoom: vi.fn(async () => {}),
      unreadCount: computed(() => 0),
      auditLog: [],
    }),
    getSavedGuestSession: () => null,
    hasHostToken: () => false,
    fetchRoomStatus: async () => ({ isActive: true, sessionId: 'sid' }),
    fetchRoomResult: async () => null,
  }
})

let app = null
let host = null
let pendingHideRequests = null
let config = null

const flush = async (n = 8) => { for (let i = 0; i < n; i++) await nextTick() }
const cards = () => [...host.querySelectorAll('.item-req-card')]
  .filter(c => c.textContent.includes('非表示を申請'))

beforeAll(async () => { await import('./App.vue'); vi.resetModules() })

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
  localStorage.setItem('tanaoro_onboarded', '1')
  if (syncFlags) { syncFlags.active = false; syncFlags.host = false }
  broadcastItemHideResponse.mockClear()
  broadcastItemHideRequest.mockClear()
  broadcastConfig.mockClear()
})

afterEach(() => {
  if (app)  { app.unmount(); app = null }
  if (host) { host.remove(); host = null }
  pendingHideRequests?.splice(0, pendingHideRequests.length)
  window.history.replaceState({}, '', '/')
})

/** 招待リンクで棚卸画面まで入り、そこからホスト側の面に切り替える */
async function openSessionAsHost() {
  window.history.replaceState({}, '', '/?store=ABCDEF')
  const sync = await import('./composables/useSync.js')
  pendingHideRequests = sync.pendingHideRequests
  const cfgMod = await import('./composables/useConfig.js')
  config = cfgMod.useConfig().config

  const { default: App } = await import('./App.vue')
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp(App)
  app.mount(host)
  await flush()

  const input = host.querySelector('.name-modal-input')
  input.value = '端末'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await flush(2)
  ;[...host.querySelectorAll('button')].find(b => /参加する/.test(b.textContent))
    .dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await flush()

  syncFlags.host = true   // 以降はホストとして描画する
  await flush()
}

const request = (requestId, name, from) => ({ requestId, name, fromDeviceName: from, fromDeviceId: from })

describe('ホスト: ゲストからの非表示申請', () => {
  it('申請が届くと承認・拒否のカードが出る', async () => {
    await openSessionAsHost()
    pendingHideRequests.push(request('r1', 'トマト', 'Aさん'))
    await flush()

    expect(cards()).toHaveLength(1)
    expect(cards()[0].textContent).toContain('Aさん')
    expect(cards()[0].textContent).toContain('トマト')
  })

  it('承認すると非表示になり、config を配り直す', async () => {
    await openSessionAsHost()
    pendingHideRequests.push(request('r1', 'トマト', 'Aさん'))
    await flush()

    cards()[0].querySelector('.item-req-approve').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flush()

    expect(config.hiddenItems).toContain('トマト')
    expect(broadcastItemHideResponse).toHaveBeenCalledWith('r1', true, 'トマト')
    expect(broadcastConfig).toHaveBeenCalled()
    expect(pendingHideRequests).toHaveLength(0)
  })

  it('拒否すると非表示にはせず、申請元へ返す', async () => {
    await openSessionAsHost()
    pendingHideRequests.push(request('r1', 'トマト', 'Aさん'))
    await flush()

    cards()[0].querySelector('.item-req-reject').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flush()

    expect(config.hiddenItems ?? []).not.toContain('トマト')
    expect(broadcastItemHideResponse).toHaveBeenCalledWith('r1', false, 'トマト')
    expect(pendingHideRequests).toHaveLength(0)
  })

  // 本題。2人が同じ品目を申請したとき、片方だけに返すと相手は待ち続ける。
  it('同じ品目への申請は、まとめて返して両方消す', async () => {
    await openSessionAsHost()
    pendingHideRequests.push(request('r1', 'トマト', 'Aさん'))
    pendingHideRequests.push(request('r2', 'トマト', 'Bさん'))
    await flush()
    expect(cards()).toHaveLength(2)

    cards()[0].querySelector('.item-req-approve').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flush()

    expect(broadcastItemHideResponse).toHaveBeenCalledWith('r1', true, 'トマト')
    expect(broadcastItemHideResponse).toHaveBeenCalledWith('r2', true, 'トマト')
    expect(pendingHideRequests).toHaveLength(0)
    expect(cards()).toHaveLength(0)
  })

  it('別の品目の申請は残す', async () => {
    await openSessionAsHost()
    pendingHideRequests.push(request('r1', 'トマト', 'Aさん'))
    pendingHideRequests.push(request('r2', '豚バラ', 'Bさん'))
    await flush()

    cards()[0].querySelector('.item-req-approve').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flush()

    expect(pendingHideRequests).toHaveLength(1)
    expect(pendingHideRequests[0].name).toBe('豚バラ')
  })
})

describe('ゲスト: 非表示の申請', () => {
  /** 招待リンクで棚卸画面へ入り、品目を1つ持った状態にする（ゲストのまま） */
  async function openSessionAsGuest() {
    const cfgMod = await import('./composables/useConfig.js')
    const cfg = cfgMod.useConfig()
    cfg.setEmptyList()
    cfg.addItem('トマト', 120, '野菜', '個')
    config = cfg.config

    window.history.replaceState({}, '', '/?store=ABCDEF')
    const sync = await import('./composables/useSync.js')
    pendingHideRequests = sync.pendingHideRequests

    const { default: App } = await import('./App.vue')
    host = document.createElement('div')
    document.body.appendChild(host)
    app = createApp(App)
    app.mount(host)
    await flush()

    const input = host.querySelector('.name-modal-input')
    input.value = 'ゲスト端末'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flush(2)
    ;[...host.querySelectorAll('button')].find(b => /参加する/.test(b.textContent))
      .dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flush()

    host.querySelector('thead tr')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flush()
  }

  function touch(el, type, x, y = 0) {
    const ev = new Event(type, { bubbles: true, cancelable: true })
    ev.changedTouches = [{ clientX: x, clientY: y }]
    el.dispatchEvent(ev)
  }

  /** 行を引き切って離す（＝申請の確定操作） */
  async function fullSwipe(name) {
    const el = host.querySelector(`tr.item-row[data-item="${name}"]`)
    expect(el, '品目の行が出ていない').toBeTruthy()
    touch(el, 'touchstart', 300, 100)
    touch(el, 'touchmove', 80, 100)
    await flush(2)
    touch(el, 'touchend', 0, 0)
    await flush()
  }

  it('引き切るとホストへ申請を送り、端末では隠さない', async () => {
    await openSessionAsGuest()
    await fullSwipe('トマト')

    expect(broadcastItemHideRequest).toHaveBeenCalledTimes(1)
    expect(broadcastItemHideRequest.mock.calls[0][0]).toBe('トマト')
    // 品目リストの正はホスト。承認前に端末側で隠すと、次の config 同期で戻ってくる
    expect(config.hiddenItems ?? []).not.toContain('トマト')
    expect(host.textContent).toContain('非表示をホストに申請中')
  })

  it('承認待ちのあいだは次の申請を出さない', async () => {
    await openSessionAsGuest()
    await fullSwipe('トマト')
    broadcastItemHideRequest.mockClear()

    await fullSwipe('トマト')
    expect(broadcastItemHideRequest).not.toHaveBeenCalled()
  })
})
