import { reactive, computed, ref } from 'vue'
import {
  DICTIONARY as DEFAULT_DICT,
  INVENTORY_ORDER as DEFAULT_ORDER,
  ITEM_UNITS as DEFAULT_UNITS,
  SAMPLE_DICTIONARY,
  SAMPLE_ORDER,
  SAMPLE_UNITS,
} from '../config.js'
import { STORAGE_KEYS } from '../utils/storageKeys.js'
import { isPro, FREE_ITEM_LIMIT } from '../utils/planLimits.js'
import { toCSVRow } from '../utils/csvParse.js'
import {
  parseItemCSV,
  parseMappedCSV,
  buildImportPlan,
  parseCSVLine,
  IMPORT_MODE_MERGE,
  IMPORT_MODE_REPLACE,
  ALIAS_KEEP_EXISTING,
  ALIAS_TAKEOVER,
} from '../utils/itemImport.js'

export { IMPORT_MODE_MERGE, IMPORT_MODE_REPLACE, ALIAS_KEEP_EXISTING, ALIAS_TAKEOVER }

const CONFIG_KEY  = STORAGE_KEYS.config
const ALIASES_KEY = STORAGE_KEYS.aliases

export const AXIS_NAME_MAX = 10   // 分類名の文字数上限
const MASTER_KEY  = STORAGE_KEYS.master

let _onConfigChanged = null
export function setConfigChangedCallback(fn) { _onConfigChanged = fn }

// ── モジュールスコープ シングルトン ────────────────────────────────────────────
const config = reactive({
  order:          [...DEFAULT_ORDER],
  units:          { ...DEFAULT_UNITS },
  prices:         {},
  categories:     {},
  codes:          {},
  categoryCodes:  {},
  prevMonths:     {},
  lotSizes:       {},
  reorderPoints:  {},        // 品目 → 発注点（この理論在庫以下で「要補充」）。手動設定
  replenishTargets: {},      // 品目 → 補充目標（発注してここまで戻す）。未設定は自動算出
  orderInputMode: 'auto',    // 発注数の決め方 'auto'=不足分に追従 / 'manual'=自分で入力
  dictionary:     { ...DEFAULT_DICT },
  isCustom:       false,
  savedAt:        null,
  manualItems:    [],  // フォームから手動追加した品目名（CSV品目と区別）
  axisNames:      ['', ''],  // 汎用2軸の名前（例: '場所', '仕入先'）。空=未使用
  tagsA:          {},        // 品目 → 軸1のグループ名（フラットマップ）
  tagsB:          {},        // 品目 → 軸2のグループ名
  axisGroupsA:    [],        // 軸1の定義済みグループ名一覧（空グループも保持）
  axisGroupsB:    [],        // 軸2の定義済みグループ名一覧
  hiddenItems:    [],        // 非表示にした品目名（マスタは不変・進捗の分母から除外）
  hiddenAuto:     [],        // hiddenItems のうち「前回まで未入力」で自動非表示にしたもの（由来マーカー）
  tagsArchiveA:   {},        // 軸1の割り当てを品目名で永続記憶（取込/一括削除をまたいで復元用）
  tagsArchiveB:   {},        // 軸2の割り当てアーカイブ
  orderSchedule:  { days: [], deadline: '' },  // 発注スケジュール（days:0=日..6=土 / deadline:'HH:MM'）
})

// 自動学習エイリアス（別ストレージ）
const learnedAliases = reactive({})

// マスター辞書: { keyword: canonical[] }（1対多・永続）
const masterDict = reactive({})

// マージ済み辞書: CSV定義 + 自動学習エイリアス
const dictionary = computed(() => ({
  ...config.dictionary,
  ...learnedAliases,
}))

// CSV パーサーは utils/itemImport.js と共用（取込プレビューと同じ解析を使う）

// 軸の割り当ては「品目 → グループ名の配列」（多ロケーション対応）。
// 旧データ（文字列）や不正値を配列へ正規化する。
function _normTags(m) {
  const out = {}
  if (m && typeof m === 'object') {
    for (const k of Object.keys(m)) {
      const v = m[k]
      const arr = (Array.isArray(v) ? v : (v ? [v] : []))
        .map(x => String(x).trim()).filter(Boolean)
      if (arr.length) out[k] = [...new Set(arr)]
    }
  }
  return out
}

