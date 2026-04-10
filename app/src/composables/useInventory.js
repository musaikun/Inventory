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
    const finalQty = add && existing ? existing.qty + qty : qty
    inventory[ingredient] = { qty: finalQty, unit }
    _save()
  }

  function updateQty(ingredient, qty) {
    if (inventory[ingredient]) {
      inventory[ingredient].qty = qty
      _save()
    }
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
      ? '日付,品目名,単位,数量,単価,在庫金額'
      : '日付,品目名,単位,数量'
    const rows = [header]

    // 定義順 → カスタム品目の順に出力
    const orderedItems = [
      ...config.order.filter(k => inventory[k]),
      ...Object.keys(inventory).filter(k => !config.order.includes(k)),
    ]

    let grandTotal  = 0
    let hasAnyPrice = false

    orderedItems.forEach(item => {
      const e = inventory[item]
      if (!e) return
      if (hasPrices) {
        const unitPrice = config.prices[item]
        const subtotal  = unitPrice != null ? Math.round(e.qty * unitPrice) : ''
        if (typeof subtotal === 'number') { grandTotal += subtotal; hasAnyPrice = true }
        rows.push(`${date},"${item}","${e.unit}",${e.qty},${unitPrice ?? ''},${subtotal}`)
      } else {
        rows.push(`${date},"${item}","${e.unit}",${e.qty}`)
      }
    })

    if (hasAnyPrice) {
      rows.push(`${date},"【合計】","",,,${grandTotal}`)
    }

    return rows.join('\n')
  }

  return { inventory, filledCount, totalValue, setItem, updateQty, removeItem, reset, exportCSV }
}
