const HISTORY_KEY = 'inventory_history_v1'

// モジュールスコープ（シングルトン）
let _data = {}

function _load() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (raw) _data = JSON.parse(raw)
  } catch (_) { _data = {} }
}

function _persist() {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(_data))
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
   */
  function saveSnapshot(inventory, prices, order, codes, entryLog) {
    if (Object.keys(inventory).length === 0) return

    const today = new Date().toISOString().slice(0, 10)

    // 定義順 → カスタム品目の順
    const orderedKeys = [
      ...order.filter(k => inventory[k]),
      ...Object.keys(inventory).filter(k => !order.includes(k)),
    ]

    const items = []
    let totalValue = 0
    let hasPrices  = false

    for (const item of orderedKeys) {
      const entry     = inventory[item]
      if (!entry) continue
      const unitPrice = prices?.[item] ?? null
      const subtotal  = unitPrice != null ? Math.round(entry.qty * unitPrice) : null
      const code      = codes?.[item] ?? ''
      if (subtotal != null) { totalValue += subtotal; hasPrices = true }
      items.push({ item, qty: entry.qty, unit: entry.unit, unitPrice, subtotal, code })
    }

    _data[today] = {
      date:       today,
      savedAt:    new Date().toISOString(),
      items,
      totalValue: hasPrices ? totalValue : null,
      entryLog:   entryLog ? [...entryLog] : [],
    }
    _persist()
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

    const hasPrice = snapshot.totalValue !== null
    const header   = hasPrice
      ? '日付,商品コード,品目名,単位,数量,単価,在庫金額'
      : '日付,商品コード,品目名,単位,数量'
    const rows = [header]

    for (const it of snapshot.items) {
      const code     = csvSafe(it.code ?? '')
      const safeItem = csvSafe(it.item)
      const unit     = csvSafe(it.unit ?? '')
      if (hasPrice) {
        rows.push(`"${snapshot.date}","${code}","${safeItem}","${unit}",${it.qty},${it.unitPrice ?? ''},${it.subtotal ?? ''}`)
      } else {
        rows.push(`"${snapshot.date}","${code}","${safeItem}","${unit}",${it.qty}`)
      }
    }

    if (snapshot.totalValue != null) {
      rows.push(`"${snapshot.date}","","【合計】","",,,${snapshot.totalValue}`)
    }
    return rows.join('\r\n')
  }

  return { saveSnapshot, getSnapshots, getEntryLogs, deleteSnapshot, exportSnapshotCSV }
}
