// 履歴の新旧判定を server revision で行う（DATA-001 §4）
//
// 端末時計（savedAt / updatedAt）で新旧を決めると、時計がずれた端末の訂正が
// 「古い」と判定されてリモートの版に潰される。判定は
//   1. serverRevision（第一優先）
//   2. serverSavedAt（revision を返さない旧サーバー・旧行の fallback）
//   3. 端末でだけ訂正した状態（dirty）は、サーバーが取り込むまで残す
// の順で行う。
import { describe, it, expect, beforeEach, vi } from 'vitest'

async function freshHistory() {
  vi.resetModules()
  const mod = await import('./useHistory.js')
  return mod.useHistory()
}

const S1 = 'sess-1'

const snap = (extra = {}) => ({
  sessionId: S1,
  date: '2026-08-10',
  savedAt: '2026-08-10T10:00:00.000Z',
  items: [{ item: 'トマト', qty: 1, unitPrice: null, subtotal: null }],
  ...extra,
})

const qtyOf = (h) => h.getSnapshotBySessionId(S1)?.items[0]?.qty
const nameOf = (h) => h.getSnapshotBySessionId(S1)?.items[0]?.item

describe('serverRevision を第一優先にする', () => {
  beforeEach(() => { localStorage.clear() })

  it('revision が新しければ端末時計に関係なく取り込む', async () => {
    const h = await freshHistory()
    h.applyRemoteHistory([snap({ serverRevision: 5, items: [{ item: '端末', qty: 1 }] })])
    h.applyRemoteHistory([snap({
      serverRevision: 6,
      savedAt: '2000-01-01T00:00:00.000Z',   // client時計はずっと過去
      items: [{ item: '新しいサーバー版', qty: 9 }],
    })])
    expect(nameOf(h)).toBe('新しいサーバー版')
  })

  it('revision が古ければ端末時計が過去でも取り込まない', async () => {
    const h = await freshHistory()
    h.applyRemoteHistory([snap({ serverRevision: 6, items: [{ item: '端末', qty: 1 }] })])
    h.applyRemoteHistory([snap({
      serverRevision: 5,
      savedAt: '2099-01-01T00:00:00.000Z',   // client時計は未来
      items: [{ item: '古いサーバー版', qty: 9 }],
    })])
    expect(nameOf(h)).toBe('端末')
  })

  it('同一秒に2回保存されても revision で順序が付く（serverSavedAt では付かない）', async () => {
    const h = await freshHistory()
    const sameSecond = '2026-08-10T12:00:00.000Z'
    h.applyRemoteHistory([snap({ serverRevision: 7, serverSavedAt: sameSecond, items: [{ item: '後', qty: 2 }] })])
    h.applyRemoteHistory([snap({ serverRevision: 6, serverSavedAt: sameSecond, items: [{ item: '先', qty: 1 }] })])
    expect(nameOf(h)).toBe('後')
  })

  it('revision を持たない側は serverSavedAt へ落ちる（legacy fallback）', async () => {
    const h = await freshHistory()
    h.applyRemoteHistory([snap({ serverSavedAt: '2026-08-10T10:00:00.000Z', items: [{ item: '古い', qty: 1 }] })])
    h.applyRemoteHistory([snap({ serverSavedAt: '2026-08-10T12:00:00.000Z', items: [{ item: '新しい', qty: 9 }] })])
    expect(nameOf(h)).toBe('新しい')
  })
})

