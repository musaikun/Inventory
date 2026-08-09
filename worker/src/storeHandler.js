// ── 店舗コード方式 データ永続化 API（Cloudflare D1）────────────────────────────

import { inventoryLineStatements } from './inventoryLines.js'
import { _now, genUniqueShopCode } from './workerUtils.js'
import { MAX_PAYLOAD_CHARS, RESULT_WINDOW_DAYS, MAX_SESSION_LINES, MAX_LINES_PER_REQUEST, MAX_INGREDIENT_LEN, MAX_UNIT_LEN } from './constants.js'
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

// GET /store/:code/sessions/:id/lines
//
// 完了済みセッションの明細を D1 から読む（DATA-002 Phase 1 / R-001）。
// 一覧は D1 sessions、詳細は localStorage + store_history という持ち主の違いがあり、
// 端末を変えると「一覧には出るのに詳細が開けない」状態になっていた。
// 完了時の明細は inventory_lines に残っているので、そこを読み出す経路を用意する。
// D1 への復旧書き込みは行わない（User判断 2026-07-28: 方式A）。
//
// 店舗境界: session_id だけで引くと、他店舗のセッションIDを渡された場合に
// その店舗の明細が読める。SEC-002 と同じく shop_code と session_id の両方で絞る。
export async function handleSessionLinesGet(db, code, sessionId) {
  // セッションが自店舗のものであることを先に確認する。
  // 「他店舗のID」と「存在しないID」は同じ 404 にして、IDの存在有無を漏らさない。
  const session = await db.prepare(`
    SELECT id, started_at, ended_at, status, item_count, total_value, type
    FROM sessions WHERE id = ? AND shop_code = ?
  `).bind(sessionId, code).first()
  if (!session) return { _status: 404, error: 'セッションが見つかりません' }

  // rowid 順＝完了時の挿入順。棚卸で入力した並びに最も近く、再取得しても安定する
  // （ON CONFLICT DO UPDATE は rowid を変えない）。
  const rows = await db.prepare(`
    SELECT item_name, category, qty, unit, unit_price, line_value, taken_at
    FROM inventory_lines
    WHERE session_id = ? AND shop_code = ?
    ORDER BY rowid
    LIMIT ?
  `).bind(sessionId, code, MAX_SESSION_LINES + 1).all()

  const all       = rows.results ?? []
  const truncated = all.length > MAX_SESSION_LINES
  const picked    = truncated ? all.slice(0, MAX_SESSION_LINES) : all

  const lines = picked.map(r => ({
    item:      r.item_name,
    qty:       r.qty,
    unit:      r.unit ?? null,
    unitPrice: r.unit_price ?? null,
    subtotal:  r.line_value ?? null,
    category:  r.category ?? null,
  }))

  // 表示日の決定順: 明細の taken_at → セッションの ended_at → started_at。
  // 過去取込ぶんは taken_at が実施日で、ended_at（取込した日時）とはずれる。
  const date = (picked.find(r => r.taken_at)?.taken_at
    ?? session.ended_at ?? session.started_at ?? '').slice(0, 10)

  return {
    sessionId,
    date,
    startedAt:  session.started_at,
    endedAt:    session.ended_at ?? null,
    status:     session.status,
    type:       session.type ?? 'stock',
    itemCount:  lines.length,
    totalValue: session.total_value ?? null,
    truncated,
    lines,
  }
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

  const rawLines = Array.isArray(body.lines) ? body.lines : []
  if (rawLines.length > MAX_LINES_PER_REQUEST) return { _status: 413, error: '発注行が多すぎます' }

  const clean = rawLines
    .map(l => ({
      item:      String(l.item ?? '').trim().slice(0, MAX_INGREDIENT_LEN),
      qty:       Number(l.qty),
      unit:      String(l.unit ?? '').slice(0, MAX_UNIT_LEN),
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

  // ヘッダ・明細削除・明細追加を1つの batch（=1トランザクション）で書く（DATA-001）。
  // 以前はヘッダ→削除→N回INSERTが独立したwriteで、途中で落ちると
  // 「ヘッダはあるが明細が消えたまま」「一部の行だけ入った」状態が残った。
  //
  // SELECT後に別店舗が同じidを作る競合は upsert 自身の WHERE が原子的に拒否する。
  // batch は途中で中断できないため、明細INSERTも EXISTS で持ち主を確認し、
  // ヘッダが拒否された場合に明細だけが入るのを防ぐ。
  const headStmt = db.prepare(`
    INSERT INTO orders (id, shop_code, order_date, supplier, axis, session_id, saved_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET order_date = excluded.order_date, supplier = excluded.supplier, axis = excluded.axis
    WHERE orders.shop_code = excluded.shop_code
  `).bind(id, code, date, body.supplier ?? '', body.axis ?? '', body.sessionId ?? null, body.savedAt ?? now)

  const delStmt = db.prepare('DELETE FROM order_lines WHERE order_id = ? AND shop_code = ?').bind(id, code)

  const lineStmts = clean.map(l => db.prepare(`
    INSERT INTO order_lines (order_id, shop_code, order_date, item, qty, unit, stock, lot, post_stock, excluded, created_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    WHERE EXISTS (SELECT 1 FROM orders WHERE id = ? AND shop_code = ?)
  `).bind(id, code, date, l.item, l.qty, l.unit, l.stock, l.lot, l.postStock, l.excluded, now, id, code))

  let results
  try {
    results = await db.batch([headStmt, delStmt, ...lineStmts])
  } catch (e) {
    console.error('[storeHandler] order create batch failed:', code, id, e?.message ?? e)
    return { _status: 503, code: 'order_save_failed', retryable: true, error: '保存できませんでした' }
  }

  const headWrite = results?.[0]
  if (headWrite?.success !== true || headWrite?.meta?.changes !== 1) {
    return { _status: 409, error: '保存できませんでした' }
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

  const rawLines = Array.isArray(body.lines) ? body.lines : []
  if (rawLines.length > MAX_LINES_PER_REQUEST) return { _status: 413, error: '入出庫行が多すぎます' }

  const clean = rawLines
    .map(l => ({
      item: String(l.item ?? '').trim().slice(0, MAX_INGREDIENT_LEN),
      qty:  Number(l.qty),
      unit: String(l.unit ?? '').slice(0, MAX_UNIT_LEN),
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

  // ヘッダ・明細削除・明細追加を1つの batch（=1トランザクション）で書く（DATA-001）。
  // 明細を消してからヘッダを書いていたため、間で落ちると明細だけ消えた状態が残った。
  //
  // upsert に WHERE を足した。SELECT 後に別店舗が同じ id を作る競合で、
  // 他店のヘッダを上書きできてしまう隙間が残っていた（handleOrderCreate と同じ形へ揃える）。
  const headStmt = db.prepare(`
    INSERT INTO movements (id, shop_code, move_date, type, note, order_id, saved_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET move_date = excluded.move_date, type = excluded.type, note = excluded.note, order_id = excluded.order_id
    WHERE movements.shop_code = excluded.shop_code
  `).bind(id, code, date, type, body.note ?? '', orderId, body.savedAt ?? now)

  const delStmt = db.prepare('DELETE FROM movement_lines WHERE movement_id = ? AND shop_code = ?').bind(id, code)

  const lineStmts = clean.map(l => db.prepare(`
    INSERT INTO movement_lines (movement_id, shop_code, move_date, item, qty, unit, created_at)
    SELECT ?, ?, ?, ?, ?, ?, ?
    WHERE EXISTS (SELECT 1 FROM movements WHERE id = ? AND shop_code = ?)
  `).bind(id, code, date, l.item, l.qty, l.unit, now, id, code))

  let results
  try {
    results = await db.batch([headStmt, delStmt, ...lineStmts])
  } catch (e) {
    console.error('[storeHandler] movement create batch failed:', code, id, e?.message ?? e)
    return { _status: 503, code: 'movement_save_failed', retryable: true, error: '保存できませんでした' }
  }

  const headWrite = results?.[0]
  if (headWrite?.success !== true || headWrite?.meta?.changes !== 1) {
    return { _status: 409, error: '保存できませんでした' }
  }
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
// 棚卸完了の一括処理。明細（inventory_lines）と完了状態（sessions）を
// **1つの db.batch = 1トランザクション**で書く（DATA-001）。
//
// 以前は insertInventoryLines と UPDATE sessions が独立した2つの write で、
// 前者だけ失敗すると「セッションは残るが明細が消える」状態になっていた。
// これは DATA-002 の R-001 として本番で実害が出ている。
//
// 冪等性: 同じ完了要求を再送しても最終状態は同じ。明細は貼り直し、
// 完了状態は同じ値で上書きされる。品目が減った再送でも前回ぶんは残らない。
export async function handleSessionComplete(db, code, sessionId, body) {
  if (_tooLarge(body)) return { _status: 413, error: 'データサイズが大きすぎます' }

  const { inventory = {}, prices = {}, takenAt } = body ?? {}
  if (inventory == null || typeof inventory !== 'object' || Array.isArray(inventory)) {
    return { _status: 400, error: '在庫データの形式が不正です' }
  }
  if (Object.keys(inventory).length > MAX_LINES_PER_REQUEST) {
    return { _status: 413, error: '品目数が多すぎます' }
  }

  const session = await db.prepare(
    'SELECT id FROM sessions WHERE id = ? AND shop_code = ?'
  ).bind(sessionId, code).first()
  if (!session) return { _status: 404, error: 'セッションが見つかりません' }

  const now   = _now()
  const taken = takenAt ?? now.slice(0, 10)

  const { statements, itemCount, totalValue } =
    inventoryLineStatements(db, { sessionId, shopCode: code, takenAt: taken, inventory, prices })

  // UPDATE を batch の先頭に置く。セッションが消えている・他店舗のものになっている場合に
  // ここが 0 行となり、後続の INSERT も EXISTS で弾かれて何も書き込まれない。
  const sessionUpdate = db.prepare(`
    UPDATE sessions
    SET status = 'completed', ended_at = ?, item_count = ?, total_value = ?
    WHERE id = ? AND shop_code = ?
  `).bind(now, itemCount, totalValue, sessionId, code)

  let results
  try {
    results = await db.batch([sessionUpdate, ...statements])
  } catch (e) {
    // 途中で落ちた場合、batch はトランザクションごと巻き戻る。
    // 完了扱いにせず、クライアントが再送できる形で返す。
    console.error('[storeHandler] session complete batch failed:', code, sessionId, e?.message ?? e)
    return { _status: 503, code: 'complete_failed', retryable: true, error: '完了を保存できませんでした' }
  }

  // UPDATE が 0 行 = 直前にセッションが消えた/他店舗のものになった。
  // 明細も EXISTS で入っていないため、部分的に書かれた状態にはならない。
  if (results?.[0]?.meta?.changes !== 1) {
    return { _status: 404, error: 'セッションが見つかりません' }
  }

  return { ok: true, sessionId, itemCount, totalValue }
}
