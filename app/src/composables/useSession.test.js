// セッションライフサイクル（DATA-001 / App第2セッション §1・§2・§7）
//
// 第1修正セッションが確定した契約に合わせる。
//  - 完了は `POST /sessions/:id/complete` だけ。汎用 PUT で completed にしない
//    （server は `409 use_complete_endpoint` で塞いでいる）
//  - 完了中・結果不明中・完了済みに `active` を書かない
//  - 再送は組み立て済みの body をそのまま送る（fingerprint が一致しないと 409）
import { describe, it, expect, beforeEach, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isAuthenticated: { value: true },
  updateSession:   vi.fn(async () => ({ ok: true })),
  completeSession: vi.fn(async () => ({ ok: true, sessionId: 'abc-123', type: 'stock', itemCount: 2, snapshotSaved: true })),
  getSessions:     vi.fn(async () => []),
  shopCode:        { value: 'ABCDEF' },
}))

vi.mock('./useAuth.js', () => ({
  isAuthenticated: mocks.isAuthenticated,
  updateSession:   mocks.updateSession,
  completeSession: mocks.completeSession,
  getSessions:     mocks.getSessions,
}))
vi.mock('./useStore.js', () => ({ shopCode: mocks.shopCode }))

import { useSession, resetLocalData } from './useSession.js'
import { STORAGE_KEYS } from '../utils/storageKeys.js'

// 再読込の再現: module registry を捨てて作り直す（localStorage はそのまま）
async function reloadSession() {
  vi.resetModules()
  const mod = await import('./useSession.js')
  return mod.useSession()
}

const SESSION = { id: 'abc-123', shopCode: 'ABCDEF', startedAt: '2026-06-11', status: 'active', itemCount: 0 }

// services/sessionCompletion.js の戻り値と同じ形
const STOCK_REQ = {
  ok: true, type: 'stock',
  snapshot: { sessionId: 'abc-123', date: '2026-08-17', items: [{ item: '玉ねぎ', qty: 5 }] },
  body: {
    inventory: { 玉ねぎ: { qty: 5, unit: '箱' } },
    prices:    { 玉ねぎ: 300 },
    takenAt:   '2026-08-17',
    snapshot:  { sessionId: 'abc-123', date: '2026-08-17', items: [{ item: '玉ねぎ', qty: 5 }] },
  },
}
const ORDER_REQ = { ok: true, type: 'order', snapshot: null, body: { itemCount: 12 } }

function httpError(status, code) {
  const e = new Error(code ?? `HTTP ${status}`)
  e.status = status
  e.code   = code
  return e
}

describe('useSession.complete', () => {
  let session

  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    mocks.isAuthenticated.value = true
    session = useSession()
    session.begin({ ...SESSION })
  })

  it('組み立て済みの body をそのまま complete API へ送る', async () => {
    await session.complete(STOCK_REQ)
    expect(mocks.completeSession).toHaveBeenCalledWith('abc-123', STOCK_REQ.body)
    expect(mocks.updateSession).not.toHaveBeenCalled()
    expect(session.pendingSession.value.status).toBe('completed')
  })

  // 発注は `{ itemCount }` だけ。snapshot / 非空 inventory を送ると server が
  // 400 snapshot_not_allowed を返す（DATA-002 §1 order）。
  it('発注セッションは itemCount だけを送る', async () => {
    mocks.completeSession.mockResolvedValueOnce({ ok: true, type: 'order', itemCount: 12, snapshotSaved: false })
    const res = await session.complete(ORDER_REQ)

    expect(mocks.completeSession).toHaveBeenCalledWith('abc-123', { itemCount: 12 })
    expect(res.ok).toBe(true)
    // order は snapshotSaved:false が正常。これを失敗と扱わない
    expect(session.pendingSession.value.status).toBe('completed')
  })

  it('stock は snapshotSaved:true でなければ完了扱いにしない', async () => {
    mocks.completeSession.mockResolvedValueOnce({ ok: true, type: 'stock' })
    const res = await session.complete(STOCK_REQ)

    expect(res.ok).toBe(false)
    expect(res.reason).toBe('snapshot_missing')
    expect(session.pendingSession.value.status).not.toBe('completed')
  })

  // 旧仕様: complete API が失敗したら updateSession(status='completed') へフォールバック。
  // 「明細の保存に失敗したのにセッションだけ完了として残す」DATA-001 そのもので、
  // いまは server も汎用 PUT での完了を 409 use_complete_endpoint で塞いでいる。
  it('失敗しても updateSession へフォールバックしない', async () => {
    mocks.completeSession.mockRejectedValueOnce(new Error('network'))
    const res = await session.complete(STOCK_REQ)

    expect(mocks.updateSession).not.toHaveBeenCalled()
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('save_failed')
    expect(session.pendingSession.value.status).not.toBe('completed')
  })

  it('body の無い要求では API を呼ばない', async () => {
    const res = await session.complete({ ok: false, reason: 'no_inventory' })
    expect(mocks.completeSession).not.toHaveBeenCalled()
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('no_payload')
  })

  it('未認証なら何も書き込まない', async () => {
    mocks.isAuthenticated.value = false
    await session.complete(STOCK_REQ)
    expect(mocks.completeSession).not.toHaveBeenCalled()
    expect(mocks.updateSession).not.toHaveBeenCalled()
  })
})

