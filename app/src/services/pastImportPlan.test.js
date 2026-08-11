/**
 * IMPORT-001 — 過去棚卸取込の計画・確定・取消（client側）。
 *
 * 守りたいのは3つ。
 *   ・取り込む前に何が起きるか出る（同じ日に既存があるときの選択を含む）
 *   ・サーバーが sessionId を返した日だけを「取り込めた」とする
 *   ・取消はサーバー結果を確認してから端末を消し、取込ぶんだけを消す
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  buildPastImportPlan, withResolution, unresolvedConflicts,
  commitPastImport, cancelPastImport,
  ON_CONFLICT_ADD, ON_CONFLICT_REPLACE,
} from './pastImportPlan.js'
import { useHistory } from '../composables/useHistory.js'

const snaps = [
  { date: '2026-05-01', items: [{ item: '米', qty: 20, unitPrice: 100 }, { item: '豚', qty: 2, unitPrice: 500 }] },
  { date: '2026-05-08', items: [{ item: '米', qty: 12 }] },
]

describe('buildPastImportPlan', () => {
  it('日数・品目数・金額を計画へ出す', () => {
    const plan = buildPastImportPlan(snaps)
    expect(plan.totals).toMatchObject({ days: 2, items: 3, conflicts: 0 })
    expect(plan.days[0].totalValue).toBe(20 * 100 + 2 * 500)
    expect(plan.days[1].totalValue).toBeNull()      // 単価が無い日は金額なし
    expect(plan.importBatchId).toMatch(/^imp_/)
  })

  it('同じ日の既存セッションを衝突として出す', () => {
    const plan = buildPastImportPlan(snaps, {
      existing: [{ date: '2026-05-01', sessionId: 'sess-1', items: [{}, {}], source: 'stocktake' }],
    })
    expect(plan.totals.conflicts).toBe(1)
    expect(plan.days[0].collisions).toEqual([
      { sessionId: 'sess-1', source: 'stocktake', itemCount: 2, importBatchId: null },
    ])
  })

  it('既定は非破壊（別セッションとして追加）', () => {
    const plan = buildPastImportPlan(snaps, { existing: [{ date: '2026-05-01', sessionId: 's', items: [] }] })
    expect(plan.days[0].resolution).toBe(ON_CONFLICT_ADD)
    expect(unresolvedConflicts(plan)).toEqual([])
  })

  it('withResolution は計画を書き換えず、選択済みの複製を返す', () => {
    const plan = buildPastImportPlan(snaps, { existing: [{ date: '2026-05-01', sessionId: 's', items: [] }] })
    const next = withResolution(plan, '2026-05-01', ON_CONFLICT_REPLACE)
    expect(plan.days[0].resolution).toBe(ON_CONFLICT_ADD)     // 元は不変
    expect(next.days[0].resolution).toBe(ON_CONFLICT_REPLACE)
    expect(next.days[1].resolution).toBe(ON_CONFLICT_ADD)
  })

  it('空の入力は計画にしない', () => {
    expect(() => buildPastImportPlan([])).toThrow()
    expect(() => buildPastImportPlan(null)).toThrow()
  })
})

describe('commitPastImport', () => {
  it('サーバーが sessionId を返した日だけを端末へ反映する', async () => {
    const plan = buildPastImportPlan(snaps)
    const saveToServer = vi.fn(async (_b, p) =>
      p.date === '2026-05-08'
        ? { _status: 503, error: '保存できませんでした' }
        : { ok: true, sessionId: `sess-${p.date}`, itemCount: p.items.length })
    const applyLocal = vi.fn()

    const r = await commitPastImport(plan, { saveToServer, applyLocal })

    expect(r.ok).toBe(false)
    expect(r.saved.map(s => s.date)).toEqual(['2026-05-01'])
    expect(r.failed.map(f => f.date)).toEqual(['2026-05-08'])
    expect(applyLocal).toHaveBeenCalledTimes(1)
    expect(applyLocal).toHaveBeenCalledWith(expect.objectContaining({
      date: '2026-05-01', sessionId: 'sess-2026-05-01', importBatchId: plan.importBatchId,
    }))
  })

  it('サーバーが ok でも sessionId を返さなければ「取り込めた」としない', async () => {
    const plan = buildPastImportPlan([snaps[0]])
    const applyLocal = vi.fn()
    const r = await commitPastImport(plan, {
      saveToServer: async () => ({ ok: true }), applyLocal,
    })
    expect(r.saved).toEqual([])
    expect(r.failed).toHaveLength(1)
    expect(applyLocal).not.toHaveBeenCalled()
  })

  it('通信例外でも端末へ反映せず、retryable を伝える', async () => {
    const plan = buildPastImportPlan([snaps[0]])
    const applyLocal = vi.fn()
    const err = Object.assign(new Error('offline'), { body: { retryable: true } })
    const r = await commitPastImport(plan, { saveToServer: async () => { throw err }, applyLocal })

    expect(r.saved).toEqual([])
    expect(r.failed[0]).toMatchObject({ date: '2026-05-01', retryable: true })
    expect(applyLocal).not.toHaveBeenCalled()
  })

  it('全ての日が同じ importBatchId で送られる', async () => {
    const plan = buildPastImportPlan(snaps)
    const seen = []
    await commitPastImport(plan, {
      saveToServer: async (b, p) => { seen.push(b); return { ok: true, sessionId: `s-${p.date}` } },
      applyLocal: () => {},
    })
    expect(new Set(seen)).toEqual(new Set([plan.importBatchId]))
  })

  it('追加を選んだ日は上書き対象を送らない', async () => {
    const plan = buildPastImportPlan([snaps[0]], {
      existing: [{ date: '2026-05-01', sessionId: 'sess-1', items: [] }],
    })
    const payloads = []
    await commitPastImport(plan, {
      saveToServer: async (_b, p) => { payloads.push(p); return { ok: true, sessionId: 'new' } },
      applyLocal: () => {},
    })
    expect(payloads[0].replaceSessionIds).toEqual([])
  })

  it('上書きを選んだ日だけ、既存 sessionId を明示して送る', async () => {
    let plan = buildPastImportPlan([snaps[0]], {
      existing: [{ date: '2026-05-01', sessionId: 'sess-1', items: [] }],
    })
    plan = withResolution(plan, '2026-05-01', ON_CONFLICT_REPLACE)

    const payloads = []
    await commitPastImport(plan, {
      saveToServer: async (_b, p) => { payloads.push(p); return { ok: true, sessionId: 'new' } },
      applyLocal: () => {},
    })
    expect(payloads[0].replaceSessionIds).toEqual(['sess-1'])
  })

  it('sessionId を持たない legacy 行は上書き対象に含めない（サーバーで消せないため）', async () => {
    let plan = buildPastImportPlan([snaps[0]], {
      existing: [{ date: '2026-05-01', sessionId: null, items: [] }],
    })
    plan = withResolution(plan, '2026-05-01', ON_CONFLICT_REPLACE)

    const payloads = []
    await commitPastImport(plan, {
      saveToServer: async (_b, p) => { payloads.push(p); return { ok: true, sessionId: 'new' } },
      applyLocal: () => {},
    })
    expect(payloads[0].replaceSessionIds).toEqual([])
  })
})

describe('cancelPastImport', () => {
  it('サーバーの成功を確認してから端末を消す', async () => {
    const deleteLocal = vi.fn(() => 2)
    const r = await cancelPastImport('imp_x', {
      cancelOnServer: async () => ({ ok: true, removed: 2 }),
      deleteLocal,
    })
    expect(r).toMatchObject({ ok: true, removedOnServer: 2, removedLocally: 2 })
    expect(deleteLocal).toHaveBeenCalledWith('imp_x')
  })

  it('サーバーが失敗したら端末を消さない', async () => {
    const deleteLocal = vi.fn()
    await expect(cancelPastImport('imp_x', {
      cancelOnServer: async () => ({ _status: 503, error: '取り消せませんでした' }),
      deleteLocal,
    })).rejects.toThrow('取り消せませんでした')
    expect(deleteLocal).not.toHaveBeenCalled()
  })
})

describe('端末側の履歴との通し（sessionId モデルへの接続）', () => {
  beforeEach(() => { localStorage.clear() })

  function freshHistory() {
    const h = useHistory()
    for (const s of h.getSnapshots()) h.deleteSnapshot(h.snapshotKey(s))
    return h
  }

  it('取込は sessionId キーで保存され、同じ日の通常棚卸を潰さない', async () => {
    const h = freshHistory()
    // 同じ日に通常の棚卸がある状態を作る
    h.importPastSnapshot({ date: '2026-05-01', items: [{ item: '既存', qty: 1 }], sessionId: 'normal-1' })

    const plan = buildPastImportPlan([snaps[0]], { existing: h.getSnapshots() })
    await commitPastImport(plan, {
      saveToServer: async () => ({ ok: true, sessionId: 'imported-1' }),
      applyLocal: h.importPastSnapshot,
    })

    const all = h.getSnapshots().filter(s => s.date === '2026-05-01')
    expect(all).toHaveLength(2)
    expect(h.getSnapshotBySessionId('normal-1')).not.toBeNull()
    expect(h.getSnapshotBySessionId('imported-1')).not.toBeNull()
  })

  it('カレンダー（一覧）と詳細が同じ sessionId を指す', async () => {
    const h = freshHistory()
    const plan = buildPastImportPlan([snaps[0]])
    await commitPastImport(plan, {
      saveToServer: async () => ({ ok: true, sessionId: 'imported-9' }),
      applyLocal: h.importPastSnapshot,
    })

    const listed = h.getSnapshots()[0]
    expect(h.snapshotKey(listed)).toBe('imported-9')
    expect(h.getSnapshotBySessionId('imported-9').items[0].item).toBe('米')
  })

  it('バッチ取消は取込ぶんだけを消し、通常の棚卸と別バッチを残す', async () => {
    const h = freshHistory()
    h.importPastSnapshot({ date: '2026-04-01', items: [{ item: '通常', qty: 1 }], sessionId: 'normal-1' })
    h.importPastSnapshot({ date: '2026-04-02', items: [{ item: '別', qty: 1 }], sessionId: 'other-1', importBatchId: 'imp_other' })

    const plan = buildPastImportPlan(snaps)
    await commitPastImport(plan, {
      saveToServer: async (_b, p) => ({ ok: true, sessionId: `imp-${p.date}` }),
      applyLocal: h.importPastSnapshot,
    })
    expect(h.getSnapshots()).toHaveLength(4)

    const r = await cancelPastImport(plan.importBatchId, {
      cancelOnServer: async () => ({ ok: true, removed: 2 }),
      deleteLocal: h.deleteImportBatchLocal,
    })

    expect(r.removedLocally).toBe(2)
    const left = h.getSnapshots().map(s => s.sessionId).sort()
    expect(left).toEqual(['normal-1', 'other-1'])
  })

  it('取消後に同じ内容を再取込しても重複しない（sessionId が正本）', async () => {
    const h = freshHistory()
    const plan = buildPastImportPlan(snaps)
    const server = async (_b, p) => ({ ok: true, sessionId: `imp-${p.date}` })

    await commitPastImport(plan, { saveToServer: server, applyLocal: h.importPastSnapshot })
    await cancelPastImport(plan.importBatchId, {
      cancelOnServer: async () => ({ ok: true, removed: 2 }),
      deleteLocal: h.deleteImportBatchLocal,
    })
    await commitPastImport(plan, { saveToServer: server, applyLocal: h.importPastSnapshot })

    expect(h.getSnapshots()).toHaveLength(2)
  })

  it('取込バッチの一覧を取消前に確認できる', async () => {
    const h = freshHistory()
    const plan = buildPastImportPlan(snaps)
    await commitPastImport(plan, {
      saveToServer: async (_b, p) => ({ ok: true, sessionId: `imp-${p.date}` }),
      applyLocal: h.importPastSnapshot,
    })
    expect(h.getImportBatch(plan.importBatchId).map(s => s.date).sort())
      .toEqual(['2026-05-01', '2026-05-08'])
  })
})
