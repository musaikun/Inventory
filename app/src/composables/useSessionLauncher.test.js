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
let discardedList = []
let restoreImpl = async () => ({ ok: false })
let purgeImpl = async () => ({ ok: true, sessionIds: [] })
vi.mock('./useAuth.js', () => ({
  getSessions:   (...a) => getSessionsImpl(...a),
  createSession: (...a) => createSession(...a),
  deleteSession: (...a) => deleteSession(...a),
  logout:        (...a) => logout(...a),
  getDiscardedSessions: async () => discardedList,
  restoreSession: (...a) => restoreImpl(...a),
  purgeUnfinishedSessions: (...a) => purgeImpl(...a),
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
  discardedList = []
  restoreImpl = async () => ({ ok: false })
  purgeImpl = async () => ({ ok: true, sessionIds: [] })
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
    expect(await L.remove(ACTIVE_ORDER, { confirmed: true })).toBe(false)
    expect(deleteSession).not.toHaveBeenCalled()
    expect(L.error.value).toContain('すでに完了')
    expect(L.sessions.value[0].status).toBe('completed')
  })

  it('完了した記録は削除しない（確認も出さない）', async () => {
    const done = { ...ACTIVE_ORDER, status: 'completed', endedAt: iso(now) }
    sessionList = [done]
    await L.load()
    const spy = vi.spyOn(window, 'confirm'); spy.mockClear()
    expect(await L.remove(done)).toBe(false)
    expect(spy).not.toHaveBeenCalled()
    expect(deleteSession).not.toHaveBeenCalled()
  })

  it('中断中のままなら破棄できる', async () => {
    sessionList = [ACTIVE_ORDER]
    await L.load()
    expect(await L.remove(ACTIVE_ORDER, { confirmed: true })).toBe(true)
    expect(deleteSession).toHaveBeenCalledWith('o1', { draft: null })
  })

  // 破棄は24時間取り戻せる（User要望 2026-10-01）
  it('破棄のとき、端末の下書きを一緒に送る（取り戻したときに数量を戻すため）', async () => {
    localStorage.setItem('inv_draft_o1', JSON.stringify({ inv: { トマト: { qty: 2 } }, activeMs: 5, audit: [] }))
    localStorage.setItem('order_draft_ord_o1', JSON.stringify({ トマト: { orderQty: 3 } }))
    sessionList = [ACTIVE_ORDER]
    await L.load()
    expect(await L.remove(ACTIVE_ORDER, { confirmed: true })).toBe(true)
    const [, opts] = deleteSession.mock.calls[0]
    expect(opts.draft.inv.トマト.qty).toBe(2)
    expect(opts.draft.orderDraft.トマト.orderQty).toBe(3)
  })

  it('取り戻すと、端末に下書きが無ければサーバーの下書きを書き戻し、一覧を読み直す', async () => {
    discardedList = [{ id: 'o1', type: 'order', itemCount: 1, startedAt: iso(now), restorableUntil: iso(new Date(+now + 3600_000)) }]
    await L.load()
    await Promise.resolve(); await Promise.resolve()
    expect(L.discarded.value.map(d => d.id)).toEqual(['o1'])
    restoreImpl = async () => {
      sessionList = [ACTIVE_ORDER]; discardedList = []
      return { ok: true, session: ACTIVE_ORDER, payload: { draft: { inv: { トマト: { qty: 4 } }, orderDraft: { トマト: { orderQty: 1 } } } } }
    }
    const s = await L.restore(L.discarded.value[0])
    expect(s.id).toBe('o1')
    expect(JSON.parse(localStorage.getItem('inv_draft_o1')).inv.トマト.qty).toBe(4)
    expect(JSON.parse(localStorage.getItem('order_draft_ord_o1')).トマト.orderQty).toBe(1)
    expect(L.activeOrderSession.value.id).toBe('o1')
  })

  it('取り戻せないとき（期限切れ・別の進行中あり）は理由を出す', async () => {
    restoreImpl = async () => { throw new Error('進行中の発注があります。完了するか破棄してから取り戻してください') }
    expect(await L.restore({ id: 'o1' })).toBeNull()
    expect(L.error.value).toContain('進行中の発注があります')
  })
})

describe('品目マスタの一括削除に合わせて、完了していないセッションを消す', () => {
  it('サーバーで消した中断中・破棄の下書きを端末からも消し、一覧から外す。完了済みは残る', async () => {
    sessionList = [DONE_TODAY, ACTIVE_ORDER]
    discardedList = [{ id: 'd1', type: 'stock', itemCount: 3, startedAt: iso(now), discardedAt: iso(now) }]
    await L.load(); await L.loadDiscarded()
    localStorage.setItem('inv_draft_d1', '{"inv":{}}')
    localStorage.setItem('order_draft_ord_o1', '{}')
    purgeImpl = async () => ({ ok: true, sessionIds: ['o1', 'd1'] })
    expect(await L.purgeUnfinished()).toEqual(['o1', 'd1'])
    expect(localStorage.getItem('inv_draft_d1')).toBeNull()
    expect(localStorage.getItem('order_draft_ord_o1')).toBeNull()
    expect(L.sessions.value.map(s => s.id)).toEqual(['today'])
    expect(L.discarded.value).toEqual([])
  })

  it('消せなければ null を返し、一覧も下書きも変えない（品目は消さない）', async () => {
    sessionList = [ACTIVE_ORDER]
    await L.load()
    localStorage.setItem('order_draft_ord_o1', '{}')
    purgeImpl = async () => { throw new Error('通信できません') }
    expect(await L.purgeUnfinished()).toBeNull()
    expect(L.error.value).toContain('通信できません')
    expect(L.sessions.value.map(s => s.id)).toEqual(['o1'])
    expect(localStorage.getItem('order_draft_ord_o1')).toBe('{}')
  })
})
