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
  MAX_REPLACE_SESSIONS, D1_MAX_BOUND_PARAMS, D1_QUERIES_PER_INVOCATION_FREE,
} from '../src/constants.js'
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
    // どちらが勝つかは競合の解決順で変わるので、勝者側の内容で数える。
    // 「qty が敗者の値の行が無い」だと、B が勝ったときに B 自身の行を数えてしまう。
    expect(linesOf(h)).toHaveLength(win.itemCount)
    expect(linesOf(h).every(r => r.session_id === win.sessionId)).toBe(true)
    expect(historyOf(h)).toHaveLength(1)

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

// ── 再レビュー HIGH: replace は旧 claim・旧台帳まで消す ─────────────────────
// 旧実装は inventory_lines / store_history / sessions の3種類しか消しておらず、
//   - 通常棚卸を置換 → 旧 session_completions が孤児として残る
//   - 取込済みを別batchで置換 → 旧 import_batch_requests が残り、
//     旧バッチの再送が import_record_missing になる
// という状態を作っていた。`api-design.md` の「通常操作ではstale台帳は発生しない」とも矛盾する。
//
// **seed で `status='completed'` を直接 INSERT しても claim は作られない**ため、
// ここでは必ず実API経路（handleSessionComplete / handlePastImportCreate）で作る。
describe('replace は上書き対象の claim と台帳まで消す', () => {
  const claimsOf = (h, code = CODE) =>
    h.rows('SELECT * FROM session_completions WHERE shop_code = ?', code)

  /** 実API経路で完了済み stock session を作り、claim まで持たせる */
  async function completeRealStock(h, id, { code = CODE, date = DATE } = {}) {
    h.seedSession(code, id, { status: 'active', type: 'stock', startedAt: `${date}T00:00:00.000Z` })
    const res = await handleSessionComplete(h.db, code, id, {
      inventory: { 既存品目: { qty: 5, unit: '個' } },
      prices: { 既存品目: 10 },
      takenAt: date,
      snapshot: { sessionId: id, items: [{ item: '既存品目', qty: 5, unit: '個' }] },
    })
    expect(res.ok).toBe(true)
    return id
  }

  it('通常棚卸を置換すると、旧 session_completions も消える', async () => {
    const h = setup()
    const victim = await completeRealStock(h, 'aaaaaaaa-1111-4111-8111-111111111111')
    expect(claimsOf(h)).toHaveLength(1)

    const res = await handlePastImportCreate(h.db, CODE, BATCH, {
      date: DATE, items: items(3), replaceSessionIds: [victim],
    })

    expect(res.ok).toBe(true)
    expect(sessionsOf(h).some(s => s.id === victim)).toBe(false)
    expect(claimsOf(h).some(c => c.session_id === victim)).toBe(false)
    expect(claimsOf(h)).toHaveLength(0)          // 孤児 claim を残さない
    // 新しい取込は揃っている
    expect(linesOf(h)).toHaveLength(3)
    expect(historyOf(h)).toHaveLength(1)
    expect(ledgerOf(h)).toHaveLength(1)
  })

  it('取込済み棚卸を別 batch で置換すると、旧 import_batch_requests も消える', async () => {
    const h = setup()
    const OLD = 'imp_old001'
    const first = await handlePastImportCreate(h.db, CODE, OLD, { date: DATE, items: items(2) })
    expect(first.ok).toBe(true)
    expect(ledgerOf(h)).toHaveLength(1)

    const res = await handlePastImportCreate(h.db, CODE, BATCH, {
      date: DATE, items: items(3), replaceSessionIds: [first.sessionId],
    })

    expect(res.ok).toBe(true)
    expect(sessionsOf(h).some(s => s.id === first.sessionId)).toBe(false)
    // 旧バッチの台帳が残っていない
    const ledger = ledgerOf(h)
    expect(ledger).toHaveLength(1)
    expect(ledger[0].batch_id).toBe(BATCH)
    expect(ledger.some(r => r.batch_id === OLD)).toBe(false)

    // 旧バッチを再送しても import_record_missing にならない（記録ごと消えている）
    const reimport = await handlePastImportCreate(h.db, CODE, OLD, { date: DATE, items: items(2) })
    expect(reimport.code).not.toBe('import_record_missing')
  })

  it('作成中の新しい台帳 claim は消さない', async () => {
    const h = setup()
    const victim = await completeRealStock(h, 'aaaaaaaa-1111-4111-8111-111111111111')

    const res = await handlePastImportCreate(h.db, CODE, BATCH, {
      date: DATE, items: items(3), replaceSessionIds: [victim],
    })

    expect(res.ok).toBe(true)
    const ledger = ledgerOf(h)
    expect(ledger).toHaveLength(1)
    expect(ledger[0].batch_id).toBe(BATCH)
    expect(ledger[0].session_id).toBe(res.sessionId)
  })

  it('他店舗・別batchの claim と台帳には触れない', async () => {
    const h = setup()
    const victim  = await completeRealStock(h, 'aaaaaaaa-1111-4111-8111-111111111111')
    const foreign = await completeRealStock(h, 'cccccccc-1111-4111-8111-111111111111', { code: OTHER })
    const keepBatch = await handlePastImportCreate(h.db, CODE, 'imp_keep01', {
      date: '2026-07-05', items: items(2),
    })
    expect(keepBatch.ok).toBe(true)

    const res = await handlePastImportCreate(h.db, CODE, BATCH, {
      date: DATE, items: items(3), replaceSessionIds: [victim],
    })
    expect(res.ok).toBe(true)

    // 他店舗
    expect(claimsOf(h, OTHER).some(c => c.session_id === foreign)).toBe(true)
    expect(sessionsOf(h, OTHER)).toHaveLength(1)
    // 別batch
    expect(ledgerOf(h).some(r => r.batch_id === 'imp_keep01')).toBe(true)
    expect(sessionsOf(h).some(s => s.id === keepBatch.sessionId)).toBe(true)
  })

  // batch の **どの statement で落ちても** 何も変わらないこと。
  // statement の並びに依存させないため、まず成功実行で batch サイズを測り、
  // 0..size-1 のすべてに障害を注入する。
  it('batch のどの位置で失敗しても、旧対象と新取込のどちらも部分状態にならない', async () => {
    const probe = setup()
    const pv = await completeRealStock(probe, 'aaaaaaaa-1111-4111-8111-111111111111')
    probe.resetCounters()
    expect((await handlePastImportCreate(probe.db, CODE, BATCH, {
      date: DATE, items: items(3), replaceSessionIds: [pv],
    })).ok).toBe(true)
    const batchSize = probe.counters().lastBatchSize
    expect(batchSize).toBeGreaterThan(5)      // ledger+session+lines+snapshot+削除5+stamp

    for (let failIndex = 0; failIndex < batchSize; failIndex++) {
      const hh = setup()
      const v  = await completeRealStock(hh, 'aaaaaaaa-1111-4111-8111-111111111111')
      hh.failBatchAt(failIndex)
      const res = await handlePastImportCreate(hh.db, CODE, BATCH, {
        date: DATE, items: items(3), replaceSessionIds: [v],
      })
      const at = `failIndex=${failIndex}`
      expect(res.ok, at).toBeUndefined()
      expect(res._status, at).toBe(503)
      // 旧対象はすべて残る（一部だけ消えない）
      expect(sessionsOf(hh).some(s => s.id === v), at).toBe(true)
      expect(claimsOf(hh).some(c => c.session_id === v), at).toBe(true)
      expect(historyOf(hh).some(r => r.session_id === v), at).toBe(true)
      expect(linesOf(hh).some(r => r.session_id === v), at).toBe(true)
      // 新取込は1件も入らない
      expect(sessionsOf(hh).filter(s => s.import_batch_id === BATCH), at).toHaveLength(0)
      expect(ledgerOf(hh), at).toHaveLength(0)
    }
  })

  it('上限件数の replace でも query 数と bound parameter 数が D1 上限内', async () => {
    const h = setup()
    const ids = []
    for (let i = 0; i < MAX_REPLACE_SESSIONS; i++) {
      ids.push(await completeRealStock(h, `dddddddd-${String(i).padStart(4, '0')}-4111-8111-111111111111`))
    }

    h.resetCounters()
    const res = await handlePastImportCreate(h.db, CODE, BATCH, {
      date: DATE, items: items(200), replaceSessionIds: ids,
    })
    const c = h.counters()

    expect(res.ok).toBe(true)
    expect(c.maxBoundParams).toBeLessThanOrEqual(D1_MAX_BOUND_PARAMS)
    expect(c.queries).toBeLessThanOrEqual(D1_QUERIES_PER_INVOCATION_FREE - 2)   // 認証2本ぶんの余白
    expect(claimsOf(h)).toHaveLength(0)      // 旧 claim は全部消えている
    expect(ledgerOf(h)).toHaveLength(1)
  })
})

