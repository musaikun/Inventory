import { reactive, computed } from 'vue'
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

const CONFIG_KEY  = STORAGE_KEYS.config
const ALIASES_KEY = STORAGE_KEYS.aliases
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
  dictionary:     { ...DEFAULT_DICT },
  isCustom:       false,
  savedAt:        null,
  manualItems:    [],  // フォームから手動追加した品目名（CSV品目と区別）
  axisNames:      ['', ''],  // 汎用2軸の名前（例: '場所', '仕入先'）。空=未使用
  tagsA:          {},        // 品目 → 軸1のグループ名（フラットマップ）
  tagsB:          {},        // 品目 → 軸2のグループ名
  axisGroupsA:    [],        // 軸1の定義済みグループ名一覧（空グループも保持）
  axisGroupsB:    [],        // 軸2の定義済みグループ名一覧
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

// ── CSV パーサー ───────────────────────────────────────────────────────────────
function parseCSVLine(line) {
  const result = []
  let cur = ''
  let inQ = false
  for (const ch of line) {
    if (ch === '"')              { inQ = !inQ }
    else if (ch === ',' && !inQ) { result.push(cur); cur = '' }
    else                         { cur += ch }
  }
  result.push(cur)
  return result
}

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

// ── 品目リスト ロード / セーブ ───────────────────────────────────────────────
function _load() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY)
    if (!raw) return
    const saved = JSON.parse(raw)
    // CONFIG_KEY はカスタム設定でのみ保存される（空リスト開始も含む）。
    // 空の品目リストでも軸名・グループ等を復元できるよう order 空も許容する。
    if (Array.isArray(saved.order)) {
      config.order         = saved.order
      config.units         = saved.units         ?? {}
      config.prices        = saved.prices        ?? {}
      config.categories    = saved.categories    ?? {}
      config.codes         = saved.codes         ?? {}
      config.categoryCodes = saved.categoryCodes ?? {}
      config.prevMonths    = saved.prevMonths    ?? {}
      config.lotSizes      = saved.lotSizes      ?? {}
      config.dictionary    = saved.dictionary    ?? {}
      config.manualItems   = saved.manualItems   ?? []
      config.axisNames     = saved.axisNames     ?? ['', '']
      config.tagsA         = _normTags(saved.tagsA)
      config.tagsB         = _normTags(saved.tagsB)
      config.axisGroupsA   = saved.axisGroupsA   ?? []
      config.axisGroupsB   = saved.axisGroupsB   ?? []
      config.isCustom      = true
      config.savedAt       = saved.savedAt       ?? null
    }
  } catch (_) {}
}

function _saveLocalOnly() {
  try {
    config.savedAt = new Date().toISOString()
    localStorage.setItem(CONFIG_KEY, JSON.stringify({
      order:         config.order,
      units:         config.units,
      prices:        config.prices,
      categories:    config.categories,
      codes:         config.codes,
      categoryCodes: config.categoryCodes,
      prevMonths:    config.prevMonths,
      lotSizes:      config.lotSizes,
      dictionary:    config.dictionary,
      manualItems:   config.manualItems,
      axisNames:     config.axisNames,
      tagsA:         config.tagsA,
      tagsB:         config.tagsB,
      axisGroupsA:   config.axisGroupsA,
      axisGroupsB:   config.axisGroupsB,
      savedAt:       config.savedAt,
    }))
    config.isCustom = true
  } catch (_) {}
}

