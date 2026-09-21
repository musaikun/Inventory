import { ref, computed } from 'vue'
import { runBusy, HEAVY_ROWS } from './useBusy.js'
import { useConfig } from './useConfig.js'
import { useMovements } from './useMovements.js'
import { useHistory } from './useHistory.js'
import { saveMovementToD1, importPastSessionToD1, cancelPastImportOnD1 } from './useStore.js'
import { assertSpreadsheetFile, excelToCsv, parsePdfFile } from './usePdfImporter.js'
import { deliveryImportTemplateCSV } from '../utils/deliveryImportParser.js'
import { parseResultSnapshots } from '../utils/resultCsvParser.js'
import { STOCKTAKE_FIELDS, DELIVERY_FIELDS, buildMappedCSV } from '../utils/rowMapping.js'
import { tokenizeCSV } from '../utils/csvParse.js'
import { pdfPagesToTable, rowsToCsv } from '../utils/pdfGrid.js'
import {
  fingerprintTable, fingerprintPdf, matchRecipe, matchPdfGridRecipe,
  applyRecipeColumns, saveRecipe, listRecipes, suggestRecipeName,
} from './importRecipes.js'
import {
  buildPastImportPlan, withResolution, commitPastImport, cancelPastImport,
} from '../services/pastImportPlan.js'

// 過去データ（納品・棚卸）の取込フローを1箇所に集約する composable。
// 入出庫画面・データ管理画面の両方から同じ動作で使う（導線が2箇所でも実装は1つ）。
// 状態（モーダル表示・CSV）は呼び出しごとに独立。

