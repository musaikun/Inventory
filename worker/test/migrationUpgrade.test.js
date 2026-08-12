/**
 * データが入った既存DBを 0012 以降へ更新できることを確かめる（第2セッション §5）。
 *
 * fresh 適用（migrationFresh.test.js）だけでは、本番と同じ「0011 まで適用済みで
 * データが入っている」DBを壊さないかを確認できない。0012 は
 * `DROP TABLE store_history` を含む不可逆 migration なので、
 *   ・既存行が1行も落ちないこと
 *   ・snapshot_json の sessionId が session_id 列へ引き上がること
 *   ・0011 のトリガが貼り直されること
 *   ・0014 の revision / updated_at が既存行にも入ること
 * をここで固定する。
 *
 * 実D1（remote）へは適用していない。これはローカル SQLite 上の検証。
 */
import { describe, it, expect } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { applyMigrations, migrationFiles } from './d1Harness.js'

const SHOP  = 'OLDSHP'
const SESS  = '11111111-1111-4111-8111-111111111111'

/** 0011 までを適用し、本番相当のデータを入れた DB を返す */
function seedLegacyDb() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec('PRAGMA foreign_keys = ON')
  applyMigrations(sqlite, migrationFiles({ to: '0011_account_deletion.sql' }))

  sqlite.prepare('INSERT INTO stores (shop_code, created_at, updated_at) VALUES (?, ?, ?)')
    .run(SHOP, '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z')

  sqlite.prepare(`
    INSERT INTO sessions (id, shop_code, started_at, ended_at, status, item_count, total_value, type)
    VALUES (?, ?, '2026-07-07T01:00:00.000Z', '2026-07-07T02:00:00.000Z', 'completed', 351, 120000, 'stock')
  `).run(SESS, SHOP)

  const line = sqlite.prepare(`
    INSERT INTO inventory_lines (session_id, shop_code, taken_at, item_name, category, qty, unit, unit_price, line_value)
    VALUES (?, ?, '2026-07-07', ?, NULL, ?, '個', 100, ?)
  `)
  for (let i = 0; i < 351; i++) line.run(SESS, SHOP, `品目${i}`, i + 1, (i + 1) * 100)

  const hist = sqlite.prepare(
    'INSERT INTO store_history (shop_code, snapshot_date, snapshot_json, created_at) VALUES (?, ?, ?, ?)'
  )
  // sessionId を持つ完了スナップショット（0012 で session_id へ引き上がる）
  hist.run(SHOP, '2026-07-07', JSON.stringify({ date: '2026-07-07', sessionId: SESS, items: [{ item: '牛乳', qty: 1 }] }),
    '2026-07-07T02:00:00.000Z')
  // sessionId を持たない旧データ（session_id NULL のまま残る）
  hist.run(SHOP, '2026-06-30', JSON.stringify({ date: '2026-06-30', items: [] }), '2026-06-30T02:00:00.000Z')

  return sqlite
}

function upgrade(sqlite) {
  applyMigrations(sqlite, migrationFiles({ from: '0012_history_session_key.sql' }))
  return sqlite
}

const rows = (db, sql, ...p) => db.prepare(sql).all(...p)