function _save() {
  _saveLocalOnly()
  _onConfigChanged?.()
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

// ── リモート設定の適用（同期ゲスト参加時にホストの品目リストを受け取る） ───────
export function applyRemoteConfig(cfg) {
  if (!cfg || !Array.isArray(cfg.order) || cfg.order.length === 0) return
  _validateLearnedAliases(cfg.order)
  config.order         = cfg.order
  config.units         = cfg.units         ?? {}
  config.prices        = cfg.prices        ?? {}
  config.categories    = cfg.categories    ?? {}
  config.codes         = cfg.codes         ?? {}
  config.categoryCodes = cfg.categoryCodes ?? {}
  config.prevMonths    = cfg.prevMonths    ?? {}
  config.lotSizes      = cfg.lotSizes      ?? {}
  config.dictionary    = cfg.dictionary    ?? {}
  config.axisNames     = cfg.axisNames     ?? ['', '']
  config.tagsA         = _normTags(cfg.tagsA)
  config.tagsB         = _normTags(cfg.tagsB)
  config.axisGroupsA   = cfg.axisGroupsA   ?? []
  config.axisGroupsB   = cfg.axisGroupsB   ?? []
  _saveLocalOnly()
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
   * 棚卸品目 CSV 読み込み（品目名,単位,単価,カテゴリ,エイリアス）
   * 旧フォーマット（2/3/4列）も互換
   */
  function loadFromCSV(csvText) {
    const text  = csvText.replace(/^\uFEFF/, '').trim()
    const lines = text.split(/\r?\n/).filter(l => l.trim())

    if (lines.length < 2) throw new Error('データ行がありません')

    const header = parseCSVLine(lines[0]).map(h => h.trim())

    const isOldFormat    = header[1] === 'エイリアス'
    const hasPriceCol    = !isOldFormat && header[2] === '単価'
    const hasCategoryCol = hasPriceCol  && header[3] === 'カテゴリ'

    const newOrder         = []
    const newUnits         = {}
    const newPrices        = {}
    const newCategories    = {}
    const newCodes         = {}
    const newCategoryCodes = {}
    const newPrevMonths    = {}
    const newLotSizes      = {}
    const newDict          = {}

    // ── パス1: 複数回出現する品目名を特定（同名品目のカテゴリ付与に使用）────
    const nameCounts = new Map()
    for (let i = 1; i < lines.length; i++) {
      const n = parseCSVLine(lines[i])[0]?.trim()
      if (n) nameCounts.set(n, (nameCounts.get(n) ?? 0) + 1)
    }
    const dupNames = new Set([...nameCounts.entries()].filter(([, c]) => c > 1).map(([n]) => n))

    // ── パス2: パース（重複削除なし・全件保持）────────────────────────────────
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCSVLine(lines[i])
      const name = cols[0]?.trim()
      if (!name) continue

      if (isOldFormat) {
        newOrder.push(name)
        if (cols[1]) {
          cols[1].split(',').map(a => a.trim()).filter(Boolean)
            .forEach(alias => { newDict[alias] = name })
        }
      } else if (hasCategoryCol) {
        const unit     = cols[1]?.trim()
        const price    = parseFloat(cols[2])
        const category = cols[3]?.trim()
        const code     = cols[5]?.trim() ?? ''

        // 同名品目にはカテゴリを付与して識別しやすくする（削除はしない）
        let storeName = name
        if (dupNames.has(name)) {
          const disambig = category || code
          if (disambig) storeName = `${name}（${disambig}）`
        }
        newOrder.push(storeName)

        const catCode   = parseInt(cols[6]?.trim(), 10)
        const prevMonth = cols[7]?.trim() ?? ''
        const lotSize   = cols[8]?.trim() ?? ''
        if (unit)                        newUnits[storeName]         = unit
        if (!isNaN(price) && price > 0)  newPrices[storeName]        = price
        if (category)                    newCategories[storeName]    = category
        if (code)                        newCodes[storeName]         = code
        if (category && !isNaN(catCode)) newCategoryCodes[category]  = catCode
        if (prevMonth)                   newPrevMonths[storeName]    = prevMonth
        if (lotSize)                     newLotSizes[storeName]      = lotSize
        if (cols[4]) {
          cols[4].split(',').map(a => a.trim()).filter(Boolean)
            .forEach(alias => { newDict[alias] = storeName })
        }
      } else if (hasPriceCol) {
        newOrder.push(name)
        const unit  = cols[1]?.trim()
        const price = parseFloat(cols[2])
        if (unit)                       newUnits[name]  = unit
        if (!isNaN(price) && price > 0) newPrices[name] = price
        if (cols[3]) {
          cols[3].split(',').map(a => a.trim()).filter(Boolean)
            .forEach(alias => { newDict[alias] = name })
        }
      } else {
        newOrder.push(name)
        const unit = cols[1]?.trim()
        if (unit) newUnits[name] = unit
        if (cols[2]) {
          cols[2].split(',').map(a => a.trim()).filter(Boolean)
            .forEach(alias => { newDict[alias] = name })
        }
      }
    }

    if (newOrder.length === 0) throw new Error('有効な品目が見つかりませんでした')

    // Free プラン: 上限を超える分は切り捨て（取込機能自体は無料）
    const totalParsed = newOrder.length
    const cappedOrder = (!isPro() && newOrder.length > FREE_ITEM_LIMIT)
      ? newOrder.slice(0, FREE_ITEM_LIMIT)
      : newOrder

    _validateLearnedAliases(cappedOrder)

    config.order         = cappedOrder
    config.units         = newUnits
    config.prices        = newPrices
    config.categories    = newCategories
    config.codes         = newCodes
    config.categoryCodes = newCategoryCodes
    config.prevMonths    = newPrevMonths
    config.lotSizes      = newLotSizes
    config.dictionary    = newDict
    // CSV取込後もインポート後の一覧に残っている手動登録品目は編集・削除できるよう保持する
    const newOrderSet    = new Set(cappedOrder)
    config.manualItems   = config.manualItems.filter(n => newOrderSet.has(n))
    _save()

    return {
      count:         cappedOrder.length,
      truncated:     totalParsed - cappedOrder.length,
      hasPrices:     Object.keys(newPrices).length > 0,
      hasCategories: Object.keys(newCategories).length > 0,
    }
  }

  /** 棚卸品目 CSV エクスポート */
  function exportConfigCSV() {
    // フォーミュラインジェクション対策
    const cs = v => (typeof v === 'string' && /^[=+\-@|]/.test(v)) ? `'${v}` : v
    const a0 = (config.axisNames?.[0] || '軸1').replace(/,/g, ' ')
    const a1 = (config.axisNames?.[1] || '軸2').replace(/,/g, ' ')
    const rows = [`品目名,単位,単価,カテゴリ,エイリアス,商品コード,分類コード,前月実績,入数,${a0},${a1}`]
    config.order.forEach(item => {
      const unit     = cs(config.units[item]      ?? '')
      const price    = config.prices[item]        ?? ''
      const category = cs(config.categories[item] ?? '')
      const code     = cs(config.codes[item]      ?? '')
      const catCode  = config.categoryCodes[config.categories[item]] ?? ''
      const prevMonth = cs(config.prevMonths[item] ?? '')
      const lotSize  = cs(config.lotSizes[item]   ?? '')
      const tagA     = cs((config.tagsA[item] ?? []).join('|'))
      const tagB     = cs((config.tagsB[item] ?? []).join('|'))
      const aliases  = Object.entries(config.dictionary)
        .filter(([, v]) => v === item)
        .map(([k]) => cs(k))
      const unitCell    = unit           ? `"${unit}"`              : ''
      const priceCell   = price !== ''   ? price                    : ''
      const catCell     = category       ? `"${category}"`          : ''
      const aliasCell   = aliases.length ? `"${aliases.join(',')}"` : ''
      const codeCell    = code           ? `"${code}"`              : ''
      const catCodeCell = catCode !== '' ? catCode                  : ''
      const prevCell    = prevMonth      ? `"${prevMonth}"`         : ''
      const lotCell     = lotSize        ? `"${lotSize}"`           : ''
      const tagACell    = tagA           ? `"${tagA}"`              : ''
      const tagBCell    = tagB           ? `"${tagB}"`              : ''
      rows.push(`"${cs(item)}",${unitCell},${priceCell},${catCell},${aliasCell},${codeCell},${catCodeCell},${prevCell},${lotCell},${tagACell},${tagBCell}`)
    })
    return rows.join('\r\n')
  }

  /** 現在の品目リストをディープコピーで退避する（練習モードの一時切替用） */
  function snapshotConfig() {
    return JSON.parse(JSON.stringify({
      order:         config.order,
      units:         config.units,
      prices:        config.prices,
      categories:    config.categories,
      codes:         config.codes,
      categoryCodes: config.categoryCodes,
      prevMonths:    config.prevMonths,
      lotSizes:      config.lotSizes,
      dictionary:    config.dictionary,
      isCustom:      config.isCustom,
      manualItems:   config.manualItems,
      axisNames:     config.axisNames,
      tagsA:         config.tagsA,
      tagsB:         config.tagsB,
      axisGroupsA:   config.axisGroupsA,
      axisGroupsB:   config.axisGroupsB,
    }))
  }

  /** snapshotConfig で退避した品目リストを復元する */
  function restoreConfigSnapshot(snap) {
    if (!snap) return
    config.order         = snap.order         ?? []
    config.units         = snap.units         ?? {}
    config.prices        = snap.prices        ?? {}
    config.categories    = snap.categories    ?? {}
    config.codes         = snap.codes         ?? {}
    config.categoryCodes = snap.categoryCodes ?? {}
    config.prevMonths    = snap.prevMonths    ?? {}
    config.lotSizes      = snap.lotSizes      ?? {}
    config.dictionary    = snap.dictionary    ?? {}
    config.manualItems   = snap.manualItems   ?? []
    config.axisNames     = snap.axisNames     ?? ['', '']
    config.tagsA         = _normTags(snap.tagsA)
    config.tagsB         = _normTags(snap.tagsB)
    config.axisGroupsA   = snap.axisGroupsA   ?? []
    config.axisGroupsB   = snap.axisGroupsB   ?? []
    config.isCustom      = !!snap.isCustom
    if (snap.isCustom) _saveLocalOnly()
    else localStorage.removeItem(CONFIG_KEY)
  }

  /** 空の品目リストで開始（棚卸しながら品目を追加していく用） */
  function setEmptyList() {
    config.order         = []
    config.units         = {}
    config.prices        = {}
    config.categories    = {}
    config.codes         = {}
    config.categoryCodes = {}
    config.prevMonths    = {}
    config.lotSizes      = {}
    config.dictionary    = {}
    config.manualItems   = []
    config.axisNames     = ['', '']
    config.tagsA         = {}
    config.tagsB         = {}
    config.axisGroupsA   = []
    config.axisGroupsB   = []
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
    config.dictionary    = { ...SAMPLE_DICTIONARY }
    config.axisNames     = ['', '']
    config.tagsA         = {}
    config.tagsB         = {}
    config.axisGroupsA   = []
    config.axisGroupsB   = []
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
    config.order         = [...DEFAULT_ORDER]
    config.units         = { ...DEFAULT_UNITS }
    config.prices        = {}
    config.categories    = {}
    config.codes         = {}
    config.categoryCodes = {}
    config.prevMonths    = {}
    config.lotSizes      = {}
    config.dictionary    = { ...DEFAULT_DICT }
    config.manualItems   = []
    config.axisNames     = ['', '']
    config.tagsA         = {}
    config.tagsB         = {}
    config.axisGroupsA   = []
    config.axisGroupsB   = []
    config.isCustom      = false
    config.savedAt       = null
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
      for (const obj of [config.units, config.prices, config.categories, config.codes, config.prevMonths, config.lotSizes, config.tagsA, config.tagsB]) {
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
    arr[index] = (name ?? '').trim()
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
    _save()
    return true
  }

  // 並び替え（軸）を丸ごと削除: 名前・グループ・割り当てをすべて消す
  function clearAxis(axisIndex) {
    if (axisIndex !== 0 && axisIndex !== 1) return false
    const names = Array.isArray(config.axisNames) ? [...config.axisNames] : ['', '']
    names[axisIndex] = ''
    config.axisNames = [names[0] ?? '', names[1] ?? '']
    if (axisIndex === 0) { config.tagsA = {}; config.axisGroupsA = [] }
    else                 { config.tagsB = {}; config.axisGroupsB = [] }
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
  function setAxisGroupOrder(axisIndex, names) {
    const list = _axisList(axisIndex)
    if (!list || !Array.isArray(names)) return false
    const cur  = new Set(list)
    const next = names.filter(n => cur.has(n))
    for (const n of list) if (!next.includes(n)) next.push(n)  // 漏れは末尾へ
    if (next.length !== list.length) return false
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
    if (!arr.includes(g)) { arr.push(g); map[item] = arr; _save() }
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
      if (!g) { delete map[item]; continue }
      const arr = Array.isArray(map[item]) ? [...map[item]] : []
      if (!arr.includes(g)) arr.push(g)
      map[item] = arr
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
    for (const obj of [config.units, config.prices, config.categories, config.codes, config.prevMonths, config.lotSizes, config.tagsA, config.tagsB]) {
      delete obj[name]
    }
    const mi = config.manualItems.indexOf(name)
    if (mi >= 0) config.manualItems.splice(mi, 1)
    _save()
    return true
  }

  /**
   * 任意CSVをフィールドマッピング指定でインポート
   * mapping = { name, unit, price, category, alias, code } — 各フィールドの列インデックス（null=使用しない）
   */
  function loadFromCSVMapped(csvText, mapping) {
    const { name: nameCol, unit: unitCol, price: priceCol, category: categoryCol,
            code: codeCol, lotSize: lotCol, prevMonth: prevCol,
            axisA: axisACol, axisB: axisBCol } = mapping
    if (nameCol === null || nameCol === undefined) throw new Error('品目名列を選択してください')

    const lines = csvText.replace(/^﻿/, '').trim().split(/\r?\n/).filter(l => l.trim())
    if (lines.length < 2) throw new Error('データ行がありません')

    const newOrder = [], newUnits = {}, newPrices = {}, newCategories = {}
    const newCodes = {}, newLotSizes = {}, newPrevMonths = {}, newTagsA = {}, newTagsB = {}

    for (let i = 1; i < lines.length; i++) {
      const cols = parseCSVLine(lines[i])
      const name = cols[nameCol]?.trim()
      if (!name) continue

      newOrder.push(name)
      if (unitCol != null) {
        const u = cols[unitCol]?.trim()
        if (u) newUnits[name] = u
      }
      if (priceCol != null) {
        const p = parseFloat(cols[priceCol])
        if (!isNaN(p) && p > 0) newPrices[name] = p
      }
      if (categoryCol != null) {
        const c = cols[categoryCol]?.trim()
        if (c) newCategories[name] = c
      }
      if (codeCol != null) {
        const cd = cols[codeCol]?.trim()
        if (cd) newCodes[name] = cd
      }
      if (lotCol != null) {
        const l = cols[lotCol]?.trim()
        if (l) newLotSizes[name] = l
      }
      if (prevCol != null) {
        const pm = cols[prevCol]?.trim()
        if (pm) newPrevMonths[name] = pm
      }
      if (axisACol != null) {
        const v = cols[axisACol]?.trim()
        if (v) newTagsA[name] = v.split('|').map(s => s.trim()).filter(Boolean)
      }
      if (axisBCol != null) {
        const v = cols[axisBCol]?.trim()
        if (v) newTagsB[name] = v.split('|').map(s => s.trim()).filter(Boolean)
      }
    }

    if (newOrder.length === 0) throw new Error('有効な品目が見つかりませんでした')

    // Free プラン: 上限を超える分は切り捨て（取込機能自体は無料）
    const totalParsed = newOrder.length
    const cappedOrder = (!isPro() && newOrder.length > FREE_ITEM_LIMIT)
      ? newOrder.slice(0, FREE_ITEM_LIMIT)
      : newOrder

    _validateLearnedAliases(cappedOrder)
    config.order         = cappedOrder
    config.units         = newUnits
    config.prices        = newPrices
    config.categories    = newCategories
    config.codes         = newCodes
    config.categoryCodes = {}
    config.prevMonths    = newPrevMonths
    config.lotSizes      = newLotSizes
    config.dictionary    = {}
    // 軸の割り当てはアプリ内で維持する。再インポートは品目名の完全一致で保持し、
    // 消えた品目は破棄、新規品目は未割り当て（その他）。CSVに軸列があればそれを優先。
    const keepA = {}, keepB = {}
    for (const nm of cappedOrder) {
      const a = newTagsA[nm] !== undefined ? newTagsA[nm] : config.tagsA[nm]
      const b = newTagsB[nm] !== undefined ? newTagsB[nm] : config.tagsB[nm]
      if (a !== undefined) keepA[nm] = a
      if (b !== undefined) keepB[nm] = b
    }
    config.tagsA         = keepA
    config.tagsB         = keepB
    // 軸名が未設定なら、マッピングした列のヘッダ名を軸名に採用する
    const headers = parseCSVLine(lines[0])
    const axisNames = [...(config.axisNames ?? ['', ''])]
    if (axisACol != null && !axisNames[0]) axisNames[0] = (headers[axisACol]?.trim() || '').slice(0, 12)
    if (axisBCol != null && !axisNames[1]) axisNames[1] = (headers[axisBCol]?.trim() || '').slice(0, 12)
    config.axisNames     = [axisNames[0] ?? '', axisNames[1] ?? '']
    const newSet         = new Set(cappedOrder)
    config.manualItems   = config.manualItems.filter(n => newSet.has(n))
    _save()

    return {
      count:         cappedOrder.length,
      truncated:     totalParsed - cappedOrder.length,
      hasPrices:     Object.keys(newPrices).length > 0,
      hasCategories: Object.keys(newCategories).length > 0,
    }
  }

  const itemCount         = computed(() => config.order.length)
  const learnedAliasCount = computed(() => Object.keys(learnedAliases).length)

  return {
    config,
    dictionary,
    masterDict,
    itemCount,
    learnedAliasCount,
    loadFromCSV,
    loadFromCSVMapped,
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
  }
}
