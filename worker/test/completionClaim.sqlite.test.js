/**
 * 完了契約の迂回・日付分裂・上書きを塞ぐ（DATA-002 再レビュー §1 / §2 / §3）。
 *
 * §1 汎用 PUT からの迂回:
 *   `PUT /sessions/:id` に `status:'completed'` を送るだけで完了扱いにできると、
 *   `inventory_lines` も `store_history` も持たない completed session を作れる。
 *   完了は必ず `POST /sessions/:id/complete` を通す。
 *
 * §2 棚卸日の一意性:
 *   `takenAt` と `snapshot.date` を別々に受理すると、明細が 08-09・履歴が 08-10 という
 *   分裂した記録を保存できてしまう。canonical 日付は検証済み `takenAt` ひとつ。
 *
 * §3 完了済みの上書き:
 *   complete の UPDATE に現在 status の条件が無いと、完了後に別内容の complete を送って
 *   明細・snapshot・件数・revision を差し替えられる。**最初の1要求だけが確定できる**。
 *   同一 intent の再送だけが冪等成功し、異なる intent は 409。
 *   勝者判定は timestamp ではなく、server が作る fingerprint の claim 行が持つ。
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createD1 } from './d1Harness.js'
import {
  handleSessionComplete, handleSessionUpdate, handleSessionLinesGet, handleHistoryGet,
} from '../src/storeHandler.js'

const CODE = 'SHOPAA'
const SID  = '11111111-1111-4111-8111-111111111111'

const inventory = (n = 3, qty = i => i + 1) => Object.fromEntries(
  Array.from({ length: n }, (_, i) => [`品目${i}`, { qty: qty(i), unit: '個' }]),
)

function snapFor(inv, { sessionId = SID, date = undefined } = {}) {
  return {
    ...(date === undefined ? {} : { date }),
    sessionId,
    items: Object.entries(inv).map(([item, v]) => ({ item, qty: v.qty, unit: v.unit ?? '' })),
  }
}

function setup({ type = 'stock', status = 'active' } = {}) {
  const h = createD1()
  h.seedStore(CODE, { sessionId: SID, status, type })
  return h
}

const sessionRow = (h, id = SID) => h.rows('SELECT * FROM sessions WHERE id = ?', id)[0]
const linesOf    = h => h.rows('SELECT * FROM inventory_lines WHERE shop_code = ?', CODE)
const historyOf  = h => h.rows('SELECT * FROM store_history WHERE shop_code = ?', CODE)

/** 既定の完了要求（3品目・単価あり） */
function completeBody({ inv = inventory(3), prices = { 品目0: 100, 品目1: 100, 品目2: 100 },
                        takenAt = '2026-08-09', date = undefined } = {}) {
  return { inventory: inv, prices, takenAt, snapshot: snapFor(inv, { date }) }
}

afterEach(() => { vi.useRealTimers() })

