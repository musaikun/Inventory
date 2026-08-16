/**
 * 過去棚卸取込の server 側契約（IMPORT-001）を実SQLiteで確認する。
 *
 * 見るのは「原子性・冪等性・店舗境界・検証」の4点。
 * 取込は既存の棚卸データと同じテーブルへ書くので、通常の棚卸や別バッチを
 * 巻き込まないことを SQL レベルで固定しておく必要がある。
 */
import { describe, it, expect } from 'vitest'
import { createD1 } from './d1Harness.js'
import { handlePastImportCreate, handlePastImportCancel, importSessionId } from '../src/pastImport.js'
import {
  MAX_LINES_PER_REQUEST, MAX_REPLACE_SESSIONS,
  D1_MAX_BOUND_PARAMS, D1_QUERIES_PER_INVOCATION_FREE,
} from '../src/constants.js'

const CODE  = 'SHOPAA'
const OTHER = 'SHOPBB'
const BATCH = 'imp_test001'

const items = (n = 2) => Array.from({ length: n }, (_, i) => ({
  item: `品目${i}`, qty: i + 1, unit: '個', unitPrice: 100,
}))

function setup() {
  const h = createD1()
  h.seedStore(CODE)
  h.seedStore(OTHER)
  return h
}

const sessionsOf = (h, code = CODE) =>
  h.rows('SELECT * FROM sessions WHERE shop_code = ? ORDER BY started_at', code)
const linesOf = (h, code = CODE) =>
  h.rows('SELECT * FROM inventory_lines WHERE shop_code = ?', code)
const historyOf = (h, code = CODE) =>
  h.rows('SELECT * FROM store_history WHERE shop_code = ?', code)

