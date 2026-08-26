// 操作ログ（変更履歴）の D1 送信キュー（migration 0017）。
//
// 守りたい契約:
//   ・**記録の保存が棚卸を止めてはならない。** 送信失敗は握りつぶし、キューに残して次で送る
//   ・1入力ごとに通信しない（まとめて送る）
//   ・同じ id を二重に積まない。再送は server 側で冪等なのでそのまま送り直してよい
//   ・キューは localStorage に持ち、再読込・アプリ再起動をまたいで送り直せる
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }))

vi.mock('../utils/api.js', () => ({
  HTTP_BASE: 'https://worker.test',
  WS_BASE: 'wss://worker.test',
  apiFetch: apiFetchMock,
  setAuthInvalidatedHandler: vi.fn(),
}))

let mod

const SID = 'sess-1'
const entry = (id, item = 'トマト') => ({
  id, ingredient: item, action: 'overwrite', delta: 1, totalQty: 5,
  unit: '個', enteredBy: '端末A', enteredById: 'dev-a', timestamp: 1_700_000_000_000,
})

const queued = () => JSON.parse(localStorage.getItem('_audit_queue_v1') ?? '[]')
const sentBodies = () => apiFetchMock.mock.calls
  .filter(([, opts]) => opts?.method === 'POST')
  .map(([, opts]) => JSON.parse(opts.body))

beforeEach(async () => {
  vi.useFakeTimers()
  localStorage.clear()
  localStorage.setItem('_shop_code', 'ABCDEF')
  vi.resetModules()
  apiFetchMock.mockReset()
  apiFetchMock.mockResolvedValue({ ok: true, saved: 1 })
  const store = await import('./useStore.js')
  store.shopCode.value = 'ABCDEF'
  mod = await import('./useAuditSync.js')
})
afterEach(() => { vi.useRealTimers() })

describe('まとめて送る', () => {
  it('1件ごとには送らず、待ってからまとめて送る', async () => {
    mod.queueAuditEntries(SID, entry('e1'))
    mod.queueAuditEntries(SID, entry('e2'))
    mod.queueAuditEntries(SID, entry('e3'))
    expect(apiFetchMock).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(3000)
    expect(sentBodies()).toHaveLength(1)
    expect(sentBodies()[0].entries.map(e => e.id)).toEqual(['e1', 'e2', 'e3'])
  })

  it('上限ぶん溜まったら待たずに送る', async () => {
    const many = Array.from({ length: mod.AUDIT_BATCH_LIMIT }, (_, i) => entry(`e${i}`))
    mod.queueAuditEntries(SID, many)
    await vi.advanceTimersByTimeAsync(0)
    expect(sentBodies()).toHaveLength(1)
    expect(sentBodies()[0].entries).toHaveLength(mod.AUDIT_BATCH_LIMIT)
  })

  it('セッションごとに分けて送る', async () => {
    mod.queueAuditEntries('sess-1', entry('e1'))
    mod.queueAuditEntries('sess-2', entry('e2'))
    await vi.advanceTimersByTimeAsync(3000)

    const paths = apiFetchMock.mock.calls.map(([p]) => p)
    expect(paths).toEqual([
      '/store/ABCDEF/sessions/sess-1/audit',
      '/store/ABCDEF/sessions/sess-2/audit',
    ])
  })

  it('同じ id は二重に積まない', async () => {
    mod.queueAuditEntries(SID, entry('e1'))
    mod.queueAuditEntries(SID, entry('e1'))
    await vi.advanceTimersByTimeAsync(3000)
    expect(sentBodies()[0].entries).toHaveLength(1)
  })

  it('id の無いものは積まない', async () => {
    mod.queueAuditEntries(SID, { ingredient: 'トマト' })
    expect(queued()).toEqual([])
  })

  it('sessionId が無ければ積まない（練習モードなど）', async () => {
    mod.queueAuditEntries(null, entry('e1'))
    expect(queued()).toEqual([])
  })
})