// ── active の書き戻しを塞ぐ（§1）────────────────────────────────────────────
describe('useSession — 完了中・結果不明中に active を書かない', () => {
  let session

  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    mocks.isAuthenticated.value = true
    session = useSession()
    session.begin({ ...SESSION })
  })

  // 旧テストは「完了に失敗したら markActive(2) が通る」ことを固定していた。
  // 応答が返らない失敗ではサーバー側が完了しているか分からず、そこへ active を送ると
  // 確定済みの completed を巻き戻す（server は 409 session_completed で拒否するが、
  // 端末側が「進行中」と信じ続ける状態そのものを作らない）。
  it('応答が返らない失敗のあとは active を書き戻さない（結果不明）', async () => {
    mocks.completeSession.mockRejectedValueOnce(new Error('network'))
    const res = await session.complete(STOCK_REQ)
    expect(res.unknown).toBe(true)
    expect(session.completionUnknown.value).toBe(true)

    const marked = await session.markActive(2)
    expect(marked.ok).toBe(false)
    expect(marked.reason).toBe('completion_unknown')
    expect(mocks.updateSession).not.toHaveBeenCalled()
  })

  it('サーバーが内容を拒否した失敗（4xx）は「完了していない」と断定できる', async () => {
    mocks.completeSession.mockRejectedValueOnce(httpError(400, 'snapshot_mismatch'))
    const res = await session.complete(STOCK_REQ)

    expect(res.ok).toBe(false)
    expect(res.unknown).toBe(false)
    expect(res.retryable).toBe(false)
    expect(session.completionUnknown.value).toBe(false)
    // 再試行は塞がない
    expect((await session.markActive(2)).ok).toBe(true)
  })

  it('完了処理中は active を書かない', async () => {
    let release
    mocks.completeSession.mockImplementationOnce(() => new Promise(r => {
      release = () => r({ ok: true, snapshotSaved: true })
    }))
    const completing = session.complete(STOCK_REQ)
    expect(session.isCompleting.value).toBe(true)

    const marked = await session.markActive(2)
    expect(marked.reason).toBe('completing')
    expect(mocks.updateSession).not.toHaveBeenCalled()

    release()
    await completing
  })

  it('完了済みセッションを active へ戻さない', async () => {
    await session.complete(STOCK_REQ)
    expect(session.pendingSession.value.status).toBe('completed')
    // 端末側の確定前は「結果不明」として、確定後は「完了済み」として拒否する。
    // どちらでも active は送らない
    expect((await session.markActive(2)).ok).toBe(false)
    session.ackCompletionFinalized('abc-123')
    expect((await session.markActive(2)).reason).toBe('completed')
    expect(mocks.updateSession).not.toHaveBeenCalled()
  })

  it('完了後の touch は無視される（completed が上書きされない）', async () => {
    vi.useFakeTimers()
    await session.complete(STOCK_REQ)
    session.touch(5)
    vi.advanceTimersByTime(3000)
    expect(mocks.updateSession).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  // 再試行が成功しても、端末側の確定（履歴 commit・後片付け）が終わるまでは
  // 結果不明を下ろさない。API 成功と端末の確定完了は別（再レビュー §1）。
  it('結果不明は再試行の成功＋確定ackで解除される', async () => {
    mocks.completeSession.mockRejectedValueOnce(new Error('network'))
    await session.complete(STOCK_REQ)
    expect(session.completionUnknown.value).toBe(true)

    const res = await session.complete(STOCK_REQ)
    expect(res.ok).toBe(true)
    expect(session.completionUnknown.value).toBe(true)   // ack 前は保持

    session.ackCompletionFinalized('abc-123')
    expect(session.completionUnknown.value).toBe(false)
  })

  // verify は「サーバーがどうなっているか」を教えるだけ。端末側の確定は別（再レビュー §3）。
  it('サーバー状態の再確認だけでは結果不明を解除しない（確定ackで解除する）', async () => {
    mocks.completeSession.mockRejectedValueOnce(new Error('network'))
    await session.complete(STOCK_REQ)

    mocks.getSessions.mockResolvedValueOnce([{ id: 'abc-123', status: 'completed' }])
    const res = await session.verifyCompletion()
    expect(res).toMatchObject({ ok: true, completed: true })
    expect(session.completionUnknown.value).toBe(true)
    // どちらの状態でも active は書かない
    expect((await session.markActive(2)).ok).toBe(false)

    session.ackCompletionFinalized('abc-123')
    expect(session.completionUnknown.value).toBe(false)
    expect((await session.markActive(2)).reason).toBe('completed')
  })

  it('再確認できなければ結果不明のまま（activeも書かない）', async () => {
    mocks.completeSession.mockRejectedValueOnce(new Error('network'))
    await session.complete(STOCK_REQ)

    mocks.getSessions.mockRejectedValueOnce(new Error('offline'))
    const res = await session.verifyCompletion()
    expect(res.ok).toBe(false)
    expect(session.completionUnknown.value).toBe(true)
    expect(mocks.updateSession).not.toHaveBeenCalled()
  })
})

