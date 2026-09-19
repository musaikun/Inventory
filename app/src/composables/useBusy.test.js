// 時間のかかる処理のあいだの表示。
// 狙いは2つで、どちらも「出しっぱなし」「出ない」の両方を防ぐためにtestで固定する。
//   1. 速い処理では出さない（押すたびにちらつくのは、待ちの合図として役に立たない）
//   2. 同期処理でも出す（旗を立てただけでは描画されないまま走り切ってしまう）
import { describe, it, expect, beforeEach, vi } from 'vitest'

let busyLabel, isBusy, runBusy, clearBusy, HEAVY_ROWS

beforeEach(async () => {
  vi.resetModules()
  // requestAnimationFrame は jsdom にあるが、待ち時間を読みやすくするため差し替える
  globalThis.requestAnimationFrame = cb => setTimeout(() => cb(0), 0)
  const m = await import('./useBusy.js')
  ;({ busyLabel, isBusy, runBusy, clearBusy, HEAVY_ROWS } = m)
  clearBusy()
})

const sleep = ms => new Promise(r => setTimeout(r, ms))

describe('useBusy', () => {
  it('速く終わる処理では何も出さない', async () => {
    const seen = []
    const p = runBusy('取り込み中…', async () => { seen.push(busyLabel.value) })
    expect(busyLabel.value).toBe('')     // 始めた時点ではまだ出さない
    await p
    expect(seen).toEqual([''])           // 処理中も出ていない
    expect(isBusy.value).toBe(false)
  })

  it('長くかかる処理では出て、終わったら消える', async () => {
    let inside = ''
    const p = runBusy('取り込み中…', async () => {
      await sleep(260)                   // しきい値（180ms）を越える
      inside = busyLabel.value
    })
    await sleep(220)
    expect(busyLabel.value).toBe('取り込み中…')
    await p
    expect(inside).toBe('取り込み中…')
    expect(isBusy.value).toBe(false)
  })

  // 同期処理は main thread を占有するので、遅延表示のタイマーが動かない。
  // paintFirst は「先に描いてから始める」ための指定。
  it('paintFirst なら、同期処理でも本体より先に出る', async () => {
    let labelDuringWork = ''
    await runBusy('書き出し中…', () => { labelDuringWork = busyLabel.value },
      { paintFirst: true })
    expect(labelDuringWork).toBe('書き出し中…')
    expect(isBusy.value).toBe(false)     // 終われば必ず畳む
  })

  it('例外が出ても必ず畳む', async () => {
    await expect(runBusy('取り込み中…', () => { throw new Error('失敗') },
      { paintFirst: true })).rejects.toThrow('失敗')
    expect(isBusy.value).toBe(false)
  })

  it('入れ子でも、内側が終わった時点で外側の表示を消さない', async () => {
    await runBusy('外側…', async () => {
      await runBusy('内側…', async () => {}, { paintFirst: true })
      expect(busyLabel.value).toBe('外側…')
      expect(isBusy.value).toBe(true)
    }, { paintFirst: true })
    expect(isBusy.value).toBe(false)
  })

  it('戻り値はそのまま通す', async () => {
    expect(await runBusy('…', () => 42, { paintFirst: true })).toBe(42)
    expect(await runBusy('…', async () => 'ok')).toBe('ok')
  })

  it('「重い」の目安を持つ（小さい処理を待たせないための境目）', () => {
    expect(HEAVY_ROWS).toBeGreaterThan(0)
  })
})
