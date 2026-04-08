import { reactive, computed } from 'vue'
import { INVENTORY_ORDER } from '../config.js'

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
  const filledCount = computed(() => Object.keys(inventory).length)

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
    const date = new Date().toISOString().slice(0, 10)
    const rows = ['date,ingredient,quantity,unit']

    INVENTORY_ORDER.forEach(item => {
      const e = inventory[item]
      if (e) rows.push(`${date},"${item}",${e.qty},"${e.unit}"`)
    })

    Object.entries(inventory).forEach(([item, e]) => {
      if (!INVENTORY_ORDER.includes(item)) {
        rows.push(`${date},"${item}",${e.qty},"${e.unit}"`)
      }
    })

    return rows.join('\n')
  }

  return { inventory, filledCount, setItem, updateQty, removeItem, reset, exportCSV }
}