// ── 品目リストのデータフィールドを一箇所で扱う（同期・永続の食い違いを防ぐ）──────
// ここに追加すれば save / load / snapshot / restore / getter / payload すべてに反映される。
// manualItems / isCustom / savedAt は文脈ごとに扱いが違うため各関数で個別に付与する。
function _serializeConfigData() {
  return {
    order:         config.order,
    units:         config.units,
    prices:        config.prices,
    categories:    config.categories,
    codes:         config.codes,
    categoryCodes: config.categoryCodes,
    prevMonths:    config.prevMonths,
    lotSizes:      config.lotSizes,
    reorderPoints: config.reorderPoints,
    replenishTargets: config.replenishTargets,
    orderInputMode: config.orderInputMode,
    dictionary:    config.dictionary,
    axisNames:     config.axisNames,
    tagsA:         config.tagsA,
    tagsB:         config.tagsB,
    axisGroupsA:   config.axisGroupsA,
    axisGroupsB:   config.axisGroupsB,
    hiddenItems:   config.hiddenItems,
    hiddenAuto:    config.hiddenAuto,
    tagsArchiveA:  config.tagsArchiveA,
    tagsArchiveB:  config.tagsArchiveB,
    orderSchedule: config.orderSchedule,
  }
}
function _assignConfigData(src) {
  config.order         = Array.isArray(src.order) ? src.order : []
  config.units         = src.units         ?? {}
  config.prices        = src.prices        ?? {}
  config.categories    = src.categories    ?? {}
  config.codes         = src.codes         ?? {}
  config.categoryCodes = src.categoryCodes ?? {}
  config.prevMonths    = src.prevMonths    ?? {}
  config.lotSizes      = src.lotSizes      ?? {}
  config.reorderPoints = src.reorderPoints ?? {}
  config.replenishTargets = src.replenishTargets ?? {}
  config.orderInputMode = src.orderInputMode === 'manual' ? 'manual' : 'auto'
  config.dictionary    = src.dictionary    ?? {}
  config.axisNames     = Array.isArray(src.axisNames) ? src.axisNames : ['', '']
  config.tagsA         = _normTags(src.tagsA)
  config.tagsB         = _normTags(src.tagsB)
  config.axisGroupsA   = Array.isArray(src.axisGroupsA) ? src.axisGroupsA : []
  config.axisGroupsB   = Array.isArray(src.axisGroupsB) ? src.axisGroupsB : []
  config.hiddenItems   = Array.isArray(src.hiddenItems) ? src.hiddenItems : []
  config.hiddenAuto    = Array.isArray(src.hiddenAuto) ? src.hiddenAuto : []
  config.tagsArchiveA  = _normTags(src.tagsArchiveA)
  config.tagsArchiveB  = _normTags(src.tagsArchiveB)
  config.orderSchedule = _normSchedule(src.orderSchedule)
}

// 発注スケジュールの正規化（days は 0..6 の整数配列・重複除去、deadline は 'HH:MM'）
function _normSchedule(s) {
  const days = Array.isArray(s?.days)
    ? [...new Set(s.days.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6))]
    : []
  const deadline = /^\d{1,2}:\d{2}$/.test(s?.deadline || '') ? s.deadline : ''
  return { days, deadline }
}

// ── 品目リスト ロード / セーブ ───────────────────────────────────────────────
function _load() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY)
    if (!raw) return
    const saved = JSON.parse(raw)
    // CONFIG_KEY はカスタム設定でのみ保存される（空リスト開始も含む）。
    // 空の品目リストでも軸名・グループ等を復元できるよう order 空も許容する。
    if (Array.isArray(saved.order)) {
      _assignConfigData(saved)
      config.manualItems   = saved.manualItems   ?? []
      config.isCustom      = true
      config.savedAt       = saved.savedAt       ?? null
    }
  } catch (_) {}
}

function _saveLocalOnly() {
  try {
    config.savedAt = new Date().toISOString()
    localStorage.setItem(CONFIG_KEY, JSON.stringify({
      ..._serializeConfigData(),
      manualItems: config.manualItems,
      savedAt:     config.savedAt,
    }))
    config.isCustom = true
  } catch (_) {}
}

function _save() {
  // 取込の取り消しは「取り込んだ直後」だけ有効。品目マスタが他の理由で変わった時点で失効させる。
  _dropImportBackup()
  _saveLocalOnly()
  _onConfigChanged?.()
}

// 発注スケジュール（頻度＝発注曜日・締切）を設定して保存（localStorage + D1）。
function setOrderSchedule({ days, deadline } = {}) {
  config.orderSchedule = _normSchedule({ days, deadline })
  config.isCustom = true
  _save()
}

// ── 自動学習エイリアス ────────────────────────────────────────────────────────
function _loadAliases() {
  try {
    const raw = localStorage.getItem(ALIASES_KEY)
    if (!raw) return
    const saved = JSON.parse(raw)
    if (saved && typeof saved === 'object') Object.assign(learnedAliases, saved)
  } catch (_) {}
}

function _saveAliases() {
  try {
    localStorage.setItem(ALIASES_KEY, JSON.stringify({ ...learnedAliases }))
  } catch (_) {}
}

function _validateLearnedAliases(newOrder) {
  const orderSet = new Set(newOrder)
  for (const alias of Object.keys(learnedAliases)) {
    if (!orderSet.has(learnedAliases[alias])) delete learnedAliases[alias]
  }
  _saveAliases()
}

// ── マスター辞書 ロード / セーブ ─────────────────────────────────────────────
function _loadMaster() {
  try {
    const raw = localStorage.getItem(MASTER_KEY)
    if (!raw) return
    const saved = JSON.parse(raw)
    if (saved && typeof saved === 'object') Object.assign(masterDict, saved)
  } catch (_) {}
}

function _saveMaster() {
  try {
    localStorage.setItem(MASTER_KEY, JSON.stringify({ ...masterDict }))
  } catch (_) {}
}

_load()
_loadAliases()
_loadMaster()

