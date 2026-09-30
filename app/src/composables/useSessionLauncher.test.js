// 棚卸・発注の開始・再開・破棄を画面から切り離した共通部品（proposals.md 2026-09-30 段階1）。
// 画面遷移は呼ぶ側の仕事なので、ここでは「何が起きたか」を返すことだけを確かめる。
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../utils/api.js', () => ({
  HTTP_BASE: 'https://worker.test',
  apiFetch: vi.fn(async () => ({})),
  setAuthInvalidatedHandler: vi.fn(),
}))
let sessionList = []
let getSessionsImpl = async () => sessionList
const createSession = vi.fn(async (type) => ({ id: type === 'order' ? 'ord-new' : 'stk-new', type: type ?? 'stock', status: 'active' }))
const deleteSession = vi.fn(async () => ({}))
const logout = vi.fn(async () => {})
vi.mock('./useAuth.js', () => ({
  getSessions:   (...a) => getSessionsImpl(...a),
  createSession: (...a) => createSession(...a),
  deleteSession: (...a) => deleteSession(...a),
  logout:        (...a) => logout(...a),
}))
vi.mock('./useSync.js', () => ({ fetchRoomStatus: vi.fn(async () => null) }))

const now = new Date()
const iso = d => d.toISOString()
const DONE_TODAY = { id: 'today', type: 'stock', status: 'completed', startedAt: iso(new Date(now - 3600_000)), endedAt: iso(now) }
const ACTIVE_ORDER = { id: 'o1', type: 'order', status: 'active', startedAt: iso(now) }

let L
beforeEach(async () => {
  localStorage.clear()
  vi.resetModules()
  createSession.mockClear(); deleteSession.mockClear(); logout.mockClear()
  sessionList = []
  getSessionsImpl = async () => sessionList
  const { useConfig } = await import('./useConfig.js')
  const cfg = useConfig(); cfg.setEmptyList(); cfg.addItem('トマト', 0, '', '個')
  const { useSessionLauncher } = await import('./useSessionLauncher.js')
  L = useSessionLauncher()
})

describe('useSessionLauncher', () => {
  it('一覧を読み、棚卸と発注の進行中を振り分ける', async () => {
    sessionList = [DONE_TODAY, ACTIVE_ORDER]
    expect(await L.load()).toBe('ok')
    expect(L.activeOrderSession.value.id).toBe('o1')
    expect(L.activeSession.value).toBeNull()
    expect(L.completedSessions.value.map(s => s.id)).toEqual(['today'])
  })

  it('認証切れ（401）ならログアウトして unauthorized を返す', async () => {
    getSessionsImpl = async () => { throw new Error('401 Unauthorized') }
    expect(await L.load()).toBe('unauthorized')
    expect(logout).toHaveBeenCalledTimes(1)
  })

  it('同じ日の2回目は作らずに sameDay を返す（続きか新しくかは画面が訊く）', async () => {
    sessionList = [DONE_TODAY]
    await L.load()
    expect(await L.startStock()).toEqual({ sameDay: DONE_TODAY })
    expect(createSession).not.toHaveBeenCalled()
  })

  it('「新しく始める」と決めたら force で新しい棚卸を作る', async () => {
    sessionList = [DONE_TODAY]
    await L.load()
    const r = await L.startStock({ force: true })
    expect(r.session.id).toBe('stk-new')
    expect(L.startingKind.value).toBeNull()
  })

  it('発注は type=order で作る。品目が0件なら作らずに理由を出す', async () => {
    expect((await L.startOrder()).id).toBe('ord-new')
    expect(createSession).toHaveBeenCalledWith('order')
    const { useConfig } = await import('./useConfig.js')
    useConfig().setEmptyList()
    createSession.mockClear()
    expect(await L.startOrder()).toBeNull()
    expect(createSession).not.toHaveBeenCalled()
    expect(L.error.value).toContain('品目マスタ')
  })

  it('削除は確認のうえで一覧から外す。キャンセルなら何もしない', async () => {
    sessionList = [ACTIVE_ORDER]
    await L.load()
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false)
    expect(await L.remove(ACTIVE_ORDER)).toBe(false)
    expect(deleteSession).not.toHaveBeenCalled()
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true)
    expect(await L.remove(ACTIVE_ORDER)).toBe(true)
    expect(L.sessions.value).toEqual([])
  })

  it('画面で確認済み（confirmed）ならブラウザの確認を出さない', async () => {
    sessionList = [ACTIVE_ORDER]
    await L.load()
    const spy = vi.spyOn(window, 'confirm'); spy.mockClear()
    expect(await L.remove(ACTIVE_ORDER, { confirmed: true })).toBe(true)
    expect(spy).not.toHaveBeenCalled()
  })

  it('中断中の破棄は、消す直前にサーバーで完了済みになっていたら消さない（実データ消失の再発防止）', async () => {
    sessionList = [ACTIVE_ORDER]
    await L.load()
    // 別の端末で完了した
    sessionList = [{ ...ACTIVE_ORDER, status: 'completed', endedAt: iso(now) }]
    expect(await L.remove(ACTIVE_ORDER, { confirmed: true, onlyIfActive: true })).toBe(false)
    expect(deleteSession).not.toHaveBeenCalled()
    expect(L.error.value).toContain('すでに完了')
    expect(L.sessions.value[0].status).toBe('completed')
  })

  it('中断中のままなら破棄できる', async () => {
    sessionList = [ACTIVE_ORDER]
    await L.load()
    expect(await L.remove(ACTIVE_ORDER, { confirmed: true, onlyIfActive: true })).toBe(true)
    expect(deleteSession).toHaveBeenCalledWith('o1')
  })
})
