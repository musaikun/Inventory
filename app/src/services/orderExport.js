/**
 * 発注の書き出し（User決定 2026-10-07）。文面は送る人に任せ、**品目名と数量だけ**を正しく出す。
 *
 * - 仕入先ごとに分ける（並び替えの1つで分ける。名前に「仕入」「業者」「取引」を含むものを既定に）
 * - 1行 = 「品目名　数量＋単位」。入数が2以上の品目は口数で頼むので「口」を付ける（画面の表示と同じ）
 * - 商品コードは選べば行の先頭に付ける
 */
import { effectiveLot } from './lot.js'

const SUPPLIER_RE = /仕入|業者|取引/

/** 既定の分け方。仕入先らしい並び替えがあればそれ、無ければ分けない */
export function defaultExportAxis(axisNames = ['', '']) {
  for (const i of [0, 1]) if (SUPPLIER_RE.test(axisNames[i] || '')) return i
  return -1
}

function _fmtQty(n) {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100)
}

export function exportLine(line, { code = '' } = {}) {
  const unit = effectiveLot(line.lot) > 1 ? '口' : (line.unit || '')
  return `${code ? `${code} ` : ''}${line.item}　${_fmtQty(Number(line.qty))}${unit}`
}

/**
 * @param {object} order   発注の記録（lines: [{item, qty, unit, lot}]）
 * @param {object} config  品目リスト（tagsA/tagsB・axisGroupsA/B・codes・order）
 * @param {{ axis?: number, withCode?: boolean }} opts axis = 0/1 で分ける、-1 で分けない
 * @returns {{ name: string, lines: string[], text: string }[]}
 */
export function buildOrderExport(order, config, { axis = -1, withCode = false } = {}) {
  const lines = (order?.lines ?? []).filter(l => l.item && Number(l.qty) > 0 && !l.excluded)
  // 品目リストの並び（取込順）で出す。業者の伝票と同じ順になりやすい
  const pos = new Map((config?.order ?? []).map((n, i) => [n, i]))
  lines.sort((a, b) => (pos.get(a.item) ?? 1e9) - (pos.get(b.item) ?? 1e9))
  const tags = axis === 0 ? config?.tagsA : axis === 1 ? config?.tagsB : null
  const groupOrder = axis === 0 ? (config?.axisGroupsA ?? []) : axis === 1 ? (config?.axisGroupsB ?? []) : []
  const OTHER = '振り分けなし'
  const groups = new Map()
  for (const l of lines) {
    const g = tags ? (tags[l.item]?.[0] || OTHER) : ''
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g).push(exportLine(l, { code: withCode ? (config?.codes?.[l.item] || '') : '' }))
  }
  const rank = g => (g === OTHER ? 1e9 : groupOrder.includes(g) ? groupOrder.indexOf(g) : 1e8)
  return [...groups.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b, 'ja'))
    .map(([name, ls]) => ({ name, lines: ls, text: ls.join('\n') }))
}
