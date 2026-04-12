import { reactive, computed } from 'vue'
import { useConfig } from './useConfig.js'

// モジュールスコープのシングルトン state
const inventory = reactive({})

function _save() {
  try {
    localStorage.setItem('inventory_v1', JSON.stringify({
      date: new Date().toISOString().slice(0, 10),
      data: { ...inventory },
    }))
  } catch (_) {}
}

function _load() {
  try {
    const raw = localStorage.getItem('inventory_v1')
    if (!raw) return
    const saved = JSON.parse(raw)
    const today = new Date().toISOString().slice(0, 10)
    if (saved.date !== today) return
    Object.assign(inventory, saved.data ?? {})
  } catch (_) {}
}

_load()

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
    const rawQty   = add && existing ? existing.qty + qty : qty
    // 浮動小数点誤差を除去（0.1+0.1... → 1.7999...998 などを防ぐ）
    const finalQty = Math.round(rawQty * 10000) / 10000
    inventory[ingredient] = { qty: finalQty, unit }
    _save()
  }

  function updateQty(ingredient, qty, unit) {
    if (inventory[ingredient]) {
      inventory[ingredient].qty = qty
      // 既存エントリの単位はそのまま保持
    } else {
      // テーブルから直接入力された新規品目
      inventory[ingredient] = { qty, unit: unit || config.units?.[ingredient] || '' }
    }
    _save()
  }

  function removeItem(ingredient) {
    delete inventory[ingredient]
    _save()
  }

  function reset() {
    Object.keys(inventory).forEach(k => delete inventory[k])
    _save()
  }

  function exportCSV() {
    const date       = new Date().toISOString().slice(0, 10)
    const hasPrices  = Object.keys(config.prices ?? {}).length > 0
    const header     = hasPrices
      ? '日付,商品コード,品目名,単位,数量,単価,在庫金額'
      : '日付,商品コード,品目名,単位,数量'
    const rows = [header]

    // 定義順（未入力も含む）→ カスタム品目の順に出力
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

  return { inventory, filledCount, totalValue, setItem, updateQty, removeItem, reset, exportCSV }
}
