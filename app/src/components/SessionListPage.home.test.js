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
const createSession = vi.fn(async (type) => ({ id: type === 'order' ? 'ord-new' : 'stk-new', type: type ?? 'stock', status: 'active', startedAt: new Date().toISOString() }))
const deleteSession = vi.fn(async () => ({}))
vi.mock('../composables/useAuth.js', () => ({
  getSessions:     vi.fn(async () => sessionList),
  createSession:   (...a) => createSession(...a),
  deleteSession:   (...a) => deleteSession(...a),
  updateSession:   vi.fn(),
  logout:          vi.fn(),
  isAuthenticated: { value: true },
  storeName:       { value: 'テスト店' },
}))
vi.mock('../composables/useSync.js', () => ({ fetchRoomStatus: vi.fn(async () => null) }))

const now = new Date()
const iso = d => d.toISOString()
const DONE_TODAY = { id: 'today', type: 'stock', status: 'completed', startedAt: iso(new Date(now - 3600_000)), endedAt: iso(now) }
const ACTIVE_STOCK = { id: 's1', type: 'stock', status: 'active', startedAt: iso(new Date(now - 600_000)), itemCount: 12 }
const ACTIVE_ORDER = { id: 'o1', type: 'order', status: 'active', startedAt: iso(new Date(now - 600_000)), itemCount: 3 }

let app = null, host = null, events
async function mountPage({ items = true } = {}) {
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
    onStartSession: on('startSession'), onResumeSession: on('resumeSession'), onOpenHistory: on('openHistory'),
    onDeleteSession: on('deleteSession'), onOpenMaster: on('openMaster'), onOpenMovement: on('openMovement'),
    onStartPractice: on('startPractice'), onOpenFeedback: on('openFeedback'),
  })
  app.mount(host)
  for (let i = 0; i < 6; i++) await nextTick()
  return host
}
const tick = async (n = 4) => { for (let i = 0; i < n; i++) await nextTick() }
async function click(el) { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); await tick() }
const btn = (root, label) => [...root.querySelectorAll('button')].find(b => b.textContent.includes(label))
const sheet = () => host.querySelector('.sh')

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear()
  vi.resetModules()
  sessionList = []
  createSession.mockClear(); deleteSession.mockClear()
})
afterEach(() => { app?.unmount(); host?.remove(); app = null; host = null; vi.restoreAllMocks() })

describe('ホームの骨組み', () => {
  it('表・操作ボタン3つ（読むは置かない）・下部ナビ（在庫／履歴／管理）', async () => {
    await mountPage()
    expect(host.querySelector('.sp .inventory-table, .sp table')).not.toBeNull()
    expect([...host.querySelectorAll('.acts .act')].map(b => b.textContent.replace(/\s/g, ''))).toEqual(['👥棚卸', '🧾発注', '📥入出庫'])
    expect([...host.querySelectorAll('.bnav button')].map(b => b.textContent.replace(/\s/g, ''))).toEqual(['📦在庫', '📅履歴', '🗂管理'])
  })

  it('品目が無ければ（サンプルのままでも）表と操作ボタンの代わりに登録の入口', async () => {
    const { useConfig } = await import('../composables/useConfig.js')
    useConfig().resetToDefault?.()
    await mountPage({ items: false })
    expect(host.textContent).toContain('最初の品目を追加')
    expect(host.querySelector('.acts')).toBeNull()
  })

  it('履歴・管理はホームのタブ（下部ナビは出たまま）', async () => {
    await mountPage()
    await click(btn(host.querySelector('.bnav'), '履歴'))
    expect(host.querySelector('.hcp')).not.toBeNull()
    expect(host.querySelector('.bnav button.on').textContent).toContain('履歴')
    await click(btn(host.querySelector('.bnav'), '管理'))
    for (const label of ['データ管理', '在庫分析', '仕入れ', '各種設定', '練習モード', 'フィードバック']) {
      expect(host.querySelector('.manage').textContent).toContain(label)
    }
    await click(btn(host.querySelector('.manage'), 'データ管理'))
    expect(events).toContainEqual(['openMaster'])
  })

  it('入出庫は仕入れの入庫タブを開く', async () => {
    await mountPage()
    await click(btn(host.querySelector('.acts'), '入出庫'))
    expect(events).toContainEqual(['openMovement', 'in'])
  })
})