// ── 409（第1修正セッションが追加した契約）────────────────────────────────────
describe('useSession — 409 の扱い', () => {
  let session

  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    mocks.isAuthenticated.value = true
    session = useSession()
    session.begin({ ...SESSION })
  })

  // fingerprint は canonical snapshot 全体から作られる。別内容の再送は確定できない。
  it('completion_intent_conflict は再試行不可・結果不明にしない', async () => {
    mocks.completeSession.mockRejectedValueOnce(httpError(409, 'completion_intent_conflict'))
    const res = await session.complete(STOCK_REQ)

    expect(res.ok).toBe(false)
    expect(res.reason).toBe('intent_conflict')
    expect(res.conflict).toBe(true)
    expect(res.retryable).toBe(false)
    expect(res.unknown).toBe(false)
    expect(session.completionUnknown.value).toBe(false)
    // サーバー側は確定済み。端末から active へ戻さない
    expect(session.pendingSession.value.status).toBe('completed')
    expect((await session.markActive(2)).reason).toBe('completed')
  })

  it('completion_record_missing は再試行不可（同じ session では復旧できない）', async () => {
    mocks.completeSession.mockRejectedValueOnce(httpError(409, 'completion_record_missing'))
    const res = await session.complete(STOCK_REQ)

    expect(res.ok).toBe(false)
    expect(res.reason).toBe('record_missing')
    expect(res.retryable).toBe(false)
    expect(res.unknown).toBe(false)
  })

  it('503 は結果不明として扱う（retryable）', async () => {
    const err = httpError(503, 'complete_failed')
    err.body = { retryable: true }
    mocks.completeSession.mockRejectedValueOnce(err)
    const res = await session.complete(STOCK_REQ)

    expect(res.unknown).toBe(true)
    expect(res.retryable).toBe(true)
  })
})

