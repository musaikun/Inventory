// ── 店舗コード方式 データ永続化 API（Cloudflare D1）────────────────────────────

import { insertInventoryLines } from './inventoryLines.js'
import { _now, genUniqueShopCode } from './workerUtils.js'
import { MAX_PAYLOAD_CHARS, RESULT_WINDOW_DAYS } from './constants.js'
import { entitlement } from './entitlements.js'

function _tooLarge(body) {
  try { return JSON.stringify(body).length > MAX_PAYLOAD_CHARS } catch { return true }
}

// POST /store/create
export async function handleStoreCreate(db) {
  const code = await genUniqueShopCode(db)
  const now  = _now()
  await db.prepare('INSERT INTO stores (shop_code, created_at, updated_at) VALUES (?, ?, ?)')
    .bind(code, now, now).run()
  return { shopCode: code }
}

// GET /store/:code
export async function handleStoreGet(db, code) {
  const row = await db.prepare(
    'SELECT shop_code, active_room, created_at, plan FROM stores WHERE shop_code = ? AND deleted_at IS NULL AND deletion_pending_at IS NULL'
  ).bind(code).first()
  if (!row) return null
  return { shopCode: row.shop_code, activeRoom: row.active_room ?? null, createdAt: row.created_at, ...entitlement(row) }
}

// GET /store/:code/config
export async function handleConfigGet(db, code) {
  const row = await db.prepare('SELECT config_json FROM store_configs WHERE shop_code = ?').bind(code).first()
  return row ? JSON.parse(row.config_json) : null
}

// PUT /store/:code/config
export async function handleConfigPut(db, code, body) {
  if (_tooLarge(body)) return { _status: 413, error: 'データサイズが大きすぎます' }
  const now = _now()
  await db.prepare(`
    INSERT INTO store_configs (shop_code, config_json, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(shop_code) DO UPDATE SET config_json = excluded.config_json, updated_at = excluded.updated_at
  `).bind(code, JSON.stringify(body), now).run()
  return { ok: true }
}

// GET /store/:code/inventory
export async function handleInventoryGet(db, code) {
  const row = await db.prepare('SELECT inventory_json FROM store_inventory WHERE shop_code = ?').bind(code).first()
  return row ? JSON.parse(row.inventory_json) : null
}

// PUT /store/:code/inventory
export async function handleInventoryPut(db, code, body) {
  if (_tooLarge(body)) return { _status: 413, error: 'データサイズが大きすぎます' }
  const now = _now()
  await db.prepare(`
    INSERT INTO store_inventory (shop_code, inventory_json, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(shop_code) DO UPDATE SET inventory_json = excluded.inventory_json, updated_at = excluded.updated_at
  `).bind(code, JSON.stringify(body), now).run()
  return { ok: true }
}

// GET /store/:code/history
export async function handleHistoryGet(db, code) {
  const rows = await db.prepare(`
    SELECT snapshot_json FROM store_history
    WHERE shop_code = ? ORDER BY snapshot_date DESC LIMIT 50
  `).bind(code).all()
  return rows.results.map(r => JSON.parse(r.snapshot_json))
}

// POST /store/:code/history
export async function handleHistoryPost(db, code, body) {
  if (_tooLarge(body)) return { _status: 413, error: 'データサイズが大きすぎます' }
  const date = body.date ?? new Date().toISOString().slice(0, 10)
  const now  = _now()
  await db.prepare(`
    INSERT INTO store_history (shop_code, snapshot_date, snapshot_json, created_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(shop_code, snapshot_date) DO UPDATE SET snapshot_json = excluded.snapshot_json
  `).bind(code, date, JSON.stringify(body), now).run()
  return { ok: true }
}

// DELETE /store/:code/history/:date
export async function handleHistoryDelete(db, code, date) {
  await db.prepare('DELETE FROM store_history WHERE shop_code = ? AND snapshot_date = ?')
    .bind(code, date).run()
  return { ok: true }
}

// PUT /store/:code/room  body: { roomCode: string | null }
export async function handleRoomUpdate(db, code, body) {
  await db.prepare(
    'UPDATE stores SET active_room = ?, updated_at = ? WHERE shop_code = ? AND deleted_at IS NULL AND deletion_pending_at IS NULL'
  )
    .bind(body.roomCode ?? null, _now(), code).run()
  return { ok: true }
}

