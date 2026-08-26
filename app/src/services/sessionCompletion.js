/**
 * 棚卸／発注セッションの完了要求を組み立てる（DATA-001 / App第2セッション §2）
 *
 * ## 背景
 *
 * 完了処理は本番経路が3つある — 完了ボタン、完了済みセッションでホームへ戻る、
 * ホストからの `session_ended` 受信。以前はこの3つがそれぞれ別の形で
 * `completeSessionD1()` を呼んでおり、うち2つは **snapshot を付けずに**呼んでいた。
 *
 * ## 第1修正セッションが確定した契約（DATA-002 §1 / `docs/api-design.md` §3.1）
 *
 * `POST /store/:code/sessions/:id/complete` の契約は **`sessions.type` で分かれる**。
 *
 * | | stock | order |
 * |---|---|---|
 * | body | `{ inventory, prices, takenAt, snapshot }` | `{ itemCount }` **だけ** |
 * | snapshot | 必須（無ければ `400 snapshot_required`） | 送ると `400 snapshot_not_allowed` |
 * | inventory | 明細0件は `400 empty_inventory` | 非空は `400 snapshot_not_allowed` |
 * | 日付 | `takenAt` と `snapshot.date` の不一致は `400 snapshot_date_mismatch` | — |
 * | 保存先 | `sessions` / `inventory_lines` / `store_history` | `sessions` のみ |
 *
 * 発注の正本は `orders` / `order_lines` で、完了一覧も `type === 'order'` を除外している。
 * 架空の marker snapshot を作ると、履歴・カレンダー・分析に発注が棚卸として現れる。
 * **在庫を入力していても発注セッションでは snapshot も inventory も送らない。**
 *
 * ## server の検証を先取りする
 *
 * server は `qty` を持つ snapshot items の集合と `inventory` から作った明細行の集合が
 * 一致しなければ `400 snapshot_mismatch`（何も書かない）を返す。品目名は 200 文字で
 * 切られ、切り詰め後に重複した行は落ちる。送ってから 400 を受けるより、
 * 同じ判定を手前で行い、理由の分かるエラーにする。
 */

import { isSnapshotComplete } from '../utils/snapshotSync.js'

/** 完了要求の種別 */
export const COMPLETION_STOCK = 'stock'
export const COMPLETION_ORDER = 'order'

// server 側と同じ正規化・上限（worker/src/constants.js・validate.js の text()）。
// **値をずらすと、App が「正常」と判断した payload を server が 400/413 で落とす。**
// MAX_LINES_PER_REQUEST は D1 の statement 予算から逆算された 500（旧 5,000 ではない）。
const MAX_INGREDIENT_LEN    = 200
const MAX_LINES_PER_REQUEST = 500    // 明細行（inventory）・発注件数の上限
const MAX_SNAPSHOT_ITEMS    = 2000   // 未入力ぶんを含む表示用 items の上限

/** server の `text(v, MAX_INGREDIENT_LEN)` と同じ正規化 */
function _normName(v) {
  if (v == null) return ''
  return String(v).trim().slice(0, MAX_INGREDIENT_LEN)
}

/**
 * 送信用に内容を固定する（deep clone）。
 *
 * `{ ...inventory }` は外側だけの浅いコピーで、entry オブジェクトは元の在庫と共有される。
 * `updateQty()` は entry を直接書き換えるため、**組み立て済みの完了要求まで後から変わる**。
 * snapshot 側は値のコピーなので変わらず、再送時に server の
 * `400 snapshot_mismatch` や `409 completion_intent_conflict` を招く。
 *
 * 中身は JSON へ入る値（文字列・数値・真偽・null・配列・平objects）だけなので
 * JSON 経由で複製する。`undefined` の鍵は落ちるが、送信時に落ちるのと同じ。
 */
/**
 * 完了要求のバイト上限。server の MAX_PAYLOAD_BYTES（1MB）より小さく取る。
 * 超えた要求は 413 で**完了そのものが失敗**し、ユーザーには「保存できなかった」しか残らない。
 */
