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
 *   - 冪等: sessionId は (shop_code, importBatchId, date) から決まる決定的UUID。
 *     応答を取りこぼした client が同じ要求を送り直しても、同じ行を貼り直すだけで増えない。
 *     並行に2本届いても同じ id へ収束し、DB側の一意インデックス（0014）が最後の砦になる。
 *   - snapshot は **server 側で検証済み行から組み立てる**。client の不完全な snapshot を
 *     そのまま保存すると、items の無い履歴（＝詳細が開けない記録）を作れてしまう。
 *   - 取消は import_batch_id でだけ対象を絞る。通常の棚卸（import_batch_id IS NULL）と
 *     別バッチには触れない。
 *   - 同じ日に既存 session があっても勝手に消さない。client が明示指定し、かつ
 *     「同じ店舗・同じ日付・completed・stock」を満たす session だけを削除する。
 */

import {
  MAX_INGREDIENT_LEN,
  MAX_UNIT_LEN,
  MAX_INVENTORY_QTY,
  MAX_UNIT_PRICE,
  MAX_LINES_PER_REQUEST,
  MAX_PAYLOAD_BYTES,
  MAX_REPLACE_SESSIONS,
  INVENTORY_ROWS_PER_STATEMENT,
} from './constants.js'
import { isValidDate, parseQty, parseClientId, text, chunk, jsonByteLength } from './validate.js'
import { sessionSnapshotStatement, readHistoryStamp } from './storeHandler.js'

const _now = () => new Date().toISOString()

/** 取込バッチID。client採番だが、形は server 側でも縛る。 */
export function parseBatchId(v) {
  const id = parseClientId(v)
  return id || null      // null（未指定）も undefined（不正）もここでは弾く
}

function _tooLarge(body) {
  return jsonByteLength(body) > MAX_PAYLOAD_BYTES
}

/**
 * (shop_code, importBatchId, date) から決まる sessionId。
 *
 * ランダムUUIDだと、応答を取りこぼした再送や同時に届いた2本が別セッションを作る。
 * 「先に SELECT して無ければ作る」だけでは、SELECT と INSERT の間の競合を塞げない。
 * 決定的に採番すれば、どちらの経路も同じ行の upsert に収束する。
 *
 * 形式は UUID v5 相当（SHA-256 の先頭16バイト + version/variant ビット）。
 * router の `/sessions/([0-9a-f-]{36})/lines` を通す必要があるため、UUIDの形を守る。
 */
