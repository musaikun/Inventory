import { describe, it, expect } from 'vitest'
import { handleConfigPut, handleInventoryPut, handleHistoryPost, handleSessionComplete, handleRoomResult } from './storeHandler.js'

// 書き込み系の最小モック（INSERT/UPDATE を success で返すだけ）
function createMockD1() {
  const lines = []
  const sessions = [{ id: 'sess-001', shop_code: 'ABCDEF', status: 'active' }]

  function prepare(sql) {
    const s = sql.replace(/\s+/g, ' ').trim()
    let bound = []
    const stmt = {
      bind(...a) { bound = a; return stmt },
      async run() {
        if (s.startsWith('INSERT INTO inventory_lines')) {
          const [session_id, shop_code, taken_at, item_name, , qty, unit, unit_price, line_value] = bound
          lines.push({ session_id, shop_code, taken_at, item_name, qty, unit, unit_price, line_value })
        }
        return { success: true }
      },
      async first() {
        if (s.includes('FROM sessions WHERE id')) return sessions.find(s => s.id === bound[0]) ?? null
        return null
      },
      async all() { return { results: [] } },
    }
    return stmt
  }

  async function batch(stmts) {
    const results = []
    for (const s of stmts) results.push(await s.run())
    return results
  }

  return { prepare, batch, _lines: lines, _sessions: sessions }
}

describe('storeHandler ペイロードサイズ上限', () => {
  const code = 'ABCDEF'

  it('通常サイズの config は保存できる', async () => {
    const db  = createMockD1()
    const res = await handleConfigPut(db, code, { items: ['鶏もも', '玉ねぎ'], prices: { 鶏もも: 500 } })
    expect(res.ok).toBe(true)
  })

  it('巨大な config は 413 を返し保存しない', async () => {
    const db  = createMockD1()
    const res = await handleConfigPut(db, code, { blob: 'x'.repeat(1_100_000) })
    expect(res._status).toBe(413)
  })

  it('通常サイズの inventory は保存できる', async () => {
    const db  = createMockD1()
    const res = await handleInventoryPut(db, code, { inventory: { 鶏もも: { qty: 5, unit: 'kg' } } })
    expect(res.ok).toBe(true)
  })

  it('巨大な inventory は 413 を返し保存しない', async () => {
    const db  = createMockD1()
    const res = await handleInventoryPut(db, code, { blob: 'x'.repeat(1_100_000) })
    expect(res._status).toBe(413)
  })

  it('巨大な history スナップショットは 413 を返し保存しない', async () => {
    const db  = createMockD1()
    const res = await handleHistoryPost(db, code, { date: '2026-06-11', blob: 'x'.repeat(1_100_000) })
    expect(res._status).toBe(413)
  })
})

describe('handleSessionComplete — inventory_lines 展開', () => {
  const code    = 'ABCDEF'
  const sessId  = 'sess-001'
  const takenAt = '2026-06-11'
  const inventory = {
    'コーヒー豆': { qty: 5,  unit: 'kg' },
    '牛乳':       { qty: 12, unit: '本' },
  }
  const prices = { 'コーヒー豆': 2000 }

  it('品目数分の inventory_lines が挿入される', async () => {
    const db  = createMockD1()
    const res = await handleSessionComplete(db, code, sessId, { inventory, prices, takenAt })
    expect(res.ok).toBe(true)
    expect(db._lines).toHaveLength(2)
  })

  it('単価あり品目の line_value が正しく計算される', async () => {
    const db  = createMockD1()
    await handleSessionComplete(db, code, sessId, { inventory, prices, takenAt })
    const coffee = db._lines.find(l => l.item_name === 'コーヒー豆')
    expect(coffee.unit_price).toBe(2000)
    expect(coffee.line_value).toBe(10000)
  })

  it('単価なし品目の unit_price・line_value が null になる', async () => {
    const db  = createMockD1()
    await handleSessionComplete(db, code, sessId, { inventory, prices, takenAt })
    const milk = db._lines.find(l => l.item_name === '牛乳')
    expect(milk.unit_price).toBeNull()
    expect(milk.line_value).toBeNull()
  })

  it('存在しないセッションIDは 404 を返す', async () => {
    const db  = createMockD1()
    const res = await handleSessionComplete(db, code, 'no-such-id', { inventory, prices, takenAt })
    expect(res._status).toBe(404)
  })
})

