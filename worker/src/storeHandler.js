// ── 店舗コード方式 データ永続化 API（Cloudflare D1）────────────────────────────

import { inventoryLineStatements } from './inventoryLines.js'
import { _now, genUniqueShopCode } from './workerUtils.js'
import {
  MAX_PAYLOAD_BYTES, RESULT_WINDOW_DAYS, MAX_SESSION_LINES, MAX_LINES_PER_REQUEST,
  MAX_INGREDIENT_LEN, MAX_UNIT_LEN, MAX_NOTE_LEN, MAX_SUPPLIER_LEN,
  MAX_ORDER_QTY, MAX_MOVEMENT_QTY,
  ORDER_ROWS_PER_STATEMENT, MOVEMENT_ROWS_PER_STATEMENT,
} from './constants.js'
import {
  parseClientId, parseDate, parseQty, parseOptionalNumber, parseEnum, parseCount,
  text, chunk, isValidDate, jsonByteLength,
} from './validate.js'
import { entitlement } from './entitlements.js'

// payload 上限は UTF-8 バイト数で判定する（第2セッション §5）。
// JSON.stringify().length は UTF-16 code unit 数で、日本語では実バイト数の約1/3を返す。
function _tooLarge(body) {
  return jsonByteLength(body) > MAX_PAYLOAD_BYTES
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
//
// serverRevision / serverSavedAt はサーバーが採番・記録した値。
// client の updatedAt / savedAt は端末時計に依存し、時計がずれた端末が古い版を
// 「新しい」と主張できるため、新旧判定には使わない（第2セッション §2）。
export async function handleHistoryGet(db, code) {
  const rows = await db.prepare(`
    SELECT session_id, snapshot_json, created_at, updated_at, revision FROM store_history
    WHERE shop_code = ? ORDER BY snapshot_date DESC, id DESC LIMIT 50
  `).bind(code).all()
  return rows.results.map(r => {
    const snap = JSON.parse(r.snapshot_json)
    return {
      ...snap,
      sessionId:      r.session_id ?? snap.sessionId ?? null,
      serverRevision: r.revision ?? 0,
      serverSavedAt:  r.updated_at ?? r.created_at,
    }
  })
}

// store_history の revision は「同じ店舗の最大値 + 1」。
// upsert のたびに採番し直すので、同じ行を上書きしても必ず増える。
// D1 の書き込みは1データベース1直列なので、この式で採番の衝突は起きない。
const _NEXT_REVISION = `COALESCE((SELECT MAX(h2.revision) FROM store_history h2 WHERE h2.shop_code = ?), 0) + 1`

/**
 * スナップショットを1件書き込む文を返す（実行しない）。
 *
 * sessionId を持つ行は (shop_code, session_id) で一意。同じ日に2回棚卸しても
 * 別セッションなら共存する（migration 0012 / F-001）。
 * sessionId を持たない過去取込・旧データは従来どおり日付で一意。
 *
 * こちらは **セッション行の存在を確認しない**。PIN 未設定のレガシー店舗は
 * `/sessions`（strict Bearer）を使えず sessions 行を持たないため、ここで
 * 存在を要求すると履歴保存そのものができなくなる。
 * 棚卸完了・過去取込は sessionSnapshotStatement（存在確認つき）を使う。
 */
export function historySnapshotStatement(db, code, snapshot, now) {
  const date      = snapshot?.date || now.slice(0, 10)
  const sessionId = parseClientId(snapshot?.sessionId) ?? null
  const json      = JSON.stringify(snapshot)

  if (sessionId) {
    return db.prepare(`
      INSERT INTO store_history (shop_code, session_id, snapshot_date, snapshot_json, created_at, updated_at, revision)
      VALUES (?, ?, ?, ?, ?, ?, ${_NEXT_REVISION})
      ON CONFLICT(shop_code, session_id) WHERE session_id IS NOT NULL DO UPDATE
        SET snapshot_json = excluded.snapshot_json, snapshot_date = excluded.snapshot_date,
            updated_at = excluded.updated_at, revision = excluded.revision
    `).bind(code, sessionId, date, json, now, now, code)
  }
  return db.prepare(`
    INSERT INTO store_history (shop_code, session_id, snapshot_date, snapshot_json, created_at, updated_at, revision)
    VALUES (?, NULL, ?, ?, ?, ?, ${_NEXT_REVISION})
    ON CONFLICT(shop_code, snapshot_date) WHERE session_id IS NULL DO UPDATE
      SET snapshot_json = excluded.snapshot_json,
          updated_at = excluded.updated_at, revision = excluded.revision
  `).bind(code, date, json, now, now, code)
}

/**
 * 棚卸完了・過去取込用のスナップショット文（実行しない）。
 *
 * `INSERT ... SELECT ... FROM sessions WHERE id = ? AND shop_code = ?` にすることで、
 * **セッション行が同じトランザクション内に存在する場合しか行を作らない**。
 * VALUES 形式では、事前の存在確認と batch の間にセッションが消えても
 * snapshot だけが書き込まれ、一覧に出ない孤児スナップショットが残っていた
 * （本番D1で両方向の孤児を確認済み・DATA-002 / F-004）。
 * batch は途中で中断できないので、文ごとに存在条件を閉じておく必要がある。
 */
export function sessionSnapshotStatement(db, code, sessionId, snapshot, now) {
  const date = snapshot?.date || now.slice(0, 10)
  const json = JSON.stringify({ ...snapshot, sessionId, date })
  return db.prepare(`
    INSERT INTO store_history (shop_code, session_id, snapshot_date, snapshot_json, created_at, updated_at, revision)
    SELECT s.shop_code, s.id, ?, ?, ?, ?, ${_NEXT_REVISION}
    FROM sessions s
    WHERE s.id = ? AND s.shop_code = ? AND s.deleted_at IS NULL
    ON CONFLICT(shop_code, session_id) WHERE session_id IS NOT NULL DO UPDATE
      SET snapshot_json = excluded.snapshot_json, snapshot_date = excluded.snapshot_date,
          updated_at = excluded.updated_at, revision = excluded.revision
  `).bind(date, json, now, now, code, sessionId, code)
}

/** 保存後の server 側 revision / 保存時刻を読み戻す。読めなくても保存自体は成立している。 */
export async function readHistoryStamp(db, code, { sessionId = null, date = null } = {}) {
  try {
    const row = sessionId
      ? await db.prepare(
          'SELECT revision, updated_at, created_at FROM store_history WHERE shop_code = ? AND session_id = ?'
        ).bind(code, sessionId).first()
      : await db.prepare(
          'SELECT revision, updated_at, created_at FROM store_history WHERE shop_code = ? AND snapshot_date = ? AND session_id IS NULL'
        ).bind(code, date).first()
    if (!row) return { serverRevision: null, serverSavedAt: null }
    return { serverRevision: row.revision ?? 0, serverSavedAt: row.updated_at ?? row.created_at ?? null }
  } catch (e) {
    console.error('[storeHandler] history stamp read failed:', code, e?.message ?? e)
    return { serverRevision: null, serverSavedAt: null }
  }
}

// POST /store/:code/history
// 過去取込・訂正など、棚卸完了以外の経路から1件保存する。
// 棚卸完了は handleSessionComplete が同じ batch で書くので、こちらを使わない。
export async function handleHistoryPost(db, code, body) {
  if (_tooLarge(body)) return { _status: 413, error: 'データサイズが大きすぎます' }
  const now   = _now()
  const today = now.slice(0, 10)

  const date = parseDate(body?.date, today)
  if (date === null) return { _status: 400, code: 'invalid_date', error: '日付の形式が不正です' }

  const sessionId = parseClientId(body?.sessionId)
  if (sessionId === undefined) return { _status: 400, code: 'invalid_id', error: 'セッションIDの形式が不正です' }

  await historySnapshotStatement(db, code, body, now).run()
  const stamp = await readHistoryStamp(db, code, { sessionId, date })
  return { ok: true, sessionId, date, ...stamp }
}

// DELETE /store/:code/history/:key
// key は sessionId（現行）または日付（legacy行）。
// sessionId 形式なら session_id で消す。日付形式なら session_id を持たない行だけを消す。
// 日付で消したときに同日の別セッションまで巻き込まないため、条件を分ける（F-001）。
export async function handleHistoryDelete(db, code, key) {
  const isDate    = isValidDate(key)
  const sessionId = isDate ? null : parseClientId(key)
  if (!isDate && !sessionId) return { _status: 400, code: 'invalid_id', error: '削除対象が不正です' }

  try {
    const res = isDate
      ? await db.prepare(
          'DELETE FROM store_history WHERE shop_code = ? AND snapshot_date = ? AND session_id IS NULL'
        ).bind(code, key).run()
      : await db.prepare('DELETE FROM store_history WHERE shop_code = ? AND session_id = ?')
          .bind(code, sessionId).run()
    return { ok: true, removed: res?.meta?.changes ?? 0 }
  } catch (e) {
    // 失敗を 200 で返すと、client は「消えた」と表示したまま再試行しない。
    console.error('[storeHandler] history delete failed:', code, key, e?.message ?? e)
    return { _status: 503, code: 'history_delete_failed', retryable: true, error: '削除できませんでした' }
  }
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
  // 未指定は 'stock'。指定されていて 'stock' / 'order' 以外なら拒否する
  // （黙って 'stock' へ倒すと、発注セッションのつもりの行が棚卸として集計される）。
  const parsedType = parseEnum(body?.type, ['stock', 'order'])
  if (parsedType === undefined) return { _status: 400, code: 'invalid_type', error: 'セッション種別が不正です' }

  const id   = crypto.randomUUID()
  const now  = _now()
  const type = parsedType ?? 'stock'
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
  if (!session) return { _status: 404, code: 'session_not_found', error: 'セッションが見つかりません' }

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
  const status = parseEnum(body?.status, ['active', 'completed', 'incomplete'])
  if (!status) return { _status: 400, code: 'invalid_status', error: '無効なステータスです' }

  // 旧実装は数値以外を黙って 0 にしていた。'12' や NaN を 0 として保存すると
  // 一覧の品目数が実際と食い違う（詳細を開くまで気づけない）。
  const itemCount = parseCount(body?.itemCount, MAX_LINES_PER_REQUEST)
  if (itemCount === undefined) return { _status: 400, code: 'invalid_count', error: '品目数が不正です' }

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

  const now = _now()

  const id = parseClientId(body.id)
  if (id === undefined) return { _status: 400, code: 'invalid_id', error: 'IDの形式が不正です' }
  const orderId = id ?? crypto.randomUUID()

  const date = parseDate(body.date, now.slice(0, 10))
  if (date === null) return { _status: 400, code: 'invalid_date', error: '日付の形式が不正です' }

  if (!Array.isArray(body.lines)) return { _status: 400, error: '発注行がありません' }
  const rawLines = body.lines
  if (rawLines.length > MAX_LINES_PER_REQUEST) return { _status: 413, error: '発注行が多すぎます' }

  // 数量は「発注しない行は送らない」契約。0・負数・NaN・Infinity・桁外れは拒否し、
  // 黙って0や1へ丸めない（DATA-001）。
  const clean = []
  for (const l of rawLines) {
    const item = text(l?.item, MAX_INGREDIENT_LEN)
    if (!item) continue
    // 0 は「確認したが発注しない」行として正当（excluded と併用される）。
    // 負数・NaN・Infinity・桁外れだけを拒否する。
    const qty = parseQty(l?.qty, { min: 0, max: MAX_ORDER_QTY })
    if (qty === null) return { _status: 400, code: 'invalid_qty', error: `発注数が不正です: ${item}` }
    const stock = parseOptionalNumber(l?.stock, { min: -MAX_ORDER_QTY, max: MAX_ORDER_QTY })
    if (stock === undefined) return { _status: 400, code: 'invalid_qty', error: `在庫数が不正です: ${item}` }
    const postStock = parseOptionalNumber(l?.postStock, { min: -MAX_ORDER_QTY, max: MAX_ORDER_QTY })
    if (postStock === undefined) return { _status: 400, code: 'invalid_qty', error: `発注後在庫が不正です: ${item}` }
    const lotNum = parseOptionalNumber(l?.lot, { min: Number.MIN_VALUE, max: MAX_ORDER_QTY })
    if (lotNum === undefined) return { _status: 400, code: 'invalid_qty', error: `入数が不正です: ${item}` }
    clean.push({
      item, qty, stock, postStock,
      unit:     text(l?.unit, MAX_UNIT_LEN),
      lot:      lotNum ?? 1,
      excluded: l?.excluded ? 1 : 0,
    })
  }
  if (clean.length === 0) return { _status: 400, error: '有効な発注行がありません' }

  // 紐付け先セッションIDは形式不正なら拒否する。旧実装は `?? null` で黙って
  // 「紐付けなし」へ倒しており、発注が棚卸セッションから切り離されていた。
  const linkedSessionId = parseClientId(body.sessionId)
  if (linkedSessionId === undefined) {
    return { _status: 400, code: 'invalid_id', error: 'セッションIDの形式が不正です' }
  }

  // テナント境界: orders.id はグローバルPK。同じidを別店舗が指定しても、
  // 他店のヘッダ・明細を更新できないようownerを確認する。
  const owner = await db.prepare('SELECT shop_code FROM orders WHERE id = ?').bind(orderId).first()
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
  `).bind(orderId, code, date, text(body.supplier, MAX_SUPPLIER_LEN), text(body.axis, MAX_SUPPLIER_LEN),
          linkedSessionId, body.savedAt ?? now)

  const delStmt = db.prepare('DELETE FROM order_lines WHERE order_id = ? AND shop_code = ?').bind(orderId, code)

  // 明細は複数行を1文へまとめる。1行1文だと N+2 statements になり、
  // Free の「Queries per Worker invocation = 50」を超える（D1公式制限・2026-08-09確認）。
  // 持ち主の確認は JOIN 元の orders 絞り込みが担う。
  const lineStmts = chunk(clean, ORDER_ROWS_PER_STATEMENT).map(group => {
    const values = group.map(() =>
      'SELECT ? AS item, ? AS qty, ? AS unit, ? AS stock, ? AS lot, ? AS post_stock, ? AS excluded'
    ).join(' UNION ALL ')
    // bind はSQL文中の ? の出現順。SELECTリストの2個（order_date, created_at）が先、
    // 次にFROM内の副問い合わせ、最後にWHEREの2個。
    const binds = [date, now]
    for (const l of group) binds.push(l.item, l.qty, l.unit, l.stock, l.lot, l.postStock, l.excluded)
    binds.push(orderId, code)
    return db.prepare(`
      INSERT INTO order_lines (order_id, shop_code, order_date, item, qty, unit, stock, lot, post_stock, excluded, created_at)
      SELECT o.id, o.shop_code, ?, v.item, v.qty, v.unit, v.stock, v.lot, v.post_stock, v.excluded, ?
      FROM orders o, (${values}) v
      WHERE o.id = ? AND o.shop_code = ?
    `).bind(...binds)
  })

  let results
  try {
    results = await db.batch([headStmt, delStmt, ...lineStmts])
  } catch (e) {
    console.error('[storeHandler] order create batch failed:', code, orderId, e?.message ?? e)
    return { _status: 503, code: 'order_save_failed', retryable: true, error: '保存できませんでした' }
  }

  const headWrite = results?.[0]
  if (headWrite?.success !== true || headWrite?.meta?.changes !== 1) {
    return { _status: 409, error: '保存できませんでした' }
  }
  return { ok: true, id: orderId }
}

// DELETE /store/:code/orders/:id
export async function handleOrderDelete(db, code, id) {
  // 不存在と他店舗所有を同じ404にして、idの存在有無を別店舗へ開示しない。
  const owner = await db.prepare('SELECT shop_code FROM orders WHERE id = ?').bind(id).first()
  if (!owner || owner.shop_code !== code) {
    return { _status: 404, code: 'order_not_found', error: '発注が見つかりません' }
  }

  // 明細とヘッダを1 batch（=1トランザクション）で消す（DATA-001）。
  // 独立した2 write だと、間で落ちたとき「ヘッダは残るが明細だけ消えた」状態になり、
  // 一覧には出るのに中身が空、という R-001 と同じ見え方を作る。
  try {
    await db.batch([
      db.prepare('DELETE FROM order_lines WHERE order_id = ? AND shop_code = ?').bind(id, code),
      db.prepare('DELETE FROM orders WHERE id = ? AND shop_code = ?').bind(id, code),
    ])
  } catch (e) {
    console.error('[storeHandler] order delete batch failed:', code, id, e?.message ?? e)
    return { _status: 503, code: 'order_delete_failed', retryable: true, error: '削除できませんでした' }
  }
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

  const now = _now()

  const rawId = parseClientId(body.id)
  if (rawId === undefined) return { _status: 400, code: 'invalid_id', error: 'IDの形式が不正です' }
  const moveId = rawId ?? crypto.randomUUID()

  const date = parseDate(body.date, now.slice(0, 10))
  if (date === null) return { _status: 400, code: 'invalid_date', error: '日付の形式が不正です' }

  // 種別は入庫/出庫のどちらかでなければならない。旧実装は 'out' 以外をすべて 'in' に
  // していたため、typo や欠落した種別が「入庫」として理論在庫へ加算されていた。
  const type = parseEnum(body.type, ['in', 'out'])
  if (!type) return { _status: 400, code: 'invalid_type', error: '入出庫の種別が不正です' }

  if (!Array.isArray(body.lines)) return { _status: 400, error: '入出庫行がありません' }
  const rawLines = body.lines
  if (rawLines.length > MAX_LINES_PER_REQUEST) return { _status: 413, error: '入出庫行が多すぎます' }

  // 数量0・負数の入出庫は記録の意味がないため拒否する。
  // 従来は filter で黙って捨てていたので、送った側は成功したと誤解していた。
  const clean = []
  for (const l of rawLines) {
    const item = text(l?.item, MAX_INGREDIENT_LEN)
    if (!item) continue
    const qty = parseQty(l?.qty, { min: Number.MIN_VALUE, max: MAX_MOVEMENT_QTY })
    if (qty === null) return { _status: 400, code: 'invalid_qty', error: `数量が不正です: ${item}` }
    clean.push({ item, qty, unit: text(l?.unit, MAX_UNIT_LEN) })
  }
  if (clean.length === 0) return { _status: 400, error: '有効な入出庫行がありません' }

  // 出庫は発注紐付けを持たない。入庫の orderId は形式不正なら拒否する
  // （`?? null` で黙って紐付けを外すと、発注の消込状態が実態とずれる）。
  const parsedOrderId = parseClientId(body.orderId)
  if (parsedOrderId === undefined) {
    return { _status: 400, code: 'invalid_id', error: '発注IDの形式が不正です' }
  }
  const linkedOrderId = type === 'in' ? parsedOrderId : null

  // テナント境界: movements.id はグローバル PK。既存 id が別店舗のものなら拒否し、
  // 他店の入出庫ヘッダ（日付/種別/メモ/発注ID）を書き換えられないようにする。
  // 同一店舗の再送はこのチェックを通り、下の upsert で冪等に貼り直す。
  const owner = await db.prepare('SELECT shop_code FROM movements WHERE id = ?').bind(moveId).first()
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
  `).bind(moveId, code, date, type, text(body.note, MAX_NOTE_LEN), linkedOrderId, body.savedAt ?? now)

  const delStmt = db.prepare('DELETE FROM movement_lines WHERE movement_id = ? AND shop_code = ?').bind(moveId, code)

  // 明細は複数行を1文へまとめる（D1の queries/invocation 対策・constants.js 参照）。
  // 持ち主の確認は JOIN 元の movements 絞り込みが担う。
  const lineStmts = chunk(clean, MOVEMENT_ROWS_PER_STATEMENT).map(group => {
    const values = group.map(() => 'SELECT ? AS item, ? AS qty, ? AS unit').join(' UNION ALL ')
    const binds = [date, now]
    for (const l of group) binds.push(l.item, l.qty, l.unit)
    binds.push(moveId, code)
    return db.prepare(`
      INSERT INTO movement_lines (movement_id, shop_code, move_date, item, qty, unit, created_at)
      SELECT m.id, m.shop_code, ?, v.item, v.qty, v.unit, ?
      FROM movements m, (${values}) v
      WHERE m.id = ? AND m.shop_code = ?
    `).bind(...binds)
  })

  let results
  try {
    results = await db.batch([headStmt, delStmt, ...lineStmts])
  } catch (e) {
    console.error('[storeHandler] movement create batch failed:', code, moveId, e?.message ?? e)
    return { _status: 503, code: 'movement_save_failed', retryable: true, error: '保存できませんでした' }
  }

  const headWrite = results?.[0]
  if (headWrite?.success !== true || headWrite?.meta?.changes !== 1) {
    return { _status: 409, error: '保存できませんでした' }
  }
  return { ok: true, id: moveId }
}

