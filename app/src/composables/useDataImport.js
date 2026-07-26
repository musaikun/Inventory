import { ref, computed } from 'vue'
import { useConfig } from './useConfig.js'
import { useMovements } from './useMovements.js'
import { useHistory } from './useHistory.js'
import { saveMovementToD1, saveSnapshotToD1 } from './useStore.js'
import { excelToCsv } from './usePdfImporter.js'
import { deliveryImportTemplateCSV } from '../utils/deliveryImportParser.js'
import { parseResultSnapshots } from '../utils/resultCsvParser.js'

// 過去データ（納品・棚卸）の取込フローを1箇所に集約する composable。
// 入出庫画面・データ管理画面の両方から同じ動作で使う（導線が2箇所でも実装は1つ）。
// 状態（モーダル表示・CSV）は呼び出しごとに独立。

async function _fileToCsv(file) {
  if (/\.(xlsx|xls)$/i.test(file.name)) return excelToCsv(await file.arrayBuffer())
  return await file.text()
}

export function useDataImport() {
  const { config, dictionary, masterDict, registerAlias, addItem } = useConfig()
  const { getMovements, saveMovement } = useMovements()
  const { getSnapshots, importPastSnapshot } = useHistory()

  // ── 納品取込（ステージングモーダル経由）───────────────────────
  const showDeliveryModal = ref(false)
  const deliveryCsv       = ref('')
  const deliveryFilename  = ref('')

  const importCtx = computed(() => ({
    order:      config.order || [],
    dictionary: dictionary.value || {},
    masterDict: masterDict || {},
    categories: config.categories || {},
  }))
  const existingMovements = () => getMovements()

  async function openDeliveryFromFile(file) {
    if (!file) return
    try {
      deliveryCsv.value = await _fileToCsv(file)
    } catch (_) { alert('ファイルの読み込みに失敗しました'); return }
    deliveryFilename.value = file.name
    showDeliveryModal.value = true
  }

  function closeDelivery() { showDeliveryModal.value = false; deliveryCsv.value = '' }

  // DeliveryImportModal の @imported ペイロードを受けて確定保存する。
  // @returns 保存した入庫レコード数
  function onDeliveryImported({ movements = [], aliasPairs = [], newItems = [] } = {}) {
    for (const it of newItems) addItem(it.name, it.price, it.category, it.unit)
    for (const p of aliasPairs) registerAlias(p.term, p.canonical)
    let n = 0
    for (const mv of movements) {
      const rec = saveMovement(mv)
      if (rec) { saveMovementToD1(rec); n++ }
    }
    closeDelivery()
    return n
  }

  function downloadDeliveryTemplate() {
    const blob = new Blob(['﻿' + deliveryImportTemplateCSV()], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = '納品取込テンプレート.csv'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  // ── 過去棚卸取込（名寄せ不要・確認して直接挿入）─────────────────
  // @returns 取り込んだ日数（0 = 未取込/キャンセル）
  async function importStocktakeFromFile(file) {
    if (!file) return 0
    let csv
    try { csv = await _fileToCsv(file) }
    catch (_) { alert('ファイルの読み込みに失敗しました'); return 0 }

    let snaps
    try { snaps = parseResultSnapshots(csv) }
    catch (err) { alert(err?.message || '取り込みに失敗しました'); return 0 }

    const existing = new Set(getSnapshots().map(s => s.date))
    const collide  = snaps.filter(s => existing.has(s.date)).length
    const msg = `${snaps.length}日分の過去棚卸を取り込みます。`
      + (collide > 0 ? `\n※ 既存の${collide}日分は上書きされます。` : '')
      + `\nよろしいですか？`
    if (!window.confirm(msg)) return 0

    let n = 0
    for (const s of snaps) {
      const rec = importPastSnapshot(s)
      if (rec) { saveSnapshotToD1(rec); n++ }
    }
    if (n > 0) alert(`${n}日分の過去棚卸を取り込みました。`)
    return n
  }

  return {
    // 納品取込
    showDeliveryModal, deliveryCsv, deliveryFilename, importCtx, existingMovements,
    openDeliveryFromFile, closeDelivery, onDeliveryImported, downloadDeliveryTemplate,
    // 過去棚卸取込
    importStocktakeFromFile,
  }
}