// ── §1 汎用PUTから完了契約を迂回させない ────────────────────────────────────
describe('汎用 PUT で完了契約を迂回できない', () => {
  it('active stock へ PUT completed は 409 で、lines も history も作られない', async () => {
    const h = setup()
    const res = await handleSessionUpdate(h.db, CODE, SID, { status: 'completed', itemCount: 3 })

    expect(res._status).toBe(409)
    expect(res.code).toBe('use_complete_endpoint')
    expect(sessionRow(h).status).toBe('active')
    expect(sessionRow(h).ended_at).toBeNull()
    expect(linesOf(h)).toHaveLength(0)
    expect(historyOf(h)).toHaveLength(0)
  })

  it('incomplete stock へ PUT completed も 409', async () => {
    const h = setup()
    await handleSessionUpdate(h.db, CODE, SID, { status: 'incomplete', itemCount: 1 })
    const res = await handleSessionUpdate(h.db, CODE, SID, { status: 'completed', itemCount: 3 })

    expect(res._status).toBe(409)
    expect(res.code).toBe('use_complete_endpoint')
    expect(sessionRow(h).status).toBe('incomplete')
  })

  it('active order へ PUT completed も 409', async () => {
    const h = setup({ type: 'order' })
    const res = await handleSessionUpdate(h.db, CODE, SID, { status: 'completed', itemCount: 4 })

    expect(res._status).toBe(409)
    expect(res.code).toBe('use_complete_endpoint')
    expect(sessionRow(h).status).toBe('active')
  })

  it('completed へ PUT completed は既存内容を変えずに冪等成功', async () => {
    const h = setup()
    await handleSessionComplete(h.db, CODE, SID, completeBody())
    const before = sessionRow(h)

    // 件数は上限内だが確定済みの値とは違うものを送る。無視されることを見る。
    const res = await handleSessionUpdate(h.db, CODE, SID, { status: 'completed', itemCount: 99 })

    expect(res.ok).toBe(true)
    const after = sessionRow(h)
    expect(after.item_count).toBe(before.item_count)
    expect(after.ended_at).toBe(before.ended_at)
    expect(after.total_value).toBe(before.total_value)
    expect(linesOf(h)).toHaveLength(3)
    expect(historyOf(h)).toHaveLength(1)
  })

  it('completed → active / incomplete は引き続き 409', async () => {
    for (const status of ['active', 'incomplete']) {
      const h = setup()
      await handleSessionComplete(h.db, CODE, SID, completeBody())
      const res = await handleSessionUpdate(h.db, CODE, SID, { status, itemCount: 1 })
      expect(res._status).toBe(409)
      expect(res.code).toBe('session_completed')
      expect(sessionRow(h).status).toBe('completed')
    }
  })

  it('active → active / incomplete は従来どおり通る', async () => {
    const h = setup()
    expect((await handleSessionUpdate(h.db, CODE, SID, { status: 'active', itemCount: 2 })).ok).toBe(true)
    expect((await handleSessionUpdate(h.db, CODE, SID, { status: 'incomplete', itemCount: 2 })).ok).toBe(true)
    expect(sessionRow(h).status).toBe('incomplete')
  })
})

// ── §2 棚卸日を一意にする ────────────────────────────────────────────────────
describe('棚卸日は takenAt ひとつで決まる', () => {
  it('takenAt と snapshot.date が同じなら成功し、保存先すべてで日付が一致する', async () => {
    const h = setup()
    const res = await handleSessionComplete(h.db, CODE, SID, completeBody({ date: '2026-08-09' }))

    expect(res.ok).toBe(true)
    expect(res.date).toBe('2026-08-09')

    expect([...new Set(linesOf(h).map(r => r.taken_at))]).toEqual(['2026-08-09'])
    const hist = historyOf(h)[0]
    expect(hist.snapshot_date).toBe('2026-08-09')
    expect(JSON.parse(hist.snapshot_json).date).toBe('2026-08-09')

    const detail = await handleSessionLinesGet(h.db, CODE, SID)
    expect(detail.date).toBe('2026-08-09')
    const [row] = await handleHistoryGet(h.db, CODE)
    expect(row.date).toBe('2026-08-09')
  })

  it('snapshot.date 省略時は takenAt を使う', async () => {
    const h = setup()
    const res = await handleSessionComplete(h.db, CODE, SID, completeBody({ takenAt: '2026-08-09' }))

    expect(res.ok).toBe(true)
    expect(historyOf(h)[0].snapshot_date).toBe('2026-08-09')
    expect(JSON.parse(historyOf(h)[0].snapshot_json).date).toBe('2026-08-09')
    expect([...new Set(linesOf(h).map(r => r.taken_at))]).toEqual(['2026-08-09'])
  })

  it('takenAt と snapshot.date が違えば 400 で、何も書かない', async () => {
    const h = setup()
    const res = await handleSessionComplete(h.db, CODE, SID,
      completeBody({ takenAt: '2026-08-09', date: '2026-08-10' }))

    expect(res._status).toBe(400)
    expect(res.code).toBe('snapshot_date_mismatch')
    expect(sessionRow(h).status).toBe('active')
    expect(linesOf(h)).toHaveLength(0)
    expect(historyOf(h)).toHaveLength(0)
  })

  it('不正な日付は従来どおり 400', async () => {
    const h = setup()
    expect((await handleSessionComplete(h.db, CODE, SID,
      completeBody({ takenAt: 'yesterday' })))._status).toBe(400)
    expect((await handleSessionComplete(h.db, CODE, SID,
      completeBody({ takenAt: '2026-08-09', date: '2026-02-30' })))._status).toBe(400)
    expect(historyOf(h)).toHaveLength(0)
  })
})

