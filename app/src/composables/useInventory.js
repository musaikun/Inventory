import { reactive, computed, ref } from 'vue'
import { useConfig } from './useConfig.js'
import { STORAGE_KEYS } from '../utils/storageKeys.js'

// ── モジュールスコープ シングルトン ────────────────────────────────────────────
const inventory   = reactive({})
const recountFlags = reactive({})  // { [item]: { by, at } } 「あとで数える」フラグ（未入力品目にも立つ）
const entryLog    = reactive([])   // 今日の入力順（初入力の順番を記録）
const completedAt = ref(null)      // null=進行中, ISO文字列=完了済み

// ── 在庫ロード / セーブ ──────────────────────────────────────────────────────
function _save() {
  try {
    localStorage.setItem(STORAGE_KEYS.inventory, JSON.stringify({
      date:         new Date().toISOString().slice(0, 10),
      data:         { ...inventory },
      recountFlags: { ...recountFlags },
      entryLog:     [...entryLog],
      completedAt:  completedAt.value,
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
    Object.assign(recountFlags, saved.recountFlags ?? {})
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

/**
 * D1 に永続化された進行中在庫を一括適用（端末復旧用）。
 * ローカルを D1 の内容で置き換える。完了済みセッションには適用しない。
 */
export function applyPersistedInventory(inv, flags) {
  if (completedAt.value) return
  for (const k of Object.keys(inventory))    delete inventory[k]
  Object.assign(inventory, inv ?? {})
  for (const k of Object.keys(recountFlags)) delete recountFlags[k]
  Object.assign(recountFlags, flags ?? {})
  entryLog.splice(0, entryLog.length, ...Object.keys(inv ?? {}))
  _save()
}

/**
 * 他デバイスからの「あとで数える」フラグ更新を適用（ブロードキャストしない）
 */
export function applyRemoteRecountFlag(item, on, by = '', at = Date.now()) {
  if (completedAt.value) return
  if (on) recountFlags[item] = { by, at }
  else    delete recountFlags[item]
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
    const rawQty   = add && existing ? existing.qty + qty : qty
    const finalQty = Math.round(rawQty * 10000) / 10000
    inventory[ingredient] = { qty: finalQty, unit, enteredBy, updatedAt: Date.now(), localEntry: true }
    if (isNew) entryLog.push(ingredient)
    _save()
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

  /** 「あとで数える」フラグを立てる/外す。未入力品目にも立てられる。 */
  function setRecountFlag(item, on, by = '') {
    if (completedAt.value) return
    if (on) recountFlags[item] = { by, at: Date.now() }
    else    delete recountFlags[item]
    _save()
  }

  /** 棚卸を完了としてマーク。読み取り専用になる。スナップショット保存は呼び出し元（App.vue）で行う。 */
  function completeSession() {
    completedAt.value = new Date().toISOString()
    _save()
  }

  /** 新規棚卸を開始（現セッションをクリア） */
  function reset() {
    Object.keys(inventory).forEach(k => delete inventory[k])
    Object.keys(recountFlags).forEach(k => delete recountFlags[k])
    entryLog.splice(0, entryLog.length)
    completedAt.value = null
    _save()
  }

  function exportCSV() {
    // CSVフォーミュラインジェクション対策
    function csvSafe(val) {
      if (typeof val !== 'string' || val === '') return val
      return /^[=+\-@|]/.test(val) ? `'${val}` : val
    }

    const date   = new Date().toISOString().slice(0, 10)
    // 読み込んだ情報を全て出力（復元で往復できるフラット形式）
    const header = '日付,商品コード,品目名,カテゴリ,単位,入数,前月実績,数量,単価,在庫金額'
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
      const category  = csvSafe(config.categories?.[item] ?? '')
      const lot       = csvSafe(config.lotSizes?.[item] ?? '')
      const prev      = csvSafe(config.prevMonths?.[item] ?? '')
      const safeItem  = csvSafe(item)
      const unitPrice = config.prices?.[item]
      const subtotal  = (e && unitPrice != null) ? Math.round(e.qty * unitPrice) : ''
      if (typeof subtotal === 'number') { grandTotal += subtotal; hasAnyPrice = true }
      const qty = e != null ? e.qty : ''
      rows.push(`"${date}","${code}","${safeItem}","${category}","${unit}","${lot}","${prev}",${qty},${unitPrice ?? ''},${subtotal}`)
    })

    if (hasAnyPrice) {
      rows.push(`"${date}","","【合計】","","","","",,,${grandTotal}`)
    }

    return rows.join('\r\n')
  }

  return {
    inventory, recountFlags, filledCount, totalValue,
    isCompleted, completedAt,
    entryLog,
    setItem, updateQty, removeItem, setRecountFlag, reset, exportCSV,
    completeSession,
  }
}
