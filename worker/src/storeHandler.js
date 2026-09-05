// ── 店舗コード方式 データ永続化 API（Cloudflare D1）────────────────────────────

import { inventoryLineStatements } from './inventoryLines.js'
import { _now, genUniqueShopCode } from './workerUtils.js'
import {
  MAX_PAYLOAD_BYTES, RESULT_WINDOW_DAYS, MAX_SESSION_LINES, MAX_LINES_PER_REQUEST,
  MAX_INGREDIENT_LEN, MAX_UNIT_LEN, MAX_NOTE_LEN, MAX_SUPPLIER_LEN,
  MAX_ORDER_QTY, MAX_MOVEMENT_QTY, MAX_INVENTORY_QTY, MAX_UNIT_PRICE,
  MAX_ID_LEN, MAX_DEVICE_NAME_LEN, MAX_DEVICE_ID_LEN,
  MAX_SNAPSHOT_ITEMS, MAX_SNAPSHOT_LOG_ENTRIES, MAX_SNAPSHOT_PARTICIPANTS, MAX_ENTRY_AT_MS,
  AUDIT_ROWS_PER_STATEMENT, MAX_AUDIT_PER_REQUEST,
  ORDER_ROWS_PER_STATEMENT, MOVEMENT_ROWS_PER_STATEMENT,
} from './constants.js'
import {
  parseClientId, parseDate, parseQty, parseOptionalNumber, parseEnum, parseCount,
  text, chunk, valueRows, isValidDate, jsonByteLength,
} from './validate.js'
import { entitlement } from './entitlements.js'

/**
 * 検証環境だけ、サーバー側エラーの要約を応答へ載せるためのスイッチ（`DEBUG_ERRORS`）。
 *
 * スマホ（とくにPWA）は DevTools が使えず Worker のログも見られないため、
 * 利用者からは「503 でした」までしか分からず切り分けが止まる。
 * **本番では立てない**（DBのエラー文面はスキーマの手掛かりを含む）。
 * 値は deploy ごとに固定なので、isolate をまたいで持ち回っても取り違えない。
 */
let _debugErrors = false
export function setDebugErrors(on) { _debugErrors = !!on }

/** 失敗応答へ足す原因の要約。無効なら undefined（応答に鍵ごと出さない） */
function _errDetail(e) {
  if (!_debugErrors) return undefined
  return String(e?.message ?? e).slice(0, 200)
}

/**
 * `too many terms in compound SELECT` の切り分け用プローブ（検証環境のみ・**読み取りだけ**）。
 *
 * **2026-08-28 に Pro Review の実D1で計測済み**:
 *
 *     s19=NG  b10=NG  v500=ok  v1000=ok
 *
 * = compound SELECT の上限は SQLite 既定の 500 ではなく **19 未満**まで絞られている。
 * 一方で複数行 VALUES は 1000 行でも通る（SQLite は VALUES を項数制限から外す）。
 * この結果を受けて、明細のまとめ書きは全経路 VALUES 形式へ移した
 * （validate.js の valueRows / test/compoundSelectFree.sqlite.test.js）。
 *
 * 残してあるのは、同じエラーがまた出たときに「上限がさらに変わったのか、
 * 別の文が原因なのか」を現地で1往復で切り分けるため。手元の実SQLiteは既定の
 * 500 で動くので、**実際のD1に聞く**しかない。
 *
 * テーブルには一切触らない定数だけの SELECT なので、失敗した完了要求の後に
 * 実行しても書き込みへ影響しない（再実行による部分適用が起きない）。
 * 消費するクエリ本数は 5 + 10 + 27 + 2 = 44 で、Free の 50/invocation にも収まる。
 */
function _compoundSelect(db, terms) {
  return db.prepare(Array.from({ length: terms }, (_, i) => `SELECT ${i} AS n`).join(' UNION ALL '))
}

async function _probeCompound(db) {
  const out = []
  try {
    // ① 1文あたりの上限（既定は 500）
    for (const n of [19, 100, 250, 500, 501]) {
      try { await _compoundSelect(db, n).all(); out.push(`s${n}=ok`) }
      catch { out.push(`s${n}=NG`); break }
    }
    // ② batch 全体で累計されているか（19項 × k文）
    for (const k of [10, 27]) {
      try { await db.batch(Array.from({ length: k }, () => _compoundSelect(db, 19))); out.push(`b${k}=ok`) }
      catch { out.push(`b${k}=NG`); break }
    }
    // ③ 代替案（VALUES 形式）が同じ上限を持つか
    for (const n of [500, 1000]) {
      const rows = Array.from({ length: n }, () => '(1)').join(',')
      try { await db.prepare(`SELECT count(*) AS c FROM (VALUES ${rows})`).all(); out.push(`v${n}=ok`) }
      catch { out.push(`v${n}=NG`); break }
    }
  } catch (e) {
    out.push(`probe_error=${String(e?.message ?? e).slice(0, 60)}`)
  }
  return out.join(' ')
}

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
export function sessionSnapshotStatement(db, code, sessionId, snapshot, now, { claim = null } = {}) {
  const date = snapshot?.date || now.slice(0, 10)
  const json = JSON.stringify({ ...snapshot, sessionId, date })
  // claim を渡すと「**この要求が勝者である**ことを示す claim 行が存在する場合だけ」という
  // 条件が加わる（DATA-002 §3 / §4）。claim は同じ batch の先頭で、server が作った
  // fingerprint とともに排他的に INSERT される。
  //
  // 旧実装は `s.ended_at = <この要求の時刻>` を所有権 marker にしていたが、
  // ミリ秒精度の時刻は排他的 token にならない。同じミリ秒の別要求が同じ marker を
  // 満たしてしまい、409 を返した側の snapshot だけが残りうる。
  const claimSql   = claim ? ` AND ${claim.sql}` : ''
  const claimBinds = claim ? claim.binds : []
  return db.prepare(`
    INSERT INTO store_history (shop_code, session_id, snapshot_date, snapshot_json, created_at, updated_at, revision)
    SELECT s.shop_code, s.id, ?, ?, ?, ?, ${_NEXT_REVISION}
    FROM sessions s
    WHERE s.id = ? AND s.shop_code = ? AND s.deleted_at IS NULL${claimSql}
    ON CONFLICT(shop_code, session_id) WHERE session_id IS NOT NULL DO UPDATE
      SET snapshot_json = excluded.snapshot_json, snapshot_date = excluded.snapshot_date,
          updated_at = excluded.updated_at, revision = excluded.revision
  `).bind(date, json, now, now, code, sessionId, code, ...claimBinds)
}

