import { describe, it, expect } from 'vitest'
import { shortage, suggestOrder, roundUpExcess } from './orderSuggestion.js'

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

  // 切り上げ（User決定 2026-09-24）: 適正20 / 在庫19 / LOT12 → 不足1 → 発注1
  it('不足が LOT 未満でも発注1（切り上げ）', () => {
    expect(suggestOrder(20, 19, 12)).toBe(1)
  })

  it('不足を LOT で割って切り上げる', () => {
    expect(suggestOrder(30, 5, 12)).toBe(3)   // 不足25 → ceil(25/12)=3
    expect(suggestOrder(20, 7, 12)).toBe(2)   // 不足13 → ceil(13/12)=2
    expect(suggestOrder(44, 8, 12)).toBe(3)   // 不足36 → ちょうど3
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

  it('入数不明で端数の不足は1へ切り上げ', () => {
    expect(suggestOrder(2.5, 2, null)).toBe(1)
  })
})

describe('roundUpExcess（切り上げの余り）', () => {
  it('余りが入数の半分以上なら余りを返す', () => {
    expect(roundUpExcess(20, 19, 12)).toBe(11)   // 不足1 → 12入る → 11余る
    expect(roundUpExcess(20, 7, 12)).toBe(11)    // 不足13 → 24入る
  })
  it('余りが入数の半分未満なら0', () => {
    expect(roundUpExcess(30, 7, 12)).toBe(0)     // 不足23 → 24入る → 1余る
  })
  it('入数が不明・1以下、発注不要なら0', () => {
    expect(roundUpExcess(20, 8, null)).toBe(0)
    expect(roundUpExcess(20, 8, '本')).toBe(0)
    expect(roundUpExcess(20, 30, 12)).toBe(0)
  })
})