// アカウント切替時のローカル全消去（品目マスタ・辞書・学習エイリアス）。
// メモリと localStorage の両方を初期状態へ戻す（前アカウントのデータ残存＝漏洩を防ぐ）。
export function resetLocalData() {
  // 取込の退避は前アカウントの品目マスタそのもの。境界では必ず捨てる（漏洩防止）
  _dropImportBackup()
  _assignConfigData({ order: [...DEFAULT_ORDER], units: { ...DEFAULT_UNITS }, dictionary: { ...DEFAULT_DICT } })
  config.manualItems = []
  config.isCustom    = false
  config.savedAt     = null
  for (const k of Object.keys(learnedAliases)) delete learnedAliases[k]
  for (const k of Object.keys(masterDict))     delete masterDict[k]
  try {
    localStorage.removeItem(CONFIG_KEY)
    localStorage.removeItem(ALIASES_KEY)
    localStorage.removeItem(MASTER_KEY)
  } catch (_) {}
}

// ── リモート設定の適用（同期ゲスト参加時にホストの品目リストを受け取る） ───────
export function applyRemoteConfig(cfg) {
  if (!cfg || !Array.isArray(cfg.order) || cfg.order.length === 0) return
  // ホストのリストで上書きされたあとに「取込を取り消す」とホスト側と食い違うため退避を捨てる
  _dropImportBackup()
  _validateLearnedAliases(cfg.order)
  _assignConfigData(cfg)
  _saveLocalOnly()
}

// 振り分けアーカイブの上限（古いキーから捨てる）
const ARCHIVE_CAP = 2000
function _pruneArchive() {
  for (const arch of [config.tagsArchiveA, config.tagsArchiveB]) {
    const keys = Object.keys(arch)
    if (keys.length > ARCHIVE_CAP) for (const k of keys.slice(0, keys.length - ARCHIVE_CAP)) delete arch[k]
  }
}

// 取込計画の共通オプション（Free は品目上限つき、Pro は無制限）
function _planOptions(mode, aliasPolicy = ALIAS_KEEP_EXISTING) {
  return {
    mode,
    aliasPolicy,
    itemLimit:   isPro() ? Infinity : FREE_ITEM_LIMIT,
    axisNameMax: AXIS_NAME_MAX,
  }
}

// 直前の取込を1回だけ元に戻すための退避。メモリのみで、再読込・アカウント切替では消える。
// 「取り込んだ直後に間違いに気づく」ケースを救うためのもので、履歴ではない。
// 品目マスタが他の理由で1回でも変わったら（_save 経由）失効する。
let _importBackup = null
export const importUndoAvailable = ref(false)

function _snapshotForUndo() {
  try {
    return JSON.parse(JSON.stringify({
      ..._serializeConfigData(),
      manualItems: config.manualItems,
    }))
  } catch (_) {
    return null
  }
}

function _dropImportBackup() {
  _importBackup = null
  importUndoAvailable.value = false
}

// 取込計画を config へ適用する。ここだけが状態を書き換える。
function _applyImportPlan(plan) {
  const backup = _snapshotForUndo()   // 取込前の品目マスタ
  _validateLearnedAliases(plan.order)

  config.order         = plan.order
  config.units         = plan.units
  config.prices        = plan.prices
  config.categories    = plan.categories
  config.codes         = plan.codes
  config.categoryCodes = plan.categoryCodes
  config.prevMonths    = plan.prevMonths
  config.lotSizes      = plan.lotSizes
  config.reorderPoints = plan.reorderPoints
  config.dictionary    = plan.dictionary
  config.tagsA         = plan.tagsA
  config.tagsB         = plan.tagsB
  config.axisNames     = [plan.axisNames[0] ?? '', plan.axisNames[1] ?? '']
  config.manualItems   = plan.manualItems

  // 復元した割り当てを再びアーカイブへ記憶（取込をまたいで復元できるように）
  for (const nm of plan.order) {
    if (plan.tagsA[nm]?.length) config.tagsArchiveA[nm] = [...plan.tagsA[nm]]
    if (plan.tagsB[nm]?.length) config.tagsArchiveB[nm] = [...plan.tagsB[nm]]
  }
  _pruneArchive()
  _save()   // ここで前回の退避が失効する

  // 退避は保存のあとに立てる。以降、取込以外の変更が入るまで取り消せる。
  _importBackup = backup
  importUndoAvailable.value = !!backup

  return _importResult(plan)
}

// 取込結果のサマリー（count / truncated / merged は従来の呼び出し元との互換のため維持）
function _importResult(plan) {
  const s = plan.summary
  return {
    mode:         plan.mode,
    count:        plan.order.length,    // 取込後の総品目数
    added:        s.added.length,
    updated:      s.updated.length,
    unchanged:    s.unchanged.length,
    removed:      s.removed.length,     // 全入れ替えで消えた品目数
    skipped:      s.skipped.length,     // 取り込めなかった行数
    truncated:    s.truncated.length,   // Free上限で入らなかった品目数
    merged:       s.duplicates,         // ファイル内の同名重複行
    restoredTags: plan.restoredTags,
  }
}

