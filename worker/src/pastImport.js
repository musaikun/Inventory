/**
 * 過去棚卸の取込（IMPORT-001）。
 *
 * 設計の要点:
 *   - 取込で作るのは**通常と同じ session**。日付キーの別世界を作らない（0012 の identity を使う）。
 *     カレンダー・一覧・詳細は取込ぶんも同じ sessionId で引ける。
 *   - 1リクエスト = 1日ぶん。複数日は client が同じ importBatchId で繰り返し呼ぶ。
 *     こうしないと statement 数が日数×品目数で膨らみ、D1 の 1 invocation 上限を超える。
 *   - session / inventory_lines / store_history を1つの db.batch（=1トランザクション）で書く。
 *     途中まで入った状態を作らない（DATA-001 と同じ契約）。
 *   - 冪等: 同じ (shop_code, importBatchId, 日付) は同じ session を使い回して貼り直す。
 *     再送でセッションが増えない。
 *   - 取消は import_batch_id でだけ対象を絞る。通常の棚卸（import_batch_id IS NULL）と
 *     別バッチには触れない。
 *   - 同じ日に既存 session があっても勝手に消さない。client が明示指定した
 *     replaceSessionIds だけを、同じ shop_code の内側で削除する。
 */

import {
  MAX_INGREDIENT_LEN,
  MAX_UNIT_LEN,
  MAX_INVENTORY_QTY,
  MAX_UNIT_PRICE,
  MAX_LINES_PER_REQUEST,
  MAX_PAYLOAD_CHARS,
  INVENTORY_ROWS_PER_STATEMENT,
} from './constants.js'
import { isValidDate, parseQty, parseClientId, text, chunk } from './validate.js'
import { historySnapshotStatement } from './storeHandler.js'

const _now = () => new Date().toISOString()

/** 取込バッチID。client採番だが、形は server 側でも縛る。 */
export function parseBatchId(v) {
  const id = parseClientId(v)
  return id || null      // null（未指定）も undefined（不正）もここでは弾く
}

function _tooLarge(body) {
  try { return JSON.stringify(body ?? {}).length > MAX_PAYLOAD_CHARS } catch (_) { return true }
}

/**
 * 取込1日ぶんの明細を検証して行へ落とす。
 * 数量は棚卸と同じ契約（0 は正当、負数・非有限は拒否）。
 */
function _buildRows(items) {
  const rows = []
  const seen = new Set()
  let total = 0
  let hasPrices = false

  for (const raw of items) {
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
      return { error: { _status: 400, code: 'invalid_item', error: '明細の形式が不正です' } }
    }
    const item = text(raw.item ?? raw.name, MAX_INGREDIENT_LEN)
    if (!item) continue
    if (seen.has(item)) continue          // PRIMARY KEY(session_id, item_name) 違反を先に潰す
    seen.add(item)

    const qty = parseQty(raw.qty, { min: 0, max: MAX_INVENTORY_QTY })
    if (qty === null) {
      return { error: { _status: 400, code: 'invalid_qty', error: `数量が不正です: ${item}` } }
    }

    let unitPrice = null
    const rawPrice = raw.unitPrice ?? raw.price
    if (rawPrice != null && rawPrice !== '') {
      const p = Number(rawPrice)
      if (!Number.isFinite(p) || p < 0 || p > MAX_UNIT_PRICE) {
        return { error: { _status: 400, code: 'invalid_price', error: `単価が不正です: ${item}` } }
      }
      unitPrice = p
    }

    const lineValue = unitPrice != null ? Math.round(qty * unitPrice) : null
    if (lineValue != null) { total += lineValue; hasPrices = true }

    rows.push({
      item, qty,
      unit:  raw.unit == null ? null : text(raw.unit, MAX_UNIT_LEN),
      price: unitPrice,
      value: lineValue,
    })
  }

  return { rows, totalValue: hasPrices ? total : null }
}

/**
 * POST /store/:code/imports/:batchId/sessions
 * body: { date, items[], replaceSessionIds?[], snapshot? }
 *
 * @returns { ok, sessionId, date, itemCount, totalValue, replaced }
 */
