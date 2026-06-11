import { describe, it, expect, beforeEach } from 'vitest'
import {
  useInventory,
  applyRemoteUpdate,
  applyRemoteRemove,
} from './useInventory.js'

const inv = useInventory()

describe('useInventory', () => {
  beforeEach(() => {
    localStorage.clear()
    inv.reset()
  })

  // S-01 新規セッションは空から始まる
  it('reset() で在庫・フラグ・完了状態がすべて消える', () => {
    inv.setItem('玉ねぎ', 5, '箱')
    inv.setRecountFlag('にんじん', true, 'A')
    inv.completeSession()
    inv.reset()
    expect(Object.keys(inv.inventory)).toHaveLength(0)
    expect(Object.keys(inv.recountFlags)).toHaveLength(0)
    expect(inv.isCompleted.value).toBe(false)
  })

  // 入力＝自分の値には localEntry が付く（競合判定の前提）
  it('setItem は localEntry: true を付与する', () => {
    inv.setItem('玉ねぎ', 5, '箱')
    expect(inv.inventory['玉ねぎ'].localEntry).toBe(true)
    expect(inv.inventory['玉ねぎ'].qty).toBe(5)
  })

  // リモート受信値には localEntry を付けない（誤競合の防止）
  it('applyRemoteUpdate は localEntry を付与しない', () => {
    applyRemoteUpdate('玉ねぎ', 3, '箱', 'B')
    expect(inv.inventory['玉ねぎ'].localEntry).toBeUndefined()
    expect(inv.inventory['玉ねぎ'].qty).toBe(3)
  })

  // 加算入力
  it('add=true は既存数量に加算する', () => {
    inv.setItem('玉ねぎ', 5, '箱')
    inv.setItem('玉ねぎ', 3, '箱', true)
    expect(inv.inventory['玉ねぎ'].qty).toBe(8)
  })

  it('add=false は上書きする', () => {
    inv.setItem('玉ねぎ', 5, '箱')
    inv.setItem('玉ねぎ', 2, '箱', false)
    expect(inv.inventory['玉ねぎ'].qty).toBe(2)
  })

  // 小数の丸め（浮動小数点誤差対策）
  it('加算結果は小数第4位に丸められる', () => {
    inv.setItem('油', 0.1, 'L')
    inv.setItem('油', 0.2, 'L', true)
    expect(inv.inventory['油'].qty).toBe(0.3)
  })

  // filledCount
  it('filledCount は入力済み品目数を表す', () => {
    inv.setItem('A', 1, '個')
    inv.setItem('B', 2, '個')
    expect(inv.filledCount.value).toBe(2)
  })

  // 完了状態
  it('完了済みは applyRemoteUpdate を受け付けない', () => {
    inv.completeSession()
    applyRemoteUpdate('玉ねぎ', 3, '箱', 'B')
    expect(inv.inventory['玉ねぎ']).toBeUndefined()
  })

  it('applyRemoteRemove は品目を削除する', () => {
    applyRemoteUpdate('玉ねぎ', 3, '箱', 'B')
    applyRemoteRemove('玉ねぎ')
    expect(inv.inventory['玉ねぎ']).toBeUndefined()
  })
})
