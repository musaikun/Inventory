import { reactive } from 'vue'
import { STORAGE_KEYS } from '../utils/storageKeys.js'
import {
  clientSavedMs, serverSavedMs, serverRevision, isSnapshotDirty,
} from '../utils/snapshotSync.js'

// reactive にすることで getSnapshots/getEntryLogs を参照する computed が
// 保存・削除のたびに自動再計算される
const _data = reactive({})

/**
 * スナップショットの保管キー（DATA-002 / F-001）。
 *
 * sessionId を正本にする。以前は日付キーだったため、同じ日に2回棚卸すると
 * 2回目が1回目を上書きして消していた。sessionId を持たない行（過去取込・旧データ）
 * だけが日付キーのまま残る。
 */
export function snapshotKey(snap) {
  return snap?.sessionId ? String(snap.sessionId) : (snap?.date ?? '')
}

/** 与えられたキーが legacy の日付キーか */
function _isDateKey(key) {
  return typeof key === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(key)
}

function _load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.history)
    if (!raw) return
    const saved = JSON.parse(raw)
    // 旧形式（日付キー）からの移行。sessionId を持つ行は sessionId キーへ移す。
    // 同日2件が既に潰れている過去分は復元できないが、以後は共存する。
    for (const [oldKey, snap] of Object.entries(saved ?? {})) {
      if (!snap || typeof snap !== 'object') continue
      // dirty/synced を持たない旧データの移行。訂正済み（updatedAt あり）で
      // サーバー確認の形跡が無いものは「未送信の訂正」として扱う（下の isSnapshotDirty と同じ判定）。
      if (snap.dirty === undefined && isSnapshotDirty(snap)) snap.dirty = true
      _data[snapshotKey(snap) || oldKey] = snap
    }
  } catch (_) {}
}

function _persist() {
  try {
    localStorage.setItem(STORAGE_KEYS.history, JSON.stringify({ ..._data }))
  } catch (_) {}
}

// 同期状態の判定は historyBackfill と共有する（utils/snapshotSync.js に一本化）。
const _savedAtMs = clientSavedMs
const _serverMs  = serverSavedMs
const _serverRev = serverRevision

/**
 * 端末側の版番号（localRev）。
 *
 * 送信中の版と、その後に端末で作られた版を区別するために持つ。
 * これが無いと `markSnapshotSynced(key)` は「いま key に入っているオブジェクト」を
 * 無条件に clean にするため、A の送信中に作った B が、A の応答だけで
 * 「サーバー確認済み」になってしまう（未送信の訂正が黙って消える）。
 *
 * 端末時計ではなく単調増加のカウンタ。時計を戻した端末でも順序が壊れない。
 */
let _localRev = 0
function _nextLocalRev() { return ++_localRev }

// 復元した内容から採番の続きを決める（リロードしても版番号が巻き戻らない）
function _seedLocalRev() {
  for (const snap of Object.values(_data)) {
    const v = Number(snap?.localRev)
    if (Number.isFinite(v) && v > _localRev) _localRev = v
  }
}

_load()
_seedLocalRev()

// アカウント切替時のローカル全消去（棚卸スナップショット履歴）。
export function resetLocalData() {
  for (const k of Object.keys(_data)) delete _data[k]
  try { localStorage.removeItem(STORAGE_KEYS.history) } catch (_) {}
}

