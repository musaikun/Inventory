import { describe, it, expect } from 'vitest'
import { handleSessionLinesGet } from './storeHandler.js'
import { MAX_SESSION_LINES } from './constants.js'

// 2店舗ぶんの sessions / inventory_lines を持つモック。
// 店舗境界（shop_code での絞り込み）を実際に検証できるよう、
// WHERE 句に shop_code が無ければ他店舗の行も返す作りにしてある。
function createMockD1({ lines = [], sessions = [] } = {}) {
  const calls = []

  function prepare(sql) {
    const s = sql.replace(/\s+/g, ' ').trim()
    let bound = []
    const stmt = {
      bind(...a) { bound = a; return stmt },
      async first() {
        calls.push({ sql: s, bound })
        if (s.includes('FROM sessions WHERE id = ?')) {
          const [id, shop] = bound
          return sessions.find(x =>
            x.id === id && (s.includes('shop_code = ?') ? x.shop_code === shop : true)
          ) ?? null
        }
        return null
      },
      async all() {
        calls.push({ sql: s, bound })
        if (s.includes('FROM inventory_lines')) {
          const [sessionId, shop] = bound
          let rows = lines.filter(l => l.session_id === sessionId)
          // shop_code で絞っていないSQLはここで他店舗の行を落とさない＝テストが落ちる
          if (s.includes('shop_code = ?')) rows = rows.filter(l => l.shop_code === shop)
          const limit = bound[bound.length - 1]
          if (typeof limit === 'number') rows = rows.slice(0, limit)
          return { results: rows }
        }
        return { results: [] }
      },
    }
    return stmt
  }

  return { prepare, _calls: calls }
}

const OWN   = 'ABCDEF'
const OTHER = 'ZZZZZZ'
const SID   = '11111111-1111-4111-8111-111111111111'

function line(over = {}) {
  return {
    session_id: SID, shop_code: OWN, taken_at: '2026-07-07',
    item_name: '鶏もも', category: null, qty: 3, unit: 'kg',
    unit_price: 500, line_value: 1500, ...over,
  }
}

describe('handleSessionLinesGet — 店舗境界（SEC-002 と同じ水準）', () => {
  it('他店舗の session_id を渡すと 404。明細は一切返さない', async () => {
    const db = createMockD1({
      sessions: [{ id: SID, shop_code: OTHER, started_at: '2026-07-07T01:00:00Z', status: 'completed' }],
      lines:    [line({ shop_code: OTHER })],
    })
    const res = await handleSessionLinesGet(db, OWN, SID)
    expect(res._status).toBe(404)
    expect(res.lines).toBeUndefined()
  })

  it('存在しない session_id も同じ 404（IDの存在有無を漏らさない）', async () => {
    const db  = createMockD1({ sessions: [], lines: [] })
    const own = await handleSessionLinesGet(db, OWN, SID)

    const dbOther = createMockD1({
      sessions: [{ id: SID, shop_code: OTHER, started_at: '2026-07-07T01:00:00Z', status: 'completed' }],
      lines:    [line({ shop_code: OTHER })],
    })
    const other = await handleSessionLinesGet(dbOther, OWN, SID)

    expect(own._status).toBe(other._status)
    expect(own.error).toBe(other.error)
  })

  it('明細の取得も shop_code で絞る（session_id だけで引かない）', async () => {
    const db = createMockD1({
      sessions: [{ id: SID, shop_code: OWN, started_at: '2026-07-07T01:00:00Z', status: 'completed' }],
      // 同一 session_id を持つ他店舗の行が混ざっている状態
      lines: [line(), line({ shop_code: OTHER, item_name: '他店舗の品目' })],
    })
    const res = await handleSessionLinesGet(db, OWN, SID)
    expect(res.lines.map(l => l.item)).toEqual(['鶏もも'])

    const linesQuery = db._calls.find(c => c.sql.includes('FROM inventory_lines'))
    expect(linesQuery.sql).toContain('shop_code = ?')
    expect(linesQuery.bound).toContain(OWN)
  })

  it('セッション照会そのものが shop_code で絞られている', async () => {
    const db = createMockD1({
      sessions: [{ id: SID, shop_code: OWN, started_at: '2026-07-07T01:00:00Z', status: 'completed' }],
      lines:    [line()],
    })
    await handleSessionLinesGet(db, OWN, SID)
    const sessQuery = db._calls.find(c => c.sql.includes('FROM sessions WHERE id = ?'))
    expect(sessQuery.sql).toContain('shop_code = ?')
    expect(sessQuery.bound).toEqual([SID, OWN])
  })
})

describe('handleSessionLinesGet — 返却内容', () => {
  const session = {
    id: SID, shop_code: OWN, started_at: '2026-07-07T01:00:00Z',
    ended_at: '2026-07-07T02:30:00Z', status: 'completed',
    item_count: 2, total_value: 2000, type: 'stock',
  }

  it('明細を表示用の形へ整えて返す', async () => {
    const db = createMockD1({
      sessions: [session],
      lines: [
        line(),
        line({ item_name: '玉ねぎ', qty: 2, unit: '箱', unit_price: 250, line_value: 500, category: '野菜' }),
      ],
    })
    const res = await handleSessionLinesGet(db, OWN, SID)
    expect(res._status).toBeUndefined()
    expect(res.sessionId).toBe(SID)
    expect(res.date).toBe('2026-07-07')
    expect(res.lines).toEqual([
      { item: '鶏もも', qty: 3, unit: 'kg',  unitPrice: 500, subtotal: 1500, category: null },
      { item: '玉ねぎ', qty: 2, unit: '箱',  unitPrice: 250, subtotal: 500,  category: '野菜' },
    ])
  })

  it('単価が無い明細は unitPrice / subtotal を null で返す', async () => {
    const db = createMockD1({
      sessions: [session],
      lines:    [line({ unit_price: null, line_value: null })],
    })
    const res = await handleSessionLinesGet(db, OWN, SID)
    expect(res.lines[0].unitPrice).toBeNull()
    expect(res.lines[0].subtotal).toBeNull()
  })

  it('明細が0件でも 404 にせず、空配列と件数0を返す（セッションは実在する）', async () => {
    const db  = createMockD1({ sessions: [session], lines: [] })
    const res = await handleSessionLinesGet(db, OWN, SID)
    expect(res._status).toBeUndefined()
    expect(res.lines).toEqual([])
    expect(res.itemCount).toBe(0)
  })

  it('taken_at が無い場合は ended_at → started_at の順で日付を決める', async () => {
    const db = createMockD1({
      sessions: [session],
      lines:    [line({ taken_at: null })],
    })
    const res = await handleSessionLinesGet(db, OWN, SID)
    expect(res.date).toBe('2026-07-07')
  })

  it('件数の上限を超える明細は打ち切り、truncated を立てる', async () => {
    const many = Array.from({ length: MAX_SESSION_LINES + 5 }, (_, i) => line({ item_name: `品目${i}` }))
    const db   = createMockD1({ sessions: [session], lines: many })
    const res  = await handleSessionLinesGet(db, OWN, SID)
    expect(res.lines).toHaveLength(MAX_SESSION_LINES)
    expect(res.truncated).toBe(true)
  })

  it('上限以下なら truncated は false', async () => {
    const db  = createMockD1({ sessions: [session], lines: [line()] })
    const res = await handleSessionLinesGet(db, OWN, SID)
    expect(res.truncated).toBe(false)
  })
})
