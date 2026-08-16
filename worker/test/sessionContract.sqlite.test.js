/**
 * セッション完了の公開契約（DATA-002 第1修正セッション §1 / §5）。
 *
 * ここで固定するのは3点。
 *   1. `sessions.type` ごとに完了契約が違う。stock は canonical snapshot を必ず持ち、
 *      order は snapshot を持たない（正本は orders / order_lines）。
 *   2. 一度 completed になったセッションは、後から届いた active 更新で再開できない。
 *      完了応答を取りこぼした client の遅れた touch が、明細ごと巻き戻していた。
 *   3. 応答の `serverRevision` は「その要求が確定させた revision」でなければならない。
 *      write の外で独立に SELECT すると、別要求の revision を自分の応答として返す。
 *
 * 実SQLite（全migration適用）で動かす。SQL そのものが要点のため。
 */
import { describe, it, expect } from 'vitest'
import { createD1 } from './d1Harness.js'
import {
  handleSessionComplete, handleSessionUpdate, handleSessionsGet, handleSessionLinesGet,
  handleHistoryPost,
} from '../src/storeHandler.js'

const CODE  = 'SHOPAA'
const OTHER = 'SHOPBB'
const SID   = '11111111-1111-4111-8111-111111111111'
const OID   = '22222222-2222-4222-8222-222222222222'

const inventory = (n = 3) => Object.fromEntries(
  Array.from({ length: n }, (_, i) => [`品目${i}`, { qty: i + 1, unit: '個' }]),
)
const prices = (n = 3) => Object.fromEntries(
  Array.from({ length: n }, (_, i) => [`品目${i}`, 100]),
)

/** App の buildSnapshot が作る形（未入力品目は qty:null で残る）。 */
function clientSnapshot(n = 3, { extraItems = [], date = '2026-08-09' } = {}) {
  return {
    date,
    savedAt: '2026-08-09T10:00:00.000Z',
    sessionId: SID,
    items: [
      ...Array.from({ length: n }, (_, i) => ({
        item: `品目${i}`, qty: i + 1, unit: '個', unitPrice: 100, subtotal: (i + 1) * 100,
        code: `C${i}`, flagged: false, category: '冷蔵', lotSize: '', prevMonth: '', tagA: '', tagB: '',
      })),
      ...extraItems,
    ],
    totalValue: 600,
    entryLog: [], participants: null, flaggedItems: [], auditLog: [],
    activeMs: 1000, axisNames: ['', ''],
  }
}

function setup({ type = 'stock', status = 'active' } = {}) {
  const h = createD1()
  h.seedStore(CODE, { sessionId: SID, status, type })
  h.seedStore(OTHER)
  return h
}

const sessionRow = (h, id = SID) => h.rows('SELECT * FROM sessions WHERE id = ?', id)[0]
const historyOf  = (h, code = CODE) => h.rows('SELECT * FROM store_history WHERE shop_code = ?', code)
const linesOf    = (h, code = CODE) => h.rows('SELECT * FROM inventory_lines WHERE shop_code = ?', code)