export const MAX_COMPLETION_BYTES = 900_000

function _byteLength(value) {
  try { return new TextEncoder().encode(JSON.stringify(value)).length } catch (_) { return 0 }
}

/**
 * 上限に収まるよう、変更履歴を**古い方から**落とす。落とした件数を返す。
 *
 * 落とす対象を変更履歴に限るのは、数量・参加者別・品目一覧が欠けると
 * 棚卸の結果そのものが保存できなくなるため。変更履歴は「訂正の経緯」なので、
 * 古い方から失われても結果は残る。
 * 1件ずつ測り直すと大きなログで測定回数が跳ねるので、8分の1ずつ落として測り直す。
 */
export function fitCompletionBody(body, limit = MAX_COMPLETION_BYTES) {
  const log = body?.snapshot?.auditLog
  if (!Array.isArray(log) || log.length === 0) return 0
  let dropped = 0
  while (log.length > 0 && _byteLength(body) > limit) {
    const cut = Math.max(1, Math.ceil(log.length / 8))
    log.splice(0, cut)
    dropped += cut
  }
  return dropped
}

function _freeze(value) {
  if (value == null) return value
  try {
    return JSON.parse(JSON.stringify(value))
  } catch (_) {
    return null
  }
}

function _isValidDate(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const d = new Date(`${v}T00:00:00Z`)
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v
}

/**
 * `inventory` の品目名を server と同じ規則で正規化する。
 * 切り詰め後に衝突すると server 側の明細行が1件減り、snapshot と食い違う。
 */
function _normalizedInventoryNames(inventory) {
  const names = new Set()
  const collided = []
  for (const raw of Object.keys(inventory ?? {})) {
    const name = _normName(raw)
    if (!name) continue
    if (names.has(name)) { collided.push(name); continue }
    names.add(name)
  }
  return { names, collided }
}

/**
 * 完了要求を組み立てる。**組み立てられない場合は API を呼ばせない。**
 *
 * @param {object} arg
 * @param {string} arg.sessionType 'stock' | 'order'（`sessions.type` が正）
 * @param {object} arg.snapshot    buildSnapshot() の戻り値（stock のみ使用）
 * @param {object} arg.inventory   完了時点の在庫（stock のみ使用）
 * @param {object} arg.prices      単価（stock のみ使用）
 * @param {number} arg.orderCount  発注行の件数（order のみ使用）
 * @returns {{ ok: true, type: string, body: object, snapshot: object|null }
 *          | { ok: false, reason: string }}
 */
export function buildCompletionRequest({
  sessionType = 'stock', snapshot = null, inventory = {}, prices = {}, orderCount = 0,
} = {}) {
  if (sessionType === 'order') return _orderRequest(orderCount)
  return _stockRequest({ snapshot, inventory, prices })
}

// ── order ────────────────────────────────────────────────────────────────────
// 送るのは件数だけ。発注明細は `POST /store/:code/orders` が別経路で冪等に書く。
function _orderRequest(orderCount) {
  const n = Number(orderCount)
  if (!Number.isFinite(n) || n < 0 || n > MAX_LINES_PER_REQUEST || !Number.isInteger(n)) {
    return { ok: false, reason: 'invalid_order_count' }
  }
  return { ok: true, type: COMPLETION_ORDER, snapshot: null, body: { itemCount: n } }
}

