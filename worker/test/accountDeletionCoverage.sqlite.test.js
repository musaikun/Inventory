// account削除が「店のデータを持つ全テーブル」を消すことを、全migrationを当てた実SQLiteで確かめる。
//
// 既存の accountDeletion.test.js は手で並べたテーブル一覧のモックで動くので、新しいテーブルを
// migration に足しても、削除の対象に足し忘れたことに気づけない（スタッフ・やること・見守りで
// テーブルが一気に増えた）。ここでは shop_code を持つテーブルをスキーマから拾い、
// 全部に1行ずつ入れてから削除し、残っていないこと・別の店には触れていないことを見る。
import { describe, it, expect, beforeEach } from 'vitest'
import { createD1 } from './d1Harness.js'
import { handleRegister } from '../src/authHandler.js'
import { handleAccountDelete } from '../src/accountDeletion.js'

const REQUEST_ID = '22222222-2222-4222-8222-222222222222'

// shop_code を持たないテーブル。新しく増えたら、ここで扱いを決める（削除の対象か・店に紐付かないか）
const NO_SHOP_CODE = {
  account_deletion_receipts: '削除の冪等receipt。account識別子を持たず7日で消える',
  ip_attempts: 'IP単位の失敗記録。店に紐付かず15分で消える',
  push_sent: '送った通知の印。endpoint経由で消す（下で確認）',
}

// 0011 の「削除中・削除済みの店へは書けない」トリガーを持たないテーブル。
// 0018 以降のテーブルには 0027 で付けた。新しいテーブルを足したら、同じトリガーを付けるか、
// ここへ理由つきで足す。
const NO_ACTIVE_TRIGGER = new Set([
  'stores',                 // 店そのもの
])

let h
const tables = () => h.rows("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map(r => r.name)
const columns = t => h.rows(`PRAGMA table_info(${t})`)
const shopTables = () => tables().filter(t => columns(t).some(c => c.name === 'shop_code'))

/** どのテーブルにも入る1行を、スキーマから組み立てて入れる（親テーブルの主キーは引き継ぐ） */
function seedRow(table, code, parents, suffix = '') {
  const fks = h.rows(`PRAGMA foreign_key_list(${table})`)
  const cols = [], vals = []
  for (const c of columns(table)) {
    const fk = fks.find(f => f.from === c.name)
    let v
    if (c.name === 'shop_code') v = code
    else if (fk) v = fk.table === 'stores' ? code : parents[fk.table]
    else if (c.pk && /INT/i.test(c.type)) continue          // 自動採番
    else if (c.pk || c.notnull) v = /INT/i.test(c.type) ? 1 : /REAL/i.test(c.type) ? 1 : `${table}-${c.name}-${code}${suffix}`
    else continue
    cols.push(c.name); vals.push(v)
  }
  h.sqlite.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...vals)
  const pk = columns(table).find(c => c.pk)
  return pk ? vals[cols.indexOf(pk.name)] : null
}

function seedAll(code) {
  const parents = {}
  // 外部キーで参照される側を先に入れる（店は登録で入っている）
  const pending = shopTables().filter(t => t !== 'stores')
  while (pending.length) {
    const i = pending.findIndex(t => h.rows(`PRAGMA foreign_key_list(${t})`)
      .every(f => f.table === 'stores' || f.table in parents))
    if (i < 0) throw new Error(`外部キーの順番が決まらない: ${pending.join(', ')}`)
    const [t] = pending.splice(i, 1)
    parents[t] = seedRow(t, code, parents)
  }
  const endpoint = h.rows('SELECT endpoint FROM push_subscriptions WHERE shop_code = ?', code)[0].endpoint
  h.sqlite.prepare('INSERT INTO push_sent (endpoint, sent_key) VALUES (?, ?)').run(endpoint, `me:2026-10:${code}`)
  return { endpoint }
}

const count = (t, code) => h.rows(`SELECT COUNT(*) AS n FROM ${t} WHERE shop_code = ?`, code)[0].n

describe('account削除: 店のデータを持つ全テーブル', () => {
  let target, other, seeded
  beforeEach(async () => {
    h = createD1()
    target = await handleRegister(h.db, { storeName: '本店', pin: '582941' })
    other  = await handleRegister(h.db, { storeName: '支店', pin: '693027' })
    seeded = { target: seedAll(target.shopCode), other: seedAll(other.shopCode) }
  })

  it('shop_code を持たないテーブルは、扱いを決めたものだけ', () => {
    expect(tables().filter(t => !shopTables().includes(t)).sort()).toEqual(Object.keys(NO_SHOP_CODE).sort())
  })

  it('削除すると、店の行がどのテーブルにも残らず、別の店の行は残る', async () => {
    for (const t of shopTables()) expect(count(t, target.shopCode), t).toBeGreaterThan(0)
    const before = Object.fromEntries(shopTables().map(t => [t, count(t, other.shopCode)]))

    const req = new Request('https://w.test/auth/account', { headers: { Authorization: `Bearer ${target.token}` } })
    const res = await handleAccountDelete(h.db, req, { requestId: REQUEST_ID, pin: '582941', confirmation: target.shopCode }, async () => {})
    expect(res._status ?? 200).toBe(200)

    for (const t of shopTables()) {
      if (t === 'stores') continue
      expect(count(t, target.shopCode), `${t} に削除した店の行が残っている`).toBe(0)
      expect(count(t, other.shopCode), `${t} の別の店の行が減った`).toBe(before[t])
    }
    // 店そのものは7日の匿名tombstone（名前・PINを消す）
    const store = h.rows('SELECT store_name, pin_hash, deleted_at FROM stores WHERE shop_code = ?', target.shopCode)[0]
    expect(store.deleted_at).not.toBeNull()
    expect(store.store_name ?? null).toBeNull()
    expect(store.pin_hash ?? null).toBeNull()
    // 送った通知の印は endpoint で消す
    expect(h.rows('SELECT * FROM push_sent WHERE endpoint = ?', seeded.target.endpoint)).toEqual([])
    expect(h.rows('SELECT * FROM push_sent WHERE endpoint = ?', seeded.other.endpoint)).toHaveLength(1)
  })

  it('削除中の店へは、どのテーブルにも新しい行を書けない', () => {
    h.sqlite.prepare('UPDATE stores SET deletion_pending_at = ? WHERE shop_code = ?').run('2026-10-13T00:00:00.000Z', target.shopCode)
    const parents = {}
    for (const t of shopTables().filter(t => t !== 'stores')) {
      for (const f of h.rows(`PRAGMA foreign_key_list(${t})`)) {
        if (f.table !== 'stores') parents[f.table] = h.rows(`SELECT ${f.to} AS id FROM ${f.table} WHERE shop_code = ? LIMIT 1`, target.shopCode)[0].id
      }
      expect(() => seedRow(t, target.shopCode, parents, '-2'), t).toThrow(/account_inactive/)
    }
  })

  it('削除中・削除済みの店へ書けないトリガーは、決めた例外を除く全テーブルにある', () => {
    const triggered = new Set(h.rows("SELECT tbl_name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'trg_%_active_insert'").map(r => r.tbl_name))
    const missing = shopTables().filter(t => !triggered.has(t))
    expect(missing.sort()).toEqual([...NO_ACTIVE_TRIGGER].sort())
  })
})
