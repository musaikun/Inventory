/**
 * 表をファイルにして保存させる（CSV / Excel・User決定 2026-10-17）。
 * - CSV: BOM 付き UTF-8（Excel で開いても文字化けしない）。シートが複数なら、同じ見出しのものは1つにつなげる
 *   （棚卸の「回ごと」は日付の列があるので、つなげても回が分かる。過去の棚卸としてそのまま取り込める）
 * - Excel: シートごとに1枚。数は数として入れる（Excel で足し算できるように）
 * セルの書き方（フォーミュラ対策）は CSV の取り出しと同じ toCSVRow に任せる。Excel は文字の先頭の = などを ' で止める
 */
import { toCSVRow } from './csvParse.js'

const _FORMULA = /^[=+\-@\t\r]/
const _xlsxCell = v => (typeof v === 'string' && _FORMULA.test(v) ? `'${v}` : v)
const _sheetName = (n, used) => {
  let base = String(n || 'Sheet').replace(/[[\]:*?/\\]/g, '-').slice(0, 31) || 'Sheet'
  let name = base, i = 2
  while (used.has(name)) name = `${base.slice(0, 28)}(${i++})`
  used.add(name)
  return name
}

/** CSV の中身（シートをつなげる） */
export function sheetsToCsv(sheets) {
  const out = []
  let head = null
  for (const s of sheets) {
    const [h, ...body] = s.rows
    const key = JSON.stringify(h)
    if (head !== key) { out.push(toCSVRow(h, { formulaGuard: true })); head = key }
    for (const r of body) out.push(toCSVRow(r, { formulaGuard: true }))
  }
  return out.join('\r\n')
}

/** Excel（.xlsx）の中身 */
export async function sheetsToXlsx(sheets) {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  const used = new Set()
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(s.rows.map(r => r.map(_xlsxCell)))
    // 列幅は中身の長さに合わせる（開いてすぐ読めるように）
    const widths = []
    for (const r of s.rows) r.forEach((c, i) => { widths[i] = Math.max(widths[i] ?? 6, Math.min(40, String(c ?? '').length * 2 + 2)) })
    ws['!cols'] = widths.map(w => ({ wch: w }))
    XLSX.utils.book_append_sheet(wb, ws, _sheetName(s.name, used))
  }
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
}

function _save(blob, filename) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

/**
 * @param {{ name: string, rows: any[][] }[]} sheets
 * @param {'xlsx'|'csv'} format
 * @param {string} base 拡張子なしのファイル名
 */
export async function downloadSheets(sheets, format, base) {
  if (format === 'csv') {
    _save(new Blob(['﻿' + sheetsToCsv(sheets)], { type: 'text/csv;charset=utf-8' }), `${base}.csv`)
  } else {
    const buf = await sheetsToXlsx(sheets)
    _save(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${base}.xlsx`)
  }
}
