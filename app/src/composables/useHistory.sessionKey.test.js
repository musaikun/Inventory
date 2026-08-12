import { describe, it, expect, beforeEach } from 'vitest'
import { useHistory, resetLocalData } from './useHistory.js'
import { missingSnapshots } from '../services/historyBackfill.js'

// 第2セッション: sessionId を履歴の正本identityにする（DATA-002 / F-001）。
const h = useHistory()

const S1 = 'aaaaaaaa-1111-4111-8111-111111111111'
const S2 = 'bbbbbbbb-2222-4222-8222-222222222222'

function snap(sessionId, date, extra = {}) {
  return {
    date, sessionId, savedAt: `${date}T10:00:00.000Z`,
    items: [{ item: '牛乳', qty: 1, unit: '本', unitPrice: null, subtotal: null }],
    totalValue: null, entryLog: [], participants: null, flaggedItems: [],
    auditLog: [], activeMs: null, axisNames: ['', ''], ...extra,
  }
}

function put(...snaps) {
  h.applyRemoteHistory(snaps)
}

beforeEach(() => { localStorage.clear(); resetLocalData() })

describe('同日2セッションを別々に保持する', () => {
  it('同じ日でも sessionId が違えば両方残る', () => {
    put(snap(S1, '2026-08-09'), snap(S2, '2026-08-09'))
    expect(h.getSnapshots()).toHaveLength(2)
    expect(h.getSnapshotBySessionId(S1).sessionId).toBe(S1)
    expect(h.getSnapshotBySessionId(S2).sessionId).toBe(S2)
  })

  it('同じ日の別セッションを取り違えて返さない', () => {
    put(snap(S1, '2026-08-09', { items: [{ item: '牛乳', qty: 1 }] }),
        snap(S2, '2026-08-09', { items: [{ item: '砂糖', qty: 9 }] }))
    expect(h.getSnapshotBySessionId(S2).items[0].item).toBe('砂糖')
  })

  it('端末に無い sessionId は日付が一致しても返さない（fail-closed）', () => {
    put(snap(S1, '2026-08-09'))
    expect(h.getSnapshotBySessionId(S2)).toBeNull()
  })

  it('sessionId 指定の削除は同じ日の別セッションを消さない', () => {
    put(snap(S1, '2026-08-09'), snap(S2, '2026-08-09'))
    h.deleteSnapshot(S1)
    expect(h.getSnapshots().map(s => s.sessionId)).toEqual([S2])
  })

  it('legacy日付キーの削除は sessionId を持つ行を消さない', () => {
    put(snap(S1, '2026-08-09'), snap(null, '2026-08-09'))
    h.deleteSnapshot('2026-08-09')
    expect(h.getSnapshots().map(s => s.sessionId)).toEqual([S1])
  })

  it('同日は保存時刻の新しい順に並ぶ（一覧で潰れない）', () => {
    put(snap(S1, '2026-08-09', { savedAt: '2026-08-09T08:00:00.000Z' }),
        snap(S2, '2026-08-09', { savedAt: '2026-08-09T20:00:00.000Z' }))
    expect(h.getSnapshots().map(s => s.sessionId)).toEqual([S2, S1])
  })
})

