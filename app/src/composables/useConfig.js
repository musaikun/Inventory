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

// ── 品目リスト ロード / セーブ ───────────────────────────────────────────────
function _load() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY)
    if (!raw) return
    const saved = JSON.parse(raw)
    if (Array.isArray(saved.order) && saved.order.length > 0) {
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

    _validateLearnedAliases(newOrder)

    config.order         = newOrder
    config.units         = newUnits
    config.prices        = newPrices
    config.categories    = newCategories
    config.codes         = newCodes
    config.categoryCodes = newCategoryCodes
    config.prevMonths    = newPrevMonths
    config.lotSizes      = newLotSizes
    config.dictionary    = newDict
    // CSV取込後もインポート後の一覧に残っている手動登録品目は編集・削除できるよう保持する
    const newOrderSet    = new Set(newOrder)
    config.manualItems   = config.manualItems.filter(n => newOrderSet.has(n))
    _save()

    return {
      count:         newOrder.length,
      hasPrices:     Object.keys(newPrices).length > 0,
      hasCategories: Object.keys(newCategories).length > 0,
    }
  }

  /** 棚卸品目 CSV エクスポート */
  function exportConfigCSV() {
    // フォーミュラインジェクション対策
    const cs = v => (typeof v === 'string' && /^[=+\-@|]/.test(v)) ? `'${v}` : v
    const rows = ['品目名,単位,単価,カテゴリ,エイリアス,商品コード,分類コード,前月実績,入数']
    config.order.forEach(item => {
      const unit     = cs(config.units[item]      ?? '')
      const price    = config.prices[item]        ?? ''
      const category = cs(config.categories[item] ?? '')
      const code     = cs(config.codes[item]      ?? '')
      const catCode  = config.categoryCodes[config.categories[item]] ?? ''
      const prevMonth = cs(config.prevMonths[item] ?? '')
      const lotSize  = cs(config.lotSizes[item]   ?? '')
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
      rows.push(`"${cs(item)}",${unitCell},${priceCell},${catCell},${aliasCell},${codeCell},${catCodeCell},${prevCell},${lotCell}`)
    })
    return rows.join('\r\n')
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

  function addItem(name, price, category) {
    const n = name.trim()
    if (!n || config.order.includes(n)) return false
    config.order.push(n)
    if (price != null && !isNaN(price) && price > 0) config.prices[n] = price
    if (category?.trim()) config.categories[n] = category.trim()
    if (!config.manualItems.includes(n)) config.manualItems.push(n)
    _save()
    return true
  }

  function updateConfigItem(oldName, newName, price, category) {
    const idx = config.order.indexOf(oldName)
    if (idx < 0) return false
    const n = newName.trim()
    if (!n) return false
    if (n !== oldName && config.order.includes(n)) return false
    if (n !== oldName) {
      config.order[idx] = n
      for (const obj of [config.units, config.prices, config.categories, config.codes, config.prevMonths, config.lotSizes]) {
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
    _save()
    return n
  }

  function removeConfigItem(name) {
    const idx = config.order.indexOf(name)
    if (idx < 0) return false
    config.order.splice(idx, 1)
    for (const obj of [config.units, config.prices, config.categories, config.codes, config.prevMonths, config.lotSizes]) {
      delete obj[name]
    }
    const mi = config.manualItems.indexOf(name)
    if (mi >= 0) config.manualItems.splice(mi, 1)
    _save()
    return true
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
    exportConfigCSV,
    clearConfig,
    loadSampleData,
    registerAlias,
    addItem,
    updateConfigItem,
    removeConfigItem,
  }
}
