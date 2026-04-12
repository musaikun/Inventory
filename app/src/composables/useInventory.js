import { reactive, computed } from 'vue'
import { useConfig } from './useConfig.js'

const ENTRY_LOGS_KEY = 'inventory_entry_logs_v1'

// ── モジュールスコープ シングルトン ────────────────────────────────────────────
const inventory = reactive({})
const entryLog  = reactive([])   // 今日の入力順（初入力の順番を記録）

// 直前の setItem 操作を1件分保持（↩ 戻す用）
let _lastEntry = null  // null | { ingredient, prevState: null|{qty,unit}, addedToLog: boolean }

// ── 入力順ログ（過去3回分）ロード / セーブ ──────────────────────────────────
function _loadHistoricalLogs() {
  try {
    const raw = localStorage.getItem(ENTRY_LOGS_KEY)
    return raw ? JSON.parse(raw) : []
  } catch (_) { return [] }
}

function _appendHistoricalLog(date, log) {
  if (!log || log.length === 0) return
  const logs     = _loadHistoricalLogs()
  const filtered = logs.filter(l => l.date !== date)
  filtered.unshift({ date, log: [...log] })
  try {
    localStorage.setItem(ENTRY_LOGS_KEY, JSON.stringify(filtered.slice(0, 3)))
  } catch (_) {}
}

// ── 在庫ロード / セーブ ──────────────────────────────────────────────────────
function _save() {
  try {
    localStorage.setItem('inventory_v1', JSON.stringify({
      date:     new Date().toISOString().slice(0, 10),
      data:     { ...inventory },
      entryLog: [...entryLog],
    }))
  } catch (_) {}
}

function _load() {
  try {
    const raw = localStorage.getItem('inventory_v1')
    if (!raw) return
    const saved = JSON.parse(raw)
    const today = new Date().toISOString().slice(0, 10)
    if (saved.date !== today) {
      // 日付変更 → 昨日の入力順を履歴に保存してから破棄
      if (saved.entryLog?.length > 0) {
        _appendHistoricalLog(saved.date, saved.entryLog)
      }
      return
    }
    Object.assign(inventory, saved.data ?? {})
    if (saved.entryLog?.length > 0) {
      entryLog.splice(0, entryLog.length, ...saved.entryLog)
    }
  } catch (_) {}
}

_load()

// ── Public API ────────────────────────────────────────────────────────────────
export function useInventory() {
  const { config } = useConfig()

  const filledCount = computed(() => Object.keys(inventory).length)

  const totalValue = computed(() => {
    if (!config.prices || Object.keys(config.prices).length === 0) return null
    let total = 0
    let hasPrices = false
    for (const [item, entry] of Object.entries(inventory)) {
      const price = config.prices[item]
      if (price != null) {
        total += entry.qty * price
        hasPrices = true
      }
    }
    return hasPrices ? Math.round(total) : null
  })

  function setItem(ingredient, qty, unit, add = false) {
    const existing = inventory[ingredient]
    const isNew    = !existing
    // undo用に変更前の状態を保存
    _lastEntry = {
      ingredient,
      prevState:    existing ? { qty: existing.qty, unit: existing.unit } : null,
      addedToLog:   isNew,
    }
    const rawQty   = add && existing ? existing.qty + qty : qty
    const finalQty = Math.round(rawQty * 10000) / 10000
    inventory[ingredient] = { qty: finalQty, unit }
    // 初入力時のみ順番を記録（上書き・追加は順番を変えない）
    if (isNew) entryLog.push(ingredient)
    _save()
  }

  /** 直前の setItem を1件元に戻す。戻した品目名を返す（undoがない場合は null）。 */
  function undoLast() {
    if (!_lastEntry) return null
    const { ingredient, prevState, addedToLog } = _lastEntry
    _lastEntry = null
    if (prevState === null) {
      // 新規追加だった → 削除
      delete inventory[ingredient]
      if (addedToLog) {
        const idx = entryLog.indexOf(ingredient)
        if (idx >= 0) entryLog.splice(idx, 1)
      }
    } else {
      // 上書き / 追加だった → 元の値に戻す
      inventory[ingredient] = { qty: prevState.qty, unit: prevState.unit }
    }
    _save()
    return ingredient
  }

  function updateQty(ingredient, qty, unit) {
    if (inventory[ingredient]) {
      inventory[ingredient].qty = qty
    } else {
      inventory[ingredient] = { qty, unit: unit || config.units?.[ingredient] || '' }
      entryLog.push(ingredient)
    }
    _save()
  }

  function removeItem(ingredient) {
    delete inventory[ingredient]
    _save()
  }

  function reset() {
    // リセット前に今日の入力順を履歴へ保存
    const today = new Date().toISOString().slice(0, 10)
    _appendHistoricalLog(today, [...entryLog])
    Object.keys(inventory).forEach(k => delete inventory[k])
    entryLog.splice(0, entryLog.length)
    _save()
  }

  /** 過去3回分の入力順ログを返す（学習ソート用） */
  function getHistoricalLogs() {
    return _loadHistoricalLogs()
  }

  function exportCSV() {
    const date       = new Date().toISOString().slice(0, 10)
    const hasPrices  = Object.keys(config.prices ?? {}).length > 0
    const header     = hasPrices
      ? '日付,商品コード,品目名,単位,数量,単価,在庫金額'
      : '日付,商品コード,品目名,単位,数量'
    const rows = [header]

    const orderedItems = [
      ...config.order,
      ...Object.keys(inventory).filter(k => !config.order.includes(k)),
    ]

    let grandTotal  = 0
    let hasAnyPrice = false

    orderedItems.forEach(item => {
      const e        = inventory[item] ?? null
      const unit     = e?.unit ?? config.units?.[item] ?? ''
      const code     = config.codes?.[item] ?? ''
      if (hasPrices) {
        const unitPrice = config.prices[item]
        const subtotal  = (e && unitPrice != null) ? Math.round(e.qty * unitPrice) : ''
        if (typeof subtotal === 'number') { grandTotal += subtotal; hasAnyPrice = true }
        const qty = e != null ? e.qty : ''
        rows.push(`${date},"${code}","${item}","${unit}",${qty},${unitPrice ?? ''},${subtotal}`)
      } else {
        const qty = e != null ? e.qty : ''
        rows.push(`${date},"${code}","${item}","${unit}",${qty}`)
      }
    })

    if (hasAnyPrice) {
      rows.push(`${date},"【合計】","",,,${grandTotal}`)
    }

    return rows.join('\r\n')
  }

  return {
    inventory, filledCount, totalValue,
    entryLog, getHistoricalLogs,
    setItem, updateQty, removeItem, reset, exportCSV, undoLast,
  }
}