// ── 完了後ゲスト閲覧（result）─────────────────────────────────────────────────
// スナップショットから金額（単価・在庫金額）を除去してゲスト向けに整形する。
// 返すのは品目・数量・単位、参加者、変更履歴（誰が・何を・いつ）のみ。
function _sanitizeForGuest(snap) {
  const items = (snap.items ?? []).map(it => ({
    item:     it.item,
    qty:      it.qty ?? null,
    unit:     it.unit ?? '',
    code:     it.code ?? '',
    flagged:  !!it.flagged,
    category: it.category ?? null,
  }))
  const participants = (snap.participants ?? []).map(p => ({
    name:  p.name,
    items: (p.items ?? []).map(it => ({ item: it.item, qty: it.qty ?? null, unit: it.unit ?? '' })),
  }))
  const auditLog = (snap.auditLog ?? []).map(e => ({
    id:        e.id,
    ingredient: e.ingredient,
    action:    e.action,
    delta:     e.delta ?? null,
    totalQty:  e.totalQty ?? null,
    unit:      e.unit ?? '',
    enteredBy: e.enteredBy ?? '',
    timestamp: e.timestamp ?? null,
  }))
  return { date: snap.date, sessionId: snap.sessionId ?? null, items, participants, auditLog }
}

// スナップショットの完了時刻（ms）。savedAt 優先、無ければ snapshot_date を 0時として扱う。
function _snapTs(s) {
  const raw = s.savedAt ? new Date(s.savedAt).getTime()
            : s.date    ? new Date(s.date + 'T00:00:00').getTime()
            : 0
  return Number.isFinite(raw) ? raw : 0
}

// GET /room/:code/result?s=<sessionId>
// 無認証・URL（店舗コード + セッションID）が鍵。
// データ源は store_history スナップショット（完了時のみ保存される＝存在＝完了済み）。
// sessions テーブルには依存しない（未ログイン店舗ではセッション行が無いため）。
export async function handleRoomResult(db, code, sessionId) {
  if (!sessionId) return { _status: 400, error: 'リンクが無効です' }

  const rows = await db.prepare(
    'SELECT snapshot_json FROM store_history WHERE shop_code = ? ORDER BY snapshot_date DESC LIMIT 50'
  ).bind(code).all()

  const snaps = []
  for (const r of rows.results ?? []) {
    try { snaps.push(JSON.parse(r.snapshot_json)) } catch (_) {}
  }

  const target = snaps.find(s => s.sessionId === sessionId)
  if (!target) return { _status: 404, error: 'この棚卸は閲覧できません' }

  const targetTs = _snapTs(target)

  // 期間チェック①: 完了から RESULT_WINDOW_DAYS 日以内
  if (!targetTs || Date.now() - targetTs > RESULT_WINDOW_DAYS * 86400_000) {
    return { _status: 410, error: '閲覧期間が終了しました' }
  }

  // 期間チェック②: より新しい完了スナップショットが無いこと（次の棚卸が完了したら失効）
  const hasNewer = snaps.some(s => s.sessionId !== sessionId && _snapTs(s) > targetTs)
  if (hasNewer) {
    return { _status: 410, error: '新しい棚卸が完了したため、この結果は閲覧できません' }
  }

  return { result: _sanitizeForGuest(target) }
}

// ── セッション API ─────────────────────────────────────────────────────────────

// GET /store/:code/sessions
export async function handleSessionsGet(db, code) {
  const rows = await db.prepare(`
    SELECT id, shop_code, started_at, ended_at, status, item_count, type
    FROM sessions WHERE shop_code = ? ORDER BY started_at DESC LIMIT 50
  `).bind(code).all()
  return rows.results.map(r => ({
    id:        r.id,
    shopCode:  r.shop_code,
    startedAt: r.started_at,
    endedAt:   r.ended_at   ?? null,
    status:    r.status,
    itemCount: r.item_count,
    type:      r.type ?? 'stock',
  }))
}

