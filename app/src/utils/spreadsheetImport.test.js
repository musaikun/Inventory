import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import {
  MAX_SPREADSHEET_BYTES,
  MAX_SPREADSHEET_COLUMNS,
  MAX_SPREADSHEET_ROWS,
  MAX_SPREADSHEET_SHEETS,
  assertSpreadsheetByteLength,
  parseSpreadsheetBuffer,
} from './spreadsheetImport.js'

function workbookBuffer(sheets, bookType = 'xlsx') {
  const workbook = XLSX.utils.book_new()
  for (const [name, rows] of sheets) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name)
  }
  return XLSX.write(workbook, { type: 'array', bookType })
}

describe('spreadsheetImport', () => {
  it('実際のxlsxバイト列をCSVと行配列へ変換する', () => {
    const buffer = workbookBuffer([['品目', [['品目名', '単位'], ['トマト', '個']]]])

    expect(parseSpreadsheetBuffer(buffer.slice(0), 'csv')).toContain('トマト,個')
    expect(parseSpreadsheetBuffer(buffer.slice(0), 'rows')).toEqual([
      [['品目名', '単位'], ['トマト', '個']],
    ])
  })

  it('従来のxlsバイト列も日本語を保持して解析する', () => {
    const buffer = workbookBuffer([['品目', [['品目名', '単位'], ['牛乳', '本']]]], 'xls')
    expect(parseSpreadsheetBuffer(buffer, 'rows')).toEqual([
      [['品目名', '単位'], ['牛乳', '本']],
    ])
  })

  it('5MBを超える入力を解析前に拒否する', () => {
    expect(() => assertSpreadsheetByteLength(MAX_SPREADSHEET_BYTES + 1))
      .toThrow('5MB以下')
  })

  it('行数上限を超えるシートを拒否する', () => {
    const rows = Array.from({ length: MAX_SPREADSHEET_ROWS + 1 }, (_, index) => [index])
    const buffer = workbookBuffer([['rows', rows]])
    expect(() => parseSpreadsheetBuffer(buffer, 'rows')).toThrow(`${MAX_SPREADSHEET_ROWS}行以下`)
  })

  it('列数上限を超えるシートを拒否する', () => {
    const buffer = workbookBuffer([[
      'columns',
      [Array.from({ length: MAX_SPREADSHEET_COLUMNS + 1 }, (_, index) => index)],
    ]])
    expect(() => parseSpreadsheetBuffer(buffer, 'rows')).toThrow(`${MAX_SPREADSHEET_COLUMNS}列以下`)
  })

  it('シート数上限を超えるブックを拒否する', () => {
    const sheets = Array.from(
      { length: MAX_SPREADSHEET_SHEETS + 1 },
      (_, index) => [`sheet-${index + 1}`, [[index]]],
    )
    const buffer = workbookBuffer(sheets)
    expect(() => parseSpreadsheetBuffer(buffer, 'rows')).toThrow(`${MAX_SPREADSHEET_SHEETS}シート以下`)
  })
})
