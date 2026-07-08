// ── 店舗コード方式 データ永続化 API（Cloudflare D1）────────────────────────────

import { insertInventoryLines } from './inventoryLines.js'
import { _now, _genShopCode } from './workerUtils.js'
import { MAX_PAYLOAD_CHARS, RESULT_WINDOW_DAYS } from './constants.js'

function _tooLarge(body) {
  try { return JSON.stringify(body).length > MAX_PAYLOAD_CHARS } catch { return true }
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