// POST /store/:code/sessions  body: { type? }
export async function handleSessionCreate(db, code, body = {}) {
  const id   = crypto.randomUUID()
  const now  = _now()
  const type = body?.type === 'order' ? 'order' : 'stock'
  await db.prepare(
    "INSERT INTO sessions (id, shop_code, started_at, status, item_count, type) VALUES (?, ?, ?, 'active', 0, ?)"
  ).bind(id, code, now, type).run()
  return { id, shopCode: code, startedAt: now, status: 'active', itemCount: 0, type }
}

// DELETE /store/:code/sessions/:id
export async function handleSessionDelete(db, code, sessionId) {
  await db.prepare('DELETE FROM sessions WHERE id = ? AND shop_code = ?').bind(sessionId, code).run()
  return { ok: true }
}

// PUT /store/:code/sessions/:id  body: { status, itemCount? }
export async function handleSessionUpdate(db, code, sessionId, body) {
  const validStatuses = ['active', 'completed', 'incomplete']
  const status    = validStatuses.includes(body.status) ? body.status : null
  const itemCount = typeof body.itemCount === 'number' ? Math.max(0, body.itemCount) : 0
  if (!status) return { _status: 400, error: '無効なステータスです' }

  const now     = _now()
  const endedAt = status === 'active' ? null : now

  await db.prepare(`
    UPDATE sessions SET status = ?, ended_at = ?, item_count = ? WHERE id = ? AND shop_code = ?
  `).bind(status, endedAt, itemCount, sessionId, code).run()
  return { ok: true }
}

// ── 発注 API ───────────────────────────────────────────────────────────────────
// 発注レコードの正は D1。学習（曜日別・適正在庫）はクライアントが order_lines から算出する。

// GET /store/:code/orders?sinceDays=400
// 直近 sinceDays 日ぶんの発注レコードを新しい順で返す（クライアントの applyRemoteOrders 用）。
export async function handleOrdersGet(db, code, sinceDays) {
  const n     = Number(sinceDays)
  const days  = Number.isFinite(n) ? Math.min(Math.max(n, 1), 1000) : 400
  const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10)

  const heads = (await db.prepare(
    'SELECT id, order_date, supplier, axis, session_id, saved_at FROM orders WHERE shop_code = ? AND order_date >= ? ORDER BY order_date DESC LIMIT 1000'
  ).bind(code, since).all()).results ?? []
  if (heads.length === 0) return []

  const lineRows = (await db.prepare(
    'SELECT order_id, item, qty, unit, stock, lot, post_stock, excluded FROM order_lines WHERE shop_code = ? AND order_date >= ?'
  ).bind(code, since).all()).results ?? []

  const byOrder = {}
  for (const l of lineRows) {
    ;(byOrder[l.order_id] ??= []).push({
      item:      l.item,
      qty:       l.qty,
      unit:      l.unit ?? '',
      stock:     l.stock ?? null,
      lot:       l.lot ?? 1,
      postStock: l.post_stock ?? null,
      excluded:  !!l.excluded,
    })
  }

  return heads.map(h => ({
    id:        h.id,
    date:      h.order_date,
    supplier:  h.supplier ?? '',
    axis:      h.axis ?? '',
    sessionId: h.session_id ?? null,
    savedAt:   h.saved_at,
    lines:     byOrder[h.id] ?? [],
  }))
}

