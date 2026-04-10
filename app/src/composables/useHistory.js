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
   * 現在の棚卸状態をスナップショットとして保存（今日の分を上書き）
   * @param {object} inventory  reactive inventory オブジェクト
   * @param {object} prices     config.prices
   * @param {string[]} order    config.order
   */
  function saveSnapshot(inventory, prices, order) {
    if (Object.keys(inventory).length === 0) return

    const today = new Date().toISOString().slice(0, 10)

    // 定義順 → カスタム品目の順
    const orderedKeys = [
      ...order.filter(k => inventory[k]),
      ...Object.keys(inventory).filter(k => !order.includes(k)),
    ]

    const items = []
    let totalValue  = 0
    let hasPrices   = false

    for (const item of orderedKeys) {
      const entry     = inventory[item]
      if (!entry) continue
      const unitPrice = prices?.[item] ?? null
      const subtotal  = unitPrice != null ? Math.round(entry.qty * unitPrice) : null
      if (subtotal != null) { totalValue += subtotal; hasPrices = true }
      items.push({ item, qty: entry.qty, unit: entry.unit, unitPrice, subtotal })
    }

    _data[today] = {
      date:       today,
      savedAt:    new Date().toISOString(),
      items,
      totalValue: hasPrices ? totalValue : null,
    }
    _persist()
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

  /** スナップショットをCSV文字列に変換 */
  function exportSnapshotCSV(snapshot) {
    const hasPrice = snapshot.totalValue !== null
    const header   = hasPrice
      ? '日付,品目名,単位,数量,単価,在庫金額'
      : '日付,品目名,単位,数量'
    const rows = [header]

    for (const it of snapshot.items) {
      if (hasPrice) {
        rows.push(
          `"${snapshot.date}","${it.item}","${it.unit}",${it.qty},${it.unitPrice ?? ''},${it.subtotal ?? ''}`
        )
      } else {
        rows.push(`"${snapshot.date}","${it.item}","${it.unit}",${it.qty}`)
      }
    }

    if (snapshot.totalValue != null) {
      rows.push(`"${snapshot.date}","【合計】","",,,${snapshot.totalValue}`)
    }
    return rows.join('\n')
  }

  return { saveSnapshot, getSnapshots, deleteSnapshot, exportSnapshotCSV }
}
