import { reactive, computed, ref } from 'vue'
import { useConfig } from './useConfig.js'
import { STORAGE_KEYS } from '../utils/storageKeys.js'

// ── モジュールスコープ シングルトン ────────────────────────────────────────────
const inventory   = reactive({})
const entryLog    = reactive([])   // 今日の入力順（初入力の順番を記録）
const completedAt = ref(null)      // null=進行中, ISO文字列=完了済み

// 直前の setItem 操作を1件分保持（↩ 戻す用）
let _lastEntry = null  // null | { ingredient, prevState: null|{qty,unit}, addedToLog: boolean }

// ── 在庫ロード / セーブ ──────────────────────────────────────────────────────
function _save() {
  try {
    localStorage.setItem(STORAGE_KEYS.inventory, JSON.stringify({
      date:        new Date().toISOString().slice(0, 10),
      data:        { ...inventory },
      entryLog:    [...entryLog],
      completedAt: completedAt.value,
    }))
  } catch (_) {}
}

function _load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.inventory)
    if (!raw) return
    const saved = JSON.parse(raw)
    const today = new Date().toISOString().slice(0, 10)

    // 完了済みセッションは日付をまたいでも保持
    // 未完了かつ日付変更 → 当日分として再開しない（破棄）
    if (!saved.completedAt && saved.date !== today) return

    Object.assign(inventory, saved.data ?? {})
    if (saved.entryLog?.length > 0) {
      entryLog.splice(0, entryLog.length, ...saved.entryLog)
    }
    completedAt.value = saved.completedAt ?? null
  } catch (_) {}
}

_load()

// ── リモート同期用（useSync から呼ばれる）────────────────────────────────────
/**
 * 他デバイスからの品目更新を適用（ブロードキャストしない・entryLog に追加しない）
 * useSync.js が setInventoryCallbacks 経由で登録し呼び出す
 */
export function applyRemoteUpdate(ingredient, qty, unit, enteredBy = '', updatedAt = Date.now()) {
  if (completedAt.value) return  // 完了済みはリモート更新を受け付けない
  inventory[ingredient] = { qty, unit: unit ?? '', enteredBy, updatedAt }
  _save()
}

/**
 * 他デバイスからの品目削除を適用（ブロードキャストしない）
 */
export function applyRemoteRemove(ingredient) {
  if (completedAt.value) return  // 完了済みはリモート削除を受け付けない
  delete inventory[ingredient]
  _save()
}

// ── Public API ────────────────────────────────────────────────────────────────
export function useInventory() {
  const { config } = useConfig()

  const isCompleted = computed(() => completedAt.value !== null)
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

  function setItem(ingredient, qty, unit, add = false, enteredBy = '') {
    const existing = inventory[ingredient]
    const isNew    = !existing
    _lastEntry = {
      ingredient,
      prevState:  existing
        ? { qty: existing.qty, unit: existing.unit, enteredBy: existing.enteredBy ?? '' }
        : null,
      addedToLog: isNew,
    }
    const rawQty   = add && existing ? existing.qty + qty : qty
    const finalQty = Math.round(rawQty * 10000) / 10000
    inventory[ingredient] = { qty: finalQty, unit, enteredBy, updatedAt: Date.now() }
    if (isNew) entryLog.push(ingredient)
    _save()
  }

  /** 直前の setItem を1件元に戻す。戻した品目名を返す（undoがない場合は null）。 */
  function undoLast() {
    if (!_lastEntry) return null
    const { ingredient, prevState, addedToLog } = _lastEntry
    _lastEntry = null
    if (prevState === null) {
      delete inventory[ingredient]
      if (addedToLog) {
        const idx = entryLog.indexOf(ingredient)
        if (idx >= 0) entryLog.splice(idx, 1)
      }
    } else {
      inventory[ingredient] = { qty: prevState.qty, unit: prevState.unit, enteredBy: prevState.enteredBy ?? '', updatedAt: Date.now() }
    }
    _save()
    return ingredient
  }

  function updateQty(ingredient, qty, unit, enteredBy = '') {
    if (inventory[ingredient]) {
      inventory[ingredient].qty       = qty
      inventory[ingredient].updatedAt = Date.now()
      if (enteredBy) inventory[ingredient].enteredBy = enteredBy
    } else {
      inventory[ingredient] = { qty, unit: unit || config.units?.[ingredient] || '', enteredBy, updatedAt: Date.now() }
      entryLog.push(ingredient)
    }
    _save()
  }

  function removeItem(ingredient) {
    delete inventory[ingredient]
    _save()
  }

  /** 棚卸を完了としてマーク。読み取り専用になる。スナップショット保存は呼び出し元（App.vue）で行う。 */
  function completeSession() {
    completedAt.value = new Date().toISOString()
    _save()
  }

  /** 完了済みセッションを再び編集可能に戻す */
  function reopenSession() {
    completedAt.value = null
    _save()
  }

  /** 新規棚卸を開始（現セッションをクリア） */
  function reset() {
    Object.keys(inventory).forEach(k => delete inventory[k])
    entryLog.splice(0, entryLog.length)
    completedAt.value = null
    _lastEntry = null
    _save()
  }

  function exportCSV() {
    // CSVフォーミュラインジェクション対策
    function csvSafe(val) {
      if (typeof val !== 'string' || val === '') return val
      return /^[=+\-@|]/.test(val) ? `'${val}` : val
    }

    const date      = new Date().toISOString().slice(0, 10)
    const hasPrices = Object.keys(config.prices ?? {}).length > 0
    const header    = hasPrices
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
      const e         = inventory[item] ?? null
      const unit      = csvSafe(e?.unit ?? config.units?.[item] ?? '')
      const code      = csvSafe(config.codes?.[item] ?? '')
      const safeItem  = csvSafe(item)
      if (hasPrices) {
        const unitPrice = config.prices[item]
        const subtotal  = (e && unitPrice != null) ? Math.round(e.qty * unitPrice) : ''
        if (typeof subtotal === 'number') { grandTotal += subtotal; hasAnyPrice = true }
        const qty = e != null ? e.qty : ''
        rows.push(`"${date}","${code}","${safeItem}","${unit}",${qty},${unitPrice ?? ''},${subtotal}`)
      } else {
        const qty = e != null ? e.qty : ''
        rows.push(`"${date}","${code}","${safeItem}","${unit}",${qty}`)
      }
    })

    if (hasAnyPrice) {
      rows.push(`"${date}","","【合計】","",,,${grandTotal}`)
    }

    return rows.join('\r\n')
  }

  return {
    inventory, filledCount, totalValue,
    isCompleted, completedAt,
    entryLog,
    setItem, updateQty, removeItem, reset, exportCSV, undoLast,
    completeSession, reopenSession,
  }
}
