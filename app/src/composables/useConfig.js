import { reactive, computed } from 'vue'
import { DICTIONARY as DEFAULT_DICT, INVENTORY_ORDER as DEFAULT_ORDER } from '../config.js'

const CONFIG_KEY = 'inventory_config_v1'

// モジュールスコープのシングルトン（全コンポーネントで共有）
const config = reactive({
  order:      [...DEFAULT_ORDER],
  dictionary: { ...DEFAULT_DICT },
  isCustom:   false,
})

// ── CSV パーサー ───────────────────────────────────────────────────────────────
// "aaa","b,c,d" → ['aaa', 'b,c,d']
function parseCSVLine(line) {
  const result = []
  let cur = ''
  let inQ = false
  for (const ch of line) {
    if (ch === '"')       { inQ = !inQ }
    else if (ch === ',' && !inQ) { result.push(cur); cur = '' }
    else                  { cur += ch }
  }
  result.push(cur)
  return result
}

// ── ロード ────────────────────────────────────────────────────────────────────
function _load() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY)
    if (!raw) return
    const saved = JSON.parse(raw)
    if (Array.isArray(saved.order) && saved.order.length > 0) {
      config.order      = saved.order
      config.dictionary = saved.dictionary ?? {}
      config.isCustom   = true
    }
  } catch (_) {}
}

function _save() {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify({
      order:      config.order,
      dictionary: config.dictionary,
    }))
    config.isCustom = true
  } catch (_) {}
}

_load()

// ── Public API ────────────────────────────────────────────────────────────────
export function useConfig() {

  /** CSVテキストを読み込んで config を更新 */
  function loadFromCSV(csvText) {
    // BOM除去
    const text  = csvText.replace(/^\uFEFF/, '').trim()
    const lines = text.split(/\r?\n/).filter(l => l.trim())

    if (lines.length < 2) throw new Error('データ行がありません')

    // ヘッダー行を確認（スキップ）
    const header = parseCSVLine(lines[0]).map(h => h.trim())
    const hasAliasCol = header.length >= 2

    const newOrder = []
    const newDict  = {}
    const errors   = []

    for (let i = 1; i < lines.length; i++) {
      const cols = parseCSVLine(lines[i])
      const name = cols[0]?.trim()
      if (!name) continue

      newOrder.push(name)

      if (hasAliasCol && cols[1]) {
        cols[1].split(',')
          .map(a => a.trim())
          .filter(Boolean)
          .forEach(alias => { newDict[alias] = name })
      }
    }

    if (newOrder.length === 0) throw new Error('有効な品目が見つかりませんでした')

    config.order      = newOrder
    config.dictionary = newDict
    _save()

    return { count: newOrder.length, errors }
  }

  /** 現在の設定をCSV文字列として返す */
  function exportConfigCSV() {
    const rows = ['品目名,エイリアス']
    config.order.forEach(item => {
      const aliases = Object.entries(config.dictionary)
        .filter(([, v]) => v === item)
        .map(([k]) => k)
      const aliasCell = aliases.length ? `"${aliases.join(',')}"` : ''
      rows.push(`"${item}",${aliasCell}`)
    })
    return rows.join('\n')
  }

  /** デフォルト（config.js）に戻す */
  function resetToDefault() {
    config.order      = [...DEFAULT_ORDER]
    config.dictionary = { ...DEFAULT_DICT }
    config.isCustom   = false
    localStorage.removeItem(CONFIG_KEY)
  }

  const itemCount = computed(() => config.order.length)

  return { config, itemCount, loadFromCSV, exportConfigCSV, resetToDefault }
}
