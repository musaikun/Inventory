import { describe, it, expect } from 'vitest'
import { shortage, suggestOrder } from './orderSuggestion.js'

describe('orderSuggestion（発注ロジック）', () => {
  it('不足量 = 適正在庫 - 現在在庫', () => {
    expect(shortage(20, 8)).toBe(12)
    expect(shortage(20, 19)).toBe(1)
    expect(shortage(20, 25)).toBe(-5)
  })

  it('適正在庫が未算出(null)なら不足0・発注0', () => {
    expect(shortage(null, 8)).toBe(0)
    expect(suggestOrder(null, 8, 12)).toBe(0)
  })

  // 仕様の例: 適正20 / 在庫8 / LOT12 → 不足12 → 発注1
  it('不足がちょうど LOT なら発注1', () => {
    expect(suggestOrder(20, 8, 12)).toBe(1)
  })

  // 仕様の例: 適正20 / 在庫19 / LOT12 → 不足1 → 発注0（LOT未満は発注しない）
  it('不足が LOT 未満なら発注0', () => {
    expect(suggestOrder(20, 19, 12)).toBe(0)
  })

  it('不足を LOT で割った整数部だけ発注（端数は切り捨て）', () => {
    expect(suggestOrder(30, 5, 12)).toBe(2)   // 不足25 → floor(25/12)=2
    expect(suggestOrder(20, 7, 12)).toBe(1)   // 不足13 → floor(13/12)=1
    expect(suggestOrder(44, 8, 12)).toBe(3)   // 不足36 → floor(36/12)=3
  })

  it('不足0以下は発注0', () => {
    expect(suggestOrder(20, 20, 12)).toBe(0)
    expect(suggestOrder(20, 30, 12)).toBe(0)
  })

  it('入数不明(文字列/未設定)は LOT=1 として扱う', () => {
    expect(suggestOrder(20, 8, '本')).toBe(12)  // 不足12 / 1
    expect(suggestOrder(20, 8, null)).toBe(12)
  })

  it('入数文字列から数値を抽出して使う', () => {
    expect(suggestOrder(20, 8, '12本')).toBe(1)
  })
})