// ── 結果不明は再読込をまたぐ（レビュー指摘1）────────────────────────────────
//
// completionUnknown と完了要求がメモリだけにあると、応答喪失後の再読込で
// 「ただの active セッション」として復帰する。そこから完了し直すと body が
// 組み立て直され、server の fingerprint と一致せず 409 で確定できなくなる。
// さらに markActive() が API エラーを握り潰して端末側を active にしていた。
describe('useSession — 結果不明の状態が再読込で失われない', () => {
  let session

  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    mocks.isAuthenticated.value = true
    mocks.shopCode.value = 'ABCDEF'
    session = useSession()
    session.begin({ ...SESSION })
  })

  it('応答喪失後の完了要求は端末へ保存される', async () => {
    mocks.completeSession.mockRejectedValueOnce(new Error('network'))
    await session.complete(STOCK_REQ)

    const saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.completionIntent))
    expect(saved.sessionId).toBe('abc-123')
    expect(saved.shopCode).toBe('ABCDEF')
    expect(saved.type).toBe('stock')
    expect(saved.body).toEqual(STOCK_REQ.body)
  })

  it('再読込しても結果不明のまま復帰し、同じ body を再送できる', async () => {
    mocks.completeSession.mockRejectedValueOnce(new Error('network'))
    await session.complete(STOCK_REQ)

    // リロード相当: module を作り直して localStorage から復帰する
    const reloaded = await reloadSession()
    expect(reloaded.completionUnknown.value).toBe(false)

    reloaded.restore()
    expect(reloaded.pendingSession.value.id).toBe('abc-123')
    expect(reloaded.completionUnknown.value).toBe(true)

    const kept = reloaded.pendingCompletionIntent()
    expect(kept.body).toEqual(STOCK_REQ.body)
    expect(kept.type).toBe('stock')

    await reloaded.complete(kept)
    expect(mocks.completeSession).toHaveBeenLastCalledWith('abc-123', STOCK_REQ.body)
  })

  it('復帰直後も active を書き戻さない', async () => {
    mocks.completeSession.mockRejectedValueOnce(new Error('network'))
    await session.complete(STOCK_REQ)
    const reloaded = await reloadSession()
    reloaded.restore()

    const marked = await reloaded.markActive(2)
    expect(marked.ok).toBe(false)
    expect(marked.reason).toBe('completion_unknown')
    expect(mocks.updateSession).not.toHaveBeenCalled()
  })

  it('別店舗の保存分は復帰させない（アカウント境界）', async () => {
    mocks.completeSession.mockRejectedValueOnce(new Error('network'))
    await session.complete(STOCK_REQ)
    mocks.shopCode.value = 'ZZZZZZ'
    const reloaded = await reloadSession()
    reloaded.restore()
    expect(reloaded.completionUnknown.value).toBe(false)
    expect(reloaded.pendingCompletionIntent()).toBeNull()
  })

  it('完了が成立し、端末側の確定ackまで済んだら保存分を消す', async () => {
    mocks.completeSession.mockRejectedValueOnce(new Error('network'))
    await session.complete(STOCK_REQ)
    expect(localStorage.getItem(STORAGE_KEYS.completionIntent)).not.toBeNull()

    await session.complete(STOCK_REQ)
    // API 成功だけでは消さない（成功直後に端末が落ちても replay できるようにする）
    expect(localStorage.getItem(STORAGE_KEYS.completionIntent)).not.toBeNull()

    session.ackCompletionFinalized('abc-123')
    expect(localStorage.getItem(STORAGE_KEYS.completionIntent)).toBeNull()
  })

  it('サーバーが拒否した（4xx）ら保存分を消す', async () => {
    mocks.completeSession.mockRejectedValueOnce(new Error('network'))
    await session.complete(STOCK_REQ)

    mocks.completeSession.mockRejectedValueOnce(httpError(400, 'snapshot_mismatch'))
    await session.complete(STOCK_REQ)
    expect(localStorage.getItem(STORAGE_KEYS.completionIntent)).toBeNull()
    expect(session.completionUnknown.value).toBe(false)
  })

  // markActive は updateSession の失敗を握り潰し、端末側だけ active にしていた。
  // server が 409 session_completed を返しても端末は「進行中」と信じ続ける。
  it('active の保存が失敗したら端末側も active にしない', async () => {
    mocks.updateSession.mockRejectedValueOnce(httpError(409, 'session_completed'))
    const res = await session.markActive(2)

    expect(res.ok).toBe(false)
    expect(res.reason).toBe('session_completed')
    expect(session.pendingSession.value.status).not.toBe('active')
  })

  it('active の保存が通信断でも端末側を active にしない', async () => {
    session.pendingSession.value.status = 'incomplete'
    mocks.updateSession.mockRejectedValueOnce(new Error('network'))
    const res = await session.markActive(2)

    expect(res.ok).toBe(false)
    expect(session.pendingSession.value.status).toBe('incomplete')
  })
})

