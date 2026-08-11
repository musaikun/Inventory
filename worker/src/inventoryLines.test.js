import { describe, it, expect } from 'vitest'
import { inventoryLineStatements } from './inventoryLines.js'
import { MAX_INGREDIENT_LEN, MAX_UNIT_LEN, INVENTORY_ROWS_PER_STATEMENT } from './constants.js'

// 文を組み立てるだけの関数なので、prepare/bind を記録する最小モックで足りる。
// 実行（batch）は呼び出し側（handleSessionComplete）の責務。
function createMockD1() {
  return {
    prepare(sql) {
      const s = sql.replace(/\s+/g, ' ').trim()
      const stmt = { sql: s, bound: [], bind(...a) { stmt.bound = a; return stmt } }
      return stmt
    },
  }
}

const SESSION_ID = 'sess-001'
const SHOP_CODE  = 'ABCDEF'
const TAKEN_AT   = '2026-06-11'

const INVENTORY = {
  'コーヒー豆': { qty: 5,  unit: 'kg' },
  '牛乳':       { qty: 12, unit: '本' },
  '砂糖':       { qty: 2,  unit: 'kg' },
}
const PRICES = { 'コーヒー豆': 2000, '牛乳': 200 }

function build(inventory = INVENTORY, prices = PRICES) {
  return inventoryLineStatements(createMockD1(), {
    sessionId: SESSION_ID, shopCode: SHOP_CODE, takenAt: TAKEN_AT, inventory, prices,
  })
}

/**
 * INSERT 文の bound を行単位へ展開する。
 * 1文は [takenAt, (item,qty,unit,price,value) × N, sessionId, shopCode] の並び。
 */
function inserts(statements) {
  const out = []
  for (const s of statements.filter(s => s.sql.startsWith('INSERT INTO inventory_lines'))) {
    const taken_at   = s.bound[0]
    const shop_code  = s.bound[s.bound.length - 1]
    const session_id = s.bound[s.bound.length - 2]
    const values     = s.bound.slice(1, -2)
    for (let i = 0; i < values.length; i += 5) {
      const [item_name, qty, unit, unit_price, line_value] = values.slice(i, i + 5)
      out.push({
        session_id, shop_code, taken_at, item_name, category: null,
        qty, unit, unit_price, line_value, _sql: s.sql, _bound: s.bound,
      })
    }
  }
  return out
}

/** INSERT 文の本数（statement 数の検証用） */
function insertStatements(statements) {
  return statements.filter(s => s.sql.startsWith('INSERT INTO inventory_lines'))
}

describe('inventoryLineStatements — 文の組み立て', () => {
  it('品目数分の INSERT を返す', () => {
    expect(inserts(build().statements)).toHaveLength(3)
  })

  it('品目名・数量・単位が正しく焼き込まれる', () => {
    const coffee = inserts(build().statements).find(l => l.item_name === 'コーヒー豆')
    expect(coffee.qty).toBe(5)
    expect(coffee.unit).toBe('kg')
  })

  it('単価あり品目は unit_price と line_value を計算する', () => {
    const coffee = inserts(build().statements).find(l => l.item_name === 'コーヒー豆')
    expect(coffee.unit_price).toBe(2000)
    expect(coffee.line_value).toBe(10000)
  })

  it('単価なし品目は unit_price と line_value が null', () => {
    const sugar = inserts(build().statements).find(l => l.item_name === '砂糖')
    expect(sugar.unit_price).toBeNull()
    expect(sugar.line_value).toBeNull()
  })

  it('session_id / shop_code / taken_at が全行に設定される', () => {
    const rows = inserts(build().statements)
    expect(rows.every(l => l.session_id === SESSION_ID)).toBe(true)
    expect(rows.every(l => l.shop_code  === SHOP_CODE)).toBe(true)
    expect(rows.every(l => l.taken_at   === TAKEN_AT)).toBe(true)
  })

  it('itemCount と totalValue を集計して返す', () => {
    const { itemCount, totalValue } = build()
    expect(itemCount).toBe(3)
    expect(totalValue).toBe(10000 + 2400)  // 砂糖は単価なしで加算されない
  })

  it('単価が1つも無ければ totalValue は null', () => {
    expect(build(INVENTORY, {}).totalValue).toBeNull()
  })
})

describe('inventoryLineStatements — 冪等性（DATA-001）', () => {
  it('先頭で当該セッションの明細を全削除する', () => {
    const [first] = build().statements
    expect(first.sql).toContain('DELETE FROM inventory_lines')
    expect(first.bound).toEqual([SESSION_ID, SHOP_CODE])
  })

  it('削除は shop_code でも絞る（他店舗の明細を消さない）', () => {
    const [first] = build().statements
    expect(first.sql).toContain('shop_code = ?')
  })

  it('品目が減った再送でも前回ぶんが残らない（削除 → 挿入の順）', () => {
    const { statements } = build({ '牛乳': { qty: 1, unit: '本' } }, {})
    expect(statements[0].sql).toContain('DELETE FROM inventory_lines')
    expect(inserts(statements).map(l => l.item_name)).toEqual(['牛乳'])
  })

  it('空の在庫でも削除文だけは返す（全消しの再送が成立する）', () => {
    const { statements, itemCount } = build({}, {})
    expect(statements).toHaveLength(1)
    expect(statements[0].sql).toContain('DELETE FROM inventory_lines')
    expect(itemCount).toBe(0)
  })
})