describe('新旧判定は server 時刻を使う（client時計に依存しない）', () => {
  it('端末時計が未来でも、サーバーが新しければリモートを採る', () => {
    put(snap(S1, '2026-08-09', { serverSavedAt: '2026-08-09T10:00:00.000Z' }))
    h.applyRemoteHistory([snap(S1, '2026-08-09', {
      savedAt: '2000-01-01T00:00:00.000Z',            // client時刻はずっと過去
      serverSavedAt: '2026-08-09T12:00:00.000Z',      // サーバーは新しい
      items: [{ item: '砂糖', qty: 9 }],
    })])
    expect(h.getSnapshotBySessionId(S1).items[0].item).toBe('砂糖')
  })

  it('端末時計が過去でも、サーバーが古ければ端末を残す', () => {
    put(snap(S1, '2026-08-09', { serverSavedAt: '2026-08-09T12:00:00.000Z', items: [{ item: '端末', qty: 1 }] }))
    h.applyRemoteHistory([snap(S1, '2026-08-09', {
      savedAt: '2099-01-01T00:00:00.000Z',            // client時刻は未来
      serverSavedAt: '2026-08-09T10:00:00.000Z',      // サーバーは古い
      items: [{ item: '古いリモート', qty: 1 }],
    })])
    expect(h.getSnapshotBySessionId(S1).items[0].item).toBe('端末')
  })

  it('端末に未送信（server時刻なし）の版があればリモートで潰さない', () => {
    // 端末で作ったばかり = serverSavedAt を持たず、サーバー確認済み(synced)でもない
    h.applyRemoteHistory([snap(S1, '2026-08-09')])
    const local = h.getSnapshotBySessionId(S1)
    delete local.serverSavedAt
    delete local.synced
    local.items = [{ item: '未送信の訂正', qty: 5 }]

    h.applyRemoteHistory([snap(S1, '2026-08-09', {
      serverSavedAt: '2026-08-09T12:00:00.000Z',
      items: [{ item: '古いサーバー版', qty: 1 }],
    })])
    expect(h.getSnapshotBySessionId(S1).items[0].item).toBe('未送信の訂正')
  })
})

describe('バックフィルは端末時計が前後しても別sessionへ寄せない', () => {
  it('同日の別セッションを「送信済み」と誤判定しない', () => {
    const local  = [snap(S1, '2026-08-09'), snap(S2, '2026-08-09')]
    const remote = [snap(S1, '2026-08-09')]         // S2 だけ D1 に無い
    expect(missingSnapshots(local, remote).map(s => s.sessionId)).toEqual([S2])
  })

  it('端末時計が未来でも、同じ sessionId ならリモートが新しければ送らない', () => {
    const local  = [snap(S1, '2026-08-09', { savedAt: '2026-08-09T10:00:00.000Z' })]
    const remote = [snap(S1, '2026-08-09', { savedAt: '2026-08-09T20:00:00.000Z' })]
    expect(missingSnapshots(local, remote)).toEqual([])
  })

  it('sessionId を持たない過去取込は日付で突き合わせる', () => {
    const local  = [snap(null, '2026-07-07')]
    const remote = [snap(null, '2026-07-07')]
    expect(missingSnapshots(local, remote)).toEqual([])
    expect(missingSnapshots(local, [])).toHaveLength(1)
  })
})

describe('旧形式（日付キー）からの移行', () => {
  it('sessionId を持つ行は sessionId キーへ移り、同日2件が共存できる', () => {
    put(snap(S1, '2026-08-09'))
    // 保存済みJSONを直接見て、キーが sessionId になっていることを確認する
    const raw = JSON.parse(localStorage.getItem('inventory_history_v1'))
    expect(Object.keys(raw)).toContain(S1)
    expect(Object.keys(raw)).not.toContain('2026-08-09')
  })

  it('sessionId を持たない行は日付キーのまま', () => {
    put(snap(null, '2026-07-07'))
    const raw = JSON.parse(localStorage.getItem('inventory_history_v1'))
    expect(Object.keys(raw)).toEqual(['2026-07-07'])
  })
})

describe('別端末: 一覧 → 詳細 → CSV が同じ sessionId を使う', () => {
  it('server明細から組み立てた詳細とCSVが、選んだsessionIdのものになる', async () => {
    const { buildSnapshotFromLines } = await import('../services/snapshotFromLines.js')
    // 端末には S1 しかないが、開くのは S2（別端末で完了した回）
    put(snap(S1, '2026-08-09', { items: [{ item: '牛乳', qty: 1 }] }))

    const built = buildSnapshotFromLines({
      sessionId: S2, date: '2026-08-09', status: 'completed', itemCount: 1, totalValue: 900,
      lines: [{ item: '砂糖', qty: 9, unit: 'kg', unitPrice: 100, subtotal: 900 }],
    })

    expect(built.sessionId).toBe(S2)
    const csv = h.exportSnapshotCSV(built)
    expect(csv).toContain('砂糖')
    expect(csv).not.toContain('牛乳')          // 端末に残る同日の別セッションが混ざらない
    // 端末側の記録は書き換わっていない
    expect(h.getSnapshotBySessionId(S1).items[0].item).toBe('牛乳')
    expect(h.getSnapshotBySessionId(S2)).toBeNull()
  })
})