// ── アカウント切替と完了応答の競合（レビュー指摘2）──────────────────────────
//
// 切替時に _completing の参照を消しても、実行中の Promise は止まらない。
// 旧アカウントの応答が後から返ると、その時点の pendingSession を completed にし、
// 呼び出し側は旧 snapshot を現在の履歴へ確定して現在の draft を消していた。
describe('useSession — 旧アカウントの完了応答が新アカウントを壊さない', () => {
  let session

  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    mocks.isAuthenticated.value = true
    mocks.shopCode.value = 'ABCDEF'
    session = useSession()
    session.begin({ ...SESSION })
  })

  it('アカウント切替後に返った応答は現在のセッションへ適用しない', async () => {
    let release
    mocks.completeSession.mockImplementationOnce(() => new Promise(r => {
      release = () => r({ ok: true, type: 'stock', snapshotSaved: true })
    }))
    const inflight = session.complete(STOCK_REQ)

    // 別アカウントへ切替 → 新しいセッションを開始
    resetLocalData()
    mocks.shopCode.value = 'ZZZZZZ'
    session.begin({ id: 'new-1', shopCode: 'ZZZZZZ', status: 'active', itemCount: 0 })

    release()
    const res = await inflight

    expect(res.ok).toBe(false)
    expect(res.stale).toBe(true)
    // 新アカウントのセッションは触られていない
    expect(session.pendingSession.value.id).toBe('new-1')
    expect(session.pendingSession.value.status).toBe('active')
    expect(session.completionUnknown.value).toBe(false)
    expect(localStorage.getItem(STORAGE_KEYS.completionIntent)).toBeNull()
  })

  it('同じアカウントで別セッションへ移った後の応答も適用しない', async () => {
    let release
    mocks.completeSession.mockImplementationOnce(() => new Promise(r => {
      release = () => r({ ok: true, type: 'stock', snapshotSaved: true })
    }))
    const inflight = session.complete(STOCK_REQ)

    session.begin({ id: 'other-1', shopCode: 'ABCDEF', status: 'active', itemCount: 0 })
    release()
    const res = await inflight

    expect(res.stale).toBe(true)
    expect(session.pendingSession.value.status).toBe('active')
  })

  it('失敗の応答も、切替後は結果不明フラグを立てない', async () => {
    let reject
    mocks.completeSession.mockImplementationOnce(() => new Promise((_, rj) => { reject = rj }))
    const inflight = session.complete(STOCK_REQ)

    resetLocalData()
    mocks.shopCode.value = 'ZZZZZZ'
    session.begin({ id: 'new-1', shopCode: 'ZZZZZZ', status: 'active', itemCount: 0 })

    reject(new Error('network'))
    const res = await inflight

    expect(res.stale).toBe(true)
    expect(session.completionUnknown.value).toBe(false)
  })
})

// ══ 再レビュー §1: 完了payloadをAPI送信前にdurable化する ══════════════════════
//
// 旧実装は `completeSessionApi()` を呼び、**catch の中で**初めて intent を保存していた。
// 送信中に PC・ブラウザ・タブが落ちると catch は実行されない。サーバーでは完了済みでも
// 端末には送った body が残らず、再読込後に同じ完了要求を再送できない。
describe('useSession — 完了requestは送信前にdurable化する', () => {
  let session

  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    mocks.isAuthenticated.value = true
    mocks.shopCode.value = 'ABCDEF'
    session = useSession()
    session.begin({ ...SESSION })
  })

  const savedIntent = () => {
    const raw = localStorage.getItem(STORAGE_KEYS.completionIntent)
    return raw ? JSON.parse(raw) : null
  }

  it('APIのPromiseが未解決のうちに、完全なbodyが端末へ保存されている', async () => {
    // 応答が返らないまま端末が落ちる状況。resolve も reject もしない
    mocks.completeSession.mockImplementationOnce(() => new Promise(() => {}))
    session.complete(STOCK_REQ)
    await Promise.resolve()

    const saved = savedIntent()
    expect(saved).not.toBeNull()
    expect(saved.sessionId).toBe('abc-123')
    expect(saved.shopCode).toBe('ABCDEF')
    expect(saved.type).toBe('stock')
    expect(saved.body).toEqual(STOCK_REQ.body)      // body 全体が残っている
    expect(saved.v).toBeGreaterThanOrEqual(1)       // schema version
  })

  it('未解決のまま再読込しても、結果不明として復帰し同じbodyを再送できる', async () => {
    mocks.completeSession.mockImplementationOnce(() => new Promise(() => {}))
    session.complete(STOCK_REQ)
    await Promise.resolve()

    // ここで端末が落ちる（catch は走らない）。module を作り直して復帰する
    const reloaded = await reloadSession()
    reloaded.restore()

    expect(reloaded.completionUnknown.value).toBe(true)
    const kept = reloaded.pendingCompletionIntent()
    expect(kept.body).toEqual(STOCK_REQ.body)

    await reloaded.complete(kept)
    expect(mocks.completeSession).toHaveBeenLastCalledWith('abc-123', STOCK_REQ.body)
  })

  it('保存に失敗したら完了APIを呼ばない（入力は保持する）', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k) => {
      if (k === STORAGE_KEYS.completionIntent) throw new DOMException('QuotaExceededError')
    })
    const res = await session.complete(STOCK_REQ)
    setItem.mockRestore()

    expect(mocks.completeSession).not.toHaveBeenCalled()
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('intent_not_persisted')
    expect(res.retryable).toBe(true)
    // セッションは残り、完了扱いにもならない
    expect(session.pendingSession.value.id).toBe('abc-123')
    expect(session.pendingSession.value.status).not.toBe('completed')
  })

  it('body を落とした marker だけで送信しない', async () => {
    let stored = null
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k, v) => {
      if (k !== STORAGE_KEYS.completionIntent) return
      const parsed = JSON.parse(v)
      if (parsed.body) throw new DOMException('QuotaExceededError')   // 本体は入らない
      stored = parsed                                                 // marker なら通る
    })
    await session.complete(STOCK_REQ)
    setItem.mockRestore()

    expect(mocks.completeSession).not.toHaveBeenCalled()
    expect(stored).toBeNull()   // marker への切り下げもしない
  })

  // API成功 = 端末側の確定完了ではない。成功直後に端末が落ちると、履歴も後片付けも
  // 済んでいないのに intent だけ消えている状態になる。
  it('API成功後もackされるまでintentは残る', async () => {
    const res = await session.complete(STOCK_REQ)
    expect(res.ok).toBe(true)
    expect(savedIntent()).not.toBeNull()
    expect(savedIntent().phase).toBe('confirmed')
    expect(session.completionUnknown.value).toBe(true)   // まだ端末側は確定していない
  })

  it('ackCompletionFinalized でだけintentが消える', async () => {
    await session.complete(STOCK_REQ)
    expect(savedIntent()).not.toBeNull()

    const acked = session.ackCompletionFinalized('abc-123')
    expect(acked).toBe(true)
    expect(savedIntent()).toBeNull()
    expect(session.completionUnknown.value).toBe(false)
  })

  it('別sessionのackではintentを消さない', async () => {
    await session.complete(STOCK_REQ)
    expect(session.ackCompletionFinalized('other-1')).toBe(false)
    expect(savedIntent()).not.toBeNull()
  })

  it('API成功後に端末が落ちても、保存済みintentから再開できる', async () => {
    await session.complete(STOCK_REQ)   // ack しないまま落ちる

    const reloaded = await reloadSession()
    reloaded.restore()
    expect(reloaded.completionUnknown.value).toBe(true)
    expect(reloaded.pendingCompletionIntent().body).toEqual(STOCK_REQ.body)
  })

  it('サーバーが内容を拒否した（4xx）ら保存分を消す', async () => {
    mocks.completeSession.mockRejectedValueOnce(httpError(400, 'snapshot_mismatch'))
    await session.complete(STOCK_REQ)
    expect(savedIntent()).toBeNull()
    expect(session.completionUnknown.value).toBe(false)
  })
})