describe('データ入りDBの 0011 → 最新 更新', () => {
  it('0012 以降を順に適用できる', () => {
    expect(() => upgrade(seedLegacyDb())).not.toThrow()
  })

  it('既存の履歴が1行も落ちない', () => {
    const db = seedLegacyDb()
    const before = rows(db, 'SELECT id, shop_code, snapshot_date, snapshot_json, created_at FROM store_history ORDER BY id')
    upgrade(db)
    const after = rows(db, 'SELECT id, shop_code, snapshot_date, snapshot_json, created_at FROM store_history ORDER BY id')
    expect(after).toEqual(before)
  })

  it('snapshot_json の sessionId が session_id 列へ引き上がる', () => {
    const db = upgrade(seedLegacyDb())
    const byDate = Object.fromEntries(
      rows(db, 'SELECT snapshot_date, session_id FROM store_history').map(r => [r.snapshot_date, r.session_id])
    )
    expect(byDate['2026-07-07']).toBe(SESS)
    expect(byDate['2026-06-30']).toBeNull()      // 旧データは NULL のまま
  })

  it('sessions と inventory_lines は 0012 の作り直しに巻き込まれない', () => {
    const db = upgrade(seedLegacyDb())
    expect(rows(db, 'SELECT * FROM inventory_lines WHERE session_id = ?', SESS)).toHaveLength(351)
    expect(rows(db, 'SELECT status, item_count, total_value FROM sessions WHERE id = ?', SESS)[0])
      .toMatchObject({ status: 'completed', item_count: 351, total_value: 120000 })
  })

  it('0013 / 0014 の列が既存行へ後方互換で足される', () => {
    const db = upgrade(seedLegacyDb())
    expect(rows(db, 'PRAGMA table_info(sessions)').map(r => r.name)).toContain('import_batch_id')
    expect(rows(db, 'SELECT import_batch_id FROM sessions WHERE id = ?', SESS)[0].import_batch_id).toBeNull()

    const hist = rows(db, 'PRAGMA table_info(store_history)').map(r => r.name)
    expect(hist).toEqual(expect.arrayContaining(['revision', 'updated_at']))
  })

  it('0014: 既存履歴に revision と updated_at が埋まる（0 や NULL のまま残らない）', () => {
    const db = upgrade(seedLegacyDb())
    for (const r of rows(db, 'SELECT revision, updated_at, created_at FROM store_history')) {
      expect(r.revision).toBeGreaterThan(0)
      expect(r.updated_at).toBe(r.created_at)
    }
    // 店舗内で重複しない＝以後の「最大値+1」採番が単調増加になる
    const revs = rows(db, 'SELECT revision FROM store_history').map(r => r.revision)
    expect(new Set(revs).size).toBe(revs.length)
  })

  it('更新後も index と trigger が揃っている', () => {
    const db = upgrade(seedLegacyDb())
    const names = rows(db, "SELECT name, type FROM sqlite_master WHERE type IN ('index','trigger')")
    const idx = names.filter(r => r.type === 'index').map(r => r.name)
    const trg = names.filter(r => r.type === 'trigger').map(r => r.name)

    expect(idx).toEqual(expect.arrayContaining([
      'idx_history_session', 'idx_history_legacy_date', 'idx_history_shop_date',
      'idx_history_revision', 'idx_sessions_import_batch', 'idx_sessions_import_unique',
    ]))
    // 0012 は DROP TABLE でトリガも消すため、貼り直せていることを確認する
    expect(trg).toContain('trg_store_history_active_insert')
  })

  it('更新後も削除済みアカウントへ履歴を書けない（トリガが効いている）', () => {
    const db = upgrade(seedLegacyDb())
    db.prepare('INSERT INTO stores (shop_code, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?)')
      .run('GONE01', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z', '2026-08-02T00:00:00Z')
    expect(() => db.prepare(
      'INSERT INTO store_history (shop_code, session_id, snapshot_date, snapshot_json, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run('GONE01', 's1', '2026-08-09', '{}', '2026-08-09T00:00:00Z')).toThrow(/account_inactive/)
  })

  it('更新後の同日2セッション共存と、同一セッション二重登録の禁止が効く', () => {
    const db = upgrade(seedLegacyDb())
    const ins = db.prepare(
      'INSERT INTO store_history (shop_code, session_id, snapshot_date, snapshot_json, created_at) VALUES (?, ?, ?, ?, ?)'
    )
    ins.run(SHOP, 'sess-2', '2026-07-07', '{}', '2026-07-07T05:00:00Z')   // 同日・別セッションは共存
    expect(rows(db, "SELECT * FROM store_history WHERE snapshot_date = '2026-07-07'")).toHaveLength(2)
    expect(() => ins.run(SHOP, SESS, '2026-07-08', '{}', '2026-07-08T05:00:00Z')).toThrow()
  })

  it('0012 は D1 が受け付けない PRAGMA foreign_keys を使わない', async () => {
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const sql = readFileSync(
      fileURLToPath(new URL('../migrations/0012_history_session_key.sql', import.meta.url)), 'utf8')
    // コメント（`--` 行）は経緯の説明なので除いて、実行される文だけを見る。
    const statements = sql.split('\n').filter(l => !l.trimStart().startsWith('--')).join('\n')
    // D1 は暗黙トランザクション内で実行するため foreign_keys を切り替えられない。
    // https://developers.cloudflare.com/d1/sql-api/foreign-keys/
    expect(statements).not.toMatch(/PRAGMA\s+foreign_keys/i)
    expect(statements).toMatch(/PRAGMA\s+defer_foreign_keys\s*=\s*on/i)
  })
})