/**
 * 「この要求が勝者である」ことを表す claim 条件（SQL 断片）。
 *
 * 完了は `session_completions`（migration 0016）、過去取込は `import_batch_requests`
 * （migration 0015）を claim table として使う。どちらも
 * **PRIMARY KEY で排他的**、かつ **server が作った fingerprint を持つ**。
 * 相関副問い合わせにして、shop_code / session_id は外側の `sessions s` から取る
 * （bound parameter を fingerprint の1個だけに抑えるため）。
 */
export function completionClaimGuard(fingerprint) {
  return {
    sql: `EXISTS (SELECT 1 FROM session_completions c
                   WHERE c.shop_code = s.shop_code AND c.session_id = s.id AND c.fingerprint = ?)`,
    binds: [fingerprint],
  }
}

/** 同上（非相関版）。`sessions s` を持たない文の WHERE へ埋める。 */
export function completionClaimExists(code, sessionId, fingerprint) {
  return {
    sql: `EXISTS (SELECT 1 FROM session_completions c
                   WHERE c.shop_code = ? AND c.session_id = ? AND c.fingerprint = ?)`,
    binds: [code, sessionId, fingerprint],
  }
}

/**
 * 保存した行の revision / 保存時刻を読み戻す **文** を返す（実行しない）。
 *
 * この SELECT は必ず **書き込みと同じ `db.batch()`** に載せる（DATA-002 §5）。
 * 以前は batch の後に独立した SELECT を撃っていたため、その隙間に別リクエストが
 * 同じ店舗の履歴を保存すると、**別要求が確定させた revision を自分の応答として返して**
 * いた。client はそれを「自分の版はサーバーに載った」と解釈し、実際には載っていない
 * 版を未送信キューから捨てる。
 *
 * D1 の batch は1トランザクションで、statement は順に実行・commit される
 * （2026-08-16 に公式資料で確認）。同じ batch の後方に置いた SELECT は、
 * 直前の自分の write を必ず見る。batch が落ちれば読み戻しごと巻き戻る。
 */
export function historyStampStatement(db, code, { sessionId = null, date = null } = {}) {
  return sessionId
    ? db.prepare(
        'SELECT revision, updated_at, created_at FROM store_history WHERE shop_code = ? AND session_id = ?'
      ).bind(code, sessionId)
    : db.prepare(
        'SELECT revision, updated_at, created_at FROM store_history WHERE shop_code = ? AND snapshot_date = ? AND session_id IS NULL'
      ).bind(code, date)
}

/**
 * `historyStampStatement` の結果（D1Result）から revision / 保存時刻を取り出す。
 * 行が無い＝書き込みが成立していないので、`serverRevision: null` で成功させず
 * 呼び出し側が retryable なエラーへ倒す。
 */
export function readStampResult(result) {
  const row = result?.results?.[0]
  if (!row) return null
  return { serverRevision: row.revision ?? 0, serverSavedAt: row.updated_at ?? row.created_at ?? null }
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

  // 保存と revision の読み戻しを同じ batch（=1トランザクション）へ入れる（§5）。
  let results
  try {
    results = await db.batch([
      historySnapshotStatement(db, code, body, now),
      historyStampStatement(db, code, { sessionId, date }),
    ])
  } catch (e) {
    console.error('[storeHandler] history save batch failed:', code, e?.message ?? e)
    return { _status: 503, code: 'history_save_failed', retryable: true, error: '保存できませんでした' }
  }

  const stamp = readStampResult(results?.[1])
  if (!stamp) {
    // 書けていれば必ず読める。読めない＝保存が成立していないので成功にしない。
    console.error('[storeHandler] history revision missing after write:', code, sessionId ?? date)
    return { _status: 503, code: 'history_save_failed', retryable: true, error: '保存を確認できませんでした' }
  }
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
    if (isDate) {
      const res = await db.prepare(
        'DELETE FROM store_history WHERE shop_code = ? AND snapshot_date = ? AND session_id IS NULL'
      ).bind(code, key).run()
      return { ok: true, removed: res?.meta?.changes ?? 0 }
    }
    // sessionId 指定のときは取込台帳（0015）も同じトランザクションで消す
    // （DATA-002 再レビュー §5）。残すと、snapshot が無いのに replay が
    // `snapshotSaved: true` を返す「保存済みだと嘘をつく」状態になる。
    // 台帳が消えることで、同じ batchId + 日付での取り込み直しもできる。
    const results = await db.batch([
      db.prepare('DELETE FROM store_history          WHERE shop_code = ? AND session_id = ?').bind(code, sessionId),
      db.prepare('DELETE FROM import_batch_requests  WHERE shop_code = ? AND session_id = ?').bind(code, sessionId),
      db.prepare('DELETE FROM session_audit          WHERE shop_code = ? AND session_id = ?').bind(code, sessionId),
    ])
    return { ok: true, removed: results?.[0]?.meta?.changes ?? 0 }
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
    // at = その品目を入力した時刻。金額ではないのでゲストにも出す（「誰が何をいつ」の“いつ”）
    items: (p.items ?? []).map(it => ({ item: it.item, qty: it.qty ?? null, unit: it.unit ?? '', at: it.at ?? null })),
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

  // **該当の1件だけを引く**。以前は直近50件を読んで全部 JSON.parse し、その中から
  // sessionId で探していた。500品目のスナップショットは 200KB 前後あるので、
  // 1リクエストで最大10MB を parse することになる。ここは**無認証**で、成功した要求は
  // レート制限に数えない（recordIpFail は 400/404 のときだけ）ため、有効なリンクを1本
  // 持っているだけで Worker のCPUを好きなだけ使わせられた。
  // (shop_code, session_id) には UNIQUE index がある（migration 0012）ので直接引ける。
  const row = await db.prepare(
    'SELECT snapshot_json FROM store_history WHERE shop_code = ? AND session_id = ?'
  ).bind(code, sessionId).first()
  if (!row) return { _status: 404, error: 'この棚卸は閲覧できません' }

  let target = null
  try { target = JSON.parse(row.snapshot_json) } catch (_) { target = null }
  if (!target) return { _status: 404, error: 'この棚卸は閲覧できません' }

  const targetTs = _snapTs(target)

  // 期間チェックは **完了からの経過時間だけ**（RESULT_WINDOW_DAYS 日以内）。
  //
  // 以前は「より新しい完了スナップショットがあれば失効」も見ていたが、これを外した。
  // 同じ日に**やり直し**（棚卸を取り直す・複数回完了する）ことは普通にあり、その場合
  // 配ったばかりのリンクが即座に死ぬ。共有した側からは理由が分からず、
  // 「リンクが壊れている」としか見えない。閲覧の範囲は時間だけで決める。
  //
  // 個々のリンクは sessionId（UUID）を知っている相手にしか開けないので、
  // 古いリンクが生き続けても、その1回ぶんの結果が見えるだけで範囲は広がらない。
  if (!targetTs || Date.now() - targetTs > RESULT_WINDOW_DAYS * 86400_000) {
    return { _status: 410, error: '閲覧期間が終了しました' }
  }

  return { result: _sanitizeForGuest(target) }
}

