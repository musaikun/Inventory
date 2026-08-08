// DATA-002 Phase 2 — D1 履歴の取り込みが端末側の新しいスナップショットを潰さないこと。
// 潰すと、未送信のスナップショットが D1 の古い版で上書きされ、
// バックフィルで送るべき差分ごと消える（＝詳細が復旧できなくなる）。
import { describe, it, expect, beforeEach, vi } from 'vitest'

async function freshHistory() {
  vi.resetModules()
  const mod = await import('./useHistory.js')
  return mod.useHistory()
}

const snap = (date, savedAt, qty) => ({
  date, savedAt, items: [{ item: 'トマト', qty, unitPrice: null, subtotal: null }],
})

describe('applyRemoteHistory（D1履歴の取り込み）', () => {
  beforeEach(() => { localStorage.clear() })

  it('端末に無い日付はリモートを取り込む', async () => {
    const h = await freshHistory()
    h.applyRemoteHistory([snap('2026-07-07', '2026-07-07T10:00:00Z', 3)])
    expect(h.getSnapshots().map(s => s.date)).toEqual(['2026-07-07'])
  })

  it('リモートが新しければ上書きする', async () => {
    const h = await freshHistory()
    h.applyRemoteHistory([snap('2026-07-07', '2026-07-07T10:00:00Z', 3)])
    h.applyRemoteHistory([snap('2026-07-07', '2026-07-08T10:00:00Z', 9)])
    expect(h.getSnapshots()[0].items[0].qty).toBe(9)
  })

  it('端末側が新しければ残す（未送信分をリモートの古い版で潰さない）', async () => {
    const h = await freshHistory()
    h.applyRemoteHistory([snap('2026-07-07', '2026-07-09T10:00:00Z', 9)])
    h.applyRemoteHistory([snap('2026-07-07', '2026-07-07T10:00:00Z', 3)])
    expect(h.getSnapshots()[0].items[0].qty).toBe(9)
  })

  it('保存時刻が同じならリモートを採用する（従来どおり）', async () => {
    const h = await freshHistory()
    h.applyRemoteHistory([snap('2026-07-07', '2026-07-07T10:00:00Z', 3)])
    h.applyRemoteHistory([snap('2026-07-07', '2026-07-07T10:00:00Z', 9)])
    expect(h.getSnapshots()[0].items[0].qty).toBe(9)
  })

  it('訂正で updatedAt が付いた端末側のスナップショットは残る', async () => {
    const h = await freshHistory()
    h.applyRemoteHistory([{ ...snap('2026-07-07', '2026-07-07T10:00:00Z', 3), updatedAt: '2026-07-10T10:00:00Z' }])
    h.applyRemoteHistory([snap('2026-07-07', '2026-07-08T10:00:00Z', 9)])
    expect(h.getSnapshots()[0].items[0].qty).toBe(3)
  })
})