describe('端末の訂正は端末時計に依存せず残る', () => {
  beforeEach(() => { localStorage.clear() })

  it('訂正した版は、あとから来た古いリモートで消えない', async () => {
    const h = await freshHistory()
    h.applyRemoteHistory([snap({ serverRevision: 3 })])
    h.patchSnapshotItems(S1, { トマト: { qty: 99 } })
    expect(qtyOf(h)).toBe(99)

    // サーバーはまだ訂正を知らない（revision は据え置き）
    h.applyRemoteHistory([snap({ serverRevision: 3, items: [{ item: 'トマト', qty: 1 }] })])
    expect(qtyOf(h)).toBe(99)
  })

  it('端末時計が過去へずれていても訂正は残る', async () => {
    const h = await freshHistory()
    h.applyRemoteHistory([snap({ serverRevision: 3 })])

    // 訂正の updatedAt が 2000年になる状況（端末時計が大きく過去）
    const realNow = Date.now
    vi.spyOn(Date.prototype, 'toISOString').mockReturnValue('2000-01-01T00:00:00.000Z')
    h.patchSnapshotItems(S1, { トマト: { qty: 77 } })
    vi.restoreAllMocks()
    Date.now = realNow

    h.applyRemoteHistory([snap({
      serverRevision: 3,
      serverSavedAt: '2026-08-10T12:00:00.000Z',
      items: [{ item: 'トマト', qty: 1 }],
    })])
    expect(qtyOf(h)).toBe(77)     // client時計で比較していた旧実装はここで消していた
  })

  it('端末時計が未来へずれていても、サーバーが訂正を取り込めば以後はサーバーを正とする', async () => {
    const h = await freshHistory()
    h.applyRemoteHistory([snap({ serverRevision: 3 })])
    h.patchSnapshotItems(S1, { トマト: { qty: 77 } })

    // 送信成功 → dirty を下ろし、サーバーの revision を書き戻す
    h.markSnapshotSynced(S1, { serverRevision: 4, serverSavedAt: '2026-08-10T12:00:00.000Z' })

    // 別端末がさらに訂正した版（revision 5）は取り込む
    h.applyRemoteHistory([snap({ serverRevision: 5, items: [{ item: 'トマト', qty: 5 }] })])
    expect(qtyOf(h)).toBe(5)
  })

  it('送信に成功していない訂正は、リロード後も dirty のまま残る', async () => {
    const h = await freshHistory()
    h.applyRemoteHistory([snap({ serverRevision: 3 })])
    h.patchSnapshotItems(S1, { トマト: { qty: 88 } })

    const reopened = await freshHistory()
    expect(reopened.getSnapshotBySessionId(S1).items[0].qty).toBe(88)
    reopened.applyRemoteHistory([snap({ serverRevision: 3, items: [{ item: 'トマト', qty: 1 }] })])
    expect(reopened.getSnapshotBySessionId(S1).items[0].qty).toBe(88)
  })
})

describe('完了スナップショットはサーバー成功後にだけ端末へ確定する', () => {
  beforeEach(() => { localStorage.clear() })

  it('buildSnapshot は端末へ書かない', async () => {
    const h = await freshHistory()
    const built = h.buildSnapshot(
      { トマト: { qty: 3, unit: '個' } }, {}, ['トマト'], {}, ['トマト'], [], null, null, S1,
    )
    expect(built.sessionId).toBe(S1)
    expect(built.items).toHaveLength(1)
    // 端末にはまだ何も無い
    expect(h.getSnapshots()).toHaveLength(0)
    expect(localStorage.getItem('inventory_history_v1')).toBeNull()
  })

  it('commitSnapshot でサーバー確認済みとして確定する', async () => {
    const h = await freshHistory()
    const built = h.buildSnapshot(
      { トマト: { qty: 3, unit: '個' } }, {}, ['トマト'], {}, ['トマト'], [], null, null, S1,
    )
    h.commitSnapshot(built, { serverRevision: 1, serverSavedAt: '2026-08-10T12:00:00.000Z' })

    const stored = h.getSnapshotBySessionId(S1)
    expect(stored.items[0].qty).toBe(3)
    expect(stored.synced).toBe(true)
    expect(stored.dirty).toBe(false)
    expect(stored.serverRevision).toBe(1)
  })

  it('入力が空なら組み立てない', async () => {
    const h = await freshHistory()
    expect(h.buildSnapshot({}, {}, [], {}, [], [], null, null, S1)).toBeNull()
    expect(h.commitSnapshot(null)).toBeNull()
  })
})
