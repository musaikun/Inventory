/**
 * 取込台帳・完了claimのlifecycle（DATA-002 再レビュー §4 / §5 / §6）。
 *
 * §4 時刻markerの廃止:
 *   session upsert が「この要求で成功した」印に `ended_at === now` を使っていた。
 *   同じミリ秒に異なる内容の要求 A/B が届くと、B へ 409 を返しながら B の
 *   lines / snapshot だけが A の session へ入りうる。所有権は時刻ではなく
 *   台帳のkey + server生成fingerprintが持つ。
 *
 * §5 stale ledger:
 *   台帳が一致すれば対応 session / history が無くても 200 `snapshotSaved:true` を
 *   返していた。通常のsession削除・history削除では台帳が残るため、削除済み取込を
 *   「保存済み」と誤回答する。replay には実体の存在確認を要求し、無ければ fail-closed。
 *
 * §6 account削除:
 *   台帳行を実際に seed して、対象店舗だけが消えることを固定する。
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createD1 } from './d1Harness.js'
import { handlePastImportCreate, handlePastImportCancel } from '../src/pastImport.js'
import {
  handleSessionComplete, handleSessionDelete, handleHistoryDelete,
} from '../src/storeHandler.js'

const CODE  = 'SHOPAA'
const OTHER = 'SHOPBB'
const BATCH = 'imp_test001'
const DATE  = '2026-07-01'
const SID   = '11111111-1111-4111-8111-111111111111'

const items = (n = 2, qty = i => i + 1) => Array.from({ length: n }, (_, i) => ({
  item: `品目${i}`, qty: qty(i), unit: '個', unitPrice: 100,
}))

function setup() {
  const h = createD1()
  h.seedStore(CODE)
  h.seedStore(OTHER)
  return h
}

const sessionsOf = (h, code = CODE) => h.rows('SELECT * FROM sessions WHERE shop_code = ? ORDER BY id', code)
const linesOf    = (h, code = CODE) => h.rows('SELECT * FROM inventory_lines WHERE shop_code = ?', code)
const historyOf  = (h, code = CODE) => h.rows('SELECT * FROM store_history WHERE shop_code = ?', code)
const ledgerOf   = (h, code = CODE) => h.rows('SELECT * FROM import_batch_requests WHERE shop_code = ?', code)

function seedCompletedStock(h, id, { code = CODE, date = DATE } = {}) {
  h.seedSession(code, id, { status: 'completed', type: 'stock', startedAt: `${date}T00:00:00.000Z` })
  h.sqlite.prepare(`
    INSERT INTO inventory_lines (session_id, shop_code, taken_at, item_name, category, qty, unit, unit_price, line_value)
    VALUES (?, ?, ?, '既存品目', NULL, 5, '個', 10, 50)
  `).run(id, code, date)
  h.sqlite.prepare(`
    INSERT INTO store_history (shop_code, session_id, snapshot_date, snapshot_json, created_at, updated_at, revision)
    VALUES (?, ?, ?, '{"items":[{"item":"既存品目"}]}', ?, ?, 1)
  `).run(code, id, date, `${date}T00:00:00.000Z`, `${date}T00:00:00.000Z`)
  return id
}

afterEach(() => { vi.useRealTimers() })

// ── §4 時刻markerではなくfingerprintで所有権を決める ────────────────────────
describe('過去取込の所有権guard（時刻markerを使わない）', () => {
  it('同一ミリ秒に届いた内容の違う2要求で、片方だけが成功し混合状態を作らない', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-01T12:00:00.000Z'))

    const h = setup()
    const victim = seedCompletedStock(h, 'aaaaaaaa-1111-4111-8111-111111111111')

    const bodyA = { date: DATE, items: items(3), replaceSessionIds: [victim] }
    const bodyB = { date: DATE, items: items(5, () => 99), replaceSessionIds: [victim] }

    const [a, b] = await Promise.all([
      handlePastImportCreate(h.db, CODE, BATCH, bodyA),
      handlePastImportCreate(h.db, CODE, BATCH, bodyB),
    ])

    const winners = [a, b].filter(r => r.ok)
    const losers  = [a, b].filter(r => r._status === 409)
    expect(winners).toHaveLength(1)
    expect(losers).toHaveLength(1)

    const win = winners[0]

    // ledger・session header・lines・snapshot がすべて勝者の内容
    const ledger = ledgerOf(h)
    expect(ledger).toHaveLength(1)
    expect(ledger[0].session_id).toBe(win.sessionId)
    expect(ledger[0].item_count).toBe(win.itemCount)

    const sessions = sessionsOf(h)
    const imported = sessions.filter(s => s.import_batch_id === BATCH)
    expect(imported).toHaveLength(1)
    expect(imported[0].item_count).toBe(win.itemCount)

    const lines = linesOf(h).filter(r => r.session_id === win.sessionId)
    expect(lines).toHaveLength(win.itemCount)

    const hist = historyOf(h).filter(r => r.session_id === win.sessionId)
    expect(hist).toHaveLength(1)
    expect(JSON.parse(hist[0].snapshot_json).itemCount).toBe(win.itemCount)

    // 敗者の明細・snapshot が残っていない
    expect(linesOf(h).filter(r => r.qty === 99)).toHaveLength(0)

    // victim削除も勝者のtransactionだけで行われる（他に取り残しが無い）
    expect(sessions.some(s => s.id === victim)).toBe(false)
    expect(linesOf(h).some(r => r.session_id === victim)).toBe(false)
    expect(historyOf(h).some(r => r.session_id === victim)).toBe(false)
  })

  it('同一ミリ秒の同一要求2本は同じ成功へ収束する', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-01T12:00:00.000Z'))

    const h = setup()
    const victim = seedCompletedStock(h, 'aaaaaaaa-1111-4111-8111-111111111111')
    const body = { date: DATE, items: items(3), replaceSessionIds: [victim] }

    const [a, b] = await Promise.all([
      handlePastImportCreate(h.db, CODE, BATCH, { ...body }),
      handlePastImportCreate(h.db, CODE, BATCH, { ...body }),
    ])

    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
    expect(a.sessionId).toBe(b.sessionId)
    expect(sessionsOf(h)).toHaveLength(1)
    expect(ledgerOf(h)).toHaveLength(1)
    expect(linesOf(h)).toHaveLength(3)
  })

  it('guard 失敗時は lines も snapshot も残さない（409の要求の痕跡が無い）', async () => {
    const h = setup()
    const victim = seedCompletedStock(h, 'aaaaaaaa-1111-4111-8111-111111111111')
    h.onNextBatch(() => {
      h.sqlite.prepare("UPDATE sessions SET status = 'active' WHERE id = ?").run(victim)
    })

    const res = await handlePastImportCreate(h.db, CODE, BATCH, {
      date: DATE, items: items(3), replaceSessionIds: [victim],
    })

    expect(res._status).toBe(409)
    expect(ledgerOf(h)).toHaveLength(0)
    expect(sessionsOf(h).filter(s => s.import_batch_id === BATCH)).toHaveLength(0)
    expect(linesOf(h)).toHaveLength(1)        // victim の既存1件だけ
    expect(historyOf(h)).toHaveLength(1)
  })
})

// ── §5 stale ledger で偽の成功を返さない ────────────────────────────────────
describe('stale ledger で replay 成功にしない', () => {
  it('台帳だけ残り session が無ければ replay 成功にしない', async () => {
    const h = setup()
    const first = await handlePastImportCreate(h.db, CODE, BATCH, { date: DATE, items: items(3) })
    expect(first.ok).toBe(true)

    // 台帳を残したまま session だけを直接消す（0016 以前の削除経路を再現）
    h.sqlite.prepare('DELETE FROM sessions WHERE id = ?').run(first.sessionId)

    const res = await handlePastImportCreate(h.db, CODE, BATCH, { date: DATE, items: items(3) })
    expect(res.ok).toBeUndefined()
    expect([409, 503]).toContain(res._status)
    expect(res.snapshotSaved).toBeUndefined()
  })

  it('台帳と session はあるが history が無ければ replay 成功にしない', async () => {
    const h = setup()
    const first = await handlePastImportCreate(h.db, CODE, BATCH, { date: DATE, items: items(3) })
    h.sqlite.prepare('DELETE FROM store_history WHERE session_id = ?').run(first.sessionId)

    const res = await handlePastImportCreate(h.db, CODE, BATCH, { date: DATE, items: items(3) })
    expect(res.ok).toBeUndefined()
    expect([409, 503]).toContain(res._status)
    expect(res.snapshotSaved).toBeUndefined()
  })

  it('通常の session 削除で、対応する台帳と明細・履歴も処理される', async () => {
    const h = setup()
    const first = await handlePastImportCreate(h.db, CODE, BATCH, { date: DATE, items: items(3) })
    expect(ledgerOf(h)).toHaveLength(1)

    const res = await handleSessionDelete(h.db, CODE, first.sessionId)
    expect(res.ok).toBe(true)

    expect(sessionsOf(h)).toHaveLength(0)
    expect(linesOf(h)).toHaveLength(0)
    expect(historyOf(h)).toHaveLength(0)
    expect(ledgerOf(h)).toHaveLength(0)

    // 台帳が消えているので、同じ内容で取り込み直せる
    const again = await handlePastImportCreate(h.db, CODE, BATCH, { date: DATE, items: items(3) })
    expect(again.ok).toBe(true)
    expect(linesOf(h)).toHaveLength(3)
  })

  it('history 削除で stale な台帳を残さない', async () => {
    const h = setup()
    const first = await handlePastImportCreate(h.db, CODE, BATCH, { date: DATE, items: items(3) })

    const res = await handleHistoryDelete(h.db, CODE, first.sessionId)
    expect(res.ok).toBe(true)
    expect(historyOf(h)).toHaveLength(0)
    expect(ledgerOf(h)).toHaveLength(0)
  })

  it('history 削除後の再取込は、明示的な取消を経てからだけ成功する', async () => {
    const h = setup()
    const first = await handlePastImportCreate(h.db, CODE, BATCH, { date: DATE, items: items(3) })
    await handleHistoryDelete(h.db, CODE, first.sessionId)

    // session は残っているのに台帳が無い＝内容を保証できない。黙って上書きしない。
    const blocked = await handlePastImportCreate(h.db, CODE, BATCH, { date: DATE, items: items(3) })
    expect(blocked._status).toBe(409)
    expect(blocked.code).toBe('legacy_import_unverified')

    expect((await handlePastImportCancel(h.db, CODE, BATCH)).ok).toBe(true)

    const again = await handlePastImportCreate(h.db, CODE, BATCH, { date: DATE, items: items(3) })
    expect(again.ok).toBe(true)
    expect(historyOf(h)).toHaveLength(1)
  })

  it('別店舗の台帳は残る', async () => {
    const h = setup()
    const mine  = await handlePastImportCreate(h.db, CODE,  BATCH, { date: DATE, items: items(2) })
    const yours = await handlePastImportCreate(h.db, OTHER, BATCH, { date: DATE, items: items(2) })
    expect(mine.ok && yours.ok).toBe(true)

    await handleSessionDelete(h.db, CODE, mine.sessionId)

    expect(ledgerOf(h, CODE)).toHaveLength(0)
    expect(ledgerOf(h, OTHER)).toHaveLength(1)
    expect(sessionsOf(h, OTHER)).toHaveLength(1)
    expect(historyOf(h, OTHER)).toHaveLength(1)
  })

  it('session 削除の途中失敗は全体 rollback する', async () => {
    const h = setup()
    const first = await handlePastImportCreate(h.db, CODE, BATCH, { date: DATE, items: items(3) })

    h.failBatchAt(1)
    const res = await handleSessionDelete(h.db, CODE, first.sessionId)

    expect(res.ok).toBeUndefined()
    expect(res._status).toBe(503)
    expect(res.retryable).toBe(true)
    expect(sessionsOf(h)).toHaveLength(1)
    expect(linesOf(h)).toHaveLength(3)
    expect(historyOf(h)).toHaveLength(1)
    expect(ledgerOf(h)).toHaveLength(1)

    // 再試行で完了する
    expect((await handleSessionDelete(h.db, CODE, first.sessionId)).ok).toBe(true)
    expect(sessionsOf(h)).toHaveLength(0)
    expect(ledgerOf(h)).toHaveLength(0)
  })

  it('通常の棚卸セッションの削除でも、完了claimごと消える', async () => {
    const h = setup()
    h.seedSession(CODE, SID)
    await handleSessionComplete(h.db, CODE, SID, {
      inventory: { 牛乳: { qty: 1, unit: '本' } }, prices: {}, takenAt: '2026-08-09',
      snapshot: { sessionId: SID, items: [{ item: '牛乳', qty: 1, unit: '本' }] },
    })
    expect(h.rows('SELECT * FROM session_completions WHERE shop_code = ?', CODE)).toHaveLength(1)

    expect((await handleSessionDelete(h.db, CODE, SID)).ok).toBe(true)
    expect(h.rows('SELECT * FROM session_completions WHERE shop_code = ?', CODE)).toHaveLength(0)
    expect(linesOf(h)).toHaveLength(0)
    expect(historyOf(h)).toHaveLength(0)
  })

  it('batch 取消は台帳も消し、取消後の再取込を成功させる', async () => {
    const h = setup()
    await handlePastImportCreate(h.db, CODE, BATCH, { date: DATE, items: items(3) })
    const cancel = await handlePastImportCancel(h.db, CODE, BATCH)

    expect(cancel.ok).toBe(true)
    expect(ledgerOf(h)).toHaveLength(0)

    const again = await handlePastImportCreate(h.db, CODE, BATCH, { date: DATE, items: items(3) })
    expect(again.ok).toBe(true)
    expect(ledgerOf(h)).toHaveLength(1)
  })
})

// ── legacy（0015 以前の取込・台帳なし）─────────────────────────────────────
describe('台帳を持たない legacy batch（0015 適用前の取込）', () => {
  /** 0015 適用前に旧Workerが書いた取込（session はあるが台帳が無い）を作る */
  async function seedLegacyImport(h) {
    const first = await handlePastImportCreate(h.db, CODE, BATCH, { date: DATE, items: items(3) })
    h.sqlite.prepare('DELETE FROM import_batch_requests').run()
    return first
  }

  it('台帳が無い既存取込は、別内容で黙って上書きできない（409 fail-closed）', async () => {
    const h = setup()
    await seedLegacyImport(h)

    const res = await handlePastImportCreate(h.db, CODE, BATCH, { date: DATE, items: items(2) })

    expect(res.ok).toBeUndefined()
    expect(res._status).toBe(409)
    expect(res.code).toBe('legacy_import_unverified')
    // 既存の取込は無傷
    expect(sessionsOf(h)).toHaveLength(1)
    expect(linesOf(h)).toHaveLength(3)
    expect(historyOf(h)).toHaveLength(1)
    expect(ledgerOf(h)).toHaveLength(0)
  })

  it('同じ内容の再送でも、台帳が無ければ 409（推測でfingerprintを作らない）', async () => {
    const h = setup()
    await seedLegacyImport(h)

    const res = await handlePastImportCreate(h.db, CODE, BATCH, { date: DATE, items: items(3) })

    expect(res._status).toBe(409)
    expect(res.code).toBe('legacy_import_unverified')
    expect(linesOf(h)).toHaveLength(3)
  })

  it('明示的に取り消した後なら再取込できる', async () => {
    const h = setup()
    await seedLegacyImport(h)

    const cancel = await handlePastImportCancel(h.db, CODE, BATCH)
    expect(cancel.ok).toBe(true)
    expect(sessionsOf(h)).toHaveLength(0)

    const again = await handlePastImportCreate(h.db, CODE, BATCH, { date: DATE, items: items(2) })
    expect(again.ok).toBe(true)
    expect(linesOf(h)).toHaveLength(2)
    expect(ledgerOf(h)).toHaveLength(1)      // 以後は台帳が付く
  })

  it('同じバッチでも別日付なら台帳の有無に関係なく取り込める', async () => {
    const h = setup()
    await seedLegacyImport(h)

    const res = await handlePastImportCreate(h.db, CODE, BATCH, { date: '2026-07-02', items: items(2) })
    expect(res.ok).toBe(true)
    expect(sessionsOf(h)).toHaveLength(2)
  })
})