export function useHistory() {
  /**
   * 棚卸完了時のスナップショットを**メモリ上で組み立てる**（端末へは書かない）。
   *
   * かつては組み立てと保存が一体で、完了APIを呼ぶ前に localStorage へ書いていた。
   * そのため完了が失敗した端末にも「完了済みの履歴」が残り、
   *   - 一覧（サーバー）には active、履歴（端末）には完了、と食い違う
   *   - まだ進行中のセッションのスナップショットをバックフィルが送ってしまう
   * という状態を作れた。組み立てと確定を分け、**サーバーが完了を受け付けた後に
   * だけ** commitSnapshot() で端末へ確定する。
   *
   * @param {object}   inventory  reactive inventory オブジェクト
   * @param {object}   prices     config.prices
   * @param {string[]} order      config.order
   * @param {object}   codes      config.codes（商品コード）
   * @param {string[]} entryLog   入力順ログ（学習ソート用）
   * @param {Array}    auditLog   変更履歴（参加者別集計に使用）
   * @param {object}   categories config.categories（カテゴリ名マップ）
   */
  function buildSnapshot(inventory, prices, order, codes, entryLog, auditLog, recountFlags = null, categories = null, sessionId = null, activeMs = null, lotSizes = null, prevMonths = null, tagsA = null, tagsB = null, axisNames = null) {
    if (Object.keys(inventory).length === 0) return null

    const today = new Date().toISOString().slice(0, 10)

    // config.order 順全件 → カスタム品目（config.orderに含まれないもの）
    const allKeys = [
      ...order,
      ...Object.keys(inventory).filter(k => !order.includes(k)),
    ]

    const items = []
    let totalValue = 0
    let hasPrices  = false

    for (const item of allKeys) {
      const entry     = inventory[item] ?? null   // null = 未入力
      const unitPrice = prices?.[item] ?? null
      const subtotal  = (entry && unitPrice != null) ? Math.round(entry.qty * unitPrice) : null
      const code      = codes?.[item] ?? ''
      if (subtotal != null) { totalValue += subtotal; hasPrices = true }
      items.push({
        item,
        qty:       entry != null ? entry.qty : null,  // null = 未入力
        unit:      entry?.unit ?? '',
        unitPrice,
        subtotal,
        code,
        flagged:   !!recountFlags?.[item],            // 「あとで数える」フラグ
        category:  categories?.[item] ?? null,
        lotSize:   lotSizes?.[item] ?? '',            // 入数
        prevMonth: prevMonths?.[item] ?? '',          // 前月実績
        tagA:      Array.isArray(tagsA?.[item]) ? tagsA[item].join('|') : (tagsA?.[item] ?? ''),  // 軸1（複数は | 区切り）
        tagB:      Array.isArray(tagsB?.[item]) ? tagsB[item].join('|') : (tagsB?.[item] ?? ''),  // 軸2
      })
    }

    // 参加者別集計: 品目ごとの「最終入力者」で割り当てる。
    //
    // 担当は **在庫データが品目ごとに持つ enteredBy / updatedAt を正**とする。
    // 以前は auditLog（操作の履歴）から逆算していたが、auditLog は 200件で古い方から
    // 捨てられるため、品目数がそれを超えると古い品目の担当者が消え、参加者別から
    // まるごと抜け落ちていた（530品目なら330品目ぶんが不明になる）。
    // 在庫側は品目ごとに1件なので、品目数がいくつでも必ず全件に担当が付く。
    //
    // auditLog は enteredBy を持たない古い下書き（0.78.1 以前）のための予備に残す。
    const lastAuthor = new Map() // ingredient -> name
    if (auditLog && auditLog.length > 0) {
      const _qtyAction = (a) => a && a !== 'remove' && a !== 'flag_recount' && a !== 'unflag_recount'
      for (const entry of auditLog) {
        if (_qtyAction(entry.action)) lastAuthor.set(entry.ingredient, entry.enteredBy || '')
      }
    }

    // 同名の端末は1人として束ねる（保存する参加者は name だけを持つため）
    const authorMap = new Map() // name -> { name, items[] }
    for (const it of items) {
      if (it.qty === null) continue  // 未入力は除外
      const entry = inventory[it.item]
      const name  = entry?.enteredBy || lastAuthor.get(it.item) || ''
      if (!name) continue            // 誰が入れたか分からないものは割り当てない
      if (!authorMap.has(name)) authorMap.set(name, { name, items: [] })
      // at = その品目を最後に入力した時刻（「誰が何をいつ」の“いつ”）
      authorMap.get(name).items.push({ ...it, at: entry?.updatedAt ?? null })
    }

    let participants = null
    if (authorMap.size > 0) {
      participants = [...authorMap.values()].map(({ name, items: pItems }) => {
        let pTotal    = 0
        let pHasPrice = false
        for (const it of pItems) {
          if (it.subtotal != null) { pTotal += it.subtotal; pHasPrice = true }
        }
        return { name, items: pItems, totalValue: pHasPrice ? pTotal : null }
      })
    }

    return {
      date:         today,
      savedAt:      new Date().toISOString(),
      items,
      totalValue:   hasPrices ? totalValue : null,
      entryLog:     entryLog ? [...entryLog] : [],
      participants,
      flaggedItems: recountFlags ? Object.keys(recountFlags) : [],
      sessionId:    sessionId ? String(sessionId) : null,
      auditLog:     auditLog ? [...auditLog] : [],
      activeMs:     typeof activeMs === 'number' ? activeMs : null,
      axisNames:    Array.isArray(axisNames) ? [...axisNames] : ['', ''],
    }
  }

  /**
   * 組み立て済みスナップショットを端末へ確定する。
   * **サーバーが完了を受け付けた後にだけ**呼ぶ（buildSnapshot のコメント参照）。
   *
   * @param {object} snap    buildSnapshot の戻り値
   * @param {object} meta    サーバーの応答（serverRevision / serverSavedAt）。
   *                         完了APIがまだ返さない場合は synced だけ立てる。
   */
  function commitSnapshot(snap, meta = null) {
    if (!snap) return null
    const key = snapshotKey(snap)
    if (!key) return null
    const rev = _serverRev(meta)
    _data[key] = {
      ...snap,
      ...(rev != null ? { serverRevision: rev } : {}),
      ...(meta?.serverSavedAt ? { serverSavedAt: meta.serverSavedAt } : {}),
      dirty:    false,
      synced:   true,   // サーバーが受け付けた内容そのもの＝再送不要
      localRev: _nextLocalRev(),
    }
    _persist()
    return _data[key]
  }

  /**
   * 過去棚卸の一括インポート（実行済みスナップショットとして過去日付で挿入）。
   * saveSnapshot は「当日」固定なのに対し、これは任意の過去日付キーで保存する。
   * 消費逆算（impliedConsumption）・理論在庫（theoreticalStock）の観測点になる。
   * @param {object} arg { date:'YYYY-MM-DD', items:[{ item, qty, unit, unitPrice|price, code, category, lotSize, prevMonth }] }
   * @returns 挿入したスナップショット（不正な入力は null）
   */
  function importPastSnapshot({ date, items, sessionId = null, importBatchId = null } = {}) {
    if (!date || !Array.isArray(items) || items.length === 0) return null

    let totalValue = 0
    let hasPrices  = false
    const built = []
    for (const it of items) {
      const name = (it.item ?? it.name ?? '').trim()
      if (!name) continue
      const qty       = (it.qty == null || it.qty === '') ? null : Number(it.qty)
      const unitPrice = it.unitPrice ?? it.price ?? null
      const subtotal  = (qty != null && unitPrice != null) ? Math.round(qty * unitPrice) : null
      if (subtotal != null) { totalValue += subtotal; hasPrices = true }
      built.push({
        item:      name,
        qty:       qty != null && Number.isFinite(qty) ? qty : null,
        unit:      it.unit ?? '',
        unitPrice,
        subtotal,
        code:      it.code ?? '',
        flagged:   false,
        category:  it.category ?? null,
        lotSize:   it.lotSize ?? '',
        prevMonth: it.prevMonth ?? '',
        tagA:      '',
        tagB:      '',
      })
    }
    if (built.length === 0) return null

    // sessionId を正本キーにする（IMPORT-001）。
    // 以前は日付キーで書いていたため、同じ日に通常の棚卸があると取込が黙って上書きしていた。
    // サーバーが採番した sessionId でしまうことで、同日の別セッションと共存し、
    // カレンダー・詳細・取消がすべて同じ sessionId を参照する。
    const snap = {
      date,
      savedAt:      new Date().toISOString(),
      items:        built,
      totalValue:   hasPrices ? totalValue : null,
      entryLog:     [],
      participants: null,
      flaggedItems: [],
      sessionId:    sessionId ? String(sessionId) : null,
      importBatchId,
      auditLog:     [],
      activeMs:     null,
      axisNames:    ['', ''],
      source:       'import',   // 過去取込由来（手動棚卸と区別）
      localRev:     _nextLocalRev(),
    }
    _data[snapshotKey(snap)] = snap
    _persist()
    return snap
  }

  /**
   * 取込バッチで入れたスナップショットを端末から消す（サーバー取消と対で使う）。
   * importBatchId が一致するものだけを消すので、別バッチ・通常の棚卸は残る。
   * @returns 消した件数
   */
  function deleteImportBatchLocal(importBatchId) {
    if (!importBatchId) return 0
    let n = 0
    for (const [k, snap] of Object.entries(_data)) {
      if (snap?.importBatchId === importBatchId) { delete _data[k]; n++ }
    }
    if (n) _persist()
    return n
  }

  /** 取込バッチに属するスナップショット（取消前の確認用） */
  function getImportBatch(importBatchId) {
    if (!importBatchId) return []
    return Object.values(_data).filter(s => s?.importBatchId === importBatchId)
  }

  /**
   * 完了済み棚卸の入力順ログを返す（学習ソート用）
   * 新しい順に最大3件、各要素は { date, log: string[] }
   */
  function getEntryLogs() {
    return Object.values(_data)
      .filter(s => s.entryLog && s.entryLog.length > 0)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 3)
      .map(s => ({ date: s.date, log: s.entryLog }))
  }

  /**
   * 全スナップショットを新しい順で返す。
   * 同じ日に複数セッションがある場合は保存時刻の新しい方を先にする（一覧で潰さない）。
   */
  function getSnapshots() {
    return Object.values(_data).sort((a, b) =>
      b.date.localeCompare(a.date) || (_savedAtMs(b) - _savedAtMs(a))
    )
  }

  /**
   * セッションIDでスナップショットを検索する。
   * **日付へのfallbackはしない。** 同じ日の別セッションを取り違えて表示するくらいなら
   * 「端末に無い」として扱い、呼び出し側がサーバーから取り直す（fail-closed）。
   */
  function getSnapshotBySessionId(sessionId) {
    if (!sessionId) return null
    const direct = _data[String(sessionId)]
    if (direct) return direct
    return Object.values(_data).find(s => s.sessionId === sessionId) ?? null
  }

  /**
   * スナップショットを削除する。key は sessionId または legacy の日付キー。
   * 日付を渡された場合、sessionId を持つ行は消さない。
   * 同日の別セッションを巻き添えで消さないため（F-001）。
   */
  function deleteSnapshot(key) {
    if (!key) return
    if (_isDateKey(key)) {
      for (const [k, snap] of Object.entries(_data)) {
        if (!snap?.sessionId && snap?.date === key) delete _data[k]
      }
      delete _data[key]
    } else {
      delete _data[String(key)]
      for (const [k, snap] of Object.entries(_data)) {
        if (snap?.sessionId === key) delete _data[k]
      }
    }
    _persist()
  }

  /**
   * スナップショットをCSV文字列に変換
   * TOP画面のexportCSVと同一フォーマット:
   * 日付,商品コード,品目名,単位,数量,単価,在庫金額
   */
  function exportSnapshotCSV(snapshot) {
    // CSVフォーミュラインジェクション対策
    function csvSafe(val) {
      if (typeof val !== 'string' || val === '') return val
      return /^[=+\-@|]/.test(val) ? `'${val}` : val
    }

    // 読み込んだ情報を全て出力（復元で往復できるフラット形式）
    const header = '日付,商品コード,品目名,カテゴリ,単位,入数,前月実績,数量,単価,在庫金額'
    const rows = [header]

    for (const it of snapshot.items) {
      const code     = csvSafe(it.code ?? '')
      const safeItem = csvSafe(it.item)
      const category = csvSafe(it.category ?? '')
      const unit     = csvSafe(it.unit ?? '')
      const lot      = csvSafe(it.lotSize ?? '')
      const prev     = csvSafe(it.prevMonth ?? '')
      const qty      = it.qty !== null && it.qty !== undefined ? it.qty : ''
      rows.push(`"${snapshot.date}","${code}","${safeItem}","${category}","${unit}","${lot}","${prev}",${qty},${it.unitPrice ?? ''},${it.subtotal ?? ''}`)
    }

    if (snapshot.totalValue != null) {
      rows.push(`"${snapshot.date}","","【合計】","","","","",,,${snapshot.totalValue}`)
    }
    return rows.join('\r\n')
  }

  /**
   * D1 から取得したスナップショット配列をローカルに反映（リモートで上書き）。
   *
   * 判定順は serverRevision → serverSavedAt → client時刻（旧データ同士のみ）。
   * 端末でだけ訂正した版（dirty）は、サーバーが取り込むまでリモートで潰さない。
   * 潰すとバックフィルが送るべき差分ごと消え、訂正が黙って無かったことになる。
   */
  function _remoteWins(local, remote) {
    if (!local) return true
    // 未送信の訂正。保存キュー経由でサーバーへ送り直されるまで端末側を正とする。
    if (isSnapshotDirty(local)) return false

    const lr = _serverRev(local), rr = _serverRev(remote)
    if (lr != null && rr != null) return rr >= lr          // 第一優先

    const lm = _serverMs(local), rm = _serverMs(remote)
    if (lm != null && rm != null) return rm >= lm          // legacy fallback

    // 片方だけがサーバー値を持つ。
    // リモートだけが持つ = 端末側は「サーバー確認済み」と分かっている場合のみ譲る。
    if (rr != null || rm != null) return !!local.synced
    // 端末側だけが持つ = リモートは revision を返さない旧サーバー。端末の値を保つ。
    if (lr != null || lm != null) return false

    // 双方サーバー値なし（旧データ同士）。従来どおり client 時刻で比較する。
    return _savedAtMs(remote) >= _savedAtMs(local)
  }

  function applyRemoteHistory(snapshots) {
    if (!Array.isArray(snapshots)) return
    for (const snap of snapshots) {
      if (!snap?.date) continue
      const key = snapshotKey(snap)
      if (!key) continue
      if (!_remoteWins(_data[key], snap)) continue
      // サーバーから来た内容そのもの。以後の比較で「未送信」と誤判定させない。
      // 版は進める。送信中だった旧版の ack が、この新しい内容へ効かないようにする。
      _data[key] = { ...snap, dirty: false, synced: true, localRev: _nextLocalRev() }
    }
    _persist()
  }

  /**
   * サーバーが保存を受け付けたことを端末のスナップショットへ反映する（訂正の再送後）。
   * dirty を下ろし、次回以降の比較に使う serverRevision / serverSavedAt を書く。
   *
   * **ack は「送った版」にだけ効く。** `sentLocalRev` を渡すと、端末の現在の版が
   * それと一致するときだけ clean にする。送信中に新しい訂正（B）が作られていた場合、
   * A の応答で B を「サーバー確認済み」にしてしまうと、一度も送っていない B が
   * バックフィルの対象から外れ、リモートの古い版に潰されて消える。
   *
   * @param {string} key           sessionId または legacy の日付キー
   * @param {object} meta          POST /store/:code/history の応答
   * @param {number} sentLocalRev  送信時に捕まえた localRev（省略時は版を確認しない）
   * @returns {object|null} 反映したスナップショット。版が進んでいれば null
   */
  function markSnapshotSynced(key, meta = null, sentLocalRev = null) {
    if (!key) return null
    const snap = _data[String(key)] ?? getSnapshotBySessionId(key)
    if (!snap) return null
    // 送信後に端末側で作られた新しい版。この ack は当てはまらない
    if (sentLocalRev != null && snap.localRev !== sentLocalRev) return null
    const rev = _serverRev(meta)
    if (rev != null) snap.serverRevision = rev
    if (meta?.serverSavedAt) snap.serverSavedAt = meta.serverSavedAt
    snap.dirty  = false
    snap.synced = true
    _persist()
    return snap
  }

  /** ローカルストレージからスナップショットを削除（D1削除に対応）。key = sessionId または日付 */
  function deleteSnapshotLocal(key) {
    deleteSnapshot(key)
  }

  /**
   * 訂正期間内のスナップショットの数量を部分更新
   * @param {string} date      スナップショットの日付キー（YYYY-MM-DD）
   * @param {object} patches   { 品目名: { qty: number|null } }
   */
  /**
   * 新しい棚卸の完了に伴い、それ以外の完了済みスナップショットを恒久ロックする。
   * 新しい方が後で削除されても前回分のロックが外れないよう、locked フラグを永続化する。
   * @returns {Array} 新たにロックしたスナップショット（呼び出し側が D1 へ再保存する用）
   */
  function lockOtherSnapshots(currentSessionId) {
    const changed = []
    for (const key of Object.keys(_data)) {
      const s = _data[key]
      if (s && !s.locked && s.sessionId !== currentSessionId) {
        s.locked = true
        // ロックも端末発の変更。サーバーが受け取るまで dirty として保護する
        // （届く前にリモートの版で潰れると、ロックが外れたまま編集できてしまう）。
        s.dirty    = true
        s.synced   = false
        s.localRev = _nextLocalRev()
        changed.push(s)
      }
    }
    if (changed.length) _persist()
    return changed
  }

  function patchSnapshotItems(key, patches) {
    const snap = _data[String(key)] ?? getSnapshotBySessionId(key)
    if (!snap || snap.locked) return null   // ロック済みは編集不可（防御）

    for (const item of snap.items) {
      if (!(item.item in patches)) continue
      const newQty = patches[item.item].qty
      item.qty = newQty
      item.subtotal = (newQty !== null && item.unitPrice != null)
        ? Math.round(newQty * item.unitPrice)
        : null
    }

    let total = 0, hasPrices = false
    for (const item of snap.items) {
      if (item.qty !== null && item.subtotal != null) { total += item.subtotal; hasPrices = true }
    }
    snap.totalValue = hasPrices ? total : null
    snap.updatedAt  = new Date().toISOString()
    // 端末でだけ訂正した状態。サーバーが受け付けるまでリモートで潰されない
    // （端末時計の updatedAt には依存しない）。
    snap.dirty    = true
    snap.synced   = false
    snap.localRev = _nextLocalRev()

    _persist()
    return { ...snap, items: snap.items.map(i => ({ ...i })) }
  }

  return { buildSnapshot, commitSnapshot, snapshotKey, importPastSnapshot, deleteImportBatchLocal, getImportBatch, applyRemoteHistory, markSnapshotSynced, deleteSnapshotLocal, getSnapshots, getSnapshotBySessionId, getEntryLogs, deleteSnapshot, exportSnapshotCSV, patchSnapshotItems, lockOtherSnapshots }
}
