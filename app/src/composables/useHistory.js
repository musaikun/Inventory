import { reactive } from 'vue'
import { STORAGE_KEYS } from '../utils/storageKeys.js'

// reactive にすることで getSnapshots/getEntryLogs を参照する computed が
// 保存・削除のたびに自動再計算される
const _data = reactive({})

function _load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.history)
    if (raw) Object.assign(_data, JSON.parse(raw))
  } catch (_) {}
}

function _persist() {
  try {
    localStorage.setItem(STORAGE_KEYS.history, JSON.stringify({ ..._data }))
  } catch (_) {}
}

_load()

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

    _data[today] = {
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
    return _data[today]
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

  /** 全スナップショットを新しい日付順で返す */
  function getSnapshots() {
    return Object.values(_data).sort((a, b) => b.date.localeCompare(a.date))
  }

  /** セッションIDでスナップショットを検索 */
  function getSnapshotBySessionId(sessionId) {
    if (!sessionId) return null
    return Object.values(_data).find(s => s.sessionId === sessionId) ?? null
  }

  /** 指定日付のスナップショットを削除 */
  function deleteSnapshot(date) {
    delete _data[date]
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

  /** D1 から取得したスナップショット配列をローカルに反映（リモートで上書き） */
  function applyRemoteHistory(snapshots) {
    if (!Array.isArray(snapshots)) return
    for (const snap of snapshots) {
      if (snap?.date) _data[snap.date] = snap
    }
    _persist()
  }

  /** ローカルストレージからスナップショットを削除（D1削除に対応） */
  function deleteSnapshotLocal(date) {
    deleteSnapshot(date)
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

  function patchSnapshotItems(date, patches) {
    const snap = _data[date]
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

  return { saveSnapshot, applyRemoteHistory, deleteSnapshotLocal, getSnapshots, getSnapshotBySessionId, getEntryLogs, deleteSnapshot, exportSnapshotCSV, patchSnapshotItems, lockOtherSnapshots }
}