// ── §1 stock セッションの完了契約 ────────────────────────────────────────────
describe('stock セッションの完了契約', () => {
  it('snapshot の主要項目を server が canonical 化して保存する', async () => {
    const h = setup()
    const res = await handleSessionComplete(h.db, CODE, SID, {
      inventory: inventory(3), prices: prices(3), takenAt: '2026-08-09',
      // client が itemCount / totalValue / sessionId / date を偽っても採用しない
      snapshot: { ...clientSnapshot(3), sessionId: 'spoofed', totalValue: 999999, itemCount: 999 },
    })

    expect(res._status).toBeUndefined()
    expect(res.ok).toBe(true)
    expect(res.snapshotSaved).toBe(true)
    expect(res.type).toBe('stock')
    expect(res.itemCount).toBe(3)
    expect(res.totalValue).toBe(600)

    const snap = JSON.parse(historyOf(h)[0].snapshot_json)
    expect(snap.sessionId).toBe(SID)
    expect(snap.date).toBe('2026-08-09')
    expect(snap.type).toBe('stock')
    expect(snap.itemCount).toBe(3)
    expect(snap.totalValue).toBe(600)
    expect(snap.items.filter(i => i.qty != null)).toHaveLength(3)
  })

  it('inventory rows に無い品目を「入力済み」と主張する snapshot を拒否する（何も書かない）', async () => {
    const h = setup()
    const res = await handleSessionComplete(h.db, CODE, SID, {
      inventory: inventory(3), prices: prices(3), takenAt: '2026-08-09',
      snapshot: clientSnapshot(3, {
        extraItems: [{ item: '偽装品目', qty: 99, unit: '個', unitPrice: 1, subtotal: 99 }],
      }),
    })

    expect(res._status).toBe(400)
    expect(res.code).toBe('snapshot_mismatch')
    expect(sessionRow(h).status).toBe('active')
    expect(linesOf(h)).toHaveLength(0)
    expect(historyOf(h)).toHaveLength(0)
  })

  it('inventory rows のうち snapshot に載っていないものがあれば拒否する', async () => {
    const h = setup()
    const res = await handleSessionComplete(h.db, CODE, SID, {
      inventory: inventory(3), prices: prices(3), takenAt: '2026-08-09',
      snapshot: clientSnapshot(2),        // 品目2 が欠けている
    })
    expect(res._status).toBe(400)
    expect(res.code).toBe('snapshot_mismatch')
    expect(historyOf(h)).toHaveLength(0)
  })

  it('items が空の snapshot をそのまま保存しない', async () => {
    const h = setup()
    const res = await handleSessionComplete(h.db, CODE, SID, {
      inventory: inventory(3), prices: prices(3), takenAt: '2026-08-09',
      snapshot: { date: '2026-08-09', items: [] },
    })
    expect(res._status).toBe(400)
    expect(res.code).toBe('snapshot_mismatch')
    expect(historyOf(h)).toHaveLength(0)
  })

  it('inventory 0件の完了は 400 empty_inventory で拒否する（公開契約）', async () => {
    const h = setup()
    const res = await handleSessionComplete(h.db, CODE, SID, {
      inventory: {}, prices: {}, takenAt: '2026-08-09',
      snapshot: { date: '2026-08-09', items: [] },
    })
    expect(res._status).toBe(400)
    expect(res.code).toBe('empty_inventory')
    expect(res.snapshotSaved).toBeUndefined()
    expect(sessionRow(h).status).toBe('active')
    expect(historyOf(h)).toHaveLength(0)
  })

  it('allowlist 外の metadata を snapshot へ持ち込ませない', async () => {
    const h = setup()
    const res = await handleSessionComplete(h.db, CODE, SID, {
      inventory: inventory(3), prices: prices(3), takenAt: '2026-08-09',
      snapshot: { ...clientSnapshot(3), evil: { a: 1 }, dirty: true, synced: true, serverRevision: 9999 },
    })
    expect(res.ok).toBe(true)
    const snap = JSON.parse(historyOf(h)[0].snapshot_json)
    expect(snap.evil).toBeUndefined()
    expect(snap.dirty).toBeUndefined()
    expect(snap.synced).toBeUndefined()
    expect(snap.serverRevision).toBeUndefined()
    expect(snap.activeMs).toBe(1000)
  })

  it('metadata の件数上限を超える配列を切り詰める', async () => {
    const h = setup()
    // 上限（500件）を大きく超えつつ MAX_PAYLOAD_BYTES（1MB）には収まる件数。
    // 「バイト数では止まらないが件数では止まる」ことを見るため。
    const huge = Array.from({ length: 1200 }, (_, i) => ({
      id: `e${i}`, ingredient: '品目0', action: 'set', delta: 1, totalQty: 1,
      unit: '個', enteredBy: 'a', timestamp: '2026-08-09T00:00:00.000Z',
    }))
    const res = await handleSessionComplete(h.db, CODE, SID, {
      inventory: inventory(3), prices: prices(3), takenAt: '2026-08-09',
      snapshot: { ...clientSnapshot(3), auditLog: huge, entryLog: huge },
    })
    expect(res.ok).toBe(true)
    const snap = JSON.parse(historyOf(h)[0].snapshot_json)
    expect(snap.auditLog.length).toBeLessThanOrEqual(500)
    expect(snap.entryLog.length).toBeLessThanOrEqual(500)
  })

  it('同じ完了要求の再送は安全で結果が変わらない（冪等）', async () => {
    const h = setup()
    const body = {
      inventory: inventory(3), prices: prices(3), takenAt: '2026-08-09', snapshot: clientSnapshot(3),
    }
    const a = await handleSessionComplete(h.db, CODE, SID, body)
    const b = await handleSessionComplete(h.db, CODE, SID, body)

    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
    expect(b.itemCount).toBe(a.itemCount)
    expect(b.totalValue).toBe(a.totalValue)
    expect(historyOf(h)).toHaveLength(1)
    expect(linesOf(h)).toHaveLength(3)
    expect(h.rows('SELECT * FROM sessions WHERE shop_code = ?', CODE)).toHaveLength(1)
  })
})

