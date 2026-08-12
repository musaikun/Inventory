// 実SQLite（node:sqlite）を D1 互換の形で包むテスト用ハーネス。
//
// 手製のSQL文字列モックでは、実際に書いたSQLが正しいかを検証できない。
// 複数行まとめINSERT・JOIN による持ち主確認・batch のロールバックは
// 「SQLとして正しいか」が要点なので、全migrationを適用した本物のSQLiteで動かす。
//
// D1 の batch は 1 トランザクション。ここでも BEGIN / COMMIT / ROLLBACK で再現し、
// failAt で任意の statement を落として部分失敗を注入できるようにしている。

import { DatabaseSync } from 'node:sqlite'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const migrationsDir = fileURLToPath(new URL('../migrations/', import.meta.url))

/** migrations/ のファイル名を名前順で返す（`0012` のような接頭辞で絞れる） */
export function migrationFiles({ from = null, to = null } = {}) {
  return readdirSync(migrationsDir)
    .filter(n => n.endsWith('.sql'))
    .sort()
    .filter(n => (from == null || n >= from) && (to == null || n <= to))
}

/** migration を1本ずつ適用する（適用途中の状態を作るテスト用） */
export function applyMigrations(sqlite, files) {
  for (const file of files) sqlite.exec(readFileSync(join(migrationsDir, file), 'utf8'))
}

/** migrations/ のSQLを名前順に全部当てた空DBを作る */
export function createD1() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec('PRAGMA foreign_keys = ON')
  applyMigrations(sqlite, migrationFiles())

  let failAt = null
  let stmtIndex = 0
  let beforeBatch = null
  // D1 の「Queries per Worker invocation」に相当する本数。
  // batch の外の SELECT/UPDATE は1本、batch は含まれる statement 数ぶんを数える
  // （公式資料に batch の数え方の明記が無いため、厳しい側を採る・constants.js 参照）。
  let queries = 0
  let lastBatchSize  = 0
  let maxBatchSize   = 0
  let maxBoundParams = 0

  function prepare(sql) {
    let values = []
    const stmt = {
      sql,
      bind(...next) { values = next; return stmt },
      async first() {
        queries++
        return sqlite.prepare(sql).get(...values) ?? null
      },
      async all() {
        queries++
        return { results: sqlite.prepare(sql).all(...values) }
      },
      async run() {
        queries++
        const r = sqlite.prepare(sql).run(...values)
        return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }
      },
      /** bind した値の個数（bound parameter 上限の検証用） */
      boundParams() { return values.length },
    }
    return stmt
  }

  async function batch(statements) {
    lastBatchSize = statements.length
    maxBatchSize  = Math.max(maxBatchSize, statements.length)
    maxBoundParams = Math.max(maxBoundParams, 0, ...statements.map(s => s.boundParams?.() ?? 0))
    if (beforeBatch) { const cb = beforeBatch; beforeBatch = null; cb() }

    const results = []
    sqlite.exec('BEGIN')
    stmtIndex = 0
    try {
      for (const s of statements) {
        if (failAt === stmtIndex) { failAt = null; throw new Error('D1_ERROR: injected failure') }
        stmtIndex++
        results.push(await s.run())
      }
      sqlite.exec('COMMIT')
      return results
    } catch (e) {
      sqlite.exec('ROLLBACK')
      throw e
    }
  }

  const db = { prepare, batch }

  return {
    db,
    sqlite,
    /** batch の i 番目（0始まり）の statement で失敗させる */
    failBatchAt(i) { failAt = i },
    /**
     * 次の batch が始まる直前（BEGIN の前）に1回だけ呼ぶ。
     * 「存在確認 → batch」の隙間に別リクエストが割り込む競合を再現する。
     */
    onNextBatch(cb) { beforeBatch = cb },
    /** D1 クエリ本数のカウンタ（batch 内 statement も1本ずつ数える） */
    resetCounters() { queries = 0; maxBatchSize = 0; lastBatchSize = 0; maxBoundParams = 0 },
    counters() { return { queries, maxBatchSize, lastBatchSize, maxBoundParams } },
    /** テーブルを素の配列で読む（アサーション用） */
    rows(sql, ...params) { return sqlite.prepare(sql).all(...params) },
    /** 店舗と（任意で）セッションを用意する */
    seedStore(code, { sessionId = null, status = 'active' } = {}) {
      sqlite.prepare('INSERT INTO stores (shop_code, created_at, updated_at) VALUES (?, ?, ?)')
        .run(code, '2026-08-09T00:00:00.000Z', '2026-08-09T00:00:00.000Z')
      if (sessionId) {
        sqlite.prepare(
          'INSERT INTO sessions (id, shop_code, started_at, status, item_count, type) VALUES (?, ?, ?, ?, 0, ?)'
        ).run(sessionId, code, '2026-08-09T00:00:00.000Z', status, 'stock')
      }
      return code
    },
  }
}

/** 品目 n 件の在庫オブジェクトを作る */
export function makeInventory(n, { qty = 1, unit = '個' } = {}) {
  const inv = {}
  for (let i = 0; i < n; i++) inv[`品目${String(i).padStart(4, '0')}`] = { qty, unit }
  return inv
}

/** 明細 n 件の配列を作る（order / movement 用） */
export function makeLines(n, extra = {}) {
  return Array.from({ length: n }, (_, i) => ({
    item: `品目${String(i).padStart(4, '0')}`, qty: 1, unit: '個', ...extra,
  }))
}
