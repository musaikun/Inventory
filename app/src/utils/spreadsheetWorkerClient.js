import {
  assertSpreadsheetByteLength,
  SPREADSHEET_PARSE_TIMEOUT_MS,
} from './spreadsheetImport.js'

export function parseSpreadsheetInWorker(
  arrayBuffer,
  mode,
  { workerFactory = createSpreadsheetWorker, timeoutMs = SPREADSHEET_PARSE_TIMEOUT_MS } = {},
) {
  assertSpreadsheetByteLength(arrayBuffer?.byteLength)

  return new Promise((resolve, reject) => {
    let worker
    try {
      worker = workerFactory()
    } catch (_) {
      reject(new Error('このブラウザでは安全なExcel解析を利用できません'))
      return
    }
    let settled = false

    const finish = (callback, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      worker.terminate()
      callback(value)
    }

    const timer = setTimeout(() => {
      finish(reject, new Error(`Excelの解析が${Math.ceil(timeoutMs / 1000)}秒を超えたため中止しました`))
    }, timeoutMs)

    worker.onmessage = event => {
      if (event.data?.ok) finish(resolve, event.data.result)
      else finish(reject, new Error(event.data?.error || 'Excelファイルを解析できませんでした'))
    }
    worker.onerror = () => finish(reject, new Error('Excelファイルを解析できませんでした'))
    worker.postMessage({ arrayBuffer, mode }, [arrayBuffer])
  })
}

export function createSpreadsheetWorker() {
  return new Worker(
    new URL('../workers/spreadsheetImport.worker.js', import.meta.url),
    { type: 'module' },
  )
}