export async function importSessionId(shopCode, batchId, date) {
  const seed  = `inventory-import|${shopCode}|${batchId}|${date}`
  const hash  = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seed))
  const bytes = new Uint8Array(hash).slice(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50      // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80      // RFC 4122 variant
  const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
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
 * 表示・分析用スナップショットを **検証済みの行から** 組み立てる。
 *
 * client が送ってきた snapshot は使わない。items を持たない snapshot を保存すると、
 * 一覧・カレンダーには出るのに詳細が空という R-001 と同じ見え方を、取込経路から
 * 新しく作れてしまう。ここで作る形は `buildSnapshotFromLines()`（App 側の復元）と
 * 同じ項目にそろえてある。
 */
function _canonicalSnapshot({ sessionId, date, rows, totalValue, batch, now }) {
  return {
    date,
    sessionId,
    savedAt:      `${date}T00:00:00.000Z`,   // 実施日。取り込んだ日時ではない
    importedAt:   now,
    source:       'import',
    importBatchId: batch,
    items: rows.map(r => ({
      item:      r.item,
      qty:       r.qty,
      unit:      r.unit ?? '',
      unitPrice: r.price,
      subtotal:  r.value,
      code:      '',
      flagged:   false,
      category:  null,
      lotSize:   '',
      prevMonth: '',
      tagA:      '',
      tagB:      '',
    })),
    itemCount:    rows.length,
    totalValue,
    entryLog:     [],
    participants: null,
    flaggedItems: [],
    auditLog:     [],
    activeMs:     null,
    axisNames:    ['', ''],
    // 端末に実体が無い記録なので訂正させない（復元スナップショットと同じ扱い）。
    locked:       true,
  }
}

/**
 * 上書き指定を検証する。1件でも条件を外れたら**全体を拒否**し、何も消さない。
 *
 * 許可するのは「同じ店舗・同じ日付・completed・stock」だけ。
 * 進行中（active）を消すと入力中の棚卸が消え、order セッションを消すと発注記録が消え、
 * 別日を消すと画面に出ていない日の棚卸が黙って消える。
 */
async function _validateReplaceTargets(db, code, ids, date) {
  if (ids.length === 0) return { ids: [] }

  const placeholders = ids.map(() => '?').join(',')
  const found = await db.prepare(`
    SELECT id, status, type, started_at FROM sessions
    WHERE shop_code = ? AND id IN (${placeholders})
  `).bind(code, ...ids).all()

  const byId = new Map((found.results ?? []).map(r => [r.id, r]))
  for (const id of ids) {
    const row = byId.get(id)
    // 他店舗のIDと存在しないIDは同じ扱い。実在するかを別店舗へ漏らさない。
    if (!row) {
      return { error: _replaceDenied(id, 'not_found', '上書き対象の棚卸が見つかりません') }
    }
    if ((row.started_at ?? '').slice(0, 10) !== date) {
      return { error: _replaceDenied(id, 'date_mismatch', '別の日付の棚卸は上書きできません') }
    }
    if (row.status !== 'completed') {
      return { error: _replaceDenied(id, 'not_completed', '進行中の棚卸は上書きできません') }
    }
    if ((row.type ?? 'stock') !== 'stock') {
      return { error: _replaceDenied(id, 'not_stock', '棚卸以外の記録は上書きできません') }
    }
  }
  return { ids }
}

function _replaceDenied(sessionId, reason, message) {
  return { _status: 409, code: 'replace_not_allowed', reason, sessionId, error: message }
}

/**
 * POST /store/:code/imports/:batchId/sessions
 * body: { date, items[], replaceSessionIds?[] }
 *
 * @returns { ok, sessionId, date, itemCount, totalValue, importBatchId, replaced,
 *            snapshotSaved, serverRevision, serverSavedAt }
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
  if (!Array.isArray(replaceSessionIds) || replaceSessionIds.length > MAX_REPLACE_SESSIONS) {
    return { _status: 400, code: 'invalid_replace', error: '上書き対象の指定が不正です' }
  }
  const replaceIds = []
  for (const id of replaceSessionIds) {
    const parsed = parseClientId(id)
    if (!parsed) return { _status: 400, code: 'invalid_replace', error: '上書き対象の指定が不正です' }
    if (!replaceIds.includes(parsed)) replaceIds.push(parsed)
  }
  // snapshot は受け取っても保存しない（server 側で組み立てる）。
  // 形だけは従来どおり検証して、client の思い違いを黙って通さない。
  if (snapshot != null && (typeof snapshot !== 'object' || Array.isArray(snapshot))) {
    return { _status: 400, code: 'invalid_snapshot', error: 'スナップショットの形式が不正です' }
  }

  const built = _buildRows(items)
  if (built.error) return built.error
  const { rows, totalValue } = built
  if (rows.length === 0) {
    return { _status: 400, code: 'no_lines', error: '取り込める明細がありません' }
  }

  const replaceCheck = await _validateReplaceTargets(db, code, replaceIds, date)
  if (replaceCheck.error) return replaceCheck.error

  // 冪等: 同じバッチ・同じ日付のセッションが既にあれば、それを貼り直す（増やさない）。
  // 見つからない場合は決定的IDを使うので、SELECT と INSERT の間に別リクエストが
  // 割り込んでも同じ行へ収束する。
  const existing = await db.prepare(`
    SELECT id FROM sessions
    WHERE shop_code = ? AND import_batch_id = ? AND date(started_at) = ?
    ORDER BY started_at LIMIT 1
  `).bind(code, batch, date).first()

  const sessionId = existing?.id ?? await importSessionId(code, batch, date)
  const startedAt = `${date}T00:00:00.000Z`
  const now       = _now()

  const statements = []

  // 1) ユーザーが明示的に「上書き」を選んだセッションだけを消す。
  //    件数によらず3文へ集約する。1件3文だと50件で150文になり、D1 の
  //    「Queries per Worker invocation」（Free 50）を1リクエストで超える。
  //    shop_code で必ず絞るので、他店舗のIDを渡されても何も消えない。
  if (replaceIds.length > 0) {
    const ph = replaceIds.map(() => '?').join(',')
    statements.push(
      db.prepare(`DELETE FROM inventory_lines WHERE shop_code = ? AND session_id IN (${ph})`)
        .bind(code, ...replaceIds),
      db.prepare(`DELETE FROM store_history   WHERE shop_code = ? AND session_id IN (${ph})`)
        .bind(code, ...replaceIds),
      db.prepare(`DELETE FROM sessions        WHERE shop_code = ? AND id IN (${ph})`)
        .bind(code, ...replaceIds),
    )
  }

  // 2) セッション本体（完了済みとして作る）。再送では同じ行を上書きする。
  //    upsert に WHERE を付けて、万一 id が別店舗のものと衝突した場合に
  //    他店の session を書き換えないようにする（orders / movements と同じ形）。
  const sessionStmtIndex = statements.length
  statements.push(db.prepare(`
    INSERT INTO sessions (id, shop_code, started_at, ended_at, status, item_count, total_value, type, import_batch_id)
    VALUES (?, ?, ?, ?, 'completed', ?, ?, 'stock', ?)
    ON CONFLICT(id) DO UPDATE SET
      ended_at = excluded.ended_at, status = 'completed',
      item_count = excluded.item_count, total_value = excluded.total_value,
      import_batch_id = excluded.import_batch_id
    WHERE sessions.shop_code = excluded.shop_code
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

  // 4) 表示・分析用スナップショット。server が組み立てた canonical 版だけを保存する。
  //    sessions を参照する INSERT ... SELECT なので、2) が何らかの理由で行を作れなかった
  //    場合に snapshot だけが残ることはない。
  statements.push(sessionSnapshotStatement(
    db, code, sessionId,
    _canonicalSnapshot({ sessionId, date, rows, totalValue, batch, now }),
    now,
  ))

  let results
  try {
    results = await db.batch(statements)
  } catch (e) {
    console.error('[pastImport] create batch failed:', code, batch, date, e?.message ?? e)
    return { _status: 503, code: 'import_failed', retryable: true, error: '取込を保存できませんでした' }
  }

  // session が書けていなければ明細も snapshot も存在条件で弾かれている。
  // 「取り込めた」と返さず、client が状況を出せる形で返す。
  if (results?.[sessionStmtIndex]?.meta?.changes !== 1) {
    return { _status: 409, code: 'import_conflict', error: '取込を保存できませんでした' }
  }

  const stamp = await readHistoryStamp(db, code, { sessionId })
  return {
    ok: true, sessionId, date,
    itemCount: rows.length, totalValue,
    importBatchId: batch,
    replaced: replaceIds.length,
    snapshotSaved: true,
    ...stamp,
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
