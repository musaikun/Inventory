// 保存状態バナー（CCレビュー修正 第1セッション §3）
//
// 守りたいのは表示の優先順位と文言の正直さ。
//  - 未保存の警告はオフライン表示より優先する（オフラインは「そのうち直る」と読めてしまう）
//  - 端末にも保持できていないものを「端末に保存済み」と言わない
//  - 状態変化を aria-live で読み上げる
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, nextTick, ref, computed } from 'vue'

const isOnline        = ref(true)
const saveState       = ref('idle')
const saveFailures    = ref(0)
const pendingSize     = ref(0)
const pendingPersisted = ref(true)
const unpersistedCount = ref(0)
const rejectedSaves    = ref([])
const retryPendingSaves = vi.fn()
const dismissRejectedSaves = vi.fn(() => { rejectedSaves.value = [] })

vi.mock('../composables/useConnectivity.js', () => ({
  isOnline,
  initConnectivity: vi.fn(),
  onReconnect: vi.fn(),
}))
vi.mock('../composables/useStore.js', () => ({
  saveState, saveFailures, pendingPersisted, unpersistedCount, rejectedSaves,
  pendingCount: computed(() => pendingSize.value),
  retryPendingSaves, dismissRejectedSaves,
}))

let app = null
let host = null

async function mountBanner() {
  const { default: ConnectionBanner } = await import('./ConnectionBanner.vue')
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp(ConnectionBanner)
  app.mount(host)
  await nextTick()
  return host
}

const banner = () => host.querySelector('.cb')
const text   = () => banner()?.textContent ?? ''

describe('ConnectionBanner', () => {
  beforeEach(() => {
    isOnline.value = true
    saveState.value = 'idle'
    saveFailures.value = 0
    pendingSize.value = 0
    pendingPersisted.value = true
    unpersistedCount.value = 0
    rejectedSaves.value = []
    vi.clearAllMocks()
  })
  afterEach(() => {
    if (app)  { app.unmount(); app = null }
    if (host) { host.remove();  host = null }
    vi.resetModules()
  })

  it('全て保存済み・オンラインなら何も出さない', async () => {
    await mountBanner()
    expect(banner()).toBeNull()
  })

  it('未送信が無くオフラインならオフライン表示', async () => {
    isOnline.value = false
    await mountBanner()
    expect(banner().className).toContain('offline')
    expect(text()).toContain('オフライン')
  })

  it('オフラインでも未送信があれば未保存側を優先して件数を出す', async () => {
    isOnline.value = false
    saveState.value = 'pending'
    pendingSize.value = 3
    await mountBanner()
    // オフライン表示（.offline）ではなく未送信表示になる
    expect(banner().className).not.toContain('offline')
    expect(text()).toContain('3件')
  })

  it('連続失敗が続くと「保存できていません」へ強める', async () => {
    saveState.value = 'pending'
    pendingSize.value = 2
    saveFailures.value = 2
    await mountBanner()
    expect(banner().className).toContain('failed')
    expect(text()).toContain('保存できていません')
  })

  it('端末にも保持できていないときは失われうることを明示する', async () => {
    saveState.value = 'pending'
    pendingSize.value = 5
    pendingPersisted.value = false
    unpersistedCount.value = 2
    await mountBanner()
    expect(banner().className).toContain('unpersisted')
    expect(text()).toContain('失われます')
    // 「端末に保存済み」とは言わない
    expect(text()).not.toContain('端末には保存済み')
  })

  it('端末に保持できていないときは割り込みで読み上げる', async () => {
    saveState.value = 'pending'
    pendingSize.value = 1
    pendingPersisted.value = false
    await mountBanner()
    expect(host.querySelector('.cb-live').getAttribute('aria-live')).toBe('assertive')
  })

  it('通常の再送中は polite で読み上げる', async () => {
    saveState.value = 'pending'
    pendingSize.value = 1
    await mountBanner()
    expect(host.querySelector('.cb-live').getAttribute('aria-live')).toBe('polite')
  })

  it('読み上げ領域はバナー非表示のときも常設される', async () => {
    await mountBanner()
    expect(host.querySelector('.cb-live')).not.toBeNull()
    expect(host.querySelector('.cb-live').getAttribute('role')).toBe('status')
  })

  it('サーバーに拒否された保存を提示し、閉じられる', async () => {
    rejectedSaves.value = [{ kind: 'order', label: '発注', status: 400, message: 'bad' }]
    await mountBanner()
    expect(banner().className).toContain('rejected')
    expect(text()).toContain('発注')
    expect(text()).toContain('拒否')

    host.querySelector('.cb-retry').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()
    expect(dismissRejectedSaves).toHaveBeenCalled()
  })

  it('未送信があるときは拒否表示より未送信を優先する', async () => {
    saveState.value = 'pending'
    pendingSize.value = 1
    rejectedSaves.value = [{ kind: 'order', label: '発注', status: 400, message: 'bad' }]
    await mountBanner()
    expect(banner().className).not.toContain('rejected')
  })

  it('「今すぐ再送」で再送を呼ぶ', async () => {
    saveState.value = 'pending'
    pendingSize.value = 1
    await mountBanner()
    host.querySelector('.cb-retry').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(retryPendingSaves).toHaveBeenCalled()
  })
})