describe('取込の作成', () => {
  it('session・明細・スナップショットを1回の取込で揃えて作る', async () => {
    const h = setup()
    const r = await handlePastImportCreate(h.db, CODE, BATCH, { date: '2026-07-01', items: items(3) })

    expect(r.ok).toBe(true)
    expect(r.itemCount).toBe(3)
    expect(r.totalValue).toBe(600)          // (1+2+3) * 100

    const s = sessionsOf(h)
    expect(s).toHaveLength(1)
    expect(s[0].status).toBe('completed')
    expect(s[0].import_batch_id).toBe(BATCH)
    expect(s[0].type).toBe('stock')
    expect(linesOf(h)).toHaveLength(3)

    // カレンダー／詳細が同じ sessionId を引けること
    const hist = historyOf(h)
    expect(hist).toHaveLength(1)
    expect(hist[0].session_id).toBe(r.sessionId)
    expect(hist[0].snapshot_date).toBe('2026-07-01')
    expect(JSON.parse(hist[0].snapshot_json)).toMatchObject({
      sessionId: r.sessionId, date: '2026-07-01', source: 'import', importBatchId: BATCH,
    })
  })

  it('同じバッチ・同じ日付・同じ内容の再送でセッションが増えない（冪等）', async () => {
    const h = setup()
    const a = await handlePastImportCreate(h.db, CODE, BATCH, { date: '2026-07-01', items: items(3) })
    const b = await handlePastImportCreate(h.db, CODE, BATCH, { date: '2026-07-01', items: items(3) })

    expect(b.sessionId).toBe(a.sessionId)
    expect(sessionsOf(h)).toHaveLength(1)
    expect(linesOf(h)).toHaveLength(3)
    expect(historyOf(h)).toHaveLength(1)
  })

  it('同じバッチ・同じ日付で内容が違えば 409（別の意図・DATA-002 §2）', async () => {
    const h = setup()
    await handlePastImportCreate(h.db, CODE, BATCH, { date: '2026-07-01', items: items(3) })
    const b = await handlePastImportCreate(h.db, CODE, BATCH, { date: '2026-07-01', items: items(2) })

    expect(b._status).toBe(409)
    expect(b.code).toBe('import_intent_conflict')
    expect(linesOf(h)).toHaveLength(3)      // 既存の取込を黙って書き換えない
  })

  it('台帳を持たない旧データ（0015 適用前）への再送は、明細を貼り直す', async () => {
    const h = setup()
    await handlePastImportCreate(h.db, CODE, BATCH, { date: '2026-07-01', items: items(3) })
    // 0015 適用前に作られた取込セッション相当の状態にする
    h.sqlite.prepare('DELETE FROM import_batch_requests').run()

    const b = await handlePastImportCreate(h.db, CODE, BATCH, { date: '2026-07-01', items: items(2) })

    expect(b.ok).toBe(true)
    expect(sessionsOf(h)).toHaveLength(1)
    expect(linesOf(h)).toHaveLength(2)      // 減った品目が残らない（貼り直し）
    expect(historyOf(h)).toHaveLength(1)
  })

  it('同じバッチの別日付は別セッションになる', async () => {
    const h = setup()
    await handlePastImportCreate(h.db, CODE, BATCH, { date: '2026-07-01', items: items() })
    await handlePastImportCreate(h.db, CODE, BATCH, { date: '2026-07-02', items: items() })
    expect(sessionsOf(h)).toHaveLength(2)
  })

  it('同じ日に通常の棚卸があっても、既定では消さずに別セッションとして共存する', async () => {
    const h = setup()
    h.sqlite.prepare(
      "INSERT INTO sessions (id, shop_code, started_at, status, item_count, type) VALUES (?, ?, ?, 'completed', 5, 'stock')"
    ).run('normal-1', CODE, '2026-07-01T09:00:00.000Z')

    await handlePastImportCreate(h.db, CODE, BATCH, { date: '2026-07-01', items: items() })

    const s = sessionsOf(h)
    expect(s).toHaveLength(2)
    expect(s.find(x => x.id === 'normal-1')).toBeDefined()
    expect(s.filter(x => x.import_batch_id === BATCH)).toHaveLength(1)
  })

  it('明示指定した session だけを上書きで消す', async () => {
    const h = setup()
    h.sqlite.prepare(
      "INSERT INTO sessions (id, shop_code, started_at, status, item_count, type) VALUES (?, ?, ?, 'completed', 5, 'stock')"
    ).run('normal-1', CODE, '2026-07-01T09:00:00.000Z')
    h.sqlite.prepare(
      "INSERT INTO sessions (id, shop_code, started_at, status, item_count, type) VALUES (?, ?, ?, 'completed', 5, 'stock')"
    ).run('keep-me', CODE, '2026-07-01T10:00:00.000Z')

    const r = await handlePastImportCreate(h.db, CODE, BATCH, {
      date: '2026-07-01', items: items(), replaceSessionIds: ['normal-1'],
    })

    expect(r.replaced).toBe(1)
    const ids = sessionsOf(h).map(s => s.id)
    expect(ids).not.toContain('normal-1')
    expect(ids).toContain('keep-me')
  })

  it('他店舗の session を上書き指定したら、全体を拒否して何も書かない', async () => {
    const h = setup()
    h.sqlite.prepare(
      "INSERT INTO sessions (id, shop_code, started_at, status, item_count, type) VALUES (?, ?, ?, 'completed', 5, 'stock')"
    ).run('other-1', OTHER, '2026-07-01T09:00:00.000Z')

    const r = await handlePastImportCreate(h.db, CODE, BATCH, {
      date: '2026-07-01', items: items(), replaceSessionIds: ['other-1'],
    })

    // 他店舗のIDと存在しないIDは同じ扱い（実在を漏らさない）
    expect(r).toMatchObject({ _status: 409, code: 'replace_not_allowed', reason: 'not_found' })
    expect(sessionsOf(h, OTHER).map(s => s.id)).toContain('other-1')
    expect(sessionsOf(h)).toHaveLength(0)      // 取込セッションも作られない
    expect(linesOf(h)).toHaveLength(0)
  })

  it('途中で失敗したら何も書かない（部分状態を残さない）', async () => {
    const h = setup()
    h.failBatchAt(2)                        // 明細INSERTのあたりで落とす
    const r = await handlePastImportCreate(h.db, CODE, BATCH, { date: '2026-07-01', items: items(3) })

    expect(r._status).toBe(503)
    expect(r.retryable).toBe(true)
    expect(sessionsOf(h)).toHaveLength(0)
    expect(linesOf(h)).toHaveLength(0)
    expect(historyOf(h)).toHaveLength(0)
  })

  it('失敗後に再送すれば、重複せずに1件だけ入る', async () => {
    const h = setup()
    h.failBatchAt(2)
    await handlePastImportCreate(h.db, CODE, BATCH, { date: '2026-07-01', items: items(3) })
    const ok = await handlePastImportCreate(h.db, CODE, BATCH, { date: '2026-07-01', items: items(3) })

    expect(ok.ok).toBe(true)
    expect(sessionsOf(h)).toHaveLength(1)
    expect(linesOf(h)).toHaveLength(3)
  })
})

