import * as XLSX from 'xlsx'

export const MAX_SPREADSHEET_BYTES = 5 * 1024 * 1024
export const MAX_SPREADSHEET_SHEETS = 20
export const MAX_SPREADSHEET_ROWS = 5000
export const MAX_SPREADSHEET_COLUMNS = 100
export const MAX_SPREADSHEET_CELLS = 100000
export const SPREADSHEET_PARSE_TIMEOUT_MS = 8000

export function assertSpreadsheetByteLength(byteLength) {
  if (!Number.isFinite(byteLength) || byteLength < 0) {
    throw new Error('Excelファイルのサイズを確認できません')
  }
  if (byteLength > MAX_SPREADSHEET_BYTES) {
    throw new Error('Excelファイルは5MB以下にしてください')
  }
}

export function assertSpreadsheetFile(file) {
  if (!file || typeof file.size !== 'number') {
    throw new Error('Excelファイルのサイズを確認できません')
  }
  assertSpreadsheetByteLength(file.size)
}

function sheetDimensions(sheet) {
  const ref = sheet?.['!fullref'] || sheet?.['!ref']
  if (!ref) return { rows: 0, columns: 0 }
  const range = XLSX.utils.decode_range(ref)
  return {
    rows: range.e.r - range.s.r + 1,
    columns: range.e.c - range.s.c + 1,
  }
}

// Web Workerと実ファイル回帰テストで共有する同期コア。
// 公開UIからは必ずspreadsheetWorkerClient経由で呼び、時間上限を強制する。
export function parseSpreadsheetBuffer(arrayBuffer, mode) {
  assertSpreadsheetByteLength(arrayBuffer?.byteLength)
  if (mode !== 'csv' && mode !== 'rows') throw new Error('Excel解析モードが不正です')

  const workbook = XLSX.read(arrayBuffer, {
    type: 'array',
    dense: true,
    cellFormula: false,
    cellHTML: false,
    sheetRows: MAX_SPREADSHEET_ROWS + 1,
  })

  if (workbook.SheetNames.length > MAX_SPREADSHEET_SHEETS) {
    throw new Error(`Excelファイルは${MAX_SPREADSHEET_SHEETS}シート以下にしてください`)
  }

  let totalCells = 0
  for (const name of workbook.SheetNames) {
    const { rows, columns } = sheetDimensions(workbook.Sheets[name])
    if (rows > MAX_SPREADSHEET_ROWS) {
      throw new Error(`Excelの各シートは${MAX_SPREADSHEET_ROWS}行以下にしてください`)
    }
    if (columns > MAX_SPREADSHEET_COLUMNS) {
      throw new Error(`Excelの各シートは${MAX_SPREADSHEET_COLUMNS}列以下にしてください`)
    }
    totalCells += rows * columns
    if (totalCells > MAX_SPREADSHEET_CELLS) {
      throw new Error(`Excel全体のセル数は${MAX_SPREADSHEET_CELLS}以下にしてください`)
    }
  }

  if (mode === 'csv') {
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
    return firstSheet ? XLSX.utils.sheet_to_csv(firstSheet) : ''
  }

  return workbook.SheetNames.map(name =>
    XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: '' })
  )
}
