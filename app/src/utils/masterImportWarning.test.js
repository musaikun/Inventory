import { describe, it, expect, vi } from 'vitest'
import { buildMasterImportWarning, confirmMasterImport } from './masterImportWarning.js'

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
  it('登録0件なら確認せず続行する（失うものが無い）', () => {
    const confirmFn = vi.fn()
    expect(confirmMasterImport(0, { confirmFn })).toBe(true)
    expect(confirmFn).not.toHaveBeenCalled()
  })

  it('登録があるときは確認し、OKなら true', () => {
    const confirmFn = vi.fn(() => true)
    expect(confirmMasterImport(300, { confirmFn })).toBe(true)
    expect(confirmFn).toHaveBeenCalledTimes(1)
    expect(confirmFn.mock.calls[0][0]).toContain('300件')
  })

  it('キャンセルされたら false（取込を実行させない）', () => {
    expect(confirmMasterImport(300, { confirmFn: () => false })).toBe(false)
  })

  it('confirmFn 省略時は window.confirm を使う', () => {
    const spy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    expect(confirmMasterImport(300)).toBe(true)
    expect(spy.mock.calls[0][0]).toContain('300件')
    spy.mockRestore()
  })

  it('confirm が使えない環境では false（同意なしに破壊しない）', () => {
    const original = window.confirm
    delete window.confirm
    try {
      expect(confirmMasterImport(300)).toBe(false)
    } finally {
      window.confirm = original
    }
  })
})