// DELETE /store/:code/movements/:id
export async function handleMovementDelete(db, code, id) {
  // 不存在と他店舗所有を同じ404にして、idの存在有無を別店舗へ開示しない（handleOrderDeleteと同じ形）。
  const owner = await db.prepare('SELECT shop_code FROM movements WHERE id = ?').bind(id).first()
  if (!owner || owner.shop_code !== code) {
    return { _status: 404, code: 'movement_not_found', error: '入出庫が見つかりません' }
  }

  // 明細とヘッダを1 batch で消す（DATA-001）。順序が逆でも部分状態を残さない。
  try {
    await db.batch([
      db.prepare('DELETE FROM movement_lines WHERE movement_id = ? AND shop_code = ?').bind(id, code),
      db.prepare('DELETE FROM movements WHERE id = ? AND shop_code = ?').bind(id, code),
    ])
  } catch (e) {
    console.error('[storeHandler] movement delete batch failed:', code, id, e?.message ?? e)
    return { _status: 503, code: 'movement_delete_failed', retryable: true, error: '削除できませんでした' }
  }
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

  const { inventory = {}, prices = {}, takenAt, snapshot } = body ?? {}
  if (inventory == null || typeof inventory !== 'object' || Array.isArray(inventory)) {
    return { _status: 400, error: '在庫データの形式が不正です' }
  }
  if (Object.keys(inventory).length > MAX_LINES_PER_REQUEST) {
    return { _status: 413, error: '品目数が多すぎます' }
  }

  const now   = _now()
  const today = now.slice(0, 10)

  // takenAt は inventory_lines.taken_at になり、分析・カレンダーの日付そのもの。
  // 以前は無検証で受けていたため、'yesterday' のような文字列がそのまま列へ入り得た。
  const taken = parseDate(takenAt, today)
  if (taken === null) return { _status: 400, code: 'invalid_date', error: '棚卸日の形式が不正です' }

  // スナップショットは必須（第2セッション §1）。
  // 明細（inventory_lines）だけ書いて表示用スナップショットが無い状態が、
  // 「一覧には出るのに詳細が開けない」= R-001 そのもの。完了要求に含めさせ、
  // sessions / inventory_lines / store_history を同じ batch で必ず揃える。
  if (snapshot == null) {
    return { _status: 400, code: 'snapshot_required', error: '棚卸の明細（スナップショット）がありません' }
  }
  if (typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return { _status: 400, code: 'invalid_snapshot', error: 'スナップショットの形式が不正です' }
  }
  const snapDate = parseDate(snapshot.date, taken)
  if (snapDate === null) {
    return { _status: 400, code: 'invalid_date', error: 'スナップショットの日付が不正です' }
  }

  const session = await db.prepare(
    'SELECT id FROM sessions WHERE id = ? AND shop_code = ? AND deleted_at IS NULL'
  ).bind(sessionId, code).first()
  if (!session) return { _status: 404, code: 'session_not_found', error: 'セッションが見つかりません' }

  const built = inventoryLineStatements(db, { sessionId, shopCode: code, takenAt: taken, inventory, prices })
  // 数量・単価が業務契約に合わない場合は、何も書かずに 400 を返す（0 へ丸めない・DATA-001）。
  if (built.error) return built.error
  const { statements, itemCount, totalValue } = built

  // UPDATE を batch の先頭に置く。セッションが消えている・他店舗のものになっている場合に
  // ここが 0 行となり、後続の INSERT も存在条件で弾かれて何も書き込まれない。
  const sessionUpdate = db.prepare(`
    UPDATE sessions
    SET status = 'completed', ended_at = ?, item_count = ?, total_value = ?
    WHERE id = ? AND shop_code = ? AND deleted_at IS NULL
  `).bind(now, itemCount, totalValue, sessionId, code)

  // 表示・分析用スナップショットも同じ batch に載せる（DATA-001 / 第2セッション）。
  // sessionId は必ずこのセッションのものに揃える（client 指定は信用しない）。
  // 上の SELECT と batch の間にセッションが消えても、sessionSnapshotStatement は
  // sessions を参照する INSERT ... SELECT なので snapshot だけが残ることはない。
  const snapStatement = sessionSnapshotStatement(
    db, code, sessionId, { ...snapshot, sessionId, date: snapDate }, now,
  )

  let results
  try {
    results = await db.batch([sessionUpdate, ...statements, snapStatement])
  } catch (e) {
    // 途中で落ちた場合、batch はトランザクションごと巻き戻る。
    // 完了扱いにせず、クライアントが再送できる形で返す。
    console.error('[storeHandler] session complete batch failed:', code, sessionId, e?.message ?? e)
    return { _status: 503, code: 'complete_failed', retryable: true, error: '完了を保存できませんでした' }
  }

  // UPDATE が 0 行 = 直前にセッションが消えた/他店舗のものになった。
  // 明細も snapshot も存在条件で入っていないため、部分的に書かれた状態にはならない。
  if (results?.[0]?.meta?.changes !== 1) {
    return { _status: 404, code: 'session_not_found', error: 'セッションが見つかりません' }
  }

  const stamp = await readHistoryStamp(db, code, { sessionId })
  return { ok: true, sessionId, itemCount, totalValue, snapshotSaved: true, ...stamp }
}