// ── §1 order セッションの完了契約 ────────────────────────────────────────────
describe('order セッションの完了契約', () => {
  it('snapshot 無しで完了でき、store_history を作らない', async () => {
    const h = setup({ type: 'order' })
    const res = await handleSessionComplete(h.db, CODE, SID, { itemCount: 4 })

    expect(res._status).toBeUndefined()
    expect(res.ok).toBe(true)
    expect(res.type).toBe('order')
    expect(res.snapshotSaved).toBe(false)
    expect(res.itemCount).toBe(4)

    const s = sessionRow(h)
    expect(s.status).toBe('completed')
    expect(s.item_count).toBe(4)
    expect(historyOf(h)).toHaveLength(0)
    expect(linesOf(h)).toHaveLength(0)
  })

  it('order へ stock 用 snapshot を送っても保存しない（400）', async () => {
    const h = setup({ type: 'order' })
    const res = await handleSessionComplete(h.db, CODE, SID, {
      inventory: inventory(3), prices: prices(3), snapshot: clientSnapshot(3),
    })
    expect(res._status).toBe(400)
    expect(res.code).toBe('snapshot_not_allowed')
    expect(historyOf(h)).toHaveLength(0)
    expect(sessionRow(h).status).toBe('active')
  })

  it('order 完了の再送は冪等（itemCount が保たれる）', async () => {
    const h = setup({ type: 'order' })
    await handleSessionComplete(h.db, CODE, SID, { itemCount: 4 })
    const b = await handleSessionComplete(h.db, CODE, SID, { itemCount: 4 })
    expect(b.ok).toBe(true)
    expect(sessionRow(h).item_count).toBe(4)
    expect(historyOf(h)).toHaveLength(0)
  })

  it('stock セッションへ snapshot 無しの完了要求は拒否する', async () => {
    const h = setup()
    const res = await handleSessionComplete(h.db, CODE, SID, {
      inventory: inventory(3), prices: prices(3),
    })
    expect(res._status).toBe(400)
    expect(res.code).toBe('snapshot_required')
    expect(sessionRow(h).status).toBe('active')
  })
})

// ── §1 状態遷移 ──────────────────────────────────────────────────────────────
describe('completed からの巻き戻しを防ぐ', () => {
  async function completeStock(h) {
    return handleSessionComplete(h.db, CODE, SID, {
      inventory: inventory(3), prices: prices(3), takenAt: '2026-08-09', snapshot: clientSnapshot(3),
    })
  }

  it('完了応答を取りこぼした後の active 更新でも completed のまま', async () => {
    const h = setup()
    await completeStock(h)

    const res = await handleSessionUpdate(h.db, CODE, SID, { status: 'active', itemCount: 1 })

    expect(res._status).toBe(409)
    expect(res.code).toBe('session_completed')
    const s = sessionRow(h)
    expect(s.status).toBe('completed')
    expect(s.item_count).toBe(3)
    expect(s.ended_at).not.toBeNull()
  })

  it('completed の明細と snapshot が active 更新で失われない', async () => {
    const h = setup()
    await completeStock(h)
    await handleSessionUpdate(h.db, CODE, SID, { status: 'active', itemCount: 0 })

    expect(linesOf(h)).toHaveLength(3)
    expect(historyOf(h)).toHaveLength(1)
    const detail = await handleSessionLinesGet(h.db, CODE, SID)
    expect(detail.itemCount).toBe(3)
    expect(detail.status).toBe('completed')
  })

  it('completed → incomplete も拒否する', async () => {
    const h = setup()
    await completeStock(h)
    const res = await handleSessionUpdate(h.db, CODE, SID, { status: 'incomplete', itemCount: 3 })
    expect(res._status).toBe(409)
    expect(sessionRow(h).status).toBe('completed')
  })

  it('completed → completed の再送は成功する（冪等）', async () => {
    const h = setup()
    await completeStock(h)
    const res = await handleSessionUpdate(h.db, CODE, SID, { status: 'completed', itemCount: 3 })
    expect(res.ok).toBe(true)
    expect(sessionRow(h).status).toBe('completed')
  })

  it('active → active は従来どおり通る', async () => {
    const h = setup()
    const res = await handleSessionUpdate(h.db, CODE, SID, { status: 'active', itemCount: 2 })
    expect(res.ok).toBe(true)
    expect(sessionRow(h).item_count).toBe(2)
  })

  it('他店舗のセッションIDは404（存在を漏らさない）', async () => {
    const h = setup()
    const res = await handleSessionUpdate(h.db, OTHER, SID, { status: 'active', itemCount: 1 })
    expect(res._status).toBe(404)
    expect(sessionRow(h).status).toBe('active')
  })

  it('一覧では order も stock も同じ type で返る', async () => {
    const h = setup()
    h.seedSession(CODE, OID, { type: 'order' })
    const list = await handleSessionsGet(h.db, CODE)
    expect(list.find(s => s.id === SID).type).toBe('stock')
    expect(list.find(s => s.id === OID).type).toBe('order')
  })
})

