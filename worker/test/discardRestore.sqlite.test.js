/**
 * 破棄したセッションを24時間だけ取り戻す（User要望 2026-10-01・migration 0018）。
 * 実SQLite（全migration適用）で、破棄 → 一覧 → 取り戻す → 期限切れで完全に消える、を固定する。
 */
import { describe, it, expect } from 'vitest'
import { createD1 } from './d1Harness.js'
import {
  handleSessionDelete, handleDiscardedList, handleSessionRestore, handleSessionsGet,
  purgeExpiredDiscarded, handleAuditAppend,
} from '../src/storeHandler.js'

const CODE = 'SHOPAA'
const OTHER = 'SHOPBB'
const SID = '11111111-1111-4111-8111-111111111111'
const SID2 = '22222222-2222-4222-8222-222222222222'

function setup() {
  const h = createD1()
  h.seedStore(CODE)
  h.seedStore(OTHER)
  h.seedSession(CODE, SID)
  return h
}
const draft = { inv: { トマト: { qty: 3, unit: '個' } }, activeMs: 1000, audit: [] }

describe('破棄は24時間取り戻せる', () => {
  it('破棄すると一覧から消え、取り戻せる一覧に出る', async () => {
    const h = setup()
    const res = await handleSessionDelete(h.db, CODE, SID, { draft })
    expect(res.ok).toBe(true)
    expect(res.restorableUntil).toBeTruthy()
    expect((await handleSessionsGet(h.db, CODE)).map(s => s.id)).not.toContain(SID)
    const list = await handleDiscardedList(h.db, CODE)
    expect(list.map(s => s.id)).toEqual([SID])
    // 他店舗には出ない
    expect(await handleDiscardedList(h.db, OTHER)).toEqual([])
  })

  it('取り戻すと中断中に戻り、下書きが返る', async () => {
    const h = setup()
    await handleSessionDelete(h.db, CODE, SID, { draft })
    const res = await handleSessionRestore(h.db, CODE, SID)
    expect(res.ok).toBe(true)
    expect(res.session.id).toBe(SID)
    expect(res.payload.draft.inv.トマト.qty).toBe(3)
    expect((await handleSessionsGet(h.db, CODE)).map(s => s.id)).toContain(SID)
    expect(await handleDiscardedList(h.db, CODE)).toEqual([])
  })

  it('下書きが無い端末から破棄しても、店舗の進行中在庫がこのセッションのものなら残す', async () => {
    const h = setup()
    h.sqlite.prepare('INSERT INTO store_inventory (shop_code, inventory_json, updated_at) VALUES (?, ?, ?)')
      .run(CODE, JSON.stringify({ sessionId: SID, inventory: { レタス: { qty: 2 } } }), '2026-10-01T00:00:00.000Z')
    await handleSessionDelete(h.db, CODE, SID)
    const res = await handleSessionRestore(h.db, CODE, SID)
    expect(res.payload.draft).toBeNull()
    expect(res.payload.storeInventory.inventory.レタス.qty).toBe(2)
  })

  it('同じ種類の進行中が別にあると取り戻さない（どちらが正か分からなくなる）', async () => {
    const h = setup()
    await handleSessionDelete(h.db, CODE, SID, { draft })
    h.seedSession(CODE, SID2)
    const res = await handleSessionRestore(h.db, CODE, SID)
    expect(res._status).toBe(409)
    expect(res.code).toBe('active_exists')
  })

  it('24時間を過ぎると取り戻せず、関連の行ごと完全に消える', async () => {
    const h = setup()
    await handleAuditAppend(h.db, CODE, SID, { entries: [{ id: 'e1', ingredient: 'トマト', action: 'new', totalQty: 1, unit: '個', enteredBy: 'A', at: 1000 }] })
    await handleSessionDelete(h.db, CODE, SID, { draft })
    await purgeExpiredDiscarded(h.db, CODE, Date.now() + 25 * 3600_000)
    expect(h.rows('SELECT * FROM sessions WHERE id = ?', SID)).toHaveLength(0)
    expect(h.rows('SELECT * FROM discarded_sessions')).toHaveLength(0)
    expect(h.rows('SELECT * FROM session_audit')).toHaveLength(0)
    expect((await handleSessionRestore(h.db, CODE, SID))._status).toBe(410)
  })

  it('期限内のものは掃除しない', async () => {
    const h = setup()
    await handleSessionDelete(h.db, CODE, SID, { draft })
    await purgeExpiredDiscarded(h.db, CODE, Date.now() + 23 * 3600_000)
    expect(h.rows('SELECT * FROM sessions WHERE id = ?', SID)).toHaveLength(1)
  })

  it('他店舗からは取り戻せない', async () => {
    const h = setup()
    await handleSessionDelete(h.db, CODE, SID, { draft })
    expect((await handleSessionRestore(h.db, OTHER, SID))._status).toBe(410)
  })
})
