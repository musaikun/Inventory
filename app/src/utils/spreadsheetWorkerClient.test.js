import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseSpreadsheetInWorker } from './spreadsheetWorkerClient.js'

afterEach(() => {
  vi.useRealTimers()
})

describe('spreadsheetWorkerClient', () => {
  it('Workerの解析結果を返し、終了処理を行う', async () => {
    class SuccessWorker {
      static instance
      constructor() {
        SuccessWorker.instance = this
        this.terminate = vi.fn()
      }
      postMessage() {
        queueMicrotask(() => this.onmessage({ data: { ok: true, result: '品目名\nトマト' } }))
      }
    }

    await expect(parseSpreadsheetInWorker(new ArrayBuffer(16), 'csv', {
      workerFactory: () => new SuccessWorker(),
      timeoutMs: 50,
    })).resolves.toContain('トマト')
    expect(SuccessWorker.instance.terminate).toHaveBeenCalledOnce()
  })

  it('制限時間を超えたWorkerを強制終了する', async () => {
    vi.useFakeTimers()
    class HungWorker {
      static instance
      constructor() {
        HungWorker.instance = this
        this.terminate = vi.fn()
      }
      postMessage() {}
    }

    const result = parseSpreadsheetInWorker(new ArrayBuffer(16), 'rows', {
      workerFactory: () => new HungWorker(),
      timeoutMs: 100,
    })
    const rejection = expect(result).rejects.toThrow('1秒を超えたため中止')
    await vi.advanceTimersByTimeAsync(100)
    await rejection
    expect(HungWorker.instance.terminate).toHaveBeenCalledOnce()
  })

  it('Web Worker非対応環境ではfail-closedにする', async () => {
    await expect(parseSpreadsheetInWorker(new ArrayBuffer(16), 'rows', {
      workerFactory: () => { throw new Error('unsupported') },
    })).rejects.toThrow('安全なExcel解析を利用できません')
  })
})
