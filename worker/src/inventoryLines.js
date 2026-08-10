// inventory_lines への書き込み文の組み立て
//
// 実行はしない。呼び出し側が sessions の更新・snapshot と同じ db.batch() に載せることで、
// 「明細だけ入って完了状態が付かない」「完了状態だけ付いて明細が無い」を作らせない
// （DATA-001）。D1 の batch は 1 トランザクションとして扱われる。
//
// statement 数を有界にする（2026-08-09 / D1公式制限）:
//   1行1 INSERT だと N+2 statements になり、Free の「Queries per Worker invocation = 50」を
//   150品目でも超える。複数行を1文へまとめ、statement 数を ceil(N/19)+1 に抑える。
//   まとめ行数は bound parameter 上限（100/query）から逆算している → constants.js

import {
  MAX_INGREDIENT_LEN,
  MAX_UNIT_LEN,
  MAX_INVENTORY_QTY,
  MAX_UNIT_PRICE,
  INVENTORY_ROWS_PER_STATEMENT,
} from './constants.js'
import { parseQty, text, chunk } from './validate.js'

/**
 * 棚卸完了ぶんの inventory_lines を貼り直す文を返す。
 *
 * 冪等性: 先頭で当該セッションの明細を全削除してから入れ直す。
 * ON CONFLICT の upsert だけだと、2回目に品目が減った場合に前回ぶんが残る。
 *
 * 持ち主の確認は INSERT 自身が持つ。`FROM sessions s ... WHERE s.id = ? AND s.shop_code = ?`
 * なので、セッションが無い／他店舗のものなら 0 行しか作らない。batch は途中で
 * 中断できないため、文ごとに閉じておく必要がある。
 *
 * @returns {{ statements?: object[], itemCount?: number, totalValue?: number|null, error?: object }}
 */
export function inventoryLineStatements(db, { sessionId, shopCode, takenAt, inventory, prices }) {
  const rows = []
  const seen = new Set()
  let total = 0
  let hasPrices = false

  for (const [rawName, entry] of Object.entries(inventory ?? {})) {
    const itemName = text(rawName, MAX_INGREDIENT_LEN)
    if (!itemName) continue
    // slice後に衝突した品目名は PRIMARY KEY(session_id, item_name) 違反になる。
    // batch 全体が落ちるより、先に入った1件を採る（取込の同名統合と同じ扱い）。
    if (seen.has(itemName)) continue
    seen.add(itemName)

    // 棚卸数量: 0 は正当（在庫なし）。負数・NaN・Infinity・範囲外は拒否する。
    const qty = parseQty(entry?.qty ?? 0, { min: 0, max: MAX_INVENTORY_QTY })
    if (qty === null) {
      return { error: { _status: 400, code: 'invalid_qty', error: `数量が不正です: ${itemName}` } }
    }

    // 単価は分析用のnullable列。数値でなければ「単価不明」= null（金額合計から外れる）。
    // ただし有限の負数・桁外れは記録として誤りなので拒否する。
    let unitPrice = null
    const rawPrice = prices?.[rawName]
    if (rawPrice != null && rawPrice !== '') {
      const p = Number(rawPrice)
      if (Number.isFinite(p)) {
        if (p < 0 || p > MAX_UNIT_PRICE) {
          return { error: { _status: 400, code: 'invalid_price', error: `単価が不正です: ${itemName}` } }
        }
        unitPrice = p
      }
    }

    const lineValue = unitPrice != null ? Math.round(qty * unitPrice) : null
    if (lineValue != null) { total += lineValue; hasPrices = true }

    rows.push({
      item:  itemName,
      qty,
      unit:  entry?.unit == null ? null : text(entry.unit, MAX_UNIT_LEN),
      price: unitPrice,
      value: lineValue,
    })
  }

  const statements = [
    db.prepare('DELETE FROM inventory_lines WHERE session_id = ? AND shop_code = ?')
      .bind(sessionId, shopCode),
  ]

  for (const group of chunk(rows, INVENTORY_ROWS_PER_STATEMENT)) {
    const values = group.map(() => 'SELECT ? AS item, ? AS qty, ? AS unit, ? AS price, ? AS value')
      .join(' UNION ALL ')
    const binds = []
    binds.push(takenAt)                                   // SELECT リストの ?（文ごと1個）
    for (const r of group) binds.push(r.item, r.qty, r.unit, r.price, r.value)
    binds.push(sessionId, shopCode)                       // WHERE の ?（文ごと2個）

    statements.push(db.prepare(`
      INSERT INTO inventory_lines
        (session_id, shop_code, taken_at, item_name, category, qty, unit, unit_price, line_value)
      SELECT s.id, s.shop_code, ?, v.item, NULL, v.qty, v.unit, v.price, v.value
      FROM sessions s, (${values}) v
      WHERE s.id = ? AND s.shop_code = ?
    `).bind(...binds))
  }

  return { statements, itemCount: rows.length, totalValue: hasPrices ? total : null }
}
