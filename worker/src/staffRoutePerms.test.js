/**
 * soft auth の経路でもスタッフの権限を確かめる（User決定 2026-11-02 / DOC-004 要確認2）。
 *
 * 入口の店舗認証（verifyStoreAccess）だけでは、権限をオフにしたスタッフでも API を直接呼べば
 * 過去の棚卸を読み・書き換え、発注・入出庫・進行中の数を書けた。ここでは「権限が無ければ 403、
 * あれば 403 にならない」だけを見る（その先の保存処理は既存のテストが受け持つ）。
 */
import { describe, it, expect } from 'vitest'
import worker from './index.js'

const SHOP = 'ABCDEF'

// 権限の判定に要る問い合わせだけに答える D1。ほかは空で返す
function makeDb(staff) {
  const first = (s, args) => {
    if (s.includes('FROM auth_tokens')) {
      const tok = args[0] === 'staff-tok' || args[1] === 'staff-tok'
      return tok ? { shop_code: SHOP, staff_id: staff.id, deleted_at: null, deletion_pending_at: null, owner_name: null } : null
    }
    if (s.includes('FROM staff WHERE id')) return { ...staff, status: 'active' }
    if (s.includes('FROM stores')) return { shop_code: SHOP, pin_hash: 'x', deleted_at: null, deletion_pending_at: null }
    if (s.includes('COUNT(*)')) return { n: 0 }
    return null
  }
  const stmt = (sql, args = []) => {
    const s = sql.replace(/\s+/g, ' ').trim()
    return {
      bind: (...a) => stmt(sql, a),
      first: async () => first(s, args),
      all: async () => ({ results: [] }),
      run: async () => ({ success: true, meta: { changes: 0 } }),
    }
  }
  return { prepare: sql => stmt(sql), batch: async list => list.map(() => ({ success: true, results: [], meta: { changes: 0 } })) }
}

const req = (method, path, body) => new Request(`https://api.test/store/${SHOP}${path}`, {
  method,
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer staff-tok' },
  body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
})
const call = async (groups, method, path, body) => {
  const staff = { id: 'st_0123456789abcdef', name: '鈴木', role: 'arbeit', grants_json: JSON.stringify({ v: 2, groups }) }
  const env = { DB: makeDb(staff), ROOMS: { idFromName: () => 'x', get: () => null }, ALLOWED_ORIGIN: '' }
  return (await worker.fetch(req(method, path, body), env)).status
}

describe('soft auth の経路のスタッフ権限', () => {
  it('タスク管理だけの人は、過去の棚卸の読み書き・進行中の数・発注・入出庫を 403', async () => {
    const g = ['tasks']
    expect(await call(g, 'GET', '/history')).toBe(403)
    expect(await call(g, 'POST', '/history', { date: '2026-11-01', items: [] })).toBe(403)
    expect(await call(g, 'PUT', '/inventory', { inventory: {} })).toBe(403)
    expect(await call(g, 'POST', '/orders', { id: 'o1', lines: [] })).toBe(403)
    expect(await call(g, 'POST', '/movements', { type: 'in', lines: [] })).toBe(403)
  })

  it('在庫管理の人は、過去の棚卸を読める（在庫ページ・日誌が直近の数を使う）・書ける', async () => {
    const g = ['inventory']
    expect(await call(g, 'GET', '/history')).not.toBe(403)
    expect(await call(g, 'POST', '/history', { date: '2026-11-01', items: [] })).not.toBe(403)
    expect(await call(g, 'PUT', '/inventory', { inventory: {} })).not.toBe(403)
    expect(await call(g, 'POST', '/orders', { id: 'o1', lines: [] })).not.toBe(403)
    expect(await call(g, 'POST', '/movements', { type: 'in', lines: [] })).not.toBe(403)
  })

  it('レポートだけの人は過去の棚卸を読めるが、訂正はできない', async () => {
    const g = ['report']
    expect(await call(g, 'GET', '/history')).not.toBe(403)
    expect(await call(g, 'POST', '/history', { date: '2026-11-01', items: [] })).toBe(403)
  })

  it('データの更新（品目の取り込み）の人は、納品の取り込みで入出庫を入れられる', async () => {
    expect(await call(['data'], 'POST', '/movements', { type: 'in', lines: [] })).not.toBe(403)
  })
})