describe('snapshot は server が組み立てる', () => {
  it('client が items 無しの snapshot を送っても、保存される snapshot には明細が入る', async () => {
    const h = setup()
    const r = await handlePastImportCreate(h.db, CODE, BATCH, {
      date: '2026-07-01',
      items: items(3),
      // 端末が組み立てそこねた（items が空の）snapshot。そのまま保存すると
      // 「一覧には出るのに詳細が空」という R-001 と同じ状態を取込経路から作れる。
      snapshot: { date: '2026-07-01', items: [], totalValue: 0, bogus: 'client値' },
    })

    const snap = JSON.parse(historyOf(h)[0].snapshot_json)
    expect(snap.items).toHaveLength(3)
    expect(snap.items[0]).toMatchObject({ item: '品目0', qty: 1, unit: '個', unitPrice: 100, subtotal: 100 })
    expect(snap.itemCount).toBe(3)
    expect(snap.totalValue).toBe(600)
    expect(snap.sessionId).toBe(r.sessionId)
    expect(snap.source).toBe('import')
    expect(snap.locked).toBe(true)
    expect(snap.bogus).toBeUndefined()          // client の中身は持ち込まない
  })

  it('snapshot 未指定でも保存される（server が作るので必須ではない）', async () => {
    const h = setup()
    const r = await handlePastImportCreate(h.db, CODE, BATCH, { date: '2026-07-01', items: items(2) })
    expect(r.snapshotSaved).toBe(true)
    expect(JSON.parse(historyOf(h)[0].snapshot_json).items).toHaveLength(2)
  })

  it('保存後の server revision と保存時刻を返す', async () => {
    const h = setup()
    // 同じバッチの別日付＝別の要求単位。どちらも書き込みが起き、revision が進む。
    const a = await handlePastImportCreate(h.db, CODE, BATCH, { date: '2026-07-01', items: items(2) })
    const b = await handlePastImportCreate(h.db, CODE, BATCH, { date: '2026-07-02', items: items(3) })
    expect(a.serverRevision).toBeGreaterThan(0)
    expect(b.serverRevision).toBeGreaterThan(a.serverRevision)
    expect(b.serverSavedAt).toBeTruthy()
  })
})

describe('上書き指定（replaceSessionIds）の許可条件', () => {
  const seedSession = (h, id, { date = '2026-07-01', status = 'completed', type = 'stock', code = CODE } = {}) => {
    h.sqlite.prepare(
      'INSERT INTO sessions (id, shop_code, started_at, status, item_count, type) VALUES (?, ?, ?, ?, 5, ?)'
    ).run(id, code, `${date}T09:00:00.000Z`, status, type)
    h.sqlite.prepare(
      'INSERT INTO store_history (shop_code, session_id, snapshot_date, snapshot_json, created_at, updated_at, revision) VALUES (?, ?, ?, ?, ?, ?, 1)'
    ).run(code, id, date, '{}', `${date}T09:00:00.000Z`, `${date}T09:00:00.000Z`)
    return id
  }

  it.each([
    ['別の日付',       { date: '2026-06-30' }, 'date_mismatch'],
    ['進行中',         { status: 'active' },   'not_completed'],
    ['未完了',         { status: 'incomplete' }, 'not_completed'],
    ['発注セッション', { type: 'order' },      'not_stock'],
  ])('%s の session を指定したら全体を拒否し、何も削除しない', async (_label, opts, reason) => {
    const h = setup()
    seedSession(h, 'target-1', opts)

    const r = await handlePastImportCreate(h.db, CODE, BATCH, {
      date: '2026-07-01', items: items(2), replaceSessionIds: ['target-1'],
    })

    expect(r).toMatchObject({ _status: 409, code: 'replace_not_allowed', reason, sessionId: 'target-1' })
    expect(sessionsOf(h).map(s => s.id)).toEqual(['target-1'])
    expect(historyOf(h)).toHaveLength(1)
    expect(linesOf(h)).toHaveLength(0)
  })

  it('存在しない session を指定したら全体を拒否する', async () => {
    const h = setup()
    seedSession(h, 'keep-me')
    const r = await handlePastImportCreate(h.db, CODE, BATCH, {
      date: '2026-07-01', items: items(2), replaceSessionIds: ['keep-me', 'ghost-1'],
    })
    expect(r).toMatchObject({ _status: 409, reason: 'not_found', sessionId: 'ghost-1' })
    expect(sessionsOf(h).map(s => s.id)).toEqual(['keep-me'])
  })

  it('1件でも不許可なら、許可された分も削除しない（全体拒否）', async () => {
    const h = setup()
    seedSession(h, 'ok-1')
    seedSession(h, 'ng-1', { status: 'active' })

    await handlePastImportCreate(h.db, CODE, BATCH, {
      date: '2026-07-01', items: items(2), replaceSessionIds: ['ok-1', 'ng-1'],
    })
    expect(sessionsOf(h).map(s => s.id).sort()).toEqual(['ng-1', 'ok-1'])
    expect(historyOf(h)).toHaveLength(2)
  })

  it('上限50件の上書きでも statement / bound parameter 上限を超えない', async () => {
    const h = setup()
    const ids = Array.from({ length: MAX_REPLACE_SESSIONS }, (_, i) => seedSession(h, `old-${i}`))

    h.resetCounters()
    const r = await handlePastImportCreate(h.db, CODE, BATCH, {
      date: '2026-07-01', items: items(MAX_LINES_PER_REQUEST), replaceSessionIds: ids,
    })

    expect(r.ok).toBe(true)
    expect(r.replaced).toBe(MAX_REPLACE_SESSIONS)
    const c = h.counters()
    // 認証2本ぶんを足しても Free の 50 に収まる
    expect(c.queries + 2).toBeLessThanOrEqual(D1_QUERIES_PER_INVOCATION_FREE)
    expect(c.maxBoundParams).toBeLessThanOrEqual(D1_MAX_BOUND_PARAMS)
    // 上書き対象は消え、取込ぶんだけが残る
    expect(sessionsOf(h)).toHaveLength(1)
    expect(historyOf(h)).toHaveLength(1)
    expect(linesOf(h)).toHaveLength(MAX_LINES_PER_REQUEST)
  })

  it('51件以上の指定は400で拒否する', async () => {
    const h = setup()
    const ids = Array.from({ length: MAX_REPLACE_SESSIONS + 1 }, (_, i) => `old-${i}`)
    const r = await handlePastImportCreate(h.db, CODE, BATCH, {
      date: '2026-07-01', items: items(2), replaceSessionIds: ids,
    })
    expect(r).toMatchObject({ _status: 400, code: 'invalid_replace' })
  })
})

