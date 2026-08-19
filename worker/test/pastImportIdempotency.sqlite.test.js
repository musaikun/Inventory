/**
 * 過去棚卸 replace の冪等性と権限判定（DATA-002 第1修正セッション §2 / §3）。
 *
 * §2 応答喪失からの再送:
 *   初回の replace が成功した後で応答を取りこぼすと、置換対象は既に削除済みになる。
 *   同じ requestを送り直したときに「上書き対象が見つからない」で 409 を返すと、
 *   client は取込に失敗したと表示したまま復帰できない。正確な replay は
 *   同じ成功結果へ収束しなければならない。一方、同じ batchId で中身が違う要求は
 *   別の意図なので 409 で拒否する。
 *
 * §3 replace 権限の TOCTOU:
 *   事前 SELECT で completed を確認してから DELETE するまでの間に、対象が
 *   active へ戻ることがある。preflight SELECT を削除権限の根拠にすると、
 *   入力中の棚卸を消せる。全ての delete / insert を1つの原子 guard へ従属させ、
 *   1件でも条件を外れたら書込みを0件にする。
 */
import { describe, it, expect } from 'vitest'
import { createD1 } from './d1Harness.js'
import { handlePastImportCreate, handlePastImportCancel } from '../src/pastImport.js'
import {
  MAX_REPLACE_SESSIONS, D1_MAX_BOUND_PARAMS, D1_QUERIES_PER_INVOCATION_FREE,
} from '../src/constants.js'

const CODE  = 'SHOPAA'
const OTHER = 'SHOPBB'
const BATCH = 'imp_test001'
const DATE  = '2026-07-01'

const items = (n = 2) => Array.from({ length: n }, (_, i) => ({
  item: `品目${i}`, qty: i + 1, unit: '個', unitPrice: 100,
}))

function setup() {
  const h = createD1()
  h.seedStore(CODE)
  h.seedStore(OTHER)
  return h
}