// ══ 再レビュー §2: 全てのasync lifecycle処理にgenerationを適用する ═════════════
describe('useSession — 旧accountの非同期応答を全経路で失効させる', () => {
  let session

  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    mocks.isAuthenticated.value = true
    mocks.shopCode.value = 'ABCDEF'
    session = useSession()
    session.begin({ ...SESSION })
  })

  function deferred() {
    let resolve, reject
    const promise = new Promise((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
  }

  /** B店舗へ切り替えて新しいセッションを開始する */
  function switchToShopB() {
    resetLocalData()
    mocks.shopCode.value = 'ZZZZZZ'
    session.begin({ id: 'b-1', shopCode: 'ZZZZZZ', status: 'active', itemCount: 0 })
  }

  it('verifyCompletion: 保留中にaccount切替 → B店舗へ適用しない', async () => {
    mocks.completeSession.mockRejectedValueOnce(new Error('network'))
    await session.complete(STOCK_REQ)
    expect(session.completionUnknown.value).toBe(true)

    const gate = deferred()
    mocks.getSessions.mockImplementationOnce(() => gate.promise)
    const verifying = session.verifyCompletion()

    switchToShopB()
    const bIntentBefore = localStorage.getItem(STORAGE_KEYS.completionIntent)

    gate.resolve([{ id: 'abc-123', status: 'completed' }])
    const res = await verifying

    expect(res.stale).toBe(true)
    expect(res.ok).toBe(false)
    // B店舗の状態は一切変わらない
    expect(session.pendingSession.value.id).toBe('b-1')
    expect(session.pendingSession.value.status).toBe('active')
    expect(session.completionUnknown.value).toBe(false)
    expect(localStorage.getItem(STORAGE_KEYS.completionIntent)).toBe(bIntentBefore)
    expect(mocks.completeSession).toHaveBeenCalledTimes(1)   // B店舗の完了APIは呼ばれない
  })

  it('verifyCompletion: 同一店舗でも別sessionへ移っていたら適用しない', async () => {
    mocks.completeSession.mockRejectedValueOnce(new Error('network'))
    await session.complete(STOCK_REQ)

    const gate = deferred()
    mocks.getSessions.mockImplementationOnce(() => gate.promise)
    const verifying = session.verifyCompletion()

    session.begin({ id: 'other-1', shopCode: 'ABCDEF', status: 'active', itemCount: 0 })
    gate.resolve([{ id: 'abc-123', status: 'completed' }])

    expect((await verifying).stale).toBe(true)
    expect(session.pendingSession.value.status).toBe('active')
  })

  it('markActive: 保留中にaccount切替 → 成功応答をB店舗へ適用しない', async () => {
    const gate = deferred()
    mocks.updateSession.mockImplementationOnce(() => gate.promise)
    session.pendingSession.value.status = 'incomplete'
    const marking = session.markActive(3)

    switchToShopB()
    gate.resolve({ ok: true })
    const res = await marking

    expect(res.stale).toBe(true)
    expect(session.pendingSession.value.id).toBe('b-1')
  })

  it('markActive: 409 session_completed でもB店舗へ適用しない', async () => {
    const gate = deferred()
    mocks.updateSession.mockImplementationOnce(() => gate.promise)
    const marking = session.markActive(3)

    switchToShopB()
    gate.reject(httpError(409, 'session_completed'))
    const res = await marking

    expect(res.stale).toBe(true)
    expect(session.pendingSession.value.id).toBe('b-1')
    expect(session.pendingSession.value.status).not.toBe('completed')
  })

  it('markActive: 通信エラーでもB店舗へ適用しない', async () => {
    const gate = deferred()
    mocks.updateSession.mockImplementationOnce(() => gate.promise)
    const marking = session.markActive(3)

    switchToShopB()
    gate.reject(new Error('network'))
    const res = await marking

    expect(res.stale).toBe(true)
    expect(session.pendingSession.value.id).toBe('b-1')
    expect(session.pendingSession.value.status).toBe('active')
  })

  it('markActive: 同一店舗でも別sessionへ移っていたら適用しない', async () => {
    const gate = deferred()
    mocks.updateSession.mockImplementationOnce(() => gate.promise)
    session.pendingSession.value.status = 'incomplete'
    const marking = session.markActive(3)

    session.begin({ id: 'other-1', shopCode: 'ABCDEF', status: 'incomplete', itemCount: 0 })
    gate.resolve({ ok: true })

    expect((await marking).stale).toBe(true)
    expect(session.pendingSession.value.status).toBe('incomplete')
  })
})