// ── セッション API ─────────────────────────────────────────────────────────────

// GET /store/:code/sessions
export async function handleSessionsGet(db, code) {
  const rows = await db.prepare(`
    SELECT id, shop_code, started_at, ended_at, status, item_count, type, import_batch_id
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
    // 取込で作ったセッションだけが値を持つ。ended_at は「取り込んだ時刻」なので、
    // 履歴カレンダーはこれを見て started_at（実施日）のマスへ載せる。
    importBatchId: r.import_batch_id ?? null,
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
//
// セッションに属するものを**1 batch（=1トランザクション）でまとめて消す**
// （DATA-002 再レビュー §5）。旧実装は `sessions` の行だけを消しており、
//   - `inventory_lines` / `store_history` が孤児として残る（F-004）
//   - 取込台帳（0015）が残り、削除済みの取込を replay が「保存済み」と誤回答する
//   - 完了 claim（0016）が残り、同じセッションIDでの再完了を塞ぎ続ける
// という状態を作っていた。全 SQL を `shop_code` で絞るので他店舗には触れない。
export async function handleSessionDelete(db, code, sessionId) {
  try {
    await db.batch([
      db.prepare('DELETE FROM inventory_lines      WHERE session_id = ? AND shop_code = ?').bind(sessionId, code),
      db.prepare('DELETE FROM store_history        WHERE session_id = ? AND shop_code = ?').bind(sessionId, code),
      db.prepare('DELETE FROM import_batch_requests WHERE session_id = ? AND shop_code = ?').bind(sessionId, code),
      db.prepare('DELETE FROM session_completions  WHERE session_id = ? AND shop_code = ?').bind(sessionId, code),
      // 操作ログ（0017）。セッションを消したら「誰が何を変えたか」も残さない
      db.prepare('DELETE FROM session_audit        WHERE session_id = ? AND shop_code = ?').bind(sessionId, code),
      db.prepare('DELETE FROM sessions             WHERE id = ? AND shop_code = ?').bind(sessionId, code),
    ])
  } catch (e) {
    // 途中で落ちれば batch ごと巻き戻る。一部だけ消えた状態を成功として返さない。
    console.error('[storeHandler] session delete batch failed:', code, sessionId, e?.message ?? e)
    return { _status: 503, code: 'session_delete_failed', retryable: true, error: '削除できませんでした' }
  }
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
//
// **completed からは戻さない**（DATA-002 §1 / 状態遷移）。
// 完了要求の応答を取りこぼした端末は、保留していた `touch()`（active の遅延保存）を
// そのまま送ってくる。旧実装はそれを無条件に適用し、`status='active'`、`ended_at=NULL`、
// `item_count=<入力途中の件数>` で完了済みセッションを上書きしていた。
// `inventory_lines` と `store_history` は残るのに一覧だけが「進行中」へ戻るため、
// 完了済みの詳細に到達できなくなる（R-001 と同じ見え方）。
//
// 判定は UPDATE 文の WHERE 自身が持つ（単一文＝原子的）。後続の SELECT は
// 404 と 409 を区別してメッセージを出すためだけに使い、権限判定には使わない。
export async function handleSessionUpdate(db, code, sessionId, body) {
  const status = parseEnum(body?.status, ['active', 'completed', 'incomplete'])
  if (!status) return { _status: 400, code: 'invalid_status', error: '無効なステータスです' }

  // 旧実装は数値以外を黙って 0 にしていた。'12' や NaN を 0 として保存すると
  // 一覧の品目数が実際と食い違う（詳細を開くまで気づけない）。
  const itemCount = parseCount(body?.itemCount, MAX_LINES_PER_REQUEST)
  if (itemCount === undefined) return { _status: 400, code: 'invalid_count', error: '品目数が不正です' }

  // ── completed への遷移はこのAPIでは行わない（DATA-002 再レビュー §1）────────
  // 汎用PUTで completed にできると、`inventory_lines` も `store_history` も持たない
  // completed session を作れてしまう（＝一覧には出るのに詳細が空。R-001 そのもの）。
  // 完了は必ず `POST /sessions/:id/complete` を通す。ここでは**一切書き込まない**。
  if (status === 'completed') {
    const row = await db.prepare('SELECT status FROM sessions WHERE id = ? AND shop_code = ?')
      .bind(sessionId, code).first()
    if (!row) return { _status: 404, code: 'session_not_found', error: 'セッションが見つかりません' }
    // 既に completed への再送は、何も変更せず冪等成功とする。
    if (row.status === 'completed') return { ok: true }
    return {
      _status: 409, code: 'use_complete_endpoint', retryable: false,
      error: '棚卸の完了は完了APIから行ってください',
    }
  }

  const now = _now()

  // active / incomplete への遷移。completed からは戻さない（判定は WHERE 自身が持つ＝原子的）。
  // 完了応答を取りこぼした端末は保留していた `touch()` をそのまま送ってくるため、
  // 旧実装はそれを適用して完了済みセッションを進行中へ巻き戻していた。
  const res = await db.prepare(`
    UPDATE sessions SET status = ?, ended_at = ?, item_count = ?
    WHERE id = ? AND shop_code = ? AND status <> 'completed'
  `).bind(status, status === 'active' ? null : now, itemCount, sessionId, code).run()

  if (res?.meta?.changes === 1) return { ok: true }

  const row = await db.prepare('SELECT status FROM sessions WHERE id = ? AND shop_code = ?')
    .bind(sessionId, code).first()
  // 他店舗のIDと存在しないIDは同じ404（IDの存在有無を漏らさない）。
  if (!row) return { _status: 404, code: 'session_not_found', error: 'セッションが見つかりません' }
  return {
    _status: 409, code: 'session_completed', retryable: false,
    error: '完了済みの棚卸は進行中に戻せません',
  }
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
    const { sql: values, col } = valueRows(group.length,
      ['item', 'qty', 'unit', 'stock', 'lot', 'post_stock', 'excluded'])
    // bind はSQL文中の ? の出現順。SELECTリストの2個（order_date, created_at）が先、
    // 次にFROM内の VALUES、最後にWHEREの2個。
    const binds = [date, now]
    for (const l of group) binds.push(l.item, l.qty, l.unit, l.stock, l.lot, l.postStock, l.excluded)
    binds.push(orderId, code)
    return db.prepare(`
      INSERT INTO order_lines (order_id, shop_code, order_date, item, qty, unit, stock, lot, post_stock, excluded, created_at)
      SELECT o.id, o.shop_code, ?, ${col.item}, ${col.qty}, ${col.unit}, ${col.stock}, ${col.lot}, ${col.post_stock}, ${col.excluded}, ?
      FROM orders o, (VALUES ${values}) v
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
    const { sql: values, col } = valueRows(group.length, ['item', 'qty', 'unit'])
    const binds = [date, now]
    for (const l of group) binds.push(l.item, l.qty, l.unit)
    binds.push(moveId, code)
    return db.prepare(`
      INSERT INTO movement_lines (movement_id, shop_code, move_date, item, qty, unit, created_at)
      SELECT m.id, m.shop_code, ?, ${col.item}, ${col.qty}, ${col.unit}, ?
      FROM movements m, (VALUES ${values}) v
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

// ── 完了 snapshot の canonical 化（DATA-002 §1）────────────────────────────────

/**
 * client の snapshot から、保存してよい任意 metadata だけを取り出す。
 *
 * 主要項目（items / itemCount / totalValue / date / sessionId / type）はここでは扱わない。
 * それらは検証済みの inventory rows から server が組み立てる。
 * ここに無い鍵（`dirty` / `synced` / `serverRevision` など client 内部の状態や、
 * 未知の任意データ）は捨てる。件数と文字列長も上限で切る。
 */
// 監査エントリの時刻。epoch ms（数値）を第一に扱い、ISO 文字列も受ける。
function _auditTimestamp(v) {
  const n = parseOptionalNumber(v, { min: 0, max: MAX_ENTRY_AT_MS })
  if (typeof n === 'number') return n
  return text(v, 40)
}

function _snapshotMeta(snapshot) {
  const log = entries => (Array.isArray(entries) ? entries : [])
    .slice(0, MAX_SNAPSHOT_LOG_ENTRIES)
    .filter(e => e != null && typeof e === 'object' && !Array.isArray(e))
    .map(e => ({
      id:         text(e.id, MAX_ID_LEN),
      ingredient: text(e.ingredient, MAX_INGREDIENT_LEN),
      action:     text(e.action, 32),
      delta:      parseOptionalNumber(e.delta, { min: -MAX_INVENTORY_QTY, max: MAX_INVENTORY_QTY }) ?? null,
      totalQty:   parseOptionalNumber(e.totalQty, { min: -MAX_INVENTORY_QTY, max: MAX_INVENTORY_QTY }) ?? null,
      unit:       text(e.unit, MAX_UNIT_LEN),
      enteredBy:  text(e.enteredBy, MAX_DEVICE_NAME_LEN),
      // 誰が入れたかの識別子。同名端末の区別と、将来ログを D1 の行として持つときの
      // 集計キーになるので落とさない。
      enteredById: text(e.enteredById, MAX_DEVICE_ID_LEN),
      // client は epoch ms（数値）で送る。text() に通すと "1700000000000" という
      // 文字列になり、`new Date(...)` が Invalid Date になって時刻が表示できなくなる。
      // 数値として解釈できるものは数値で保存し、ISO 文字列だけ文字列で残す。
      timestamp:  _auditTimestamp(e.timestamp),
    }))

  const participants = Array.isArray(snapshot.participants)
    ? snapshot.participants
        .slice(0, MAX_SNAPSHOT_PARTICIPANTS)
        .filter(p => p != null && typeof p === 'object' && !Array.isArray(p))
        .map(p => ({
          name:  text(p.name, MAX_DEVICE_NAME_LEN),
          items: (Array.isArray(p.items) ? p.items : [])
            .slice(0, MAX_SNAPSHOT_ITEMS)
            .filter(it => it != null && typeof it === 'object')
            .map(it => ({
              item: text(it.item, MAX_INGREDIENT_LEN),
              qty:  parseOptionalNumber(it.qty, { min: -MAX_INVENTORY_QTY, max: MAX_INVENTORY_QTY }) ?? null,
              unit: text(it.unit, MAX_UNIT_LEN),
              // at = その品目を最後に入力した時刻（epoch ms）。参加者別の「いつ」に使う。
              // 端末時計なので順序の根拠にはしない（表示のみ）。範囲外・非数は null に落とす。
              at:   parseOptionalNumber(it.at, { min: 0, max: MAX_ENTRY_AT_MS }) ?? null,
            })),
          totalValue: parseOptionalNumber(p.totalValue, { min: -MAX_UNIT_PRICE * MAX_INVENTORY_QTY, max: MAX_UNIT_PRICE * MAX_INVENTORY_QTY }) ?? null,
        }))
    : null

  return {
    entryLog:     log(snapshot.entryLog),
    auditLog:     log(snapshot.auditLog),
    participants,
    flaggedItems: (Array.isArray(snapshot.flaggedItems) ? snapshot.flaggedItems : [])
      .slice(0, MAX_SNAPSHOT_ITEMS)
      .map(v => text(v, MAX_INGREDIENT_LEN))
      .filter(Boolean),
    activeMs:  parseOptionalNumber(snapshot.activeMs, { min: 0, max: 366 * 86400_000 }) ?? null,
    axisNames: (Array.isArray(snapshot.axisNames) ? snapshot.axisNames : ['', ''])
      .slice(0, 2).map(v => text(v, MAX_SUPPLIER_LEN)),
    locked: snapshot.locked === true,
  }
}

/**
 * 検証済み inventory rows と client snapshot を突き合わせて canonical snapshot を作る。
 *
 * client の snapshot をそのまま保存すると、items が空・件数や合計が実際と違う・
 * 別セッションの sessionId を名乗る履歴を作れてしまう（＝R-001 と同じ「一覧に出るのに
 * 詳細が合わない」状態を、API から新しく作れる）。
 *
 * - 数量・単位・単価・小計は **rows で上書き**する（正規化）。
 * - `qty` を持つ品目の集合が rows と一致しない場合は保存せず 400 で拒否する。
 *   多い＝サーバーに明細が無いものを「入力済み」と主張している。
 *   少ない＝明細にあるものが履歴から欠ける。どちらも表示が実データと食い違う。
 * - 未入力（`qty: null`）の品目は表示のためにそのまま残す（棚卸で数えなかった品目）。
 *
 * @returns {{ snapshot?: object, error?: object }}
 */
function _canonicalStockSnapshot({ sessionId, date, rows, totalValue, snapshot, now }) {
  const rowByItem = new Map(rows.map(r => [r.item, r]))
  const rawItems  = Array.isArray(snapshot.items) ? snapshot.items : []
  if (rawItems.length > MAX_SNAPSHOT_ITEMS) {
    return { error: { _status: 413, code: 'snapshot_too_large', error: 'スナップショットの品目数が多すぎます' } }
  }

  const items   = []
  const matched = new Set()
  const seen    = new Set()

  for (const raw of rawItems) {
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
      return { error: { _status: 400, code: 'invalid_snapshot', error: 'スナップショットの明細が不正です' } }
    }
    const item = text(raw.item, MAX_INGREDIENT_LEN)
    if (!item || seen.has(item)) continue
    seen.add(item)

    const row = rowByItem.get(item)
    if (!row) {
      // 明細に無い品目が数量を主張している = 改ざんか client 側の不整合。
      if (raw.qty != null) {
        return {
          error: {
            _status: 400, code: 'snapshot_mismatch', item,
            error: '棚卸の明細とスナップショットが一致しません',
          },
        }
      }
      // 未入力の品目はそのまま表示用に残す。
      items.push({
        item, qty: null, unit: text(raw.unit, MAX_UNIT_LEN), unitPrice: null, subtotal: null,
        ..._snapshotItemLabels(raw),
      })
      continue
    }

    matched.add(item)
    items.push({
      item,
      qty:       row.qty,
      unit:      row.unit ?? '',
      unitPrice: row.price,
      subtotal:  row.value,
      ..._snapshotItemLabels(raw),
    })
  }

  if (matched.size !== rows.length) {
    return {
      error: {
        _status: 400, code: 'snapshot_mismatch',
        error: '棚卸の明細とスナップショットが一致しません',
      },
    }
  }

  return {
    snapshot: {
      // ── server が決める主要項目 ──
      sessionId,
      date,
      type:       'stock',
      savedAt:    now,          // 端末時計ではなくサーバー時刻を正とする
      items,
      itemCount:  rows.length,
      totalValue,
      // ── allowlist した任意 metadata ──
      ..._snapshotMeta(snapshot),
    },
  }
}

/** 明細に影響しない表示用ラベル（切り詰めるだけ・保存してよい）。 */
function _snapshotItemLabels(raw) {
  return {
    code:      text(raw.code, MAX_ID_LEN),
    flagged:   raw.flagged === true,
    category:  raw.category == null ? null : text(raw.category, MAX_INGREDIENT_LEN),
    lotSize:   text(raw.lotSize, MAX_UNIT_LEN),
    prevMonth: text(raw.prevMonth, MAX_UNIT_LEN),
    tagA:      text(raw.tagA, MAX_SUPPLIER_LEN),
    tagB:      text(raw.tagB, MAX_SUPPLIER_LEN),
  }
}

// POST /store/:code/sessions/:id/complete
//
// **セッション種別ごとに完了契約が違う**（DATA-002 §1）。旧実装は種別を見ずに
// 「snapshot 必須」を全経路へ課しており、発注セッション（在庫入力を伴わない）は
// 完了できなかった。
//
// ## stock（棚卸）
//   要求: `{ inventory, prices, takenAt?, snapshot }`
//   - `snapshot` は必須。無ければ 400 `snapshot_required`。
//   - 保存する snapshot は **server が検証済み inventory rows から canonical 化**する。
//     `sessionId` / `date` / `type` / `items` / `itemCount` / `totalValue` は client 値を採らない。
//   - 明細と snapshot.items が食い違えば 400 `snapshot_mismatch`（何も書かない）。
//   - `inventory` が 0 件の完了は 400 `empty_inventory`。
//     明細も items も無い「完了」は、一覧に出るのに詳細が空という R-001 そのものになる。
//   - `sessions` / `inventory_lines` / `store_history` を1つの `db.batch` で書く。
//   - 応答: `{ ok, sessionId, type:'stock', itemCount, totalValue, snapshotSaved:true,
//              serverRevision, serverSavedAt }`
//
// ## order（発注確認）
//   要求: `{ itemCount }`
//   - `store_history` を **書かない**。発注の正本は `orders` / `order_lines` で、
//     App の完了一覧も `type==='order'` を除外している。架空の marker snapshot を
//     作ると、履歴・カレンダー・分析に発注が棚卸として現れる。
//   - `snapshot` や `inventory` を送ってきたら 400 `snapshot_not_allowed`。
//     「発注なのに棚卸の snapshot を作ってしまう」経路を API として塞ぐ。
//   - 一覧の `itemCount` は client 値（検証済み）。発注明細は `POST /orders` が
//     別経路・別タイミングで冪等に書くため、完了を order_lines の到着に依存させると
//     未送信キューが残っている間だけ完了できなくなる。詳細の正本は `orders` 側。
//   - 応答: `{ ok, sessionId, type:'order', itemCount, snapshotSaved:false }`
//
// ## 確定は1回だけ（DATA-002 再レビュー §3）
//   最初の1要求だけが completed を確定できる。確定内容は `session_completions`
//   （migration 0016）の claim 行に fingerprint として残る。
//   - まったく同じ intent の再送 → 保存済みの結果をそのまま返す
//   - 数量・単価・日付・明細・件数・合計が違う再送 → 409 `completion_intent_conflict`
//   fingerprint は **server が検証済みの値からだけ**作る。client 送信値は信用しない。
//
// 冪等性: どちらも同じ要求の再送で最終状態が変わらない。
// completed になった後の active 更新は `handleSessionUpdate` が 409 で拒否する。
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

  // 棚卸日は **takenAt ひとつ**で決まる（DATA-002 再レビュー §2）。
  // `inventory_lines.taken_at` になり、分析・カレンダーの日付そのもの。
  const taken = parseDate(takenAt, today)
  if (taken === null) return { _status: 400, code: 'invalid_date', error: '棚卸日の形式が不正です' }

  const session = await db.prepare(
    'SELECT id, type, status FROM sessions WHERE id = ? AND shop_code = ? AND deleted_at IS NULL'
  ).bind(sessionId, code).first()
  if (!session) return { _status: 404, code: 'session_not_found', error: 'セッションが見つかりません' }

  const type = session.type === 'order' ? 'order' : 'stock'
  if (type === 'order') return _completeOrderSession(db, code, sessionId, session, body, now)

  // ── 以降 stock ──────────────────────────────────────────────────────────────
  if (snapshot == null) {
    return { _status: 400, code: 'snapshot_required', error: '棚卸の明細（スナップショット）がありません' }
  }
  if (typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return { _status: 400, code: 'invalid_snapshot', error: 'スナップショットの形式が不正です' }
  }

  // snapshot.date は canonical 日付（takenAt）と一致していなければならない。
  // 旧実装は両方を別々に受理していたため、`inventory_lines.taken_at = 08-09` と
  // `store_history.snapshot_date = 08-10` という分裂した記録を作れた。
  if (snapshot.date != null && snapshot.date !== '') {
    if (!isValidDate(snapshot.date)) {
      return { _status: 400, code: 'invalid_date', error: 'スナップショットの日付が不正です' }
    }
    if (snapshot.date !== taken) {
      return {
        _status: 400, code: 'snapshot_date_mismatch',
        error: '棚卸日とスナップショットの日付が一致しません',
      }
    }
  }

  const built = inventoryLineStatements(db, { sessionId, shopCode: code, takenAt: taken, inventory, prices })
  // 数量・単価が業務契約に合わない場合は、何も書かずに 400 を返す（0 へ丸めない・DATA-001）。
  if (built.error) return built.error
  const { rows, itemCount, totalValue } = built

  // 明細が1件も無い完了は成立させない。sessions だけ completed になり、
  // inventory_lines も items も空の履歴が残る＝詳細が開けない棚卸そのもの。
  if (itemCount === 0) {
    return { _status: 400, code: 'empty_inventory', error: '棚卸の明細がありません' }
  }

  const canonical = _canonicalStockSnapshot({
    sessionId, date: taken, rows, totalValue, snapshot, now,
  })
  if (canonical.error) return canonical.error

  // server が検証・正規化した値だけから作る canonical intent の指紋。
  // **保存する canonical snapshot 全体**（volatile な鍵を除く）を含めるので、
  // `category` / `code` / `auditLog` など「明細以外だが保存される項目」を変えた再送も
  // 別 intent として 409 になる（server 旧内容・端末新内容の食い違いを作らない）。
  const fingerprint = await _completionFingerprint({
    type: 'stock', date: taken, itemCount, totalValue, rows, snapshot: canonical.snapshot,
  })

  // 既に確定済みなら、同じ intent の再送だけを冪等成功にする。
  const settled = await _settledCompletion(db, code, sessionId, fingerprint, {
    type: 'stock', requireHistory: true,
  })
  if (settled) return settled

  const claim = completionClaimGuard(fingerprint)

  // batch の先頭で claim を取る。PRIMARY KEY(shop_code, session_id) と
  // `status <> 'completed'` により、**この batch で確定できるのは1要求だけ**。
  // 以降の全文はこの claim 行の存在に従属するので、claim を取れなかった側は
  // 1行も書き込めない（時刻 marker と違い、同一ミリ秒でも区別できる）。
  const claimStatement = db.prepare(`
    INSERT INTO session_completions
      (shop_code, session_id, fingerprint, type, taken_at, item_count, total_value, completed_at)
    SELECT ?, ?, ?, 'stock', ?, ?, ?, ?
    WHERE EXISTS (
      SELECT 1 FROM sessions s
      WHERE s.id = ? AND s.shop_code = ? AND s.deleted_at IS NULL AND s.status <> 'completed'
    )
  `).bind(code, sessionId, fingerprint, taken, itemCount, totalValue, now, sessionId, code)

  const sessionUpdate = db.prepare(`
    UPDATE sessions
    SET status = 'completed', ended_at = ?, item_count = ?, total_value = ?
    WHERE id = ? AND shop_code = ? AND deleted_at IS NULL
      AND ${completionClaimExists(code, sessionId, fingerprint).sql}
  `).bind(now, itemCount, totalValue, sessionId, code,
          ...completionClaimExists(code, sessionId, fingerprint).binds)

  // 明細も claim に従属させる（JOIN 元の sessions 経由で相関）。
  const lineStatements = inventoryLineStatements(db, {
    sessionId, shopCode: code, takenAt: taken, inventory, prices, claim,
  }).statements

  // 表示・分析用スナップショットも同じ batch に載せる（DATA-001 / 第2セッション）。
  // sessions を参照する INSERT ... SELECT なので snapshot だけが残ることはない。
  const snapStatement = sessionSnapshotStatement(db, code, sessionId, canonical.snapshot, now, { claim })
  // revision の読み戻しも同じ batch。別要求の revision を自分の応答にしない。
  const stampStatement = historyStampStatement(db, code, { sessionId })

  let results
  try {
    results = await db.batch([claimStatement, sessionUpdate, ...lineStatements, snapStatement, stampStatement])
  } catch (e) {
    // 途中で落ちた場合、batch はトランザクションごと巻き戻る。
    // 完了扱いにせず、クライアントが再送できる形で返す。
    console.error('[storeHandler] session complete batch failed:', code, sessionId, e?.message ?? e)
    // 検証環境では batch の構成も添える。エラー文面だけでは、どの文が大きすぎるのか
    // （明細のまとめ方なのか、別の文なのか）が切り分けられない。
    // **文を実行し直さない** — 再実行すると一部だけ適用される危険がある。
    const shape = _debugErrors
      ? ` | stmts=${1 + 1 + lineStatements.length + 2} lines=${lineStatements.length}`
        + ` items=${itemCount} inv=${Object.keys(inventory ?? {}).length}`
        + ` snapKB=${Math.round(jsonByteLength(canonical.snapshot) / 1024)}`
      : ''
    // compound SELECT の上限に当たった場合だけ、実D1の数え方を測って添える。
    // 明細は 19 項ずつに切ってあるので、これが出る時点で前提が違っている。
    const probe = _debugErrors && /compound/i.test(String(e?.message ?? ''))
      ? ` | ${await _probeCompound(db)}`
      : ''
    return {
      _status: 503, code: 'complete_failed', retryable: true,
      error: '完了を保存できませんでした',
      detail: _debugErrors ? `${_errDetail(e)}${shape}${probe}` : undefined,
    }
  }

  // claim を取れなかった = 直前に別要求が確定した / 既に completed だった /
  // セッションが消えた（他店舗のものになった）。
  // 明細も snapshot も claim 条件で 0 行なので、部分的に書かれた状態にはならない。
  if (results?.[0]?.meta?.changes !== 1) {
    const raced = await _settledCompletion(db, code, sessionId, fingerprint, {
      type: 'stock', requireHistory: true,
    })
    if (raced) return raced
    return await _claimFailureReason(db, code, sessionId)
  }

  // UPDATE が 0 行 = claim 直後にセッションが消えた/他店舗のものになった。
  if (results?.[1]?.meta?.changes !== 1) {
    return { _status: 404, code: 'session_not_found', error: 'セッションが見つかりません' }
  }

  const stamp = readStampResult(results[results.length - 1])
  if (!stamp) {
    console.error('[storeHandler] complete revision missing after write:', code, sessionId)
    return {
      _status: 503, code: 'complete_failed', retryable: true,
      error: '完了を確認できませんでした',
      // batch は通ったのに履歴の revision が読めない = snapshot 行が書かれていない
      detail: _debugErrors ? 'snapshot row missing after batch' : undefined,
    }
  }

  return {
    ok: true, sessionId, type: 'stock', date: taken, itemCount, totalValue,
    snapshotSaved: true, ...stamp,
  }
}

/**
 * fingerprint から**意図的に除外する** canonical snapshot の鍵。
 *
 * ここに挙げた項目だけは「違っていても同じ intent」とみなす。理由が無いものは足さない。
 *
 * - `savedAt`: server 時刻。要求のたびに必ず変わるため、含めると再送が常に別 intent になる。
 * - `activeMs`: 端末の計測時間。完了に失敗して同じ画面から再試行すると増えるため、
 *   含めると正当な再送が 409 になる。表示用の参考値で、棚卸の記録内容そのものではない。
 *
 * これ以外（`items` の全列 = 数量・単位・単価・小計に加え `code` / `flagged` / `category` /
 * `lotSize` / `prevMonth` / `tagA` / `tagB`、および `entryLog` / `auditLog` / `participants` /
 * `flaggedItems` / `axisNames` / `locked` / `itemCount` / `totalValue` / `date` / `sessionId` /
 * `type`）は**すべて fingerprint に含める**。保存対象なのに指紋から漏れていると、
 * その項目だけを変えた再送が「同じ intent」として replay 成功になり、
 * **サーバーは旧内容・端末は新内容**という食い違いを作る。
 */
const FINGERPRINT_EXCLUDED_SNAPSHOT_KEYS = ['savedAt', 'activeMs']

/**
 * canonical intent の指紋。**server が検証・正規化した値だけ**から作る。
 *
 * client が送る fingerprint は受け取らない（改ざんで別内容の上書きが通ってしまう）。
 * stock では「保存する canonical snapshot そのもの」から上記の除外鍵を落としたものを使うため、
 * 保存対象が増えても指紋の対象が自動的に追随する。
 */
async function _completionFingerprint({ type, date, itemCount, totalValue, rows = [], snapshot = null }) {
  // canonical snapshot は server が固定の鍵順で組み立てるので、JSON 化は決定的。
  const stable = snapshot == null ? null : Object.fromEntries(
    Object.entries(snapshot).filter(([k]) => !FINGERPRINT_EXCLUDED_SNAPSHOT_KEYS.includes(k)),
  )
  const canonical = JSON.stringify({
    type, date, itemCount, totalValue: totalValue ?? null,
    rows: rows.map(r => [r.item, r.qty, r.unit ?? '', r.price, r.value]),
    snapshot: stable,
  })
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical))
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * claim を取れなかった原因を、実際の状態から確定させる。
 * セッションが消えていれば 404、それ以外は別内容での確定済みとして 409。
 */
async function _claimFailureReason(db, code, sessionId) {
  const row = await db.prepare(
    'SELECT status FROM sessions WHERE id = ? AND shop_code = ? AND deleted_at IS NULL'
  ).bind(sessionId, code).first()
  if (!row) return { _status: 404, code: 'session_not_found', error: 'セッションが見つかりません' }
  return _completionConflict(sessionId)
}

function _completionConflict(sessionId, reason = 'different_payload') {
  return {
    _status: 409, code: 'completion_intent_conflict', reason, sessionId, retryable: false,
    error: 'この棚卸は別の内容で完了済みです',
  }
}

/**
 * 確定済み completion があるかを見て、再送の扱いを決める。
 *
 * @returns 応答オブジェクト（返すべき場合）／ null（新規確定へ進んでよい場合）
 */
async function _settledCompletion(db, code, sessionId, fingerprint, { type, requireHistory }) {
  const claim = await db.prepare(`
    SELECT fingerprint, type, taken_at, item_count, total_value
    FROM session_completions WHERE shop_code = ? AND session_id = ?
  `).bind(code, sessionId).first()

  if (!claim) {
    // claim が無いのに completed = **0016 適用前に完了したセッション**。
    // 当時の要求と同一かを判定する材料が無いため、推測で fingerprint を作らず
    // fail-closed にする（保存済みデータは無傷。詳細APIで内容を確認できる）。
    const row = await db.prepare('SELECT status FROM sessions WHERE id = ? AND shop_code = ?')
      .bind(sessionId, code).first()
    if (row?.status === 'completed') return _completionConflict(sessionId, 'already_completed')
    return null
  }

  if (claim.fingerprint !== fingerprint) return _completionConflict(sessionId)

  if (type === 'order') {
    return {
      ok: true, sessionId, type: 'order', itemCount: claim.item_count,
      snapshotSaved: false, replay: true,
    }
  }

  // stale claim を「保存済み」と答えない（DATA-002 再レビュー §5）。
  // session が消えている / snapshot が消えている場合、replay を成功にすると
  // client は存在しない記録を保存済みとして扱う。
  const stamp = requireHistory
    ? readStampResult(await historyStampStatement(db, code, { sessionId }).all())
    : null
  if (requireHistory && !stamp) {
    console.error('[storeHandler] stale completion claim (history missing):', code, sessionId)
    return {
      _status: 409, code: 'completion_record_missing', sessionId, retryable: false,
      error: 'この棚卸の記録が見つかりません。セッションを削除してからやり直してください',
    }
  }

  return {
    ok: true, sessionId, type: 'stock', date: claim.taken_at,
    itemCount: claim.item_count, totalValue: claim.total_value ?? null,
    snapshotSaved: true, replay: true, ...(stamp ?? {}),
  }
}

/**
 * 発注セッションの完了。`store_history` も `inventory_lines` も書かない。
 * 確定は claim（migration 0016）が持ち、同じ `itemCount` の再送だけを冪等成功にする。
 */
async function _completeOrderSession(db, code, sessionId, session, body, now) {
  const { inventory, snapshot, itemCount: rawCount } = body ?? {}
  if (snapshot != null) {
    return {
      _status: 400, code: 'snapshot_not_allowed',
      error: '発注セッションに棚卸のスナップショットは保存できません',
    }
  }
  if (inventory != null && typeof inventory === 'object' && Object.keys(inventory).length > 0) {
    return {
      _status: 400, code: 'snapshot_not_allowed',
      error: '発注セッションに棚卸の明細は保存できません',
    }
  }

  const parsed = parseCount(rawCount, MAX_LINES_PER_REQUEST)
  if (parsed === undefined) return { _status: 400, code: 'invalid_count', error: '品目数が不正です' }
  const itemCount = parsed ?? 0

  const fingerprint = await _completionFingerprint({ type: 'order', date: null, itemCount, totalValue: null })

  const settled = await _settledCompletion(db, code, sessionId, fingerprint, {
    type: 'order', requireHistory: false,
  })
  if (settled) return settled

  const claimExists = completionClaimExists(code, sessionId, fingerprint)

  let results
  try {
    results = await db.batch([
      db.prepare(`
        INSERT INTO session_completions
          (shop_code, session_id, fingerprint, type, taken_at, item_count, total_value, completed_at)
        SELECT ?, ?, ?, 'order', NULL, ?, NULL, ?
        WHERE EXISTS (
          SELECT 1 FROM sessions s
          WHERE s.id = ? AND s.shop_code = ? AND s.deleted_at IS NULL AND s.status <> 'completed'
        )
      `).bind(code, sessionId, fingerprint, itemCount, now, sessionId, code),
      db.prepare(`
        UPDATE sessions SET status = 'completed', ended_at = ?, item_count = ?
        WHERE id = ? AND shop_code = ? AND deleted_at IS NULL AND ${claimExists.sql}
      `).bind(now, itemCount, sessionId, code, ...claimExists.binds),
    ])
  } catch (e) {
    console.error('[storeHandler] order session complete failed:', code, sessionId, e?.message ?? e)
    return { _status: 503, code: 'complete_failed', retryable: true, error: '完了を保存できませんでした' }
  }

  if (results?.[0]?.meta?.changes !== 1) {
    const raced = await _settledCompletion(db, code, sessionId, fingerprint, {
      type: 'order', requireHistory: false,
    })
    if (raced) return raced
    return await _claimFailureReason(db, code, sessionId)
  }
  if (results?.[1]?.meta?.changes !== 1) {
    return { _status: 404, code: 'session_not_found', error: 'セッションが見つかりません' }
  }

  return { ok: true, sessionId, type: 'order', itemCount, snapshotSaved: false }
}

// ── 操作ログ（変更履歴・migration 0017）─────────────────────────────────────
//
// 「誰が・何を・いつ変えたか」の記録。参加者別の重複カウントと品目ごとの履歴の正本。
// 進行中の記録が1台の端末にも Durable Object の生存期間にも依存しないよう、D1 に持つ。
//
// 設計上の約束:
//   - `id` は端末/DO が発行する監査エントリID。PRIMARY KEY にして **再送しても重複しない**
//     （INSERT OR IGNORE）。端末は失敗時にそのまま送り直せる。
//   - `at` は端末時計。順序の根拠にはせず表示にだけ使う。並べ替えは at → id で安定させる。
//   - **記録の保存が棚卸そのものを止めてはならない。** 呼び出し側は失敗を握りつぶし、
//     端末のキューに残して後で送り直す。

function _auditRow(e, now) {
  const id   = text(e?.id, MAX_ID_LEN)
  const item = text(e?.ingredient ?? e?.item, MAX_INGREDIENT_LEN)
  const action = text(e?.action, 32)
  if (!id || !item || !action) return null
  const at = parseOptionalNumber(e?.at ?? e?.timestamp, { min: 0, max: MAX_ENTRY_AT_MS })
  return {
    id,
    item,
    action,
    delta:    parseOptionalNumber(e?.delta,    { min: -MAX_INVENTORY_QTY, max: MAX_INVENTORY_QTY }) ?? null,
    totalQty: parseOptionalNumber(e?.totalQty, { min: -MAX_INVENTORY_QTY, max: MAX_INVENTORY_QTY }) ?? null,
    unit:     text(e?.unit, MAX_UNIT_LEN),
    by:       text(e?.enteredBy, MAX_DEVICE_NAME_LEN),
    byId:     text(e?.enteredById, MAX_DEVICE_ID_LEN),
    at:       typeof at === 'number' ? at : (Date.parse(now) || 0),
  }
}

// POST /store/:code/sessions/:id/audit  body: { entries: [...] }
export async function handleAuditAppend(db, code, sessionId, body = {}) {
  if (!sessionId) return { _status: 400, code: 'invalid_session', error: 'セッションIDがありません' }
  if (_tooLarge(body)) return { _status: 413, error: 'データサイズが大きすぎます' }

  const raw = Array.isArray(body.entries) ? body.entries : null
  if (!raw) return { _status: 400, code: 'invalid_entries', error: '変更履歴がありません' }
  if (raw.length > MAX_AUDIT_PER_REQUEST) {
    return { _status: 413, code: 'too_many_entries', error: '変更履歴が多すぎます', limit: MAX_AUDIT_PER_REQUEST }
  }

  const now = _now()
  const rows = []
  const seen = new Set()
  for (const e of raw) {
    const row = _auditRow(e, now)
    if (!row || seen.has(row.id)) continue   // 同じ要求の中の重複も落とす
    seen.add(row.id)
    rows.push(row)
  }
  if (rows.length === 0) return { ok: true, saved: 0 }

  // セッションの持ち主を確認する。他店舗のセッションへ記録を差し込ませない。
  const owner = await db.prepare('SELECT shop_code FROM sessions WHERE id = ?').bind(sessionId).first()
  if (!owner) return { _status: 404, code: 'session_not_found', error: 'セッションが見つかりません' }
  if (owner.shop_code !== code) return { _status: 409, error: '保存できませんでした' }

  // 複数行を1文へまとめる（D1の queries/invocation 対策・constants.js 参照）。
  // INSERT OR IGNORE なので、同じ id の再送は黙って無視される（＝冪等）。
  const stmts = chunk(rows, AUDIT_ROWS_PER_STATEMENT).map(group => {
    const values = group.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')
    const binds = []
    for (const r of group) {
      binds.push(r.id, code, sessionId, r.item, r.action, r.delta, r.totalQty, r.unit, r.by, r.byId, r.at, now)
    }
    return db.prepare(`
      INSERT OR IGNORE INTO session_audit
        (id, shop_code, session_id, item_name, action, delta, total_qty, unit, entered_by, entered_by_id, at, created_at)
      VALUES ${values}
    `).bind(...binds)
  })

  try {
    await db.batch(stmts)
  } catch (e) {
    // 記録の保存が棚卸を止めてはならないので、client 側は再送で回復する。
    // table が無い（0017 未適用）場合もここに来る。
    console.error('[storeHandler] audit append failed:', code, sessionId, e?.message ?? e)
    return { _status: 503, code: 'audit_append_failed', retryable: true, error: '変更履歴を保存できませんでした' }
  }
  return { ok: true, saved: rows.length }
}

// GET /store/:code/sessions/:id/audit
// 別端末から進行中・完了済みセッションの変更履歴を読む。
export async function handleAuditGet(db, code, sessionId) {
  if (!sessionId) return { _status: 400, code: 'invalid_session', error: 'セッションIDがありません' }
  try {
    const rows = await db.prepare(`
      SELECT id, item_name, action, delta, total_qty, unit, entered_by, entered_by_id, at
      FROM session_audit
      WHERE shop_code = ? AND session_id = ?
      ORDER BY at ASC, id ASC
      LIMIT ?
    `).bind(code, sessionId, MAX_SNAPSHOT_LOG_ENTRIES).all()
    return (rows.results ?? []).map(r => ({
      id:          r.id,
      ingredient:  r.item_name,
      action:      r.action,
      delta:       r.delta,
      totalQty:    r.total_qty,
      unit:        r.unit ?? '',
      enteredBy:   r.entered_by ?? '',
      enteredById: r.entered_by_id ?? '',
      timestamp:   r.at,
    }))
  } catch (e) {
    // 0017 未適用の環境では table が無い。履歴が読めないだけで画面は壊さない。
    console.error('[storeHandler] audit get failed:', code, sessionId, e?.message ?? e)
    return []
  }
}
