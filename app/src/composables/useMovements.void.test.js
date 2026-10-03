// 入出庫の取り消し（印を付けて残す）・24時間以内の元に戻す・別端末での取り消しの反映
import { describe, it, expect, beforeEach, vi } from 'vitest'

let mv
beforeEach(async () => {
  localStorage.clear()
  vi.resetModules()
  const mod = await import('./useMovements.js')
  mv = { ...mod.useMovements(), canRestoreMovement: mod.canRestoreMovement }
})

describe('入出庫の取り消し', () => {
  it('取り消した記録は有効な一覧から外れ、全件には残る', () => {
    const r = mv.saveMovement({ type: 'in', lines: [{ item: '豆', qty: 3 }] })
    mv.voidMovement(r.id)
    expect(mv.getMovements()).toHaveLength(0)
    expect(mv.getAllMovements()[0].deletedAt).toBeTruthy()
  })

  it('元に戻せるのは取り消してから24時間以内', () => {
    const r = mv.saveMovement({ type: 'out', lines: [{ item: '豆', qty: 1 }] })
    const v = mv.voidMovement(r.id)
    const at = Date.parse(v.deletedAt)
    expect(mv.restoreMovement(r.id, at + 25 * 3600_000)).toBeNull()
    expect(mv.restoreMovement(r.id, at + 3600_000)).not.toBeNull()
    expect(mv.getMovements()).toHaveLength(1)
  })

  it('サーバーの取り消しを反映する。送信待ちの端末側の変更は保つ', () => {
    const a = mv.saveMovement({ type: 'in', lines: [{ item: '豆', qty: 1 }] })
    const b = mv.saveMovement({ type: 'in', lines: [{ item: '豆', qty: 2 }] })
    mv.voidMovement(b.id)   // 送信待ち
    mv.applyRemoteMovements([
      { id: a.id, deletedAt: '2026-10-03T00:00:00Z', by: '佐藤' },
      { id: b.id, deletedAt: null },
    ])
    const all = Object.fromEntries(mv.getAllMovements().map(m => [m.id, m]))
    expect(all[a.id].deletedAt).toBeTruthy()
    expect(all[a.id].by).toBe('佐藤')
    expect(all[b.id].deletedAt).toBeTruthy()   // 端末側の取り消しを保つ
    mv.markMovementSynced(b.id)
    mv.applyRemoteMovements([{ id: b.id, deletedAt: null }])
    expect(mv.getMovements().map(m => m.id).sort()).toEqual([b.id].sort())
  })
})
