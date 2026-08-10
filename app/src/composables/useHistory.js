import { reactive } from 'vue'
import { STORAGE_KEYS } from '../utils/storageKeys.js'

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
      _data[snapshotKey(snap) || oldKey] = snap
    }
  } catch (_) {}
}

function _persist() {
  try {
    localStorage.setItem(STORAGE_KEYS.history, JSON.stringify({ ..._data }))
  } catch (_) {}
}

_load()

/** client時計による保存時刻（端末間の比較には使わない） */
function _savedAtMs(snap) {
  const t = Date.parse(snap?.updatedAt ?? snap?.savedAt ?? '')
  return Number.isFinite(t) ? t : 0
}

/** サーバーが記録した保存時刻。無ければ null（= 未同期） */
function _serverMs(snap) {
  const t = Date.parse(snap?.serverSavedAt ?? '')
  return Number.isFinite(t) ? t : null
}

// アカウント切替時のローカル全消去（棚卸スナップショット履歴）。
export function resetLocalData() {
  for (const k of Object.keys(_data)) delete _data[k]
  try { localStorage.removeItem(STORAGE_KEYS.history) } catch (_) {}
}

export function useHistory() {
  /**
   * 棚卸完了時にスナップショットを保存
   * @param {object}   inventory  reactive inventory オブジェクト
   * @param {object}   prices     config.prices
   * @param {string[]} order      config.order
   * @param {object}   codes      config.codes（商品コード）
   * @param {string[]} entryLog   入力順ログ（学習ソート用）
   * @param {Array}    auditLog   変更履歴（参加者別集計に使用）
   * @param {object}   categories config.categories（カテゴリ名マップ）
   */
  function saveSnapshot(inventory, prices, order, codes, entryLog, auditLog, recountFlags = null, categories = null, sessionId = null, activeMs = null, lotSizes = null, prevMonths = null, tagsA = null, tagsB = null, axisNames = null) {
    if (Object.keys(inventory).length === 0) return

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

    // 参加者別集計: auditLog の最終更新者をオーナーとして品目を割り当て
    let participants = null
    if (auditLog && auditLog.length > 0) {
      const lastAuthor = new Map() // ingredient -> { deviceId, name }
      const _qtyAction = (a) => a && a !== 'remove' && a !== 'flag_recount' && a !== 'unflag_recount'
      for (const entry of auditLog) {
        if (_qtyAction(entry.action)) {
          lastAuthor.set(entry.ingredient, {
            deviceId: entry.enteredById || '__solo__',
            name:     entry.enteredBy   || '名前未設定',
          })
        }
      }

      const authorMap = new Map() // deviceId -> { name, items[] }
      for (const it of items) {
        if (it.qty === null) continue  // 未入力は除外
        const author = lastAuthor.get(it.item)
        if (!author) continue
        if (!authorMap.has(author.deviceId)) {
          authorMap.set(author.deviceId, { name: author.name, items: [] })
        }
        authorMap.get(author.deviceId).items.push({ ...it })
      }

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
    }

    const key = sessionId ? String(sessionId) : today
    _data[key] = {
      date:         today,
      savedAt:      new Date().toISOString(),
      items,
      totalValue:   hasPrices ? totalValue : null,
      entryLog:     entryLog ? [...entryLog] : [],
      participants,
      flaggedItems: recountFlags ? Object.keys(recountFlags) : [],
      sessionId,
      auditLog:     auditLog ? [...auditLog] : [],
      activeMs:     typeof activeMs === 'number' ? activeMs : null,
      axisNames:    Array.isArray(axisNames) ? [...axisNames] : ['', ''],
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
  function importPastSnapshot({ date, items } = {}) {
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

    _data[date] = {
      date,
      savedAt:      new Date().toISOString(),
      items:        built,
      totalValue:   hasPrices ? totalValue : null,
      entryLog:     [],
      participants: null,
      flaggedItems: [],
      sessionId:    null,
      auditLog:     [],
      activeMs:     null,
      axisNames:    ['', ''],
      source:       'import',   // 過去取込由来（手動棚卸と区別）
    }
    _persist()
    return _data[date]
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
   * ただし端末側が新しい場合は残す。未送信のスナップショットが D1 の古い版で
   * 潰れると、バックフィル（historyBackfill）が送るべき差分ごと消えるため。
   * 保存時刻が同じ・不明なときはリモートを採用する（従来の挙動）。
   */
  function applyRemoteHistory(snapshots) {
    if (!Array.isArray(snapshots)) return
    for (const snap of snapshots) {
      if (!snap?.date) continue
      const key   = snapshotKey(snap)
      if (!key) continue
      const local = _data[key]
      if (local) {
        const localServer  = _serverMs(local)
        const remoteServer = _serverMs(snap)
        if (remoteServer != null) {
          // 端末側にサーバー時刻が無い = このスナップショットはまだ送れていない。
          // 端末の変更をリモートの版で潰すとバックフィルの差分ごと消えるため残す。
          if (localServer == null) continue
          if (localServer > remoteServer) continue
        } else if (_savedAtMs(local) > _savedAtMs(snap)) {
          // 双方サーバー時刻を持たない旧データ同士は、従来どおりclient時刻で比較する。
          continue
        }
      }
      _data[key] = snap
    }
    _persist()
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

    _persist()
    return { ...snap, items: snap.items.map(i => ({ ...i })) }
  }

  return { saveSnapshot, snapshotKey, importPastSnapshot, applyRemoteHistory, deleteSnapshotLocal, getSnapshots, getSnapshotBySessionId, getEntryLogs, deleteSnapshot, exportSnapshotCSV, patchSnapshotItems, lockOtherSnapshots }
}
