import { reactive, computed } from 'vue'
import {
  DICTIONARY as DEFAULT_DICT,
  INVENTORY_ORDER as DEFAULT_ORDER,
  ITEM_UNITS as DEFAULT_UNITS,
} from '../config.js'

const CONFIG_KEY  = 'inventory_config_v1'
const ALIASES_KEY = 'inventory_aliases_v1'

// ── モジュールスコープ シングルトン ────────────────────────────────────────────
const config = reactive({
  order:      [...DEFAULT_ORDER],
  units:      { ...DEFAULT_UNITS },
  prices:     {},
  dictionary: { ...DEFAULT_DICT },
  isCustom:   false,
})

// 自動学習エイリアス（別ストレージ・CSV再アップロードでリセットしない）
const learnedAliases = reactive({})

// マージ済み辞書: CSV定義エイリアス + 自動学習エイリアス
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

// ── ロード / セーブ ───────────────────────────────────────────────────────────
function _load() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY)
    if (!raw) return
    const saved = JSON.parse(raw)
    if (Array.isArray(saved.order) && saved.order.length > 0) {
      config.order      = saved.order
      config.units      = saved.units      ?? {}
      config.prices     = saved.prices     ?? {}
      config.dictionary = saved.dictionary ?? {}
      config.isCustom   = true
    }
  } catch (_) {}
}

function _save() {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify({
      order:      config.order,
      units:      config.units,
      prices:     config.prices,
      dictionary: config.dictionary,
    }))
    config.isCustom = true
  } catch (_) {}
}

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

// CSV再アップロード時: 新リストにない品目を指すエイリアスを削除
function _validateLearnedAliases(newOrder) {
  const orderSet = new Set(newOrder)
  for (const alias of Object.keys(learnedAliases)) {
    if (!orderSet.has(learnedAliases[alias])) delete learnedAliases[alias]
  }
  _saveAliases()
}

_load()
_loadAliases()

// ── Public API ────────────────────────────────────────────────────────────────
export function useConfig() {

  /** 品目選択時にサイレント自動登録 */
  function registerAlias(searchTerm, canonical) {
    if (!searchTerm || !canonical) return
    const term = searchTerm.trim()
    if (!term || term === canonical) return
    if (learnedAliases[term] === canonical) return
    learnedAliases[term] = canonical
    _saveAliases()
  }

  /**
   * CSVテキストを読み込んで config を更新
   * 対応フォーマット:
   *   旧: 品目名,エイリアス
   *   中: 品目名,単位,エイリアス
   *   新: 品目名,単位,単価,エイリアス  ← 推奨
   */
  function loadFromCSV(csvText) {
    const text  = csvText.replace(/^\uFEFF/, '').trim()
    const lines = text.split(/\r?\n/).filter(l => l.trim())

    if (lines.length < 2) throw new Error('データ行がありません')

    const header = parseCSVLine(lines[0]).map(h => h.trim())

    // フォーマット判定
    const isOldFormat  = header[1] === 'エイリアス'                    // 旧: 品目名,エイリアス
    const hasPriceCol  = !isOldFormat && header[2] === '単価'          // 新: 品目名,単位,単価,エイリアス
    // それ以外: 品目名,単位,エイリアス（現行）

    const newOrder  = []
    const newUnits  = {}
    const newPrices = {}
    const newDict   = {}

    for (let i = 1; i < lines.length; i++) {
      const cols = parseCSVLine(lines[i])
      const name = cols[0]?.trim()
      if (!name) continue

      newOrder.push(name)

      if (isOldFormat) {
        // 旧: col1 = カンマ区切りエイリアス
        if (cols[1]) {
          cols[1].split(',').map(a => a.trim()).filter(Boolean)
            .forEach(alias => { newDict[alias] = name })
        }
      } else if (hasPriceCol) {
        // 新: col1=単位, col2=単価, col3=エイリアス
        const unit  = cols[1]?.trim()
        const price = parseFloat(cols[2])
        if (unit)      newUnits[name]  = unit
        if (!isNaN(price) && price > 0) newPrices[name] = price
        if (cols[3]) {
          cols[3].split(',').map(a => a.trim()).filter(Boolean)
            .forEach(alias => { newDict[alias] = name })
        }
      } else {
        // 現行: col1=単位, col2=エイリアス
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

    config.order      = newOrder
    config.units      = newUnits
    config.prices     = newPrices
    config.dictionary = newDict
    _save()

    return { count: newOrder.length, hasPrices: Object.keys(newPrices).length > 0 }
  }

  /** 現在の設定をCSV文字列として返す（品目名,単位,単価,エイリアス） */
  function exportConfigCSV() {
    const rows = ['品目名,単位,単価,エイリアス']
    config.order.forEach(item => {
      const unit    = config.units[item]  ?? ''
      const price   = config.prices[item] ?? ''
      const aliases = Object.entries(config.dictionary)
        .filter(([, v]) => v === item)
        .map(([k]) => k)
      const unitCell  = unit           ? `"${unit}"`              : ''
      const priceCell = price !== ''   ? price                    : ''
      const aliasCell = aliases.length ? `"${aliases.join(',')}"` : ''
      rows.push(`"${item}",${unitCell},${priceCell},${aliasCell}`)
    })
    return rows.join('\n')
  }

  /** デフォルト（config.js）に戻す（learnedAliases は保持） */
  function resetToDefault() {
    config.order      = [...DEFAULT_ORDER]
    config.units      = { ...DEFAULT_UNITS }
    config.prices     = {}
    config.dictionary = { ...DEFAULT_DICT }
    config.isCustom   = false
    localStorage.removeItem(CONFIG_KEY)
  }

  const itemCount         = computed(() => config.order.length)
  const learnedAliasCount = computed(() => Object.keys(learnedAliases).length)

  return {
    config,
    dictionary,
    itemCount,
    learnedAliasCount,
    loadFromCSV,
    exportConfigCSV,
    resetToDefault,
    registerAlias,
  }
}
