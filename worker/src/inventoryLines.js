// inventory_lines への書き込み文の組み立て
//
// 実行はしない。呼び出し側が sessions の更新と同じ db.batch() に載せることで、
// 「明細だけ入って完了状態が付かない」「完了状態だけ付いて明細が無い」を作らせない
// （DATA-001）。D1 の batch は 1 トランザクションとして扱われる。

import { MAX_INGREDIENT_LEN, MAX_UNIT_LEN } from './constants.js'

/**
 * 棚卸完了ぶんの inventory_lines を貼り直す文を返す。
 *
 * 冪等性: 先頭で当該セッションの明細を全削除してから入れ直す。
 * ON CONFLICT の upsert だけだと、2回目に品目が減った場合に前回ぶんが残る。
 *
 * 各 INSERT は sessions の存在を EXISTS で確認する。同じ batch の先頭で
 * UPDATE sessions が 0 行だった場合（セッションが消えている・他店舗のもの）に、
 * 持ち主のいない明細が入るのを防ぐ。
 *
 * @returns {{ statements: object[], itemCount: number, totalValue: number|null }}
 */
export function inventoryLineStatements(db, { sessionId, shopCode, takenAt, inventory, prices }) {
  const statements = [
    db.prepare('DELETE FROM inventory_lines WHERE session_id = ? AND shop_code = ?')
      .bind(sessionId, shopCode),
  ]

  let total = 0
  let hasPrices = false
  let itemCount = 0

  for (const [rawName, entry] of Object.entries(inventory ?? {})) {
    const itemName = String(rawName ?? '').trim().slice(0, MAX_INGREDIENT_LEN)
    if (!itemName) continue

    const qtyNum = Number(entry?.qty ?? 0)
    const qty    = Number.isFinite(qtyNum) ? qtyNum : 0
    const unit   = entry?.unit == null ? null : String(entry.unit).slice(0, MAX_UNIT_LEN)

    const priceNum  = Number(prices?.[rawName])
    const unitPrice = Number.isFinite(priceNum) ? priceNum : null
    const lineValue = unitPrice != null ? Math.round(qty * unitPrice) : null

    if (lineValue != null) { total += lineValue; hasPrices = true }
    itemCount++

    statements.push(db.prepare(`
      INSERT INTO inventory_lines
        (session_id, shop_code, taken_at, item_name, category, qty, unit, unit_price, line_value)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM sessions WHERE id = ? AND shop_code = ?)
    `).bind(sessionId, shopCode, takenAt, itemName, null, qty, unit, unitPrice, lineValue,
            sessionId, shopCode))
  }

  return { statements, itemCount, totalValue: hasPrices ? total : null }
}