// ══ 再レビュー §3: verifyCompletionでdurable intentを早期削除しない ═══════════
describe('useSession — verifyCompletion はintentを消さない', () => {
  let session

  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    mocks.isAuthenticated.value = true
    mocks.shopCode.value = 'ABCDEF'
    session = useSession()
    session.begin({ ...SESSION })
  })

  async function makeUnknown() {
    mocks.completeSession.mockRejectedValueOnce(new Error('network'))
    await session.complete(STOCK_REQ)
  }

  it('completed を確認しても保存済みbodyを残す', async () => {
    await makeUnknown()
    mocks.getSessions.mockResolvedValueOnce([{ id: 'abc-123', status: 'completed' }])
    const res = await session.verifyCompletion()

    expect(res).toMatchObject({ ok: true, completed: true })
    // 端末側の確定（履歴commit・後片付け）がまだなので消さない
    expect(localStorage.getItem(STORAGE_KEYS.completionIntent)).not.toBeNull()
    expect(session.pendingCompletionIntent().body).toEqual(STOCK_REQ.body)
    expect(session.completionUnknown.value).toBe(true)
  })

  it('active を確認したときも保存済みbodyを残す（同じbodyで再送する）', async () => {
    await makeUnknown()
    mocks.getSessions.mockResolvedValueOnce([{ id: 'abc-123', status: 'active' }])
    await session.verifyCompletion()

    expect(session.pendingCompletionIntent().body).toEqual(STOCK_REQ.body)
    expect(session.completionUnknown.value).toBe(true)
  })

  it('サーバー状態を取得できなければintentもcompletionUnknownも保持する', async () => {
    await makeUnknown()
    mocks.getSessions.mockRejectedValueOnce(new Error('offline'))
    const res = await session.verifyCompletion()

    expect(res.ok).toBe(false)
    expect(session.completionUnknown.value).toBe(true)
    expect(localStorage.getItem(STORAGE_KEYS.completionIntent)).not.toBeNull()
  })

  it('現在の在庫が空でも、保存済みintentから同じbodyを再送できる', async () => {
    await makeUnknown()
    const reloaded = await reloadSession()
    reloaded.restore()
    // 端末の在庫・audit log が失われた状態を模す（intent だけが残っている）
    localStorage.removeItem('inventory_v1')

    mocks.getSessions.mockResolvedValueOnce([{ id: 'abc-123', status: 'completed' }])
    await reloaded.verifyCompletion()

    const kept = reloaded.pendingCompletionIntent()
    expect(kept.body).toEqual(STOCK_REQ.body)
    expect(kept.snapshot).toEqual(STOCK_REQ.body.snapshot)
  })
})