// ── §5 revision acknowledgement ───────────────────────────────────────────────
describe('revision は自分の write が確定させた値を返す', () => {
  it('完了応答の serverRevision が、その write の直後に別要求が入っても混ざらない', async () => {
    const h = setup()
    // 旧実装の「batch の外で独立 SELECT」する位置へ、別要求の write を割り込ませる。
    h.onNextBatch(() => {
      // batch 直前に別セッションの履歴を書いて revision を1つ進めておく
      h.sqlite.prepare(`
        INSERT INTO store_history (shop_code, session_id, snapshot_date, snapshot_json, created_at, updated_at, revision)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(CODE, 'other-session', '2026-08-08', '{"items":[]}', '2026-08-08T00:00:00.000Z', '2026-08-08T00:00:00.000Z', 41)
    })

    const res = await handleSessionComplete(h.db, CODE, SID, {
      inventory: inventory(3), prices: prices(3), takenAt: '2026-08-09', snapshot: clientSnapshot(3),
    })

    const mine = h.rows('SELECT revision FROM store_history WHERE shop_code = ? AND session_id = ?', CODE, SID)[0]
    expect(res.serverRevision).toBe(mine.revision)
    expect(res.serverRevision).toBe(42)
    expect(res.serverSavedAt).toBeTruthy()
  })

  it('revision の読み戻しは write と同じ batch にある（batch が落ちれば応答も失敗する）', async () => {
    const h = setup()
    // 品目3件の完了 batch は
    //   0: UPDATE sessions / 1: DELETE inventory_lines / 2: INSERT inventory_lines
    //   3: store_history upsert / 4: revision の読み戻し
    // 最終 statement（＝読み戻し）で落としても、部分状態が残らず retryable なエラーになる。
    h.failBatchAt(4)
    const res = await handleSessionComplete(h.db, CODE, SID, {
      inventory: inventory(3), prices: prices(3), takenAt: '2026-08-09', snapshot: clientSnapshot(3),
    })
    expect(res._status).toBe(503)
    expect(res.retryable).toBe(true)
    expect(sessionRow(h).status).toBe('active')
    expect(historyOf(h)).toHaveLength(0)
    expect(linesOf(h)).toHaveLength(0)
  })

  it('POST /history も自分の write の revision を返す', async () => {
    const h = setup()
    const a = await handleHistoryPost(h.db, CODE, {
      date: '2026-08-09', sessionId: SID, items: [{ item: '品目0', qty: 1 }],
    })
    const b = await handleHistoryPost(h.db, CODE, {
      date: '2026-08-10', sessionId: OID, items: [{ item: '品目0', qty: 1 }],
    })
    expect(a.serverRevision).toBe(1)
    expect(b.serverRevision).toBe(2)
    expect(a.serverSavedAt).toBeTruthy()

    const rows = h.rows('SELECT session_id, revision FROM store_history WHERE shop_code = ? ORDER BY revision', CODE)
    expect(rows.map(r => r.revision)).toEqual([1, 2])
  })

  it('revision を確定できないときは serverRevision:null で成功させない', async () => {
    const h = setup()
    h.failBatchAt(1)
    const res = await handleHistoryPost(h.db, CODE, {
      date: '2026-08-09', sessionId: SID, items: [{ item: '品目0', qty: 1 }],
    })
    expect(res.ok).toBeUndefined()
    expect(res._status).toBe(503)
    expect(res.retryable).toBe(true)
    expect(historyOf(h)).toHaveLength(0)
  })
})