// ── 完了後ゲスト閲覧（handleRoomResult）────────────────────────────────────────
function createResultMockD1({ session = null, newer = null, snapshots = [] } = {}) {
  function prepare(sql) {
    const s = sql.replace(/\s+/g, ' ').trim()
    const stmt = {
      bind() { return stmt },
      async first() {
        if (s.includes('status, started_at, ended_at FROM sessions WHERE id')) return session
        if (s.includes("status = 'completed' AND started_at >")) return newer
        return null
      },
      async all() {
        if (s.includes('FROM store_history')) {
          return { results: snapshots.map(snap => ({ snapshot_json: JSON.stringify(snap) })) }
        }
        return { results: [] }
      },
    }
    return stmt
  }
  return { prepare }
}

describe('handleRoomResult — 完了後ゲスト閲覧', () => {
  const code = 'ABCDEF'
  const sid  = 'sess-xyz'
  const recentEnded = new Date(Date.now() - 60_000).toISOString()      // 1分前完了
  const oldEnded    = new Date(Date.now() - 5 * 86400_000).toISOString() // 5日前完了

  const snapshot = {
    sessionId: sid,
    date: '2026-06-30',
    items: [
      { item: '鶏もも', qty: 5, unit: 'kg', unitPrice: 500, subtotal: 2500, code: 'A01', flagged: false, category: '肉' },
    ],
    totalValue: 2500,
    participants: [{ name: '田中', items: [{ item: '鶏もも', qty: 5, unit: 'kg', subtotal: 2500 }], totalValue: 2500 }],
    auditLog: [{ id: 'e1', ingredient: '鶏もも', action: 'new', delta: 5, totalQty: 5, unit: 'kg', enteredBy: '田中', enteredById: 'd1', timestamp: Date.now() }],
  }

  it('セッションIDが無ければ 400', async () => {
    const db  = createResultMockD1()
    const res = await handleRoomResult(db, code, '')
    expect(res._status).toBe(400)
  })

  it('未完了セッションは 404', async () => {
    const db  = createResultMockD1({ session: { id: sid, status: 'active', started_at: '2026-06-30T00:00:00Z', ended_at: null } })
    const res = await handleRoomResult(db, code, sid)
    expect(res._status).toBe(404)
  })

  it('完了から3日を超えると 410', async () => {
    const db  = createResultMockD1({ session: { id: sid, status: 'completed', started_at: '2026-06-25T00:00:00Z', ended_at: oldEnded } })
    const res = await handleRoomResult(db, code, sid)
    expect(res._status).toBe(410)
  })

  it('より新しい完了セッションがあれば 410', async () => {
    const db  = createResultMockD1({
      session: { id: sid, status: 'completed', started_at: '2026-06-30T00:00:00Z', ended_at: recentEnded },
      newer:   { id: 'sess-new' },
    })
    const res = await handleRoomResult(db, code, sid)
    expect(res._status).toBe(410)
  })

  it('閲覧可能なら金額を除去した結果を返す', async () => {
    const db  = createResultMockD1({
      session:   { id: sid, status: 'completed', started_at: '2026-06-30T00:00:00Z', ended_at: recentEnded },
      snapshots: [snapshot],
    })
    const res = await handleRoomResult(db, code, sid)
    expect(res._status).toBeUndefined()
    expect(res.result.sessionId).toBe(sid)
    // 品目: 数量・単位は残り、金額は消える
    const item = res.result.items[0]
    expect(item.qty).toBe(5)
    expect(item.unit).toBe('kg')
    expect(item.unitPrice).toBeUndefined()
    expect(item.subtotal).toBeUndefined()
    expect(res.result.totalValue).toBeUndefined()
    // 参加者: 金額は消える
    expect(res.result.participants[0].totalValue).toBeUndefined()
    expect(res.result.participants[0].items[0].subtotal).toBeUndefined()
    expect(res.result.participants[0].items[0].qty).toBe(5)
    // 変更履歴: 誰が・何を・いつ は残る
    expect(res.result.auditLog[0].enteredBy).toBe('田中')
    expect(res.result.auditLog[0].action).toBe('new')
  })

  it('完了済みだがスナップショットが無ければ 404', async () => {
    const db  = createResultMockD1({
      session:   { id: sid, status: 'completed', started_at: '2026-06-30T00:00:00Z', ended_at: recentEnded },
      snapshots: [],
    })
    const res = await handleRoomResult(db, code, sid)
    expect(res._status).toBe(404)
  })
})