export async function handlePastImportCreate(db, code, batchId, body) {
  if (_tooLarge(body)) return { _status: 413, error: 'データサイズが大きすぎます' }

  const batch = parseBatchId(batchId)
  if (!batch) return { _status: 400, code: 'invalid_batch', error: '取込IDが不正です' }

  const { date, items, replaceSessionIds = [], snapshot } = body ?? {}

  if (!isValidDate(date)) {
    return { _status: 400, code: 'invalid_date', error: '日付の形式が不正です' }
  }
  if (!Array.isArray(items)) {
    return { _status: 400, code: 'invalid_items', error: '明細の形式が不正です' }
  }
  if (items.length > MAX_LINES_PER_REQUEST) {
    return { _status: 413, code: 'too_many_lines', error: '品目数が多すぎます' }
  }
  if (!Array.isArray(replaceSessionIds) || replaceSessionIds.length > 50) {
    return { _status: 400, code: 'invalid_replace', error: '上書き対象の指定が不正です' }
  }
  const replaceIds = []
  for (const id of replaceSessionIds) {
    const parsed = parseClientId(id)
    if (!parsed) return { _status: 400, code: 'invalid_replace', error: '上書き対象の指定が不正です' }
    replaceIds.push(parsed)
  }
  if (snapshot != null && (typeof snapshot !== 'object' || Array.isArray(snapshot))) {
    return { _status: 400, code: 'invalid_snapshot', error: 'スナップショットの形式が不正です' }
  }

  const built = _buildRows(items)
  if (built.error) return built.error
  const { rows, totalValue } = built
  if (rows.length === 0) {
    return { _status: 400, code: 'no_lines', error: '取り込める明細がありません' }
  }

  // 冪等: 同じバッチ・同じ日付のセッションが既にあれば、それを貼り直す（増やさない）。
  const existing = await db.prepare(`
    SELECT id FROM sessions
    WHERE shop_code = ? AND import_batch_id = ? AND date(started_at) = ?
    ORDER BY started_at LIMIT 1
  `).bind(code, batch, date).first()

  const sessionId = existing?.id ?? crypto.randomUUID()
  const startedAt = `${date}T00:00:00.000Z`
  const now       = _now()

  const statements = []

  // 1) ユーザーが明示的に「上書き」を選んだセッションだけを消す。
  //    shop_code で必ず絞るので、他店舗のIDを渡されても何も消えない。
  for (const id of replaceIds) {
    statements.push(db.prepare('DELETE FROM inventory_lines WHERE session_id = ? AND shop_code = ?').bind(id, code))
    statements.push(db.prepare('DELETE FROM store_history   WHERE session_id = ? AND shop_code = ?').bind(id, code))
    statements.push(db.prepare('DELETE FROM sessions        WHERE id = ? AND shop_code = ?').bind(id, code))
  }

  // 2) セッション本体（完了済みとして作る）。再送では同じ行を上書きする。
  statements.push(db.prepare(`
    INSERT INTO sessions (id, shop_code, started_at, ended_at, status, item_count, total_value, type, import_batch_id)
    VALUES (?, ?, ?, ?, 'completed', ?, ?, 'stock', ?)
    ON CONFLICT(id) DO UPDATE SET
      ended_at = excluded.ended_at, status = 'completed',
      item_count = excluded.item_count, total_value = excluded.total_value,
      import_batch_id = excluded.import_batch_id
  `).bind(sessionId, code, startedAt, now, rows.length, totalValue, batch))

  // 3) 明細。再取込で品目が減った場合に前回ぶんを残さないよう、先に消してから入れ直す。
  statements.push(db.prepare('DELETE FROM inventory_lines WHERE session_id = ? AND shop_code = ?')
    .bind(sessionId, code))

  for (const group of chunk(rows, INVENTORY_ROWS_PER_STATEMENT)) {
    const values = group.map(() => 'SELECT ? AS item, ? AS qty, ? AS unit, ? AS price, ? AS value')
      .join(' UNION ALL ')
    const binds = [date]
    for (const r of group) binds.push(r.item, r.qty, r.unit, r.price, r.value)
    binds.push(sessionId, code)

    statements.push(db.prepare(`
      INSERT INTO inventory_lines
        (session_id, shop_code, taken_at, item_name, category, qty, unit, unit_price, line_value)
      SELECT s.id, s.shop_code, ?, v.item, NULL, v.qty, v.unit, v.price, v.value
      FROM sessions s, (${values}) v
      WHERE s.id = ? AND s.shop_code = ?
    `).bind(...binds))
  }

  // 4) 表示・分析用スナップショット。sessionId はこのセッションのものへ必ず揃える。
  statements.push(historySnapshotStatement(
    db, code,
    { ...(snapshot ?? {}), sessionId, date, source: 'import', importBatchId: batch },
    now,
  ))

  try {
    await db.batch(statements)
  } catch (e) {
    console.error('[pastImport] create batch failed:', code, batch, date, e?.message ?? e)
    return { _status: 503, code: 'import_failed', retryable: true, error: '取込を保存できませんでした' }
  }

  return {
    ok: true, sessionId, date,
    itemCount: rows.length, totalValue,
    importBatchId: batch,
    replaced: replaceIds.length,
  }
}

/**
 * DELETE /store/:code/imports/:batchId
 *
 * バッチで作ったセッション・明細・スナップショットだけを消す。
 * 通常の棚卸（import_batch_id IS NULL）と別バッチには触れない。
 * 2回目以降は removed:0 で成功する（冪等）。
 */
export async function handlePastImportCancel(db, code, batchId) {
  const batch = parseBatchId(batchId)
  if (!batch) return { _status: 400, code: 'invalid_batch', error: '取込IDが不正です' }

  const target = 'SELECT id FROM sessions WHERE shop_code = ? AND import_batch_id = ?'

  const found = await db.prepare(target).bind(code, batch).all()
  const ids   = (found.results ?? []).map(r => r.id)
  if (ids.length === 0) return { ok: true, removed: 0, importBatchId: batch }

  try {
    await db.batch([
      db.prepare(`DELETE FROM inventory_lines WHERE shop_code = ? AND session_id IN (${target})`)
        .bind(code, code, batch),
      db.prepare(`DELETE FROM store_history   WHERE shop_code = ? AND session_id IN (${target})`)
        .bind(code, code, batch),
      db.prepare('DELETE FROM sessions WHERE shop_code = ? AND import_batch_id = ?').bind(code, batch),
    ])
  } catch (e) {
    console.error('[pastImport] cancel batch failed:', code, batch, e?.message ?? e)
    return { _status: 503, code: 'cancel_failed', retryable: true, error: '取込を取り消せませんでした' }
  }

  return { ok: true, removed: ids.length, sessionIds: ids, importBatchId: batch }
}
