import { describe, it, expect, beforeEach, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isAuthenticated: { value: true },
  updateSession:   vi.fn(async () => ({ ok: true })),
  completeSession: vi.fn(async () => ({ ok: true, itemCount: 2 })),
}))

vi.mock('./useAuth.js', () => ({
  isAuthenticated: mocks.isAuthenticated,
  updateSession:   mocks.updateSession,
  completeSession: mocks.completeSession,
}))

import { useSession } from './useSession.js'

const SESSION = { id: 'abc-123', shopCode: 'ABCDEF', startedAt: '2026-06-11', status: 'active', itemCount: 0 }
const PAYLOAD = { inventory: { '玉ねぎ': { qty: 5, unit: '箱' } }, prices: { '玉ねぎ': 300 } }

describe('useSession.complete', () => {
  let session

  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    mocks.isAuthenticated.value = true
    session = useSession()
    session.begin({ ...SESSION })
  })

  it('在庫ペイロード付きなら complete API（inventory_lines書き込み）を呼ぶ', async () => {
    await session.complete(1, PAYLOAD)
    expect(mocks.completeSession).toHaveBeenCalledWith('abc-123', PAYLOAD.inventory, PAYLOAD.prices, undefined)
    expect(mocks.updateSession).not.toHaveBeenCalled()
    expect(session.pendingSession.value.status).toBe('completed')
  })

  // 旧仕様: complete API が失敗したら updateSession(status='completed') へフォールバックしていた。
  // それは「明細の保存に失敗したのに、セッションだけ完了として残す」動きで、
  // DATA-001 が防ごうとしている部分適用そのものをクライアント側から作っていた。
  // 一覧には出るのに詳細が開けない棚卸（R-001）は、この経路でも生まれる。
  it('complete API が失敗しても updateSession へフォールバックしない（DATA-001）', async () => {
    mocks.completeSession.mockRejectedValueOnce(new Error('network'))
    const res = await session.complete(1, PAYLOAD)

    expect(mocks.updateSession).not.toHaveBeenCalled()
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('save_failed')
    // 完了扱いにしない。サーバー側は active のままで、再完了できる
    expect(session.pendingSession.value.status).not.toBe('completed')
  })

  it('完了に失敗したら touch を再開できる（再試行を塞がない）', async () => {
    mocks.completeSession.mockRejectedValueOnce(new Error('network'))
    await session.complete(1, PAYLOAD)

    // _finalized が戻っているので、以降の active 保存が通る
    session.markActive(2)
    await Promise.resolve()
    expect(mocks.updateSession).toHaveBeenCalledWith('abc-123', 'active', 2)
  })

  it('成功したら ok を返す', async () => {
    const res = await session.complete(1, PAYLOAD)
    expect(res.ok).toBe(true)
  })

  it('ペイロード無しは従来どおり updateSession を呼ぶ（後方互換）', async () => {
    await session.complete(3)
    expect(mocks.completeSession).not.toHaveBeenCalled()
    expect(mocks.updateSession).toHaveBeenCalledWith('abc-123', 'completed', 3)
  })

  it('未認証なら何も書き込まない', async () => {
    mocks.isAuthenticated.value = false
    await session.complete(1, PAYLOAD)
    expect(mocks.completeSession).not.toHaveBeenCalled()
    expect(mocks.updateSession).not.toHaveBeenCalled()
  })

  it('complete 後の touch は無視される（completed が上書きされない）', async () => {
    vi.useFakeTimers()
    await session.complete(1, PAYLOAD)
    session.touch(5)
    vi.advanceTimersByTime(3000)
    expect(mocks.updateSession).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})
