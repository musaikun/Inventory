import { describe, it, expect } from 'vitest'
import { createD1 } from './d1Harness.js'

// migration を追加したときの必須確認（第2セッション / 0012）。
// 空DBへ全migrationを順に適用できること、狙った制約になっていることを固定する。
describe('全migrationのfresh適用', () => {
  it('空DBへ 0001〜最新まで適用できる', () => {
    const h = createD1()
    const tables = h.rows("SELECT name FROM sqlite_master WHERE type='table'").map(r => r.name)
    for (const t of ['stores', 'sessions', 'inventory_lines', 'store_history', 'orders', 'order_lines', 'movements', 'movement_lines']) {
      expect(tables).toContain(t)
    }
  })

  it('0012: store_history に session_id 列がある', () => {
    const h = createD1()
    const cols = h.rows('PRAGMA table_info(store_history)').map(r => r.name)
    expect(cols).toContain('session_id')
  })

  it('0012: 旧UNIQUE(shop_code, snapshot_date)が外れ、同日2セッションを入れられる', () => {
    const h = createD1()
    h.seedStore('ABCDEF')
    const ins = h.sqlite.prepare(
      'INSERT INTO store_history (shop_code, session_id, snapshot_date, snapshot_json, created_at) VALUES (?, ?, ?, ?, ?)'
    )
    ins.run('ABCDEF', 's1', '2026-08-09', '{}', '2026-08-09T00:00:00Z')
    ins.run('ABCDEF', 's2', '2026-08-09', '{}', '2026-08-09T00:00:00Z')
    expect(h.rows('SELECT * FROM store_history')).toHaveLength(2)
  })

  it('0012: 同一セッションの二重登録は一意制約で拒否される', () => {
    const h = createD1()
    h.seedStore('ABCDEF')
    const ins = h.sqlite.prepare(
      'INSERT INTO store_history (shop_code, session_id, snapshot_date, snapshot_json, created_at) VALUES (?, ?, ?, ?, ?)'
    )
    ins.run('ABCDEF', 's1', '2026-08-09', '{}', '2026-08-09T00:00:00Z')
    expect(() => ins.run('ABCDEF', 's1', '2026-08-10', '{}', '2026-08-10T00:00:00Z')).toThrow()
  })

  it('0012: session_id を持たない行は日付で一意のまま', () => {
    const h = createD1()
    h.seedStore('ABCDEF')
    const ins = h.sqlite.prepare(
      'INSERT INTO store_history (shop_code, session_id, snapshot_date, snapshot_json, created_at) VALUES (?, NULL, ?, ?, ?)'
    )
    ins.run('ABCDEF', '2026-07-07', '{}', '2026-07-07T00:00:00Z')
    expect(() => ins.run('ABCDEF', '2026-07-07', '{}', '2026-07-07T00:00:00Z')).toThrow()
  })

  it('0012: 削除済みアカウントへ履歴を書けないトリガが残っている', () => {
    const h = createD1()
    h.sqlite.prepare('INSERT INTO stores (shop_code, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?)')
      .run('GONE01', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z', '2026-08-02T00:00:00Z')
    expect(() => h.sqlite.prepare(
      'INSERT INTO store_history (shop_code, session_id, snapshot_date, snapshot_json, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run('GONE01', 's1', '2026-08-09', '{}', '2026-08-09T00:00:00Z')).toThrow(/account_inactive/)
  })
})