const isPdf = (file) => /\.pdf$/i.test(file?.name ?? '')

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

  // ── レシピ（保存した読み方）──────────────────────────────────
  //
  // 仕入先の帳票は**毎月同じ形で来る**。2回目以降に答えることは本来1つも無いのに、
  // 覚える仕組みは品目リストの取込にしか繋がっていなかった。紙やExcelから過去の
  // 納品・棚卸を入れるたびに、同じ列指定をやり直すことになっていた。
  //
  // 覚えるのは「どの列が何か」と、PDFなら「紙をどう表にしたか」。訊くのは**取り込んだ後**
  // （合っていたと分かる前に名前を付けさせても、何に名前を付けているのか分からない）。
  const pdfContext    = ref(null)   // { fp, grid } 紙を表にした作り方
  const pendingShape  = ref(null)   // 列指定の結果。取り込めたら保存を訊く
  const matchedRecipe = ref(null)   // 当たったレシピ（当たった回は保存を訊かない）
  const askRecipe     = ref(null)   // { shape, filename } 保存を訊いている最中
  const recipeName    = ref('')
  const savedRecipe   = ref('')     // 保存できたレシピの名前（1回だけ出す）
  const recipes       = ref(listRecipes())

  const _fieldsOf = (kind) => (kind === 'delivery' ? DELIVERY_FIELDS : STOCKTAKE_FIELDS)

  /**
   * 保存済みレシピで、このCSVをそのまま中間フォーマットへ組み直せるか試す。
   *
   * 見出しのある形／無い形の両方で照合する（どちらで保存したかは人が覚えていない）。
   * **必須の列が1つでも欠けるレシピは使わない** ── 半端に当てると、日付の無い行が
   * まとめて捨てられて「数が合わない」だけが残る。
   */
  function _tryRecipe(kind, csv) {
    let records
    try { records = tokenizeCSV(csv).rows } catch (_) { return null }
    if (!records?.length) return null
    const fields = _fieldsOf(kind)
    for (const r of [0, -1]) {
      const rec = matchRecipe(fingerprintTable(records, r))
      if (!rec || (rec.for ?? 'items') !== kind) continue
      const cols = applyRecipeColumns(rec, r >= 0 ? (records[r]?.cols ?? []) : [])
      if (fields.some(f => f.required && cols[f.key] === undefined)) continue
      return { csvText: buildMappedCSV(records, cols, fields, r === 0), recipe: rec }
    }
    return null
  }

  /** ファイルの中身を、レシピがあれば当ててから、それぞれの通常経路へ流す */
  function _ingest(kind, csv, filename) {
    const hit = _tryRecipe(kind, csv)
    matchedRecipe.value = hit?.recipe ?? null
    const text = hit ? hit.csvText : csv
    if (kind === 'delivery') {
      deliveryCsv.value       = text
      deliveryFilename.value  = filename ?? ''
      showDeliveryModal.value = true
      return true
    }
    return _openStocktakeFromCsv(text, filename ?? '')
  }

  /** 取り込めたので「この読み方を保存しますか」と訊く。当たった回は訊かない */
  function _offerRecipe(kind, filename) {
    const ctx = pdfContext.value
    if (matchedRecipe.value || (!pendingShape.value && !ctx)) { askRecipe.value = null; return }
    const shape = {
      kind: 'table', columns: [], headerRow: 0, headerNamed: true,
      ...(pendingShape.value ?? {}),
      for: kind,
      ...(ctx ? { pdfFp: ctx.fp, grid: ctx.grid } : {}),
    }
    askRecipe.value  = { shape, filename: filename ?? '' }
    recipeName.value = suggestRecipeName(filename ?? '')
  }

  function confirmSaveRecipe() {
    if (!askRecipe.value) return
    const rec = saveRecipe({ ...askRecipe.value.shape, name: recipeName.value.trim() || '無題のレシピ' })
    savedRecipe.value = rec.name
    askRecipe.value   = null
    recipes.value     = listRecipes()
  }
  function dismissRecipe() { askRecipe.value = null }

  // ── PDF（紙の納品書・棚卸表）────────────────────────────────
  //
  // **PDFだけは、そのままCSVにできない。** 何枚の表が刷られているか・行の高さ・列の
  // 境界を人が決めて初めて表になる（`PdfGridSetup`）。そこを通したあとは、CSV・Excel と
  // まったく同じ経路へ合流する ── 納品なら `DeliveryImportModal`、棚卸なら計画づくり。
  // どちらも自動で読めなければ列指定へ落ちるので、紙の帳票でも行き止まりにならない。
  const pdfSetup = ref(null)   // null | { kind: 'delivery'|'stocktake', file, pages }

  /** PDFを開いて「表にする画面」を出す。ここでは何も取り込まない */
  async function _openPdfSetup(kind, file) {
    let pages = []
    try {
      pages = await runBusy('PDFを読み込み中…', async () => {
        const { pages: pg } = await parsePdfFile(await file.arrayBuffer())
        return pg ?? []
      })
    } catch (err) {
      alert(err?.message || 'PDFの読み込みに失敗しました')
      return false
    }
    if (!pages.length) {
      alert('このPDFからは文字を取り出せませんでした。写真やスキャンの画像だけのPDFは読み取れません。')
      return false
    }
    // 表の作り方まで覚えているレシピが当たったら、問いを出さずにそのまま流す
    const fp  = fingerprintPdf(pages[0]?.tokens ?? [])
    const rec = matchPdfGridRecipe(fp)
    if (rec?.grid && (rec.for ?? 'items') === kind) {
      const built = pdfPagesToTable(pages, rec.grid)
      if (built.rows.length >= 2) {
        pdfContext.value = { fp, grid: rec.grid }
        return _ingest(kind, rowsToCsv(built.rows), file.name)
      }
    }
    pdfContext.value = null
    pdfSetup.value = { kind, file, pages, fp, initial: rec?.grid ?? null }
    return true
  }
  function closePdfSetup() { pdfSetup.value = null }

  /** 表にする画面の結果（CSV）を、それぞれの通常経路へ流す */
  async function applyPdfSetup({ csvText, grid } = {}) {
    const kind = pdfSetup.value?.kind
    const filename = pdfSetup.value?.file?.name ?? ''
    const fp = pdfSetup.value?.fp ?? null
    if (!kind || !csvText) return false
    pdfSetup.value = null
    // 紙をどう表にしたかは、このあとレシピへ一緒に残す（翌月は問いが1つも出ない）
    pdfContext.value = grid ? { fp, grid } : null
    return _ingest(kind, csvText, filename)
  }

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
  async function applyRowMapping({ csvText, filename, recipeShape } = {}) {
    const kind = rowMapper.value?.kind
    if (!kind || !csvText) return false
    closeRowMapper()
    // 取り込めたら「この読み方を保存しますか」と訊くための控え
    pendingShape.value = recipeShape ?? null
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
    if (isPdf(file)) { await _openPdfSetup('delivery', file); return }
    let csv
    try {
      // Excelはここで表へ変換する。大きいファイルでは数秒かかる
      csv = await runBusy('ファイルを読み込み中…', () => _fileToCsv(file))
    } catch (_) { alert('ファイルの読み込みに失敗しました'); return }
    pdfContext.value = null
    _ingest('delivery', csv, file.name)
  }

  function closeDelivery() { showDeliveryModal.value = false; deliveryCsv.value = '' }

  // DeliveryImportModal の @imported ペイロードを受けて確定保存する。
  // 種別が出庫の行は出庫として保存される（ペイロードの type をそのまま使う）。
  // @returns 保存した入出庫レコード数
  function onDeliveryImported(payload = {}) {
    // 保存件数を返す契約は変えない。待ちの表示だけ被せる。
    // 件数が多いときだけ先に描く（少ないときに待たせないため）
    const rows = (payload.movements ?? []).length
    return runBusy('取り込み中…', () => _applyDeliveryImport(payload),
      { paintFirst: rows >= HEAVY_ROWS })
  }
  function _applyDeliveryImport({ movements = [], aliasPairs = [], newItems = [] } = {}) {
    for (const it of newItems) addItem(it.name, it.price, it.category, it.unit)
    for (const p of aliasPairs) registerAlias(p.term, p.canonical)
    let n = 0
    for (const mv of movements) {
      const rec = saveMovement(mv)
      if (rec) { saveMovementToD1(rec); n++ }
    }
    closeDelivery()
    if (n > 0) _offerRecipe('delivery', deliveryFilename.value)
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
    if (isPdf(file)) return await _openPdfSetup('stocktake', file)
    let csv
    try { csv = await runBusy('ファイルを読み込み中…', () => _fileToCsv(file)) }
    catch (_) { alert('ファイルの読み込みに失敗しました'); return false }
    // 解析と計画づくりは同期。行が多いと数百ms止まるので、そのときだけ先に描く
    const rows = csv.split('\n').length
    pdfContext.value = null
    return await runBusy('読み込んだ内容を確認中…', () => _ingest('stocktake', csv, file.name),
      { paintFirst: rows >= HEAVY_ROWS })
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
    // 日付ごとにサーバーへ往復する。件数が多いと明確に待たされる
    const filename = stocktakeFilename.value
    const res = await runBusy('取り込み中…', () => commitPastImport(stocktakePlan.value, {
      saveToServer: importPastSessionToD1,
      applyLocal:   importPastSnapshot,
      onlyDates,
    }))
    if (res?.saved?.length) _offerRecipe('stocktake', filename)
    return res
  }

  /** 取込バッチを取り消す（サーバー結果を確認してから端末を消す） */
  async function undoStocktakeImport(importBatchId) {
    return runBusy('取り消し中…', () => cancelPastImport(importBatchId, {
      cancelOnServer: cancelPastImportOnD1,
      deleteLocal:    deleteImportBatchLocal,
    }))
  }

  return {
    // 納品取込
    showDeliveryModal, deliveryCsv, deliveryFilename, importCtx, existingMovements,
    openDeliveryFromFile, closeDelivery, onDeliveryImported, downloadDeliveryTemplate,
    // 列指定インポート（納品・棚卸の受け皿）
    rowMapper, closeRowMapper, applyRowMapping, mapDeliveryColumns,
    // PDF（紙の納品書・棚卸表）を表にしてから同じ経路へ流す
    pdfSetup, closePdfSetup, applyPdfSetup,
    // レシピ（保存した読み方）
    askRecipe, recipeName, savedRecipe, recipes, matchedRecipe,
    confirmSaveRecipe, dismissRecipe,
    // 過去棚卸取込
    showStocktakeModal, stocktakePlan, stocktakeFilename,
    openStocktakeFromFile, closeStocktake, setStocktakeResolution,
    confirmStocktakeImport, undoStocktakeImport,
  }
}