// ── 再レビュー MEDIUM: 取消の対象取得を同じ transaction へ ─────────────────
describe('取消は対象取得と削除を同じ transaction で行う', () => {
  it('事前処理後・batch 開始前に確定した同じバッチの取込も削除し、件数に含める', async () => {
    const h = setup()
    const first = await handlePastImportCreate(h.db, CODE, BATCH, { date: DATE, items: items(2) })
    expect(first.ok).toBe(true)

    // cancel の batch が始まる直前に、同じバッチの別日付が確定する競合
    const racedId = 'eeeeeeee-1111-4111-8111-111111111111'
    h.onNextBatch(() => {
      h.sqlite.prepare(`
        INSERT INTO sessions (id, shop_code, started_at, status, item_count, type, import_batch_id)
        VALUES (?, ?, '2026-07-09T00:00:00.000Z', 'completed', 1, 'stock', ?)
      `).run(racedId, CODE, BATCH)
      h.sqlite.prepare(`
        INSERT INTO import_batch_requests
          (shop_code, batch_id, import_date, fingerprint, session_id, item_count, total_value, replaced, created_at)
        VALUES (?, ?, '2026-07-09', 'fp-raced', ?, 1, NULL, 0, '2026-07-09T00:00:00.000Z')
      `).run(CODE, BATCH, racedId)
    })

    const res = await handlePastImportCancel(h.db, CODE, BATCH)

    expect(res.ok).toBe(true)
    // 競合で入った session も消え、件数と ID がその実態と一致する
    expect(sessionsOf(h)).toHaveLength(0)
    expect(ledgerOf(h)).toHaveLength(0)
    expect(res.removed).toBe(2)
    expect(res.sessionIds).toContain(first.sessionId)
    expect(res.sessionIds).toContain(racedId)
  })

  it('batch のどこで失敗しても session・履歴・明細・台帳がすべて元のまま', async () => {
    for (const failIndex of [0, 1, 2, 3, 4, 5]) {
      const h = setup()
      const first = await handlePastImportCreate(h.db, CODE, BATCH, { date: DATE, items: items(2) })
      expect(first.ok).toBe(true)

      h.failBatchAt(failIndex)
      const res = await handlePastImportCancel(h.db, CODE, BATCH)

      expect(res.ok, `failIndex=${failIndex}`).toBeUndefined()
      expect(res._status, `failIndex=${failIndex}`).toBe(503)
      expect(res.code, `failIndex=${failIndex}`).toBe('cancel_failed')
      expect(res.retryable, `failIndex=${failIndex}`).toBe(true)

      expect(sessionsOf(h), `failIndex=${failIndex}`).toHaveLength(1)
      expect(linesOf(h), `failIndex=${failIndex}`).toHaveLength(2)
      expect(historyOf(h), `failIndex=${failIndex}`).toHaveLength(1)
      expect(ledgerOf(h), `failIndex=${failIndex}`).toHaveLength(1)
    }
  })

  it('2回目の取消は removed:0 で成功する（冪等）', async () => {
    const h = setup()
    await handlePastImportCreate(h.db, CODE, BATCH, { date: DATE, items: items(2) })
    expect((await handlePastImportCancel(h.db, CODE, BATCH)).removed).toBe(1)

    const second = await handlePastImportCancel(h.db, CODE, BATCH)
    expect(second.ok).toBe(true)
    expect(second.removed).toBe(0)
    expect(second.sessionIds).toEqual([])
  })

  it('通常棚卸・別batch・他店舗には触れない', async () => {
    const h = setup()
    const mine  = await handlePastImportCreate(h.db, CODE,  BATCH, { date: DATE, items: items(2) })
    const other = await handlePastImportCreate(h.db, OTHER, BATCH, { date: DATE, items: items(2) })
    const keep  = await handlePastImportCreate(h.db, CODE, 'imp_keep01', { date: '2026-07-05', items: items(2) })
    h.seedSession(CODE, SID, { status: 'completed', type: 'stock' })   // 通常棚卸
    expect(mine.ok && other.ok && keep.ok).toBe(true)

    const res = await handlePastImportCancel(h.db, CODE, BATCH)

    expect(res.removed).toBe(1)
    expect(res.sessionIds).toEqual([mine.sessionId])
    expect(sessionsOf(h).some(s => s.id === SID)).toBe(true)
    expect(sessionsOf(h).some(s => s.id === keep.sessionId)).toBe(true)
    expect(sessionsOf(h, OTHER)).toHaveLength(1)
    expect(ledgerOf(h, OTHER)).toHaveLength(1)
    expect(ledgerOf(h).map(r => r.batch_id)).toEqual(['imp_keep01'])
  })

  it('取消の query 数は Free 上限内', async () => {
    const h = setup()
    await handlePastImportCreate(h.db, CODE, BATCH, { date: DATE, items: items(2) })

    h.resetCounters()
    const res = await handlePastImportCancel(h.db, CODE, BATCH)
    const c = h.counters()

    expect(res.ok).toBe(true)
    expect(c.queries).toBeLessThanOrEqual(D1_QUERIES_PER_INVOCATION_FREE - 2)
  })
})