describe('棚卸を始める', () => {
  it('開始シートで「ひとりで／みんなで」を選ぶ。みんなではルームを作る印を付けて開始する', async () => {
    await mountPage()
    await click(host.querySelector('.act.stock'))
    expect(sheet().textContent).toContain('棚卸を始める')
    await click(btn(sheet(), 'みんなで始める'))
    expect(events).toContainEqual(['startSession', expect.objectContaining({ id: 'stk-new' }), 'stock', { room: true }])
  })

  it('同じ日の2回目は、ブラウザの確認ではなくシートで「続きから／新しく」を訊く', async () => {
    sessionList = [DONE_TODAY]
    await mountPage()
    const spy = vi.spyOn(window, 'confirm')
    await click(host.querySelector('.act.stock'))
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
    await click(host.querySelector('.act.stock'))
    await click(btn(sheet(), 'ひとりで始める'))
    await click(btn(sheet(), '別の棚卸として新しく始める'))
    expect(events).toContainEqual(['startSession', expect.objectContaining({ id: 'stk-new' }), 'stock', { room: false }])
  })

  it('練習は開始シートの小さなリンクから', async () => {
    await mountPage()
    await click(host.querySelector('.act.stock'))
    await click(btn(sheet(), '練習'))
    expect(events).toContainEqual(['startPractice'])
  })
})

describe('発注を始める', () => {
  it('開始シートで「記録のみ（仕入先へ送信しない）」を一度はっきり言う', async () => {
    await mountPage()
    await click(host.querySelector('.act.order'))
    expect(sheet().textContent).toContain('仕入先へは送信されません')
    await click(btn(sheet(), 'ひとりで始める'))
    expect(createSession).toHaveBeenCalledWith('order')
    expect(events).toContainEqual(['startSession', expect.objectContaining({ id: 'ord-new' }), 'order', { room: false }])
  })
})

describe('中断中のセッションと破棄', () => {
  it('中断中の棚卸・発注は帯に出て、再開できる', async () => {
    sessionList = [ACTIVE_STOCK, ACTIVE_ORDER]
    await mountPage()
    const strips = [...host.querySelectorAll('.strip.pause')]
    expect(strips.map(s => s.textContent)).toEqual([expect.stringContaining('棚卸（中断中）'), expect.stringContaining('発注（中断中）')])
    await click(btn(strips[0], '再開'))
    expect(events).toContainEqual(['resumeSession', ACTIVE_STOCK])
  })

  it('中断中に「棚卸」を押すと、新しく始めずに再開か破棄を訊く', async () => {
    sessionList = [ACTIVE_STOCK]
    await mountPage()
    await click(host.querySelector('.act.stock'))
    expect(sheet().textContent).toContain('中断中の棚卸があります')
    expect(btn(sheet(), 'ひとりで始める')).toBeUndefined()
  })

  it('⋯ から破棄：件数を見せて確認し、ブラウザの確認は出さない', async () => {
    sessionList = [ACTIVE_STOCK]
    await mountPage()
    const spy = vi.spyOn(window, 'confirm')
    await click(host.querySelector('.strip.pause .strip-more'))
    expect(sheet().textContent).toContain('この棚卸を破棄しますか？')
    expect(sheet().textContent).toContain('12品目')
    await click(btn(sheet(), '破棄する'))
    expect(spy).not.toHaveBeenCalled()
    expect(deleteSession).toHaveBeenCalledWith('s1')
    expect(events).toContainEqual(['deleteSession', 's1'])
  })

  it('破棄の確認で「やめる」なら何もしない', async () => {
    sessionList = [ACTIVE_ORDER]
    await mountPage()
    await click(host.querySelector('.strip.pause .strip-more'))
    expect(sheet().textContent).toContain('この発注を破棄しますか？')
    await click(btn(sheet(), 'やめる'))
    expect(deleteSession).not.toHaveBeenCalled()
    expect(sheet()).toBeNull()
  })
})