describe('同一 batchId + 日付の一意性', () => {
  it('同時に届いた2つの要求でも session は1件だけになる', async () => {
    const h = setup()
    const body = { date: '2026-07-01', items: items(3) }

    // 「存在確認 → batch」の隙間で相手の取込が先に完了する競合を再現する。
    const [a, b] = await Promise.all([
      handlePastImportCreate(h.db, CODE, BATCH, body),
      handlePastImportCreate(h.db, CODE, BATCH, body),
    ])

    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
    expect(a.sessionId).toBe(b.sessionId)
    expect(sessionsOf(h)).toHaveLength(1)
    expect(historyOf(h)).toHaveLength(1)
    expect(linesOf(h)).toHaveLength(3)
  })

  it('存在確認の後に別要求が同じバッチ・日付で先に入っても、2件目を作らない', async () => {
    const h = setup()
    // 「SELECT で見つからなかった」直後に、旧実装のランダムIDで作られた行が割り込む。
    h.onNextBatch(() => {
      h.sqlite.prepare(`
        INSERT INTO sessions (id, shop_code, started_at, status, item_count, type, import_batch_id)
        VALUES (?, ?, '2026-07-01T00:00:00.000Z', 'completed', 1, 'stock', ?)
      `).run('99999999-9999-4999-8999-999999999999', CODE, BATCH)
    })

    const blocked = await handlePastImportCreate(h.db, CODE, BATCH, { date: '2026-07-01', items: items(3) })
    // 一意インデックスが2件目を止める。部分状態は残らない。
    expect(blocked._status).toBe(503)
    expect(blocked.retryable).toBe(true)
    expect(sessionsOf(h)).toHaveLength(1)
    expect(linesOf(h)).toHaveLength(0)

    // 再送は既存セッションを見つけて貼り直す（増えない）。
    const retry = await handlePastImportCreate(h.db, CODE, BATCH, { date: '2026-07-01', items: items(3) })
    expect(retry.ok).toBe(true)
    expect(sessionsOf(h)).toHaveLength(1)
    expect(linesOf(h)).toHaveLength(3)
  })

  it('sessionId は (店舗・バッチ・日付) から決まる（応答を取りこぼしても同じ）', async () => {
    const id1 = await importSessionId(CODE, BATCH, '2026-07-01')
    const id2 = await importSessionId(CODE, BATCH, '2026-07-01')
    expect(id1).toBe(id2)
    expect(id1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    // 店舗・バッチ・日付のどれが変わっても別ID
    expect(await importSessionId(OTHER, BATCH, '2026-07-01')).not.toBe(id1)
    expect(await importSessionId(CODE, 'imp_other', '2026-07-01')).not.toBe(id1)
    expect(await importSessionId(CODE, BATCH, '2026-07-02')).not.toBe(id1)
  })

  it('応答を取りこぼした client の再送で、セッションも履歴も重複しない', async () => {
    const h = setup()
    const body = { date: '2026-07-01', items: items(4) }
    const first = await handlePastImportCreate(h.db, CODE, BATCH, body)   // 応答が client へ届かなかった想定
    const retry = await handlePastImportCreate(h.db, CODE, BATCH, body)

    expect(retry.sessionId).toBe(first.sessionId)
    expect(sessionsOf(h)).toHaveLength(1)
    expect(historyOf(h)).toHaveLength(1)
    expect(linesOf(h)).toHaveLength(4)
  })

  it('DB側でも同一 (店舗・バッチ・日付) の2セッションを作れない（0014）', async () => {
    const h = setup()
    const ins = h.sqlite.prepare(`
      INSERT INTO sessions (id, shop_code, started_at, status, item_count, type, import_batch_id)
      VALUES (?, ?, '2026-07-01T00:00:00.000Z', 'completed', 1, 'stock', ?)
    `)
    ins.run('dup-1', CODE, BATCH)
    expect(() => ins.run('dup-2', CODE, BATCH)).toThrow()
    // 通常の棚卸（import_batch_id NULL）は何件でも作れる
    const normal = h.sqlite.prepare(`
      INSERT INTO sessions (id, shop_code, started_at, status, item_count, type)
      VALUES (?, ?, '2026-07-01T00:00:00.000Z', 'completed', 1, 'stock')
    `)
    normal.run('n-1', CODE)
    normal.run('n-2', CODE)
    expect(sessionsOf(h)).toHaveLength(3)
  })
})

describe('server側の検証', () => {
  const bad = async (body, batch = BATCH) => {
    const h = setup()
    return handlePastImportCreate(h.db, CODE, batch, body)
  }

  it('不正な日付を拒否する', async () => {
    for (const date of ['2026-02-30', '26-7-1', '2026/07/01', '', null, 'abc']) {
      expect((await bad({ date, items: items() })).code, String(date)).toBe('invalid_date')
    }
  })

  it('不正な取込IDを拒否する', async () => {
    for (const b of ['', 'a'.repeat(65), 'imp id', 'imp/../x']) {
      expect((await bad({ date: '2026-07-01', items: items() }, b)).code, b).toBe('invalid_batch')
    }
  })

  it('数量の非有限値・負数を拒否する（0へ丸めない）', async () => {
    for (const qty of [NaN, Infinity, -1, 'abc', null, undefined, {}]) {
      const r = await bad({ date: '2026-07-01', items: [{ item: 'A', qty }] })
      expect(r.code, String(qty)).toBe('invalid_qty')
    }
  })

  it('数量0は正当な記録として受け付ける', async () => {
    const h = setup()
    const r = await handlePastImportCreate(h.db, CODE, BATCH, {
      date: '2026-07-01', items: [{ item: 'A', qty: 0 }],
    })
    expect(r.ok).toBe(true)
    expect(linesOf(h)[0].qty).toBe(0)
  })

  it('不正な単価を拒否する', async () => {
    for (const unitPrice of [Infinity, -1, 1e12]) {
      const r = await bad({ date: '2026-07-01', items: [{ item: 'A', qty: 1, unitPrice }] })
      expect(r.code, String(unitPrice)).toBe('invalid_price')
    }
  })

  it('行数の上限を超える payload を拒否する', async () => {
    const r = await bad({ date: '2026-07-01', items: items(MAX_LINES_PER_REQUEST + 1) })
    expect(r._status).toBe(413)
    expect(r.code).toBe('too_many_lines')
  })

  it('明細が配列でない / 空 / 品目名が空だけの場合を拒否する', async () => {
    expect((await bad({ date: '2026-07-01', items: 'x' })).code).toBe('invalid_items')
    expect((await bad({ date: '2026-07-01', items: [] })).code).toBe('no_lines')
    expect((await bad({ date: '2026-07-01', items: [{ item: '   ', qty: 1 }] })).code).toBe('no_lines')
  })

  it('長すぎる品目名・単位を切り詰めて保存する', async () => {
    const h = setup()
    await handlePastImportCreate(h.db, CODE, BATCH, {
      date: '2026-07-01', items: [{ item: 'あ'.repeat(500), qty: 1, unit: 'い'.repeat(200) }],
    })
    const line = linesOf(h)[0]
    expect(line.item_name.length).toBe(200)
    expect(line.unit.length).toBe(50)
  })

  it('スナップショットが object でない場合を拒否する', async () => {
    expect((await bad({ date: '2026-07-01', items: items(), snapshot: [] })).code).toBe('invalid_snapshot')
    expect((await bad({ date: '2026-07-01', items: items(), snapshot: 'x' })).code).toBe('invalid_snapshot')
  })

  it('上書き対象の指定が不正な場合を拒否する', async () => {
    expect((await bad({ date: '2026-07-01', items: items(), replaceSessionIds: 'x' })).code).toBe('invalid_replace')
    expect((await bad({ date: '2026-07-01', items: items(), replaceSessionIds: ['a b'] })).code).toBe('invalid_replace')
  })
})

describe('取込の取消', () => {
  async function seedTwoBatches() {
    const h = setup()
    await handlePastImportCreate(h.db, CODE, BATCH,      { date: '2026-07-01', items: items(2) })
    await handlePastImportCreate(h.db, CODE, BATCH,      { date: '2026-07-02', items: items(2) })
    await handlePastImportCreate(h.db, CODE, 'imp_other', { date: '2026-07-03', items: items(2) })
    h.sqlite.prepare(
      "INSERT INTO sessions (id, shop_code, started_at, status, item_count, type) VALUES (?, ?, ?, 'completed', 5, 'stock')"
    ).run('normal-1', CODE, '2026-07-01T09:00:00.000Z')
    h.sqlite.prepare(
      'INSERT INTO store_history (shop_code, session_id, snapshot_date, snapshot_json, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(CODE, 'normal-1', '2026-07-01', '{}', '2026-07-01T09:00:00.000Z')
    return h
  }

  it('バッチ単位で session・明細・スナップショットを消し、件数を返す', async () => {
    const h = await seedTwoBatches()
    const r = await handlePastImportCancel(h.db, CODE, BATCH)

    expect(r.ok).toBe(true)
    expect(r.removed).toBe(2)
    expect(sessionsOf(h).filter(s => s.import_batch_id === BATCH)).toHaveLength(0)
  })

  it('別バッチと通常の棚卸は消さない', async () => {
    const h = await seedTwoBatches()
    await handlePastImportCancel(h.db, CODE, BATCH)

    const ids = sessionsOf(h).map(s => s.id)
    expect(ids).toContain('normal-1')
    expect(sessionsOf(h).filter(s => s.import_batch_id === 'imp_other')).toHaveLength(1)
    expect(historyOf(h).some(x => x.session_id === 'normal-1')).toBe(true)
    expect(linesOf(h)).toHaveLength(2)      // imp_other のぶんだけ残る
  })

  it('2回目の取消も成功し、removed:0 を返す（冪等）', async () => {
    const h = await seedTwoBatches()
    await handlePastImportCancel(h.db, CODE, BATCH)
    const again = await handlePastImportCancel(h.db, CODE, BATCH)
    expect(again).toMatchObject({ ok: true, removed: 0 })
  })

  it('他店舗のバッチは消せない', async () => {
    const h = setup()
    await handlePastImportCreate(h.db, OTHER, BATCH, { date: '2026-07-01', items: items(2) })
    const r = await handlePastImportCancel(h.db, CODE, BATCH)

    expect(r.removed).toBe(0)
    expect(sessionsOf(h, OTHER)).toHaveLength(1)
  })

  it('不正な取込IDを拒否する', async () => {
    const h = setup()
    expect((await handlePastImportCancel(h.db, CODE, 'a b')).code).toBe('invalid_batch')
  })

  it('取消したあと同じバッチIDで再取込できる（取消 → 再取込が冪等）', async () => {
    const h = setup()
    await handlePastImportCreate(h.db, CODE, BATCH, { date: '2026-07-01', items: items(3) })
    await handlePastImportCancel(h.db, CODE, BATCH)
    const again = await handlePastImportCreate(h.db, CODE, BATCH, { date: '2026-07-01', items: items(3) })

    expect(again.ok).toBe(true)
    expect(sessionsOf(h)).toHaveLength(1)
    expect(linesOf(h)).toHaveLength(3)
    expect(historyOf(h)).toHaveLength(1)
  })
})
