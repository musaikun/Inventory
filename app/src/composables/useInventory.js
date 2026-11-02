import { reactive, computed, ref } from 'vue'
import { useConfig } from './useConfig.js'
import { STORAGE_KEYS } from '../utils/storageKeys.js'
import { localDateKey } from '../utils/localDate.js'
import { sortByCategoryAndCode, categoryOrderOf } from '../services/snapshotView.js'

// ── モジュールスコープ シングルトン ────────────────────────────────────────────
const inventory   = reactive({})
const recountFlags = reactive({})  // { [item]: { by, at } } 「あとで数える」フラグ（未入力品目にも立つ）
const entryLog    = reactive([])   // 今日の入力順（初入力の順番を記録）
const completedAt = ref(null)      // null=進行中, ISO文字列=完了済み
// 「未入力に戻した」品目と時刻 { [item]: ms }。D1 で別のブラウザの在庫と品目ごとに合わせるとき、
// 消した品目が他方の記録から生き返らないように一緒に送る
const removedAt   = reactive({})
// 品目ごとの備考 { [item]: { text, by, at } }（User決定 2026-11-02）。棚卸・発注とも、そのセッションの中だけ。
// 「期限が近いので多めに」「奥にもう1箱あるかも」のような、数字にならないその回の事情を書く
const itemNotes   = reactive({})
export const NOTE_MAX = 200

// ── 在庫ロード / セーブ ──────────────────────────────────────────────────────
function _save() {
  try {
    localStorage.setItem(STORAGE_KEYS.inventory, JSON.stringify({
      date:         localDateKey(),   // UTC だと日本時間の朝9時に日付が変わり、数えかけが捨てられる
      data:         { ...inventory },
      recountFlags: { ...recountFlags },
      entryLog:     [...entryLog],
      completedAt:  completedAt.value,
      removedAt:    { ...removedAt },
      notes:        { ...itemNotes },
    }))
  } catch (_) {}
}

function _load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.inventory)
    if (!raw) return
    const saved = JSON.parse(raw)
    // 完了済みセッションは日付をまたいでも保持
    // 未完了かつ日付変更 → 当日分として再開しない（破棄）
    // 以前の版は UTC の日付で保存していたので、それも当日として読む
    const today = [localDateKey(), new Date().toISOString().slice(0, 10)]
    if (!saved.completedAt && !today.includes(saved.date)) return

    Object.assign(inventory, saved.data ?? {})
    Object.assign(recountFlags, saved.recountFlags ?? {})
    if (saved.entryLog?.length > 0) {
      entryLog.splice(0, entryLog.length, ...saved.entryLog)
    }
    completedAt.value = saved.completedAt ?? null
    Object.assign(removedAt, saved.removedAt ?? {})
    Object.assign(itemNotes, saved.notes ?? {})
  } catch (_) {}
}

_load()

/** 未入力に戻した品目と時刻（D1 へ送る用） */
export function getRemovedAt() { return { ...removedAt } }

/** 品目の備考の一覧（読み取り用のリアクティブ。text が空のものは消した備考） */
export const itemNotesState = itemNotes

/**
 * 備考を入れる。空なら消す。at は書いた時刻（別の端末・D1 と合わせるとき新しい方を採る）。
 * 戻り値 = 変わったか
 */
export function applyNote(item, text, by = '', at = Date.now()) {
  if (completedAt.value || !item) return false
  const t = String(text ?? '').trim().slice(0, NOTE_MAX)
  const cur = itemNotes[item]
  if (cur && (cur.at ?? 0) > at) return false
  if (!t && !cur?.text) return false
  if (cur?.text === t) return false
  // 消した備考は空文字で残す。D1 で別のブラウザの古い備考と合わせたとき生き返らないように
  itemNotes[item] = { text: t, by, at }
  _save()
  return true
}