// POST /store/:code/orders  body: 発注レコード { id, date, supplier, axis, sessionId, savedAt, lines[] }
// 同一 id の再送は冪等（行を貼り直す）。
export async function handleOrderCreate(db, code, body = {}) {
  if (_tooLarge(body)) return { _status: 413, error: 'データサイズが大きすぎます' }

  const id   = (typeof body.id === 'string' && body.id) ? body.id : crypto.randomUUID()
  const date = body.date ?? new Date().toISOString().slice(0, 10)
  const now  = _now()

  const clean = (Array.isArray(body.lines) ? body.lines : [])
    .map(l => ({
      item:      String(l.item ?? '').trim(),
      qty:       Number(l.qty),
      unit:      l.unit ?? '',
      stock:     l.stock == null || l.stock === '' ? null : Number(l.stock),
      lot:       Number.isFinite(Number(l.lot)) && Number(l.lot) > 0 ? Number(l.lot) : 1,
      postStock: l.postStock == null || l.postStock === '' ? null : Number(l.postStock),
      excluded:  l.excluded ? 1 : 0,
    }))
    .filter(l => l.item && Number.isFinite(l.qty))
  if (clean.length === 0) return { _status: 400, error: '有効な発注行がありません' }

  // テナント境界: orders.id はグローバルPK。同じidを別店舗が指定しても、
  // 他店のヘッダ・明細を更新できないようownerを確認する。
  const owner = await db.prepare('SELECT shop_code FROM orders WHERE id = ?').bind(id).first()
  if (owner && owner.shop_code !== code) return { _status: 409, error: '保存できませんでした' }

  // SELECT後に別店舗が同じidを作る競合も、upsert自身のWHEREで原子的に拒否する。
  // D1Result.meta.changes が1でない限り、明細の削除・追加へ進まない。
  const headWrite = await db.prepare(`
    INSERT INTO orders (id, shop_code, order_date, supplier, axis, session_id, saved_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET order_date = excluded.order_date, supplier = excluded.supplier, axis = excluded.axis
    WHERE orders.shop_code = excluded.shop_code
  `).bind(id, code, date, body.supplier ?? '', body.axis ?? '', body.sessionId ?? null, body.savedAt ?? now).run()
  if (headWrite?.success !== true || headWrite?.meta?.changes !== 1) {
    return { _status: 409, error: '保存できませんでした' }
  }

  await db.prepare('DELETE FROM order_lines WHERE order_id = ? AND shop_code = ?').bind(id, code).run()

  for (const l of clean) {
    await db.prepare(`
      INSERT INTO order_lines (order_id, shop_code, order_date, item, qty, unit, stock, lot, post_stock, excluded, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, code, date, l.item, l.qty, l.unit, l.stock, l.lot, l.postStock, l.excluded, now).run()
  }
  return { ok: true, id }
}

// DELETE /store/:code/orders/:id
export async function handleOrderDelete(db, code, id) {
  // 不存在と他店舗所有を同じ404にして、idの存在有無を別店舗へ開示しない。
  const owner = await db.prepare('SELECT shop_code FROM orders WHERE id = ?').bind(id).first()
  if (!owner || owner.shop_code !== code) return { _status: 404, error: '発注が見つかりません' }

  await db.prepare('DELETE FROM order_lines WHERE order_id = ? AND shop_code = ?').bind(id, code).run()
  await db.prepare('DELETE FROM orders WHERE id = ? AND shop_code = ?').bind(id, code).run()
  return { ok: true }
}

// ── 入出庫 API ─────────────────────────────────────────────────────────────────
// 入出庫レコードの正は D1。理論在庫はクライアントが棚卸＋movement_lines から算出する。

// GET /store/:code/movements?sinceDays=400
// 直近 sinceDays 日ぶんの入出庫レコードを新しい順で返す（クライアントの applyRemoteMovements 用）。
export async function handleMovementsGet(db, code, sinceDays) {
  const n     = Number(sinceDays)
  const days  = Number.isFinite(n) ? Math.min(Math.max(n, 1), 1000) : 400
  const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10)

  const heads = (await db.prepare(
    'SELECT id, move_date, type, note, order_id, saved_at FROM movements WHERE shop_code = ? AND move_date >= ? ORDER BY move_date DESC LIMIT 1000'
  ).bind(code, since).all()).results ?? []
  if (heads.length === 0) return []

  const lineRows = (await db.prepare(
    'SELECT movement_id, item, qty, unit FROM movement_lines WHERE shop_code = ? AND move_date >= ?'
  ).bind(code, since).all()).results ?? []

  const byMove = {}
  for (const l of lineRows) {
    ;(byMove[l.movement_id] ??= []).push({
      item: l.item,
      qty:  l.qty,
      unit: l.unit ?? '',
    })
  }

  return heads.map(h => ({
    id:      h.id,
    date:    h.move_date,
    type:    h.type === 'out' ? 'out' : 'in',
    note:    h.note ?? '',
    orderId: h.order_id ?? null,
    savedAt: h.saved_at,
    lines:   byMove[h.id] ?? [],
  }))
}

// POST /store/:code/movements  body: 入出庫レコード { id, date, type, note, orderId, savedAt, lines[] }
// 同一 id の再送は冪等（行を貼り直す）。
export async function handleMovementCreate(db, code, body = {}) {
  if (_tooLarge(body)) return { _status: 413, error: 'データサイズが大きすぎます' }

  const id   = (typeof body.id === 'string' && body.id) ? body.id : crypto.randomUUID()
  const date = body.date ?? new Date().toISOString().slice(0, 10)
  const type = body.type === 'out' ? 'out' : 'in'
  const now  = _now()

  const clean = (Array.isArray(body.lines) ? body.lines : [])
    .map(l => ({
      item: String(l.item ?? '').trim(),
      qty:  Number(l.qty),
      unit: l.unit ?? '',
    }))
    .filter(l => l.item && Number.isFinite(l.qty) && l.qty > 0)
  if (clean.length === 0) return { _status: 400, error: '有効な入出庫行がありません' }

  // 出庫は発注紐付けを持たない。
  const orderId = type === 'in' && body.orderId ? body.orderId : null

  // テナント境界: movements.id はグローバル PK。既存 id が別店舗のものなら拒否し、
  // 他店の入出庫ヘッダ（日付/種別/メモ/発注ID）を書き換えられないようにする。
  // 同一店舗の再送はこのチェックを通り、下の upsert で冪等に貼り直す。
  const owner = await db.prepare('SELECT shop_code FROM movements WHERE id = ?').bind(id).first()
  if (owner && owner.shop_code !== code) return { _status: 409, error: '保存できませんでした' }

  await db.prepare('DELETE FROM movement_lines WHERE movement_id = ? AND shop_code = ?').bind(id, code).run()
  await db.prepare(`
    INSERT INTO movements (id, shop_code, move_date, type, note, order_id, saved_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET move_date = excluded.move_date, type = excluded.type, note = excluded.note, order_id = excluded.order_id
  `).bind(id, code, date, type, body.note ?? '', orderId, body.savedAt ?? now).run()

  // 明細は1件ずつの await ではなく batch で一括投入（R5-04・handleOrderCreate と同根）。
  const lineStmts = clean.map(l => db.prepare(`
    INSERT INTO movement_lines (movement_id, shop_code, move_date, item, qty, unit, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(id, code, date, l.item, l.qty, l.unit, now))
  if (lineStmts.length) await db.batch(lineStmts)
  return { ok: true, id }
}

// DELETE /store/:code/movements/:id
export async function handleMovementDelete(db, code, id) {
  await db.prepare('DELETE FROM movement_lines WHERE movement_id = ? AND shop_code = ?').bind(id, code).run()
  await db.prepare('DELETE FROM movements WHERE id = ? AND shop_code = ?').bind(id, code).run()
  return { ok: true }
}

// POST /store/:code/sessions/:id/complete
// 棚卸完了の一括処理: inventory_lines 展開 + sessions 更新（archive_key は R2 実装後に追加）
export async function handleSessionComplete(db, code, sessionId, body) {
  const session = await db.prepare(
    'SELECT id FROM sessions WHERE id = ? AND shop_code = ?'
  ).bind(sessionId, code).first()
  if (!session) return { _status: 404, error: 'セッションが見つかりません' }

  const { inventory = {}, prices = {}, takenAt } = body
  const now       = _now()
  const taken     = takenAt ?? now.slice(0, 10)
  const itemCount = Object.keys(inventory).length

  const totalValue = (() => {
    let total = 0; let has = false
    for (const [item, entry] of Object.entries(inventory)) {
      if (prices[item] != null) { total += entry.qty * prices[item]; has = true }
    }
    return has ? Math.round(total) : null
  })()

  await insertInventoryLines(db, { sessionId, shopCode: code, takenAt: taken, inventory, prices })

  await db.prepare(`
    UPDATE sessions
    SET status = 'completed', ended_at = ?, item_count = ?, total_value = ?
    WHERE id = ? AND shop_code = ?
  `).bind(now, itemCount, totalValue, sessionId, code).run()

  return { ok: true, sessionId, itemCount, totalValue }
}