// ── Public API ────────────────────────────────────────────────────────────────
export function useConfig() {

  /** 品目選択時にサイレント自動登録（learnedAliases + masterDict の両方に書く）*/
  function registerAlias(searchTerm, canonical) {
    if (!searchTerm || !canonical) return
    const term = searchTerm.trim()
    if (!term || term === canonical) return

    // learnedAliases: 1対1・CSV差替で無効分削除
    if (learnedAliases[term] !== canonical) {
      learnedAliases[term] = canonical
      _saveAliases()
    }

    // masterDict: 1対多・永続
    if (!masterDict[term]) masterDict[term] = []
    if (!masterDict[term].includes(canonical)) {
      masterDict[term].push(canonical)
      _saveMaster()
    }
  }

  /**
   * 棚卸品目 CSV 読み込み（品目名,単位,単価,カテゴリ,エイリアス,…）
   * 旧フォーマット（2/3/4列）も互換。
   *
   * 既定は「追加・更新」（IMPORT_MODE_MERGE）。ファイルに無い既存品目は消さず、
   * 同名品目はファイルにある列だけを上書きする。全入れ替えは呼び出し側が
   * { mode: IMPORT_MODE_REPLACE } を明示したときだけ行う（S5 / 2026-08-08）。
   */
  function loadFromCSV(csvText, { mode = IMPORT_MODE_MERGE, aliasPolicy } = {}) {
    return applyImportPlan(planCSVImport(csvText, { mode, aliasPolicy }))
  }

  /**
   * 取込計画を組み立てる（config は変更しない）。
   * 画面はこの計画をプレビューへ出し、**同じ計画オブジェクト**を applyImportPlan へ渡す。
   * プレビューと取込で解析・計画を2回作らないので、両者がずれる余地が無い。
   */
  function planCSVImport(csvText, { mode = IMPORT_MODE_MERGE, aliasPolicy } = {}) {
    return buildImportPlan(parseItemCSV(csvText), config, _planOptions(mode, aliasPolicy))
  }

  /** loadFromCSV の取込前プレビュー（件数と差分だけ必要な呼び出し元向け） */
  function previewCSVImport(csvText, opts = {}) {
    return planCSVImport(csvText, opts).summary
  }

  /**
   * 棚卸品目 CSV エクスポート。
   *
   * セルの書き出しは utils/csvParse.js の toCSVRow に一本化する（フォーミュラ対策も込み）。
   * 以前は値を `"..."` で囲むだけだったので、`5" 皿` のように引用符を含む品目名・単位・
   * エイリアスを出力すると、読み戻したときにセルが割れて列がずれていた。
   */
  function exportConfigCSV() {
    const a0 = config.axisNames?.[0] || '軸1'
    const a1 = config.axisNames?.[1] || '軸2'
    const rows = [toCSVRow(
      ['品目名', '単位', '単価', 'カテゴリ', 'エイリアス', '商品コード', '分類コード', '前月実績', '入数', a0, a1, '発注点'],
    )]
    config.order.forEach(item => {
      const aliases = Object.entries(config.dictionary)
        .filter(([, v]) => v === item)
        .map(([k]) => k)
      rows.push(toCSVRow([
        item,
        config.units[item]      ?? '',
        config.prices[item]     ?? '',
        config.categories[item] ?? '',
        aliases.join(','),
        config.codes[item]      ?? '',
        config.categoryCodes[config.categories[item]] ?? '',
        config.prevMonths[item] ?? '',
        config.lotSizes[item]   ?? '',
        (config.tagsA[item] ?? []).join('|'),
        (config.tagsB[item] ?? []).join('|'),
        config.reorderPoints?.[item] ?? '',
      ], { formulaGuard: true }))
    })
    return rows.join('\r\n')
  }

  /** 現在の品目リストをディープコピーで退避する（練習モードの一時切替用） */
  function snapshotConfig() {
    return JSON.parse(JSON.stringify({
      ..._serializeConfigData(),
      isCustom:    config.isCustom,
      manualItems: config.manualItems,
    }))
  }

  /** snapshotConfig で退避した品目リストを復元する */
  function restoreConfigSnapshot(snap) {
    if (!snap) return
    _assignConfigData(snap)
    config.manualItems   = snap.manualItems   ?? []
    config.isCustom      = !!snap.isCustom
    if (snap.isCustom) _saveLocalOnly()
    else localStorage.removeItem(CONFIG_KEY)
  }

  /**
   * 空の品目リストで開始（棚卸しながら品目を追加／一括削除して再取込する用）。
   * 既定では振り分けのアーカイブを残し、同名品目を再登録すれば割り当てが復活する。
   * opts.resetAssignments=true で振り分けの記憶も消す。
   */
  function setEmptyList(opts = {}) {
    config.order         = []
    config.units         = {}
    config.prices        = {}
    config.categories    = {}
    config.codes         = {}
    config.categoryCodes = {}
    config.prevMonths    = {}
    config.lotSizes      = {}
    config.reorderPoints = {}
    config.replenishTargets = {}
    config.dictionary    = {}
    config.manualItems   = []
    // 軸（軸名・グループ定義）は店舗の永続設定。品目を空にしても消さない。
    config.tagsA         = {}
    config.tagsB         = {}
    if (opts.resetAssignments === true) { config.tagsArchiveA = {}; config.tagsArchiveB = {} }
    config.hiddenItems   = []
    config.hiddenAuto    = []
    config.isCustom      = true   // 意図的な空リスト（セットアップ完了扱い）
    config.savedAt       = null
    localStorage.removeItem(CONFIG_KEY)
  }

  /** サンプルデータを読み込む（動作確認用） */
  function loadSampleData() {
    config.order         = [...SAMPLE_ORDER]
    config.units         = { ...SAMPLE_UNITS }
    config.prices        = {}
    config.categories    = {}
    config.codes         = {}
    config.categoryCodes = {}
    config.prevMonths    = {}
    config.lotSizes      = {}
    config.reorderPoints = {}
    config.replenishTargets = {}
    config.dictionary    = { ...SAMPLE_DICTIONARY }
    // 軸（軸名・グループ定義）は店舗の永続設定。練習でも消さない（終了時に復元もされる）。
    config.tagsA         = {}
    config.tagsB         = {}
    config.hiddenItems   = []
    config.hiddenAuto    = []
    config.isCustom      = false
    config.savedAt       = null
    localStorage.removeItem(CONFIG_KEY)
  }

  /**
   * ローカルの品目リストを空（初期状態）に掃除する
   * ゲストのルーム参加/退出時専用 — ホストが正のため、退出端末にデータを残さない（流出対策）
   * ※「デフォルトに戻す」UIではない。ホストの正データを消す用途には絶対に使わないこと
   */
  function clearConfig() {
    _assignConfigData({ order: [...DEFAULT_ORDER], units: { ...DEFAULT_UNITS }, dictionary: { ...DEFAULT_DICT } })
    config.manualItems = []
    config.isCustom    = false
    config.savedAt     = null
    localStorage.removeItem(CONFIG_KEY)
  }

  // ── マスター辞書 API ──────────────────────────────────────────────────────────

  /**
   * マスター辞書 CSV 読み込み（キーワード,品目名）
   * 1つのキーワードが複数品目を指せる（1対多）
   */
  function loadMasterFromCSV(csvText) {
    const text  = csvText.replace(/^\uFEFF/, '').trim()
    const lines = text.split(/\r?\n/).filter(l => l.trim())

    if (lines.length < 2) throw new Error('データ行がありません')

    // 全削除して再構築
    Object.keys(masterDict).forEach(k => delete masterDict[k])

    for (let i = 1; i < lines.length; i++) {
      const cols    = parseCSVLine(lines[i])
      const keyword = cols[0]?.trim()
      const item    = cols[1]?.trim()
      if (!keyword || !item) continue
      if (!masterDict[keyword]) masterDict[keyword] = []
      if (!masterDict[keyword].includes(item)) masterDict[keyword].push(item)
    }

    _saveMaster()
    return { keywordCount: Object.keys(masterDict).length }
  }

  /** マスター辞書 CSV エクスポート */
  function exportMasterCSV() {
    const rows = ['キーワード,品目名']
    for (const [keyword, items] of Object.entries(masterDict)) {
      for (const item of items) {
        rows.push(`"${keyword}","${item}"`)
      }
    }
    return rows.join('\r\n')
  }

  /** マスター辞書をすべて削除 */
  function resetMaster() {
    Object.keys(masterDict).forEach(k => delete masterDict[k])
    localStorage.removeItem(MASTER_KEY)
  }

  /** キーワード→品目の1ペアを追加 */
  function addMasterEntry(keyword, item) {
    const k = keyword.trim()
    const i = item.trim()
    if (!k || !i) return
    if (!masterDict[k]) masterDict[k] = []
    if (!masterDict[k].includes(i)) {
      masterDict[k].push(i)
      _saveMaster()
    }
  }

  /** キーワード→品目の1ペアを削除（そのキーワードの最後の品目なら行ごと削除）*/
  function deleteMasterEntry(keyword, item) {
    if (!masterDict[keyword]) return
    const idx = masterDict[keyword].indexOf(item)
    if (idx < 0) return
    masterDict[keyword].splice(idx, 1)
    if (masterDict[keyword].length === 0) delete masterDict[keyword]
    _saveMaster()
  }

  function addItem(name, price, category, unit, code) {
    const n = name.trim()
    if (!n || config.order.includes(n)) return false
    if (!isPro() && config.order.length >= FREE_ITEM_LIMIT) return false
    config.order.push(n)
    if (price != null && !isNaN(price) && price > 0) config.prices[n] = price
    if (category?.trim()) config.categories[n] = category.trim()
    if (unit?.trim())     config.units[n]       = unit.trim()
    if (code?.trim())     config.codes[n]        = code.trim()
    if (!config.manualItems.includes(n)) config.manualItems.push(n)
    // 同名品目が過去に振り分けられていれば復元（削除→再追加・個人利用の積み上げに対応）
    if (config.tagsA[n] === undefined && Array.isArray(config.tagsArchiveA[n])) config.tagsA[n] = [...config.tagsArchiveA[n]]
    if (config.tagsB[n] === undefined && Array.isArray(config.tagsArchiveB[n])) config.tagsB[n] = [...config.tagsArchiveB[n]]
    _save()
    return true
  }

  // unit を渡すと単位も更新する（undefined のときは触らない＝後方互換）
  function updateConfigItem(oldName, newName, price, category, unit) {
    const idx = config.order.indexOf(oldName)
    if (idx < 0) return false
    const n = newName.trim()
    if (!n) return false
    if (n !== oldName && config.order.includes(n)) return false
    if (n !== oldName) {
      config.order[idx] = n
      for (const obj of [config.units, config.prices, config.categories, config.codes, config.prevMonths, config.lotSizes, config.reorderPoints, config.replenishTargets, config.tagsA, config.tagsB]) {
        if (obj[oldName] !== undefined) { obj[n] = obj[oldName]; delete obj[oldName] }
      }
      for (const [alias, target] of Object.entries(config.dictionary)) {
        if (target === oldName) config.dictionary[alias] = n
      }
      const mi = config.manualItems.indexOf(oldName)
      if (mi >= 0) config.manualItems[mi] = n
    }
    if (price != null && !isNaN(price) && price > 0) config.prices[n] = price
    else delete config.prices[n]
    if (category?.trim()) config.categories[n] = category.trim()
    else delete config.categories[n]
    if (unit !== undefined) {
      const u = (unit ?? '').trim()
      if (u) config.units[n] = u
      else   delete config.units[n]
    }
    _save()
    return n
  }

  // 発注点（この理論在庫以下で「要補充」）を設定。空/不正なら解除。
  function setReorderPoint(name, value) {
    if (!config.order.includes(name)) return false
    const v = Number(value)
    if (value !== '' && value != null && Number.isFinite(v) && v >= 0) config.reorderPoints[name] = v
    else delete config.reorderPoints[name]
    _save()
    return true
  }

  // 補充目標（発注してここまで戻す水準）を設定。空/不正なら解除＝自動算出へ戻す。
  // 発注点とは別概念。発注点へ戻すと補充直後にまた発注点を割るため、目標は別に持つ。
  function setReplenishTarget(name, value) {
    if (!config.order.includes(name)) return false
    const v = Number(value)
    if (value !== '' && value != null && Number.isFinite(v) && v >= 0) config.replenishTargets[name] = v
    else delete config.replenishTargets[name]
    _save()
    return true
  }

  // 発注数の決め方（店舗の既定）。'auto' = 不足分に追従 / 'manual' = 自分で入力
  function setOrderInputMode(mode) {
    config.orderInputMode = mode === 'manual' ? 'manual' : 'auto'
    _save()
  }

  // 復元時などに入数・前月実績をまとめて設定する
  function setItemExtras(name, { lotSize, prevMonth } = {}) {
    if (!config.order.includes(name)) return false
    if (lotSize !== undefined) {
      const l = (lotSize ?? '').trim()
      if (l) config.lotSizes[name] = l; else delete config.lotSizes[name]
    }
    if (prevMonth !== undefined) {
      const p = (prevMonth ?? '').trim()
      if (p) config.prevMonths[name] = p; else delete config.prevMonths[name]
    }
    _save()
    return true
  }

  // 汎用軸の名前を設定する（index: 0=軸A, 1=軸B）。空文字で未使用に戻す
  function setAxisName(index, name) {
    if (index !== 0 && index !== 1) return false
    const arr = Array.isArray(config.axisNames) ? [...config.axisNames] : ['', '']
    arr[index] = (name ?? '').trim().slice(0, AXIS_NAME_MAX)
    config.axisNames = [arr[0] ?? '', arr[1] ?? '']
    _save()
    return true
  }

  // 品目に軸の値を設定する（axisIndex: 0=軸A, 1=軸B）。空で削除
  function setItemTag(name, axisIndex, value) {
    if (!config.order.includes(name)) return false
    const map = axisIndex === 0 ? config.tagsA : axisIndex === 1 ? config.tagsB : null
    if (!map) return false
    const v = (value ?? '').trim()
    if (v) map[name] = [v]   // 編集モーダルは主グループを1つ設定（配列化）
    else   delete map[name]
    _syncArchive(axisIndex, name)
    _save()
    return true
  }

  // 並び替え（軸）を丸ごと削除: 名前・グループ・割り当てをすべて消す
  function clearAxis(axisIndex) {
    if (axisIndex !== 0 && axisIndex !== 1) return false
    const names = Array.isArray(config.axisNames) ? [...config.axisNames] : ['', '']
    names[axisIndex] = ''
    config.axisNames = [names[0] ?? '', names[1] ?? '']
    if (axisIndex === 0) { config.tagsA = {}; config.axisGroupsA = []; config.tagsArchiveA = {} }
    else                 { config.tagsB = {}; config.axisGroupsB = []; config.tagsArchiveB = {} }
    _save()
    return true
  }

  // ── 汎用軸のグループ（場所・仕入先など）管理 ────────────────────────────────
  function _axisList(axisIndex) {
    return axisIndex === 0 ? config.axisGroupsA : axisIndex === 1 ? config.axisGroupsB : null
  }
  function _axisMap(axisIndex) {
    return axisIndex === 0 ? config.tagsA : axisIndex === 1 ? config.tagsB : null
  }
  function _archiveMap(axisIndex) {
    return axisIndex === 0 ? config.tagsArchiveA : axisIndex === 1 ? config.tagsArchiveB : null
  }

  // 割り当ての変更をアーカイブへ反映（品目名キーで永続記憶）
  function _syncArchive(axisIndex, item) {
    const map = _axisMap(axisIndex), arch = _archiveMap(axisIndex)
    if (!map || !arch) return
    if (Array.isArray(map[item]) && map[item].length) arch[item] = [...map[item]]
    else delete arch[item]
    _pruneArchive()
  }

  // グループを追加（重複は無視）
  function addAxisGroup(axisIndex, name) {
    const n = (name ?? '').trim()
    const list = _axisList(axisIndex)
    if (!n || !list) return false
    if (!list.includes(n)) { list.push(n); _save() }
    return true
  }

  // グループをリネーム（所属品目の配列も追従）
  function renameAxisGroup(axisIndex, oldName, newName) {
    const nn = (newName ?? '').trim()
    const list = _axisList(axisIndex), map = _axisMap(axisIndex)
    if (!nn || !list || !map) return false
    const idx = list.indexOf(oldName)
    if (idx < 0) return false
    if (nn !== oldName && list.includes(nn)) return false
    list[idx] = nn
    for (const item of Object.keys(map)) {
      if (Array.isArray(map[item]) && map[item].includes(oldName)) {
        map[item] = [...new Set(map[item].map(x => (x === oldName ? nn : x)))]
      }
    }
    _save()
    return true
  }

  // グループを削除（所属品目からそのグループを外す。空になれば「その他」）
  function removeAxisGroup(axisIndex, name) {
    const list = _axisList(axisIndex), map = _axisMap(axisIndex)
    if (!list || !map) return false
    const idx = list.indexOf(name)
    if (idx >= 0) list.splice(idx, 1)
    for (const item of Object.keys(map)) {
      if (!Array.isArray(map[item])) continue
      const arr = map[item].filter(x => x !== name)
      if (arr.length) map[item] = arr
      else            delete map[item]
    }
    _save()
    return true
  }

  // グループの並び順を上下に移動（dir: -1=上, +1=下）
  function moveAxisGroup(axisIndex, name, dir) {
    const list = _axisList(axisIndex)
    if (!list) return false
    const i = list.indexOf(name)
    if (i < 0) return false
    const j = i + dir
    if (j < 0 || j >= list.length) return false
    list.splice(i, 1)
    list.splice(j, 0, name)
    _save()
    return true
  }

  // 1ジャンルをこの軸へコピー（同名グループを作り、そのジャンルの品目を割り当て）
  // 追加的・冪等。戻り値=割り当てた品目数
  function copyCategoryToAxis(axisIndex, category) {
    const list = _axisList(axisIndex), map = _axisMap(axisIndex)
    const c = (category ?? '').trim()
    if (!list || !map || !c) return 0
    if (!list.includes(c)) list.push(c)
    let n = 0
    for (const item of config.order) {
      if ((config.categories?.[item] ?? '') !== c) continue
      const arr = Array.isArray(map[item]) ? [...map[item]] : []
      if (!arr.includes(c)) { arr.push(c); map[item] = arr }
      n++
    }
    _save()
    return n
  }

  // 現在のジャンル構成をこの軸へコピー（ジャンルと同名グループを作り、品目を割り当て）
  // 追加的（既存の割り当ては消さない）・冪等
  function copyCategoriesToAxis(axisIndex) {
    const list = _axisList(axisIndex), map = _axisMap(axisIndex)
    if (!list || !map) return false
    const cats = [...new Set(config.order.map(i => config.categories?.[i]).filter(Boolean))]
    cats.sort((a, b) => {
      const ca = config.categoryCodes?.[a], cb = config.categoryCodes?.[b]
      if (ca != null && cb != null) return ca - cb
      if (ca != null) return -1
      if (cb != null) return  1
      return a.localeCompare(b, 'ja')
    })
    for (const c of cats) if (!list.includes(c)) list.push(c)
    for (const item of config.order) {
      const c = config.categories?.[item]
      if (!c) continue
      const arr = Array.isArray(map[item]) ? [...map[item]] : []
      if (!arr.includes(c)) { arr.push(c); map[item] = arr }
    }
    _save()
    return cats.length
  }

  // 定義済みグループの並び順を指定配列で置き換える（ドラッグ確定用）
  // names は displayGroups（定義済み＋孤立値）を許容し、定義済みの並び替えのみ反映。
  // 定義済みを過不足なく含まない場合は拒否。
  function setAxisGroupOrder(axisIndex, names) {
    const list = _axisList(axisIndex)
    if (!list || !Array.isArray(names)) return false
    const cur  = new Set(list)
    const next = names.filter(n => cur.has(n))
    if (next.length !== list.length || new Set(next).size !== list.length) return false
    list.splice(0, list.length, ...next)
    _save()
    return true
  }

  // グループを先頭へ移動
  function moveAxisGroupToTop(axisIndex, name) {
    const list = _axisList(axisIndex)
    if (!list) return false
    const i = list.indexOf(name)
    if (i <= 0) return false
    list.splice(i, 1)
    list.unshift(name)
    _save()
    return true
  }

  // 1品目を1グループへ追加（多ロケーション・重複は無視）
  function addItemToGroup(axisIndex, item, group) {
    const map = _axisMap(axisIndex)
    const g = (group ?? '').trim()
    if (!map || !g || !config.order.includes(item)) return false
    const arr = Array.isArray(map[item]) ? [...map[item]] : []
    if (!arr.includes(g)) { arr.push(g); map[item] = arr; _syncArchive(axisIndex, item); _save() }
    return true
  }

  // 1品目を1グループから外す（空になれば「その他」）
  function removeItemFromGroup(axisIndex, item, group) {
    const map = _axisMap(axisIndex)
    if (!map || !Array.isArray(map[item])) return false
    const g = (group ?? '').trim()
    const arr = map[item].filter(x => x !== g)
    if (arr.length) map[item] = arr
    else            delete map[item]
    _syncArchive(axisIndex, item)
    _save()
    return true
  }

  // 複数品目をグループへ一括追加（group が空なら各品目の割り当てを全解除＝その他）
  function assignItemsToGroup(axisIndex, items, group) {
    const map = _axisMap(axisIndex)
    if (!map || !Array.isArray(items)) return false
    const g = (group ?? '').trim()
    for (const item of items) {
      if (!config.order.includes(item)) continue
      if (!g) { delete map[item]; _syncArchive(axisIndex, item); continue }
      const arr = Array.isArray(map[item]) ? [...map[item]] : []
      if (!arr.includes(g)) arr.push(g)
      map[item] = arr
      _syncArchive(axisIndex, item)
    }
    _save()
    return true
  }

  // 数量入力モーダルからジャンルだけを設定する（単価・並びは変えない）
  function setItemCategory(name, category) {
    if (!config.order.includes(name)) return false
    const c = (category ?? '').trim()
    if (c) config.categories[name] = c
    else   delete config.categories[name]
    _save()
    return true
  }

  function removeConfigItem(name) {
    const idx = config.order.indexOf(name)
    if (idx < 0) return false
    config.order.splice(idx, 1)
    for (const obj of [config.units, config.prices, config.categories, config.codes, config.prevMonths, config.lotSizes, config.reorderPoints, config.replenishTargets, config.tagsA, config.tagsB]) {
      delete obj[name]
    }
    const mi = config.manualItems.indexOf(name)
    if (mi >= 0) config.manualItems.splice(mi, 1)
    _save()
    return true
  }

  /**
   * 任意CSVをフィールドマッピング指定でインポート
   * mapping = { name, unit, price, category, code, lotSize, prevMonth, axisA, axisB }
   *   — 各フィールドの列インデックス（null=使用しない）
   * loadFromCSV と同じく既定は「追加・更新」。
   */
  function loadFromCSVMapped(csvText, mapping, opts = {}) {
    return applyImportPlan(planMappedImport(csvText, mapping, opts))
  }

  /** loadFromCSVMapped の取込計画（config は変更しない） */
  function planMappedImport(csvText, mapping, { mode = IMPORT_MODE_MERGE, aliasPolicy, hasHeader } = {}) {
    const parsed = parseMappedCSV(csvText, mapping, hasHeader === undefined ? {} : { hasHeader })
    return buildImportPlan(parsed, config, _planOptions(mode, aliasPolicy))
  }

  /** loadFromCSVMapped の取込前プレビュー（件数と差分だけ必要な呼び出し元向け） */
  function previewMappedImport(csvText, mapping, opts = {}) {
    return planMappedImport(csvText, mapping, opts).summary
  }

  /** プレビューで見せた計画をそのまま適用する（唯一の書き換え地点） */
  function applyImportPlan(plan) {
    return _applyImportPlan(plan)
  }

  /**
   * 直前の取込を取り消して、取込前の品目マスタへ戻す。1回だけ・メモリ上のみ。
   * 取り消せる状態かは importUndoAvailable で判定する。
   */
  function undoLastImport() {
    if (!_importBackup) return false
    const snap = _importBackup
    _assignConfigData(snap)
    config.manualItems = snap.manualItems ?? []
    _validateLearnedAliases(config.order)
    _save()   // 退避はここで失効する（取り消しは1回だけ）
    return true
  }

  const itemCount         = computed(() => config.order.length)
  const learnedAliasCount = computed(() => Object.keys(learnedAliases).length)

  // ── 手動非表示 ────────────────────────────────────────────────────────────────
  const hiddenSet = computed(() => new Set(config.hiddenItems))
  // 非表示を除いた実効品目数（ホーム進捗の分母用）
  const activeItemCount = computed(() => config.order.reduce((n, i) => n + (hiddenSet.value.has(i) ? 0 : 1), 0))

  function hideItem(name, auto = false) {
    if (!name) return
    if (!config.hiddenItems.includes(name)) config.hiddenItems.push(name)
    if (auto) { if (!config.hiddenAuto.includes(name)) config.hiddenAuto.push(name) }
    else      { const j = config.hiddenAuto.indexOf(name); if (j >= 0) config.hiddenAuto.splice(j, 1) }
    _save()
  }
  function unhideItem(name) {
    const i = config.hiddenItems.indexOf(name)
    const j = config.hiddenAuto.indexOf(name)
    if (i < 0 && j < 0) return
    if (i >= 0) config.hiddenItems.splice(i, 1)
    if (j >= 0) config.hiddenAuto.splice(j, 1)
    _save()
  }

  return {
    config,
    dictionary,
    masterDict,
    itemCount,
    activeItemCount,
    hideItem,
    unhideItem,
    serializeConfigData: _serializeConfigData,
    learnedAliasCount,
    loadFromCSV,
    loadFromCSVMapped,
    planCSVImport,
    planMappedImport,
    applyImportPlan,
    previewCSVImport,
    previewMappedImport,
    undoLastImport,
    importUndoAvailable,
    exportConfigCSV,
    clearConfig,
    setEmptyList,
    snapshotConfig,
    restoreConfigSnapshot,
    loadSampleData,
    registerAlias,
    addItem,
    updateConfigItem,
    removeConfigItem,
    setItemCategory,
    setItemExtras,
    setReorderPoint,
    setReplenishTarget,
    setOrderInputMode,
    setAxisName,
    clearAxis,
    setItemTag,
    addAxisGroup,
    renameAxisGroup,
    removeAxisGroup,
    assignItemsToGroup,
    addItemToGroup,
    removeItemFromGroup,
    moveAxisGroup,
    moveAxisGroupToTop,
    setAxisGroupOrder,
    copyCategoriesToAxis,
    copyCategoryToAxis,
    setOrderSchedule,
  }
}