/** 備考をまとめて合わせる（D1・ルーム・下書きから）。品目ごとに新しい方 */
export function mergeNotes(notes) {
  if (completedAt.value || !notes || typeof notes !== 'object') return
  let changed = false
  for (const [item, n] of Object.entries(notes)) {
    if (!n || typeof n.text !== 'string') continue
    const cur = itemNotes[item]
    if (cur && (cur.at ?? 0) >= (n.at ?? 0)) continue
    itemNotes[item] = { text: n.text.slice(0, NOTE_MAX), by: n.by ?? '', at: n.at ?? Date.now() }
    changed = true
  }
  if (changed) _save()
}

// ── リモート同期用（useSync から呼ばれる）────────────────────────────────────
/**
 * 他デバイスからの品目更新を適用（ブロードキャストしない・entryLog に追加しない）
 * useSync.js が setInventoryCallbacks 経由で登録し呼び出す
 */
export function applyRemoteUpdate(ingredient, qty, unit, enteredBy = '', updatedAt = Date.now()) {
  if (completedAt.value) return  // 完了済みはリモート更新を受け付けない
  inventory[ingredient] = { qty, unit: unit ?? '', enteredBy, updatedAt }
  delete removedAt[ingredient]
  _save()
}

/**
 * 他デバイスからの品目削除を適用（ブロードキャストしない）
 */
export function applyRemoteRemove(ingredient) {
  if (completedAt.value) return  // 完了済みはリモート削除を受け付けない
  delete inventory[ingredient]
  removedAt[ingredient] = Date.now()
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
  for (const k of Object.keys(removedAt)) delete removedAt[k]
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

// アカウント切替時のローカル全消去（当日の棚卸データ）。
export function resetLocalData() {
  for (const k of Object.keys(inventory))    delete inventory[k]
  for (const k of Object.keys(recountFlags)) delete recountFlags[k]
  entryLog.splice(0, entryLog.length)
  completedAt.value = null
  for (const k of Object.keys(removedAt)) delete removedAt[k]
  for (const k of Object.keys(itemNotes)) delete itemNotes[k]
  try { localStorage.removeItem(STORAGE_KEYS.inventory) } catch (_) {}
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
    delete removedAt[ingredient]
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
    delete removedAt[ingredient]
    _save()
  }

  function removeItem(ingredient) {
    delete inventory[ingredient]
    removedAt[ingredient] = Date.now()
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

  // 完了マークを外して入力可能へ戻す関数（reopenSession）は廃止した（DATA-001 / 第2セッション §1）。
  // 完了済みを端末側で「進行中」へ戻すと、次にホームを押したときに markActive() が
  // `status:'active'` をサーバーへ送り、確定済みの completed を巻き戻す。
  // 完了に失敗した場合は完了マークを付けないので、そもそも戻す必要が無い。

  /** 新規棚卸を開始（現セッションをクリア） */
  function reset() {
    Object.keys(inventory).forEach(k => delete inventory[k])
    Object.keys(recountFlags).forEach(k => delete recountFlags[k])
    entryLog.splice(0, entryLog.length)
    completedAt.value = null
    Object.keys(removedAt).forEach(k => delete removedAt[k])
    Object.keys(itemNotes).forEach(k => delete itemNotes[k])
    _save()
  }

  function exportCSV() {
    // CSVフォーミュラインジェクション対策
    function csvSafe(val) {
      if (typeof val !== 'string' || val === '') return val
      return /^[=+\-@|]/.test(val) ? `'${val}` : val
    }

    const date   = localDateKey()
    // 読み込んだ情報を全て出力（復元で往復できるフラット形式）
    const header = '日付,商品コード,品目名,カテゴリ,単位,入数,前月実績,数量,単価,在庫金額'
    const rows = [header]

    // ジャンル順（ホームと同じ）→ 商品コード順（User指示 2026-10-02）
    const orderedItems = sortByCategoryAndCode([
      ...config.order,
      ...Object.keys(inventory).filter(k => !config.order.includes(k)),
    ], { categories: config.categories, codes: config.codes, categoryOrder: categoryOrderOf(config) })

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
    inventory, recountFlags, filledCount, totalValue, itemNotes,
    isCompleted, completedAt,
    entryLog,
    setItem, updateQty, removeItem, setRecountFlag, reset, exportCSV,
    completeSession,
  }
}