describe('inventoryLineStatements — 持ち主のいない明細を作らない', () => {
  it('各 INSERT は sessions を絞り込んで持ち主を確認する', () => {
    for (const stmt of insertStatements(build().statements)) {
      expect(stmt.sql).toContain('FROM sessions s,')
      expect(stmt.sql).toContain('WHERE s.id = ? AND s.shop_code = ?')
      // 末尾2つが持ち主確認用の session_id / shop_code
      expect(stmt.bound.slice(-2)).toEqual([SESSION_ID, SHOP_CODE])
    }
  })
})

describe('inventoryLineStatements — 入力の正規化と上限', () => {
  it('品目名は前後の空白を落とす', () => {
    const rows = inserts(build({ '  牛乳  ': { qty: 1, unit: '本' } }, {}).statements)
    expect(rows[0].item_name).toBe('牛乳')
  })

  it('空白だけの品目名は捨てる', () => {
    const { statements, itemCount } = build({ '   ': { qty: 1, unit: '本' } }, {})
    expect(inserts(statements)).toHaveLength(0)
    expect(itemCount).toBe(0)
  })

  it('品目名は上限で切る', () => {
    const long = 'あ'.repeat(MAX_INGREDIENT_LEN + 50)
    const rows = inserts(build({ [long]: { qty: 1, unit: '本' } }, {}).statements)
    expect(rows[0].item_name).toHaveLength(MAX_INGREDIENT_LEN)
  })

  it('単位は上限で切る', () => {
    const long = 'x'.repeat(MAX_UNIT_LEN + 50)
    const rows = inserts(build({ '牛乳': { qty: 1, unit: long } }, {}).statements)
    expect(rows[0].unit).toHaveLength(MAX_UNIT_LEN)
  })

  it('数量が数値でなければ 0 へ丸めず拒否する（DATA-001）', () => {
    const r = build({ '牛乳': { qty: 'あ', unit: '本' } }, {})
    expect(r.statements).toBeUndefined()
    expect(r.error).toMatchObject({ _status: 400, code: 'invalid_qty' })
  })

  it('Infinity / -Infinity / NaN を拒否する', () => {
    for (const bad of [Infinity, -Infinity, NaN]) {
      expect(build({ '牛乳': { qty: bad } }, {}).error).toMatchObject({ code: 'invalid_qty' })
    }
  })

  it('負数の在庫を拒否する', () => {
    expect(build({ '牛乳': { qty: -1 } }, {}).error).toMatchObject({ code: 'invalid_qty' })
  })

  it('在庫0は正当な記録として受け付ける', () => {
    const rows = inserts(build({ '牛乳': { qty: 0 } }, {}).statements)
    expect(rows[0].qty).toBe(0)
  })

  it('単価が数値でなければ null として扱う', () => {
    const rows = inserts(build({ '牛乳': { qty: 1, unit: '本' } }, { '牛乳': 'たかい' }).statements)
    expect(rows[0].unit_price).toBeNull()
    expect(rows[0].line_value).toBeNull()
  })

  it('単位が未指定なら null', () => {
    const rows = inserts(build({ '牛乳': { qty: 1 } }, {}).statements)
    expect(rows[0].unit).toBeNull()
  })
})

// ── D1 実行上限への適合（2026-08-09 公式制限で確認）─────────────────────────
// 1行1 INSERT だと N+2 statements になり、Free の 50 queries/invocation を
// 150品目でも超える。まとめINSERTで statement 数を有界にしていることを固定する。
describe('inventoryLineStatements — D1 statement 数と bound parameter 上限', () => {
  function makeInventory(n) {
    const inv = {}
    for (let i = 0; i < n; i++) inv[`品目${i}`] = { qty: i % 7, unit: '個' }
    return inv
  }

  it.each([0, 1, 150, 351, 500])('%i 品目でも bound parameter が 100 を超えない', (n) => {
    const { statements } = build(makeInventory(n), {})
    for (const s of statements) expect(s.bound.length).toBeLessThanOrEqual(100)
  })

  it.each([
    [0, 0],
    [1, 1],
    [150, Math.ceil(150 / INVENTORY_ROWS_PER_STATEMENT)],
    [351, Math.ceil(351 / INVENTORY_ROWS_PER_STATEMENT)],
    [500, Math.ceil(500 / INVENTORY_ROWS_PER_STATEMENT)],
  ])('%i 品目の INSERT は %i 文にまとまる', (n, expected) => {
    expect(insertStatements(build(makeInventory(n), {}).statements)).toHaveLength(expected)
  })

  it('351品目（R-001 の実データ規模）でも全行が保たれる', () => {
    const { statements, itemCount } = build(makeInventory(351), {})
    expect(itemCount).toBe(351)
    expect(inserts(statements)).toHaveLength(351)
  })

  it('採用上限（500品目）で DELETE を含めても batch は 28 文', () => {
    const { statements } = build(makeInventory(500), {})
    expect(statements).toHaveLength(1 + Math.ceil(500 / INVENTORY_ROWS_PER_STATEMENT))
    expect(statements.length).toBe(28)
  })

  it('まとめ単位ちょうど / +1 で文数が変わる', () => {
    const r = INVENTORY_ROWS_PER_STATEMENT
    expect(insertStatements(build(makeInventory(r), {}).statements)).toHaveLength(1)
    expect(insertStatements(build(makeInventory(r + 1), {}).statements)).toHaveLength(2)
  })
})