// ── §3 完了済みsessionを別payloadで上書きさせない ───────────────────────────
describe('完了は最初の1要求だけが確定できる', () => {
  it('まったく同じ完了要求の再送は同じ結果を返す', async () => {
    const h = setup()
    const a = await handleSessionComplete(h.db, CODE, SID, completeBody())
    const b = await handleSessionComplete(h.db, CODE, SID, completeBody())

    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
    expect(b.itemCount).toBe(a.itemCount)
    expect(b.totalValue).toBe(a.totalValue)
    expect(b.serverRevision).toBe(a.serverRevision)
    expect(linesOf(h)).toHaveLength(3)
    expect(historyOf(h)).toHaveLength(1)
  })

  it.each([
    ['数量が違う', () => completeBody({ inv: inventory(3, i => i + 10) })],
    ['単価が違う', () => completeBody({ prices: { 品目0: 999, 品目1: 100, 品目2: 100 } })],
    ['日付が違う', () => completeBody({ takenAt: '2026-08-10' })],
    ['品目が違う', () => completeBody({ inv: inventory(2) })],
  ])('%s 再送は 409 で、元の記録を変更しない', async (_label, makeBody) => {
    const h = setup()
    const first = await handleSessionComplete(h.db, CODE, SID, completeBody())
    expect(first.ok).toBe(true)

    const beforeLines = linesOf(h)
    const beforeHist  = historyOf(h)[0]
    const beforeSess  = sessionRow(h)

    const res = await handleSessionComplete(h.db, CODE, SID, makeBody())

    expect(res._status).toBe(409)
    expect(res.code).toBe('completion_intent_conflict')

    expect(linesOf(h)).toEqual(beforeLines)
    expect(historyOf(h)[0].snapshot_json).toBe(beforeHist.snapshot_json)
    expect(historyOf(h)[0].revision).toBe(beforeHist.revision)
    expect(sessionRow(h).item_count).toBe(beforeSess.item_count)
    expect(sessionRow(h).total_value).toBe(beforeSess.total_value)
    expect(sessionRow(h).ended_at).toBe(beforeSess.ended_at)
  })

  it('order は同じ itemCount の再送だけ成功し、違えば 409', async () => {
    const h = setup({ type: 'order' })
    const a = await handleSessionComplete(h.db, CODE, SID, { itemCount: 4 })
    const b = await handleSessionComplete(h.db, CODE, SID, { itemCount: 4 })
    const c = await handleSessionComplete(h.db, CODE, SID, { itemCount: 7 })

    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
    expect(c._status).toBe(409)
    expect(c.code).toBe('completion_intent_conflict')
    expect(sessionRow(h).item_count).toBe(4)
  })

  it('同一ミリ秒に届いた異なる2要求は、片方だけが勝ち混合状態を作らない', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-16T00:00:00.000Z'))

    const h = setup()
    const bodyA = completeBody({ inv: inventory(3) })
    const bodyB = completeBody({ inv: inventory(2, () => 50) })

    const [a, b] = await Promise.all([
      handleSessionComplete(h.db, CODE, SID, bodyA),
      handleSessionComplete(h.db, CODE, SID, bodyB),
    ])

    const winners = [a, b].filter(r => r.ok)
    const losers  = [a, b].filter(r => r._status === 409)
    expect(winners).toHaveLength(1)
    expect(losers).toHaveLength(1)
    expect(losers[0].code).toBe('completion_intent_conflict')

    // session・lines・history がすべて勝者の内容で揃っていること（混合が無い）
    const win   = winners[0]
    const lines = linesOf(h)
    const hist  = historyOf(h)
    expect(lines).toHaveLength(win.itemCount)
    expect(hist).toHaveLength(1)
    const snap = JSON.parse(hist[0].snapshot_json)
    expect(snap.itemCount).toBe(win.itemCount)
    expect(snap.items.filter(i => i.qty != null)).toHaveLength(win.itemCount)
    expect(sessionRow(h).item_count).toBe(win.itemCount)
    expect(sessionRow(h).total_value).toBe(win.totalValue)
    // 敗者の品目が1件でも混ざっていない
    const names = new Set(lines.map(r => r.item_name))
    expect(names.size).toBe(win.itemCount)
  })

  it('別内容の再送後も詳細APIは最初の内容を返す', async () => {
    const h = setup()
    await handleSessionComplete(h.db, CODE, SID, completeBody())
    await handleSessionComplete(h.db, CODE, SID, completeBody({ inv: inventory(1) }))

    const detail = await handleSessionLinesGet(h.db, CODE, SID)
    expect(detail.itemCount).toBe(3)
    expect(detail.date).toBe('2026-08-09')
  })
})
