// inventory_lines への書き込み・読み取り

export async function insertInventoryLines(db, { sessionId, shopCode, takenAt, inventory, prices }) {
  const entries = Object.entries(inventory ?? {})
  if (entries.length === 0) return

  const stmts = entries.map(([itemName, entry]) => {
    const qty       = entry.qty ?? 0
    const unit      = entry.unit ?? null
    const unitPrice = prices?.[itemName] ?? null
    const lineValue = unitPrice != null ? Math.round(qty * unitPrice) : null

    return db.prepare(`
      INSERT INTO inventory_lines
        (session_id, shop_code, taken_at, item_name, category, qty, unit, unit_price, line_value)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, item_name) DO UPDATE SET
        qty = excluded.qty, unit = excluded.unit,
        unit_price = excluded.unit_price, line_value = excluded.line_value
    `).bind(sessionId, shopCode, takenAt, itemName, null, qty, unit, unitPrice, lineValue)
  })

  await db.batch(stmts)
}
