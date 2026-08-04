import { parseSpreadsheetBuffer } from '../utils/spreadsheetImport.js'

self.onmessage = event => {
  try {
    const result = parseSpreadsheetBuffer(event.data?.arrayBuffer, event.data?.mode)
    self.postMessage({ ok: true, result })
  } catch (error) {
    self.postMessage({ ok: false, error: error?.message || 'Excelファイルを解析できませんでした' })
  }
}
