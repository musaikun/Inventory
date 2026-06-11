// ── 店舗コード方式 データ永続化 API（Cloudflare D1）────────────────────────────

function _now() { return new Date().toISOString() }

// 1リクエストあたりの上限（約1MB）。設定/在庫/履歴の肥大化・経済的DoSを防ぐ
const MAX_PAYLOAD_CHARS = 1_000_000
function _tooLarge(body) {
  try { return JSON.stringify(body).length > MAX_PAYLOAD_CHARS } catch { return true }
}

function _genShopCode() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  return Array.from({ length: 6 }, () => c[Math.floor(Math.random() * c.length)]).join('')
}

// POST /store/create
export async function handleStoreCreate(db) {
  let code, existing
  do {
    code     = _genShopCode()
    existing = await db.prepare('SELECT shop_code FROM stores WHERE shop_code = ?').bind(code).first()
  } while (existing)

  const now = _now()
  await db.prepare('INSERT INTO stores (shop_code, created_at, updated_at) VALUES (?, ?, ?)')
    .bind(code, now, now).run()
  return { shopCode: code }
}

// GET /store/:code
export async function handleStoreGet(db, code) {
  const row = await db.prepare('SELECT shop_code, active_room, created_at FROM stores WHERE shop_code = ?').bind(code).first()
  if (!row) return null
  return { shopCode: row.shop_code, activeRoom: row.active_room ?? null, createdAt: row.created_at }
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
  await db.prepare('UPDATE stores SET active_room = ?, updated_at = ? WHERE shop_code = ?')
    .bind(body.roomCode ?? null, _now(), code).run()
  return { ok: true }
}

// ── セッション API ─────────────────────────────────────────────────────────────

// GET /store/:code/sessions
export async function handleSessionsGet(db, code) {
  const rows = await db.prepare(`
    SELECT id, shop_code, started_at, ended_at, status, item_count
    FROM sessions WHERE shop_code = ? ORDER BY started_at DESC LIMIT 50
  `).bind(code).all()
  return rows.results.map(r => ({
    id:        r.id,
    shopCode:  r.shop_code,
    startedAt: r.started_at,
    endedAt:   r.ended_at   ?? null,
    status:    r.status,
    itemCount: r.item_count,
  }))
}

// POST /store/:code/sessions
export async function handleSessionCreate(db, code) {
  const id  = crypto.randomUUID()
  const now = _now()
  await db.prepare(
    "INSERT INTO sessions (id, shop_code, started_at, status, item_count) VALUES (?, ?, ?, 'active', 0)"
  ).bind(id, code, now).run()
  return { id, shopCode: code, startedAt: now, status: 'active', itemCount: 0 }
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
