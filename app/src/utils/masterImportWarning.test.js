import { describe, it, expect, vi } from 'vitest'
import { buildMasterImportWarning, confirmMasterImport } from './masterImportWarning.js'
import { confirmState, answerConfirm } from '../composables/askConfirm.js'

describe('buildMasterImportWarning', () => {
  it('現在の件数と「置き換わる」ことを本文に含む', () => {
    const msg = buildMasterImportWarning(300)
    expect(msg).toContain('300件')
    expect(msg).toContain('すべて置き換わります')
  })

  it('「追加ではない」と、消えるもの（品目・単価・別名・カテゴリ）を明示する', () => {
    const msg = buildMasterImportWarning(50)
    expect(msg).toContain('追加ではありません')
    expect(msg).toContain('ファイルに無い品目は削除されます')
    expect(msg).toContain('単価・別名・カテゴリ')
    // 「取り消しはできません」は実装（undoLastImport）と食い違う旧文言。
    // 1回だけ戻せること、その退避が端末のメモリ上だけであることを明示する。
    expect(msg).not.toContain('取り消しはできません')
    expect(msg).toContain('1回だけ戻せます')
    expect(msg).toContain('メモリ上')
  })

  it('不正な件数は0件として扱い、例外を投げない', () => {
    expect(buildMasterImportWarning(undefined)).toContain('0件')
    expect(buildMasterImportWarning(-5)).toContain('0件')
    expect(buildMasterImportWarning(NaN)).toContain('0件')
  })
})

describe('confirmMasterImport', () => {
  it('登録0件なら確認せず続行する（失うものが無い）', async () => {
    const confirmFn = vi.fn()
    expect(await confirmMasterImport(0, { confirmFn })).toBe(true)
    expect(confirmFn).not.toHaveBeenCalled()
  })

  it('登録があるときは確認し、OKなら true', async () => {
    const confirmFn = vi.fn(() => true)
    expect(await confirmMasterImport(300, { confirmFn })).toBe(true)
    expect(confirmFn).toHaveBeenCalledTimes(1)
    expect(confirmFn.mock.calls[0][0]).toContain('300件')
  })

  it('キャンセルされたら false（取込を実行させない）', async () => {
    expect(await confirmMasterImport(300, { confirmFn: () => false })).toBe(false)
  })

  // 既定はアプリの中の確認（標準の confirm() は使わない）。答えるまで取込へ進まない
  it('confirmFn 省略時はアプリの中の確認で訊く。件数を題に、消えるものを本文に、ボタンは「すべて入れ替える」', async () => {
    const native = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const p = confirmMasterImport(300)
    expect(confirmState.value.title).toContain('300件')
    expect(confirmState.value.body).toContain('ファイルに無い品目は削除されます')
    expect(confirmState.value.ok).toBe('すべて入れ替える')
    expect(confirmState.value.danger).toBe(true)
    answerConfirm(true)
    expect(await p).toBe(true)
    expect(native).not.toHaveBeenCalled()
    native.mockRestore()
  })

  it('取りやめたら false（同意なしに破壊しない）', async () => {
    const p = confirmMasterImport(300)
    answerConfirm(false)
    expect(await p).toBe(false)
  })
})
