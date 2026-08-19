// 履歴 ack のversion競合（DATA-001 / App第2セッション §5）
//
// snapshot A を送信している最中に、同じセッションの snapshot B を作る（訂正・ロック）。
// A の応答が返ったとき、旧実装は `markSnapshotSynced(key)` が **その時点で key に
// 入っているオブジェクト**（＝B）を無条件に clean（dirty:false / synced:true）にしていた。
// B はサーバーへ一度も送られていないのに「送信済み」になり、
//   - バックフィルの対象から外れる
//   - リモートの古い版で潰されうる（dirty でなくなるため）
// という形で訂正が黙って消える。
//
// ack は「送った版」にだけ効かせる。snapshot ごとに localRev を持たせ、
// 送信時に捕まえた localRev と一致するときだけ clean にする。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { STORAGE_KEYS } from '../utils/storageKeys.js'
import { missingSnapshots } from '../services/historyBackfill.js'

async function freshHistory() {
  vi.resetModules()
  const mod = await import('./useHistory.js')
  return mod.useHistory()
}

const SNAP = (over = {}) => ({
  date: '2026-08-12',
  sessionId: 'sess-A',
  savedAt: '2026-08-12T01:00:00Z',
  items: [{ item: 'トマト', qty: 3, unit: '個', unitPrice: 100, subtotal: 300 }],
  totalValue: 300,
  ...over,
})

describe('snapshot ack は送った版にだけ効く', () => {
  beforeEach(() => { localStorage.clear() })

  it('A送信中にBを作ると、Aのack後もBはdirtyのまま残る', async () => {
    const h = await freshHistory()
    h.commitSnapshot(SNAP(), { serverRevision: 1, serverSavedAt: '2026-08-12T01:00:01Z' })

    // A: 端末で訂正した版（未送信）。ここで送信を開始したとみなす
    const a = h.patchSnapshotItems('sess-A', { トマト: { qty: 5 } })
    expect(a.dirty).toBe(true)
    const sentRev = a.localRev
    expect(typeof sentRev).toBe('number')

    // 送信の応答が返る前に、同じセッションのBを作る
    const b = h.patchSnapshotItems('sess-A', { トマト: { qty: 9 } })
    expect(b.localRev).not.toBe(sentRev)

    // Aの応答が返った（Aの版に対する ack）
    h.markSnapshotSynced('sess-A', { serverRevision: 2, serverSavedAt: '2026-08-12T02:00:00Z' }, sentRev)

    const current = h.getSnapshotBySessionId('sess-A')
    expect(current.items[0].qty).toBe(9)     // 端末の最新はB
    expect(current.dirty).toBe(true)         // Bは未送信のまま
    expect(current.synced).toBe(false)
  })

  it('dirtyに残ったBはバックフィルの再送対象になる', async () => {
    const h = await freshHistory()
    h.commitSnapshot(SNAP(), { serverRevision: 1 })
    const a = h.patchSnapshotItems('sess-A', { トマト: { qty: 5 } })
    h.patchSnapshotItems('sess-A', { トマト: { qty: 9 } })
    h.markSnapshotSynced('sess-A', { serverRevision: 2 }, a.localRev)

    // サーバーにはAの内容（qty:5）が入っている状態
    const remote = [{ ...SNAP(), items: [{ item: 'トマト', qty: 5 }], serverRevision: 2 }]
    const toSend = missingSnapshots(h.getSnapshots(), remote)
    expect(toSend).toHaveLength(1)
    expect(toSend[0].items[0].qty).toBe(9)
  })

  it('リロード（再生成）してもBは失われず、まだdirty', async () => {
    const h = await freshHistory()
    h.commitSnapshot(SNAP(), { serverRevision: 1 })
    const a = h.patchSnapshotItems('sess-A', { トマト: { qty: 5 } })
    h.patchSnapshotItems('sess-A', { トマト: { qty: 9 } })
    h.markSnapshotSynced('sess-A', { serverRevision: 2 }, a.localRev)

    // localStorage から作り直す＝リロード
    expect(localStorage.getItem(STORAGE_KEYS.history)).not.toBeNull()
    const reloaded = await freshHistory()
    const snap = reloaded.getSnapshotBySessionId('sess-A')
    expect(snap.items[0].qty).toBe(9)
    expect(snap.dirty).toBe(true)
  })

  it('送った版のままなら ack で clean になる（正常系）', async () => {
    const h = await freshHistory()
    h.commitSnapshot(SNAP(), { serverRevision: 1 })
    const a = h.patchSnapshotItems('sess-A', { トマト: { qty: 5 } })

    h.markSnapshotSynced('sess-A', { serverRevision: 3, serverSavedAt: '2026-08-12T03:00:00Z' }, a.localRev)

    const snap = h.getSnapshotBySessionId('sess-A')
    expect(snap.dirty).toBe(false)
    expect(snap.synced).toBe(true)
    expect(snap.serverRevision).toBe(3)
  })

  it('リモート反映で入れ替わった版も、古いackでcleanにならない', async () => {
    const h = await freshHistory()
    h.commitSnapshot(SNAP(), { serverRevision: 1 })
    const a = h.patchSnapshotItems('sess-A', { トマト: { qty: 5 } })

    // 送信中にリモートの版が届いて置き換わった（dirty は remote に負けないが、
    // ここでは synced な状態から remote が勝つ経路を作る）
    h.markSnapshotSynced('sess-A', { serverRevision: 2 }, a.localRev)   // 一度 clean
    h.applyRemoteHistory([{ ...SNAP(), items: [{ item: 'トマト', qty: 7 }], serverRevision: 5 }])

    // 古い ack（Aの版）が遅れて届いても、いまのオブジェクトを触らない
    const before = { ...h.getSnapshotBySessionId('sess-A') }
    h.markSnapshotSynced('sess-A', { serverRevision: 2 }, a.localRev)
    const after = h.getSnapshotBySessionId('sess-A')
    expect(after.serverRevision).toBe(before.serverRevision)
    expect(after.items[0].qty).toBe(7)
  })

  it('lockOtherSnapshots も版を進める（送信中のackでロックが消えない）', async () => {
    const h = await freshHistory()
    h.commitSnapshot(SNAP(), { serverRevision: 1 })
    const a = h.patchSnapshotItems('sess-A', { トマト: { qty: 5 } })

    const [locked] = h.lockOtherSnapshots('sess-B')   // sess-A をロック対象にする
    expect(locked.sessionId).toBe('sess-A')
    expect(locked.localRev).not.toBe(a.localRev)

    h.markSnapshotSynced('sess-A', { serverRevision: 2 }, a.localRev)
    const snap = h.getSnapshotBySessionId('sess-A')
    expect(snap.locked).toBe(true)
    expect(snap.dirty).toBe(true)   // ロックの送信はまだ
  })
})
