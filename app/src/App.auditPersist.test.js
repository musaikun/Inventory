// 変更履歴（監査ログ）が退室・再読込をまたいで残ること。
//
// 報告: ルームを作らず一人で「品目入力 → 退室 → 別の品目を入力 → 棚卸完了」としたら、
// 再入室後に入れた分しか変更履歴に残っていなかった。
//
// 原因は auditLog がメモリにしか無かったこと。下書き（inv_draft_<id>）には
// 在庫と稼働時間しか入れておらず、
//   ・再開（onSessionResume）は clearAuditLog() のあと下書きから戻すものが無い
//   ・再読込は _restoreDraft を通らない（在庫は useInventory 側の保存から戻る）
// のどちらの経路でも、そこまでの履歴が落ちて完了スナップショットにも入らなかった。
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { createApp, nextTick } from 'vue'
import { STORAGE_KEYS } from './utils/storageKeys.js'

let completeBodies = []
let serverSessions = []

vi.mock('./utils/api.js', () => ({
  HTTP_BASE: '',
  WS_BASE: '',
  apiFetch: vi.fn(async (path, options) => {
    if (path.endsWith('/complete')) {
      completeBodies.push(JSON.parse(options?.body ?? '{}'))
      return { ok: true, type: 'stock', snapshotSaved: true }
    }
    if (/\/sessions\/[^/]+$/.test(path) && options?.method === 'PUT') return { ok: true }
    if (/\/store\/[A-Z0-9]+$/.test(path)) return { shopCode: 'ABCDEF', activeRoom: null, plan: 'free' }
    if (/\/sessions(\?|$)/.test(path)) return serverSessions
    return {}
  }),
  setAuthInvalidatedHandler: vi.fn(),
}))
vi.mock('./utils/analytics.js', () => ({
  initAnalytics: vi.fn(), track: vi.fn(), resetAnalytics: vi.fn(),
}))

const SESSION = { id: 'sess-1', shopCode: 'ABCDEF', startedAt: '2026-08-09T00:00:00Z', status: 'active', itemCount: 1 }

// 「退室前に入力した1品目」の状態。下書きにはその変更履歴も入っている想定。
const EARLY_AUDIT = {
  id: 'local-early', ingredient: 'トマト', action: 'update', delta: 3, totalQty: 3,
  unit: '個', enteredBy: '端末A', enteredById: 'dev-a', timestamp: 1000,
}

let app = null
let host = null

function seed({ draftAudit = [EARLY_AUDIT], omitAudit = false } = {}) {
  localStorage.setItem(STORAGE_KEYS.authToken, 'test-token')
  localStorage.setItem(STORAGE_KEYS.shopCode, 'ABCDEF')
  localStorage.setItem(STORAGE_KEYS.pendingSession, JSON.stringify(SESSION))
  const inv = { トマト: { qty: 3, unit: '個', updatedAt: Date.now() } }
  localStorage.setItem(STORAGE_KEYS.inventory, JSON.stringify({
    date: new Date().toISOString().slice(0, 10),
    data: inv, recountFlags: {}, entryLog: Object.keys(inv), completedAt: null,
  }))
  const draft = omitAudit ? { inv, activeMs: 0 } : { inv, activeMs: 0, audit: draftAudit }
  localStorage.setItem(`inv_draft_${SESSION.id}`, JSON.stringify(draft))
}

async function settle(n = 12) { for (let i = 0; i < n; i++) await nextTick() }

async function mountApp() {
  const { default: App } = await import('./App.vue')
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp(App)
  app.config.errorHandler = () => {}
  app.mount(host)
  await settle()
  return host
}

beforeAll(async () => { await import('./App.vue'); vi.resetModules() })

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
  completeBodies = []
  serverSessions = []
  vi.stubGlobal('confirm', vi.fn(() => true))
})

afterEach(() => {
  if (app) { app.unmount(); app = null }
  if (host) { host.remove(); host = null }
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

const auditOf = (body) => body?.snapshot?.auditLog ?? []

describe('変更履歴が退室・再読込で消えない', () => {
  it('再読込しても、退室前の変更履歴が完了スナップショットに入る', async () => {
    seed()
    await mountApp()

    // 進行中セッションへ復帰している
    expect(host.querySelector('.btn-complete')).not.toBeNull()

    host.querySelector('.btn-complete').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle(20)

    expect(completeBodies).toHaveLength(1)
    expect(auditOf(completeBodies[0]).map(e => e.id)).toContain('local-early')
  }, 20000)

  it('再読込後に入れた分は、退室前の分に足される（置き換えない）', async () => {
    seed()
    await mountApp()

    // 再入室後の入力に相当する監査エントリ
    const sync = await import('./composables/useSync.js')
    sync.addLocalAuditEntry({
      id: 'local-late', ingredient: 'レタス', action: 'update', delta: 2, totalQty: 2,
      unit: '個', enteredBy: '端末A', enteredById: 'dev-a', timestamp: 2000,
    })
    await settle()

    host.querySelector('.btn-complete').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle(20)

    expect(auditOf(completeBodies[0]).map(e => e.id)).toEqual(['local-early', 'local-late'])
  }, 20000)

  // 0.78.0 以前に作られた下書きには audit キーが無い
  it('audit キーの無い旧下書きでも壊れない', async () => {
    seed({ omitAudit: true })
    await mountApp()

    host.querySelector('.btn-complete').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle(20)

    expect(completeBodies).toHaveLength(1)
    expect(auditOf(completeBodies[0])).toEqual([])
  }, 20000)
})