/** 上書き対象になれる完了済み stock セッションを作る */
function seedCompletedStock(h, id, { code = CODE, date = DATE, type = 'stock', status = 'completed' } = {}) {
  h.seedSession(code, id, { status, type, startedAt: `${date}T00:00:00.000Z` })
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

const sessionsOf = (h, code = CODE) => h.rows('SELECT * FROM sessions WHERE shop_code = ? ORDER BY id', code)
const linesOf    = (h, code = CODE) => h.rows('SELECT * FROM inventory_lines WHERE shop_code = ?', code)
const historyOf  = (h, code = CODE) => h.rows('SELECT * FROM store_history WHERE shop_code = ?', code)

// ── §2 応答喪失からの再送 ────────────────────────────────────────────────────
describe('replace 後の再送（応答喪失からの復帰）', () => {
  it('置換対象が削除済みでも、まったく同じ要求の再送は同じ成功結果を返す', async () => {
    const h = setup()
    const victim = seedCompletedStock(h, 'aaaaaaaa-1111-4111-8111-111111111111')
    const body = { date: DATE, items: items(3), replaceSessionIds: [victim] }

    const first = await handlePastImportCreate(h.db, CODE, BATCH, body)
    expect(first.ok).toBe(true)
    expect(first.replaced).toBe(1)

    // 応答を取りこぼした client がまったく同じ要求を送り直す
    const replay = await handlePastImportCreate(h.db, CODE, BATCH, { ...body, items: items(3) })

    expect(replay._status).toBeUndefined()
    expect(replay.ok).toBe(true)
    expect(replay.sessionId).toBe(first.sessionId)
    expect(replay.itemCount).toBe(first.itemCount)
    expect(replay.totalValue).toBe(first.totalValue)
    expect(replay.replaced).toBe(first.replaced)

    // セッションは1件（取込ぶんだけ）。重複を作らない
    expect(sessionsOf(h)).toHaveLength(1)
    expect(sessionsOf(h)[0].id).toBe(first.sessionId)
    expect(historyOf(h)).toHaveLength(1)
    expect(linesOf(h)).toHaveLength(3)
  })

  it('同じ batchId・同じ日付で明細が違えば 409（別の意図）', async () => {
    const h = setup()
    await handlePastImportCreate(h.db, CODE, BATCH, { date: DATE, items: items(3) })

    const res = await handlePastImportCreate(h.db, CODE, BATCH, { date: DATE, items: items(5) })

    expect(res._status).toBe(409)
    expect(res.code).toBe('import_intent_conflict')
    expect(linesOf(h)).toHaveLength(3)          // 元の内容が書き換わっていない
  })

  it('同じ batchId・同じ日付で置換対象集合が違えば 409', async () => {
    const h = setup()
    const a = seedCompletedStock(h, 'aaaaaaaa-1111-4111-8111-111111111111')
    const b = seedCompletedStock(h, 'bbbbbbbb-1111-4111-8111-111111111111')

    const first = await handlePastImportCreate(h.db, CODE, BATCH, {
      date: DATE, items: items(3), replaceSessionIds: [a],
    })
    expect(first.ok).toBe(true)

    const res = await handlePastImportCreate(h.db, CODE, BATCH, {
      date: DATE, items: items(3), replaceSessionIds: [a, b],
    })

    expect(res._status).toBe(409)
    expect(res.code).toBe('import_intent_conflict')
    // b は消えていない
    expect(sessionsOf(h).some(s => s.id === b)).toBe(true)
  })

  it('上書き対象の並び順が違うだけの再送は同じ要求として扱う', async () => {
    const h = setup()
    const a = seedCompletedStock(h, 'aaaaaaaa-1111-4111-8111-111111111111')
    const b = seedCompletedStock(h, 'bbbbbbbb-1111-4111-8111-111111111111')

    const first = await handlePastImportCreate(h.db, CODE, BATCH, {
      date: DATE, items: items(3), replaceSessionIds: [a, b],
    })
    const replay = await handlePastImportCreate(h.db, CODE, BATCH, {
      date: DATE, items: items(3), replaceSessionIds: [b, a],
    })

    expect(first.ok).toBe(true)
    expect(replay.ok).toBe(true)
    expect(replay.sessionId).toBe(first.sessionId)
    expect(sessionsOf(h)).toHaveLength(1)
  })

  it('同じ batchId の別日付は別要求として通る（1リクエスト=1日の設計）', async () => {
    const h = setup()
    const a = await handlePastImportCreate(h.db, CODE, BATCH, { date: DATE, items: items(2) })
    const b = await handlePastImportCreate(h.db, CODE, BATCH, { date: '2026-07-02', items: items(2) })

    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
    expect(a.sessionId).not.toBe(b.sessionId)
    expect(sessionsOf(h)).toHaveLength(2)
  })

  it('並行した同一要求の再送でもセッションを重複させない', async () => {
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
    expect(historyOf(h)).toHaveLength(1)
    expect(linesOf(h)).toHaveLength(3)
  })

  it('取消したバッチを同じ内容で取り込み直せる（replay 記録も消える）', async () => {
    const h = setup()
    const body = { date: DATE, items: items(3) }
    const first = await handlePastImportCreate(h.db, CODE, BATCH, body)
    expect(first.ok).toBe(true)

    const cancel = await handlePastImportCancel(h.db, CODE, BATCH)
    expect(cancel.ok).toBe(true)
    expect(sessionsOf(h)).toHaveLength(0)

    const again = await handlePastImportCreate(h.db, CODE, BATCH, { ...body })
    expect(again.ok).toBe(true)
    expect(sessionsOf(h)).toHaveLength(1)
    expect(linesOf(h)).toHaveLength(3)
  })
})

// ── §3 replace 権限の TOCTOU ─────────────────────────────────────────────────
describe('replace 権限の TOCTOU', () => {
  it('preflight 後・batch 直前に active へ戻った session は削除されない', async () => {
    const h = setup()
    const victim = seedCompletedStock(h, 'aaaaaaaa-1111-4111-8111-111111111111')

    // preflight SELECT の後、batch の直前で completed → active へ変化させる
    h.onNextBatch(() => {
      h.sqlite.prepare("UPDATE sessions SET status = 'active' WHERE id = ?").run(victim)
    })

    const res = await handlePastImportCreate(h.db, CODE, BATCH, {
      date: DATE, items: items(3), replaceSessionIds: [victim],
    })

    expect(res.ok).toBeUndefined()
    expect(res._status).toBe(409)

    // active セッションは残っている
    const rows = sessionsOf(h)
    expect(rows.find(s => s.id === victim)).toBeTruthy()
    expect(rows.find(s => s.id === victim).status).toBe('active')
    // 新しい取込セッションも作られていない
    expect(rows.filter(s => s.import_batch_id === BATCH)).toHaveLength(0)
    // 明細・履歴も元のまま（一部だけ消えていない）
    expect(linesOf(h)).toHaveLength(1)
    expect(historyOf(h)).toHaveLength(1)
  })

  it('複数指定のうち1件だけ active へ戻った場合も、他の1件を消さない', async () => {
    const h = setup()
    const a = seedCompletedStock(h, 'aaaaaaaa-1111-4111-8111-111111111111')
    const b = seedCompletedStock(h, 'bbbbbbbb-1111-4111-8111-111111111111')

    h.onNextBatch(() => {
      h.sqlite.prepare("UPDATE sessions SET status = 'active' WHERE id = ?").run(b)
    })

    const res = await handlePastImportCreate(h.db, CODE, BATCH, {
      date: DATE, items: items(3), replaceSessionIds: [a, b],
    })

    expect(res._status).toBe(409)
    const ids = sessionsOf(h).map(s => s.id)
    expect(ids).toContain(a)
    expect(ids).toContain(b)
    expect(linesOf(h)).toHaveLength(2)
    expect(historyOf(h)).toHaveLength(2)
  })

  it('batch 直前に order へ変わった session も削除されない', async () => {
    const h = setup()
    const victim = seedCompletedStock(h, 'aaaaaaaa-1111-4111-8111-111111111111')
    h.onNextBatch(() => {
      h.sqlite.prepare("UPDATE sessions SET type = 'order' WHERE id = ?").run(victim)
    })

    const res = await handlePastImportCreate(h.db, CODE, BATCH, {
      date: DATE, items: items(3), replaceSessionIds: [victim],
    })

    expect(res._status).toBe(409)
    expect(sessionsOf(h).find(s => s.id === victim)).toBeTruthy()
    expect(sessionsOf(h).filter(s => s.import_batch_id === BATCH)).toHaveLength(0)
  })

  it('batch 直前に別日付へ変わった session も削除されない', async () => {
    const h = setup()
    const victim = seedCompletedStock(h, 'aaaaaaaa-1111-4111-8111-111111111111')
    h.onNextBatch(() => {
      h.sqlite.prepare("UPDATE sessions SET started_at = '2026-06-01T00:00:00.000Z' WHERE id = ?").run(victim)
    })

    const res = await handlePastImportCreate(h.db, CODE, BATCH, {
      date: DATE, items: items(3), replaceSessionIds: [victim],
    })

    expect(res._status).toBe(409)
    expect(sessionsOf(h).find(s => s.id === victim)).toBeTruthy()
  })

  it('他店舗の session は指定しても消えない', async () => {
    const h = setup()
    const foreign = seedCompletedStock(h, 'cccccccc-1111-4111-8111-111111111111', { code: OTHER })

    const res = await handlePastImportCreate(h.db, CODE, BATCH, {
      date: DATE, items: items(3), replaceSessionIds: [foreign],
    })

    expect(res._status).toBe(409)
    expect(sessionsOf(h, OTHER)).toHaveLength(1)
    expect(linesOf(h, OTHER)).toHaveLength(1)
    expect(historyOf(h, OTHER)).toHaveLength(1)
    expect(sessionsOf(h)).toHaveLength(0)
  })

  it('上限ちょうどの上書きでも bound parameter / query 上限を超えない', async () => {
    const h = setup()
    const ids = Array.from({ length: MAX_REPLACE_SESSIONS }, (_, i) =>
      seedCompletedStock(h, `dddddddd-${String(i).padStart(4, '0')}-4111-8111-111111111111`))

    h.resetCounters()
    const res = await handlePastImportCreate(h.db, CODE, BATCH, {
      date: DATE, items: items(200), replaceSessionIds: ids,
    })
    const c = h.counters()

    expect(res.ok).toBe(true)
    expect(c.maxBoundParams).toBeLessThanOrEqual(D1_MAX_BOUND_PARAMS)
    // 認証2本ぶんの余白を残して Free の上限内に収める
    expect(c.queries).toBeLessThanOrEqual(D1_QUERIES_PER_INVOCATION_FREE - 2)
    expect(sessionsOf(h)).toHaveLength(1)
  })

  it('上限を超える指定は書き込み前に 400 で拒否する', async () => {
    const h = setup()
    const ids = Array.from({ length: MAX_REPLACE_SESSIONS + 1 }, (_, i) =>
      `eeeeeeee-${String(i).padStart(4, '0')}-4111-8111-111111111111`)

    const res = await handlePastImportCreate(h.db, CODE, BATCH, {
      date: DATE, items: items(2), replaceSessionIds: ids,
    })

    expect(res._status).toBe(400)
    expect(res.code).toBe('invalid_replace')
    expect(sessionsOf(h)).toHaveLength(0)
  })
})