// ── stock ────────────────────────────────────────────────────────────────────
function _stockRequest({ snapshot, inventory, prices }) {
  const hasInventory = Object.keys(inventory ?? {}).length > 0

  if (!isSnapshotComplete(snapshot)) {
    // 明細が無い完了は server が `400 empty_inventory` で拒否する。
    // 通らないと分かっている要求は投げない。
    return { ok: false, reason: hasInventory ? 'snapshot_build_failed' : 'no_inventory' }
  }
  // 明細を送るのに持ち主が分からない状態では送らない。server は sessionId を完了対象へ
  // 揃えるが、端末側の履歴確定がキー無しになり詳細を開けなくなる。
  if (!snapshot.sessionId) return { ok: false, reason: 'snapshot_without_session' }
  if (!hasInventory) return { ok: false, reason: 'snapshot_mismatch' }

  // 棚卸日は **takenAt ひとつ**で決まる。snapshot.date と必ず同じ値を送る
  // （不一致は server 400 snapshot_date_mismatch）。
  const takenAt = snapshot.date
  if (!_isValidDate(takenAt)) return { ok: false, reason: 'invalid_date' }

  // server と同じ上限で手前に落とす。超過分を送っても 413/400 になるだけで、
  // ユーザーには「保存できなかった」しか残らない。
  if (Object.keys(inventory).length > MAX_LINES_PER_REQUEST) {
    return { ok: false, reason: 'too_many_items', limit: MAX_LINES_PER_REQUEST }
  }
  if (snapshot.items.length > MAX_SNAPSHOT_ITEMS) {
    return { ok: false, reason: 'snapshot_too_large', limit: MAX_SNAPSHOT_ITEMS }
  }

  const { names, collided } = _normalizedInventoryNames(inventory)
  if (collided.length > 0) return { ok: false, reason: 'duplicate_item_name', item: collided[0] }

  // qty を持つ items の集合 == 明細行の集合（server の snapshot_mismatch と同じ判定）
  const claimed = new Set()
  for (const it of snapshot.items) {
    const name = _normName(it?.item)
    if (!name || it?.qty == null) continue      // 未入力は表示用にそのまま残る
    if (!names.has(name)) return { ok: false, reason: 'snapshot_mismatch', item: name }
    claimed.add(name)
  }
  if (claimed.size !== names.size) return { ok: false, reason: 'snapshot_mismatch' }

  // ここで内容を固定する。以降の入力・訂正はこの要求へ影響しない。
  const body = {
    inventory: _freeze(inventory) ?? {},
    prices:    _freeze(prices ?? {}) ?? {},
    takenAt,
    snapshot:  _freeze(snapshot),
  }
  if (!body.snapshot) return { ok: false, reason: 'snapshot_build_failed' }

  // 品目数が多い店舗では items / inventory だけで数百KBになる。変更履歴を丸ごと載せると
  // 1MB を超えて 413 になり、棚卸の完了そのものが失敗する。収まらない分は
  // 変更履歴の古い方だけを落とす（結果は残す）。落ちた件数は呼び出し側へ返して知らせる。
  const droppedAuditEntries = fitCompletionBody(body)

  // 端末の履歴確定にも**送ったのと同じ版**を使う（表示とサーバー内容をずらさない）。
  return { ok: true, type: COMPLETION_STOCK, snapshot: body.snapshot, body, droppedAuditEntries }
}

const _MESSAGES = {
  no_inventory:             '入力された明細がないため完了できません。1件以上入力してから完了してください',
  snapshot_build_failed:    '棚卸の明細を組み立てられませんでした。入力内容を確認してもう一度お試しください',
  snapshot_without_session: 'セッション情報が見つからないため完了できません。一覧へ戻ってからやり直してください',
  snapshot_mismatch:        '入力内容と棚卸の明細が一致しません。画面を開き直してからもう一度完了してください',
  duplicate_item_name:      '品目名が長すぎて重複しています。品目名を短くしてからもう一度完了してください',
  invalid_date:             '棚卸日を確定できませんでした。日付を確認してもう一度お試しください',
  invalid_order_count:      '発注件数を確定できませんでした。入力内容を確認してもう一度お試しください',
  too_many_items:           `1回に保存できる品目数（${MAX_LINES_PER_REQUEST}件）を超えています。品目を減らすか、分けて棚卸してください`,
  snapshot_too_large:       `表示する品目数（${MAX_SNAPSHOT_ITEMS}件）が多すぎます。使っていない品目を非表示にしてからお試しください`,
}

/** 組み立てに失敗した理由をユーザーへ説明する文言 */
export function completionErrorMessage(reason) {
  return _MESSAGES[reason] ?? '完了要求を作成できませんでした。入力内容を確認してもう一度お試しください'
}