describe('送信の成否', () => {
  it('成功したぶんだけキューから消える', async () => {
    mod.queueAuditEntries(SID, [entry('e1'), entry('e2')])
    await vi.advanceTimersByTimeAsync(3000)
    expect(queued()).toEqual([])
    expect(mod.auditPendingCount.value).toBe(0)
  })

  it('通信に失敗したらキューに残し、次の flush で送り直す', async () => {
    apiFetchMock.mockRejectedValueOnce(new Error('Network request failed'))
    mod.queueAuditEntries(SID, entry('e1'))
    await vi.advanceTimersByTimeAsync(3000)
    expect(queued().map(r => r.entry.id)).toEqual(['e1'])

    apiFetchMock.mockResolvedValue({ ok: true })
    await mod.flushAuditQueue()
    expect(queued()).toEqual([])
  })

  it('送信失敗は例外を投げない（棚卸を止めない）', async () => {
    apiFetchMock.mockRejectedValue(new Error('boom'))
    mod.queueAuditEntries(SID, entry('e1'))
    await expect(vi.advanceTimersByTimeAsync(3000)).resolves.not.toThrow()
    await expect(mod.flushAuditQueue()).resolves.toBeUndefined()
  })

  it('送り直しても通らない失敗（404/409/400）は捨てる', async () => {
    const err = new Error('session_not_found'); err.status = 404
    apiFetchMock.mockRejectedValue(err)
    mod.queueAuditEntries(SID, entry('e1'))
    await vi.advanceTimersByTimeAsync(3000)
    expect(queued()).toEqual([])
  })

  it('table が無い環境（503）は捨てずに残す', async () => {
    const err = new Error('audit_append_failed'); err.status = 503
    apiFetchMock.mockRejectedValue(err)
    mod.queueAuditEntries(SID, entry('e1'))
    await vi.advanceTimersByTimeAsync(3000)
    expect(queued().map(r => r.entry.id)).toEqual(['e1'])
  })
})

describe('再読込をまたぐ', () => {
  it('キューは localStorage に残り、復元して送り直せる', async () => {
    apiFetchMock.mockRejectedValue(new Error('offline'))
    mod.queueAuditEntries(SID, entry('e1'))
    await vi.advanceTimersByTimeAsync(3000)
    expect(queued()).toHaveLength(1)

    // 再読込に相当
    vi.resetModules()
    const store = await import('./useStore.js')
    store.shopCode.value = 'ABCDEF'
    const fresh = await import('./useAuditSync.js')
    apiFetchMock.mockResolvedValue({ ok: true })

    fresh.restoreAuditQueue()
    expect(fresh.auditPendingCount.value).toBe(1)
    await fresh.flushAuditQueue()
    expect(queued()).toEqual([])
  })

  it('壊れた保存値は空として扱う', async () => {
    localStorage.setItem('_audit_queue_v1', '{壊れている')
    mod.restoreAuditQueue()
    expect(mod.auditPendingCount.value).toBe(0)
  })

  it('clearAuditQueue で捨てる（アカウント切替）', async () => {
    mod.queueAuditEntries(SID, entry('e1'))
    mod.clearAuditQueue()
    expect(queued()).toEqual([])
    await vi.advanceTimersByTimeAsync(3000)
    expect(apiFetchMock).not.toHaveBeenCalled()
  })
})

describe('読み出し', () => {
  it('D1 から1セッションの変更履歴を読む', async () => {
    apiFetchMock.mockResolvedValue([entry('e1'), entry('e2')])
    const rows = await mod.loadAuditFromD1(SID)
    expect(rows.map(r => r.id)).toEqual(['e1', 'e2'])
    expect(apiFetchMock).toHaveBeenCalledWith('/store/ABCDEF/sessions/sess-1/audit')
  })

  it('読めなければ空（画面は端末に残っているぶんで動く）', async () => {
    apiFetchMock.mockRejectedValue(new Error('offline'))
    await expect(mod.loadAuditFromD1(SID)).resolves.toEqual([])
  })

  it('配列でない応答は空として扱う', async () => {
    apiFetchMock.mockResolvedValue({ error: 'nope' })
    await expect(mod.loadAuditFromD1(SID)).resolves.toEqual([])
  })
})