// ══ 再レビュー: lifecycle世代（同じsessionIdの再開でも旧Promiseを失効させる）═══
//
// 世代を account reset でしか進めていないと、同一店舗・同一 sessionId で resume した
// 場合に origin 照合がすべて一致し、前のライフサイクルの応答が新しい方へ適用される。
describe('useSession — 同じsessionIdを開き直しても旧Promiseは失効する', () => {
  let session

  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    mocks.isAuthenticated.value = true
    mocks.shopCode.value = 'ABCDEF'
    session = useSession()
    session.begin({ ...SESSION })
  })

  function deferred() {
    let resolve, reject
    const promise = new Promise((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
  }

  // 旧応答は無視するが、**再送に必要な body は捨てない**。捨てると、サーバーだけ
  // completed で端末は active という状態へ戻れなくなる（再レビュー2 §2）。
  it('complete: resume で開き直しても未確定intentは残す（旧応答は無視）', async () => {
    const gate = deferred()
    mocks.completeSession.mockImplementationOnce(() => gate.promise)
    const inflight = session.complete(STOCK_REQ)

    session.resume({ ...SESSION })        // 同じ sessionId で開き直す
    gate.resolve({ ok: true, type: 'stock', snapshotSaved: true })

    expect((await inflight).stale).toBe(true)
    expect(session.pendingSession.value.status).toBe('active')

    // 同じ店舗・同じ session の未確定 intent は保持される
    const kept = session.pendingCompletionIntent()
    expect(kept.body).toEqual(STOCK_REQ.body)
    expect(session.completionUnknown.value).toBe(true)
    // 結果が確定するまで active も書かない
    expect((await session.markActive(1)).reason).toBe('completion_unknown')
  })

  it('別sessionを開始したら未確定intentは持ち越さない', async () => {
    mocks.completeSession.mockRejectedValueOnce(new Error('network'))
    await session.complete(STOCK_REQ)
    expect(localStorage.getItem(STORAGE_KEYS.completionIntent)).not.toBeNull()

    session.begin({ id: 'other-1', shopCode: 'ABCDEF', status: 'active', itemCount: 0 })
    expect(localStorage.getItem(STORAGE_KEYS.completionIntent)).toBeNull()
    expect(session.completionUnknown.value).toBe(false)
  })

  it('別店舗の同じsessionIdでは持ち越さない', async () => {
    mocks.completeSession.mockRejectedValueOnce(new Error('network'))
    await session.complete(STOCK_REQ)

    mocks.shopCode.value = 'ZZZZZZ'
    session.resume({ ...SESSION, shopCode: 'ZZZZZZ' })
    expect(localStorage.getItem(STORAGE_KEYS.completionIntent)).toBeNull()
    expect(session.completionUnknown.value).toBe(false)
  })

  it('markActive: resume で開き直したら旧応答を適用しない', async () => {
    const gate = deferred()
    mocks.updateSession.mockImplementationOnce(() => gate.promise)
    session.pendingSession.value.status = 'incomplete'
    const marking = session.markActive(3)

    session.resume({ ...SESSION, status: 'incomplete' })
    gate.resolve({ ok: true })

    expect((await marking).stale).toBe(true)
    expect(session.pendingSession.value.status).toBe('incomplete')
  })

  it('verifyCompletion: resume で開き直したら旧応答を適用しない', async () => {
    mocks.completeSession.mockRejectedValueOnce(new Error('network'))
    await session.complete(STOCK_REQ)

    const gate = deferred()
    mocks.getSessions.mockImplementationOnce(() => gate.promise)
    const verifying = session.verifyCompletion()

    session.resume({ ...SESSION })
    gate.resolve([{ id: 'abc-123', status: 'completed' }])

    expect((await verifying).stale).toBe(true)
    expect(session.pendingSession.value.status).toBe('active')
  })

  it('lifecycle世代は外から確認できる（App の await 後の再確認用）', async () => {
    const token = session.captureLifecycle()
    expect(session.isLifecycleStale(token)).toBe(false)

    session.resume({ ...SESSION })
    expect(session.isLifecycleStale(token)).toBe(true)
  })
})
