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
// "aaa","b,c,d" → ['aaa', 'b,c,d']
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
    if (!orderSet.has(learnedAliases[alias])) {
      delete learnedAliases[alias]
    }
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

  /** CSVテキストを読み込んで config を更新 */
  function loadFromCSV(csvText) {
    const text  = csvText.replace(/^\uFEFF/, '').trim()
    const lines = text.split(/\r?\n/).filter(l => l.trim())

    if (lines.length < 2) throw new Error('データ行がありません')

    const header = parseCSVLine(lines[0]).map(h => h.trim())

    // 旧フォーマット互換: 2列目ヘッダーが "エイリアス" の場合
    const isOldFormat = header[1] === 'エイリアス'

    const newOrder = []
    const newUnits = {}
    const newDict  = {}

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
      } else {
        // 新: col1 = 単位, col2 = カンマ区切りエイリアス
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
    config.dictionary = newDict
    _save()

    return { count: newOrder.length }
  }

  /** 現在の設定をCSV文字列として返す */
  function exportConfigCSV() {
    const rows = ['品目名,単位,エイリアス']
    config.order.forEach(item => {
      const unit    = config.units[item] ?? ''
      const aliases = Object.entries(config.dictionary)
        .filter(([, v]) => v === item)
        .map(([k]) => k)
      const unitCell  = unit           ? `"${unit}"`            : ''
      const aliasCell = aliases.length ? `"${aliases.join(',')}"` : ''
      rows.push(`"${item}",${unitCell},${aliasCell}`)
    })
    return rows.join('\n')
  }

  /** デフォルト（config.js）に戻す（learnedAliases は保持） */
  function resetToDefault() {
    config.order      = [...DEFAULT_ORDER]
    config.units      = { ...DEFAULT_UNITS }
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
