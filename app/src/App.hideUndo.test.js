/**
 * 誤って非表示にしたときの戻り道（User 要件）。
 *
 * 非表示は引き切った左スワイプなら確認なしに決まる。この速さは残したいので、
 * 確認を足す代わりに**直前の1件をその場で戻せる**ようにした。
 * ここで固定するのは3点:
 *   ・隠した直後に「元に戻す」が出て、押すと一覧へ戻る（config も配り直す）
 *   ・✕ で閉じたときは戻さない（隠したままにする、が押せる）
 *   ・戻したあとはバーが残らない（同じ品目を二度戻せない）
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
let config = null

const flush = async (n = 8) => { for (let i = 0; i < n; i++) await nextTick() }
// jsdom は transitionend を出さないので、閉じたバーは leave クラスを着けたまま DOM に残る。
// 「出ている」と数えるのは退場中でないものだけ。
const undoBar = () => host.querySelector('.undo-bar:not(.toast-leave-active)')

beforeAll(async () => { await import('./App.vue'); vi.resetModules() })

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
  localStorage.setItem('tanaoro_onboarded', '1')
  if (syncFlags) { syncFlags.active = false; syncFlags.host = false }
  broadcastConfig.mockClear()
})

afterEach(() => {
  if (app)  { app.unmount(); app = null }
  if (host) { host.remove(); host = null }
  window.history.replaceState({}, '', '/')
})

/** 品目を2つ持った状態で棚卸画面へ入り、リストを操作できる側（ホスト）にする */
async function openTableAsHost() {
  const cfgMod = await import('./composables/useConfig.js')
  const cfg = cfgMod.useConfig()
  cfg.setEmptyList()
  cfg.addItem('トマト', 120, '野菜', '個')
  cfg.addItem('豚バラ', 800, '肉', 'kg')
  config = cfg.config

  window.history.replaceState({}, '', '/?store=ABCDEF')
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

  syncFlags.host = true            // 以降はリストを操作できる側
  await flush()
  host.querySelector('thead tr')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await flush()
}

// jsdom は TouchEvent を持たないので、ハンドラが見る changedTouches だけを載せる
function touch(el, type, x, y = 0) {
  const ev = new Event(type, { bubbles: true, cancelable: true })
  ev.changedTouches = [{ clientX: x, clientY: y }]
  el.dispatchEvent(ev)
}

/** 行を引き切って離す（＝確認を挟まない非表示） */
async function fullSwipe(name) {
  const el = host.querySelector(`tr.item-row[data-item="${name}"]`)
  expect(el, '品目の行が出ていない').toBeTruthy()
  touch(el, 'touchstart', 300, 100)
  touch(el, 'touchmove', 80, 100)
  await flush(2)
  touch(el, 'touchend', 0, 0)
  await flush()
}

describe('直前の非表示を戻す', () => {
  it('引き切って隠すと「元に戻す」が出る', async () => {
    await openTableAsHost()
    await fullSwipe('トマト')

    expect(config.hiddenItems).toContain('トマト')
    expect(undoBar()).not.toBeNull()
    expect(undoBar().textContent).toContain('トマト')
    expect(undoBar().querySelector('.undo-btn')).not.toBeNull()
  })

  it('「元に戻す」で一覧へ戻り、バーは消える', async () => {
    await openTableAsHost()
    await fullSwipe('トマト')
    broadcastConfig.mockClear()

    undoBar().querySelector('.undo-btn').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flush()

    expect(config.hiddenItems).not.toContain('トマト')
    expect(undoBar()).toBeNull()
    expect(host.querySelector('tr.item-row[data-item="トマト"]')).not.toBeNull()
  })

  it('✕ で閉じても非表示のまま（閉じる＝そのままにする）', async () => {
    await openTableAsHost()
    await fullSwipe('トマト')

    undoBar().querySelector('.undo-x').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flush()

    expect(undoBar()).toBeNull()
    expect(config.hiddenItems).toContain('トマト')
  })

  // 2件続けて誤操作したときは直前の1件だけが戻せる。
  // それ以前は「非表示中」の一覧（最後に隠した順・時刻つき）で辿る。
  it('続けて隠すとバーは直前の1件を指す', async () => {
    await openTableAsHost()
    await fullSwipe('トマト')
    await fullSwipe('豚バラ')

    expect(undoBar().textContent).toContain('豚バラ')
    expect(undoBar().textContent).not.toContain('トマト')

    undoBar().querySelector('.undo-btn').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flush()
    expect(config.hiddenItems).toContain('トマト')      // 前の1件は隠れたまま
    expect(config.hiddenItems).not.toContain('豚バラ')
  })

  it('非表示にした時刻を記録する（一覧の並びと表示に使う）', async () => {
    await openTableAsHost()
    await fullSwipe('トマト')
    expect(config.hiddenAt['トマト']).toMatch(/^\d{4}-\d{2}-\d{2}T/)

    undoBar().querySelector('.undo-btn').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flush()
    expect(config.hiddenAt['トマト']).toBeUndefined()   // 戻したら時刻も残さない
  })
})
