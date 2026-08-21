import { ref, computed } from 'vue'
import { useConfig } from './useConfig.js'
import { useMovements } from './useMovements.js'
import { useHistory } from './useHistory.js'
import { saveMovementToD1, importPastSessionToD1, cancelPastImportOnD1 } from './useStore.js'
import { assertSpreadsheetFile, excelToCsv } from './usePdfImporter.js'
import { deliveryImportTemplateCSV } from '../utils/deliveryImportParser.js'
import { parseResultSnapshots } from '../utils/resultCsvParser.js'
import { STOCKTAKE_FIELDS, DELIVERY_FIELDS } from '../utils/rowMapping.js'
import {
  buildPastImportPlan, withResolution, commitPastImport, cancelPastImport,
} from '../services/pastImportPlan.js'

// 過去データ（納品・棚卸）の取込フローを1箇所に集約する composable。
// 入出庫画面・データ管理画面の両方から同じ動作で使う（導線が2箇所でも実装は1つ）。
// 状態（モーダル表示・CSV）は呼び出しごとに独立。

async function _fileToCsv(file) {
  if (/\.(xlsx|xls)$/i.test(file.name)) {
    assertSpreadsheetFile(file)
    return await excelToCsv(await file.arrayBuffer())
  }
  return await file.text()
}

export function useDataImport() {
  const { config, dictionary, masterDict, registerAlias, addItem } = useConfig()
  const { getMovements, saveMovement } = useMovements()
  const { getSnapshots, importPastSnapshot, deleteImportBatchLocal } = useHistory()

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

  // ── 列指定インポート（自動で読めなかったファイルの受け皿）──────
  //
  // 過去データの取込は仕入先ごとに列名が違う。ヘッダ名で列を特定する既存パーサが
  // 弾いたファイルを「形式を確認してください」で終わらせず、ユーザーが列を指定して
  // 中間CSVへ組み直せるようにする。組み直した後は通常の取込経路をそのまま通る。
  const rowMapper = ref(null)   // null | { kind, csvText, filename, title, message, fields }

  function openRowMapper(kind, { csvText, filename, message }) {
    rowMapper.value = {
      kind,
      csvText,
      filename,
      message,
      title:  kind === 'delivery' ? '過去の納品を列指定で取り込む' : '過去の棚卸を列指定で取り込む',
      fields: kind === 'delivery' ? DELIVERY_FIELDS : STOCKTAKE_FIELDS,
    }
  }

  function closeRowMapper() { rowMapper.value = null }

  /** 納品取込の解析に失敗した画面から列指定へ移る */
  function mapDeliveryColumns() {
    const csvText  = deliveryCsv.value
    const filename = deliveryFilename.value
    showDeliveryModal.value = false
    openRowMapper('delivery', { csvText, filename, message: '自動では列を判別できませんでした。列を指定してください。' })
  }

  /**
   * 列指定の結果（中間CSV）を、それぞれの通常経路へ戻す。
   * ここでも解析に失敗したら列指定画面へ戻す（対応づけの当て直しで復帰できる）。
   * @returns {boolean} 取込画面まで進めたか
   */
  async function applyRowMapping({ csvText, filename } = {}) {
    const kind = rowMapper.value?.kind
    if (!kind || !csvText) return false
    closeRowMapper()
    if (kind === 'delivery') {
      deliveryCsv.value       = csvText
      deliveryFilename.value  = filename ?? ''
      showDeliveryModal.value = true
      return true
    }
    return _openStocktakeFromCsv(csvText, filename ?? '')
  }

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

  // ── 過去棚卸取込（IMPORT-001）───────────────────────────────────
  //
  // 「解析 → 計画をプレビュー → サーバー確定 → 端末反映」の順で進める。
  // ファイルを選んだ時点では何も書き換えず、計画をモーダルへ渡すだけ。
  const showStocktakeModal = ref(false)
  const stocktakePlan      = ref(null)
  const stocktakeFilename  = ref('')

  /** ファイルから計画を作ってプレビューを開く。config・履歴は変更しない。 */
  async function openStocktakeFromFile(file) {
    if (!file) return false
    let csv
    try { csv = await _fileToCsv(file) }
    catch (_) { alert('ファイルの読み込みに失敗しました'); return false }
    return _openStocktakeFromCsv(csv, file.name)
  }

  /**
   * CSVテキストから計画を作る。ファイル選択と列指定の両方がここへ合流する。
   * 解析に失敗したら列指定画面を開く（alertで終わらせない）。
   */
  function _openStocktakeFromCsv(csv, filename) {
    try {
      const { snapshots, errors } = parseResultSnapshots(csv)
      const plan = buildPastImportPlan(snapshots, { existing: getSnapshots() })
      // 読めなかった行は捨てずに計画へ載せる。確認画面が行番号つきで出し、
      // 明示的に「除いて取り込む」と選ぶまで確定させない。
      stocktakePlan.value = { ...plan, rowErrors: errors ?? [] }
    } catch (err) {
      openRowMapper('stocktake', {
        csvText: csv,
        filename,
        message: err?.message || 'このファイルは自動で読み取れませんでした。',
      })
      return false
    }
    stocktakeFilename.value  = filename
    showStocktakeModal.value = true
    return true
  }

  function closeStocktake() {
    showStocktakeModal.value = false
    stocktakePlan.value      = null
    stocktakeFilename.value  = ''
  }

  /** 日付ごとの「別セッションとして追加 / 上書き」の選択を反映する */
  function setStocktakeResolution(date, resolution) {
    if (!stocktakePlan.value) return
    stocktakePlan.value = withResolution(stocktakePlan.value, date, resolution)
  }

  /**
   * プレビューで見せた計画を確定する。
   * サーバーが sessionId を返した日だけを端末へ反映し、成功件数を返す。
   *
   * `onlyDates` を渡すとその日だけを送る（部分再試行）。**batchId は計画のものを使い回す**ので、
   * 成功済みの日を送り直しても新しいセッションは増えない（サーバー側で冪等）。
   */
  async function confirmStocktakeImport(onlyDates) {
    if (!stocktakePlan.value) return { saved: [], failed: [], ok: false }
    return commitPastImport(stocktakePlan.value, {
      saveToServer: importPastSessionToD1,
      applyLocal:   importPastSnapshot,
      onlyDates,
    })
  }

  /** 取込バッチを取り消す（サーバー結果を確認してから端末を消す） */
  async function undoStocktakeImport(importBatchId) {
    return cancelPastImport(importBatchId, {
      cancelOnServer: cancelPastImportOnD1,
      deleteLocal:    deleteImportBatchLocal,
    })
  }

  return {
    // 納品取込
    showDeliveryModal, deliveryCsv, deliveryFilename, importCtx, existingMovements,
    openDeliveryFromFile, closeDelivery, onDeliveryImported, downloadDeliveryTemplate,
    // 列指定インポート（納品・棚卸の受け皿）
    rowMapper, closeRowMapper, applyRowMapping, mapDeliveryColumns,
    // 過去棚卸取込
    showStocktakeModal, stocktakePlan, stocktakeFilename,
    openStocktakeFromFile, closeStocktake, setStocktakeResolution,
    confirmStocktakeImport, undoStocktakeImport,
  }
}
