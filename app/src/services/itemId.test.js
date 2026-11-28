// 品目の変わらない ID（ITEM-001 I-1）
import { describe, it, expect } from 'vitest'
import { itemIdFor, ensureItemIds, renameItemId, isItemId } from './itemId.js'

describe('itemId', () => {
  it('店舗コードと名前で決まる。どの端末でも同じ値', () => {
    const a = itemIdFor('ABC123', 'トマト')
    expect(isItemId(a)).toBe(true)
    expect(itemIdFor('ABC123', 'トマト')).toBe(a)
    expect(itemIdFor('XYZ999', 'トマト')).not.toBe(a)
    expect(itemIdFor('ABC123', 'トマト缶')).not.toBe(a)
  })

  it('無い品目にだけ足す。今ある対応・消した品目の ID は残す', () => {
    const { map, added } = ensureItemIds({ 削除済み: 'it_0000000000000001' }, ['トマト', '塩'], 'S')
    expect(added).toBe(2)
    expect(map['削除済み']).toBe('it_0000000000000001')
    expect(map['トマト']).toBe(itemIdFor('S', 'トマト'))
    const again = ensureItemIds(map, ['トマト', '塩'], 'S')
    expect(again.added).toBe(0)
    expect(again.map).toBe(map)
  })

  it('名前を変えると ID が付いて行く。同じ名前で作り直した品目は別の ID', () => {
    let { map } = ensureItemIds({}, ['トマト'], 'S')
    const id = map['トマト']
    map = renameItemId(map, 'トマト', 'ミニトマト')
    expect(map['ミニトマト']).toBe(id)
    expect(map['トマト']).toBeUndefined()
    map = ensureItemIds(map, ['ミニトマト', 'トマト'], 'S').map
    expect(map['トマト']).not.toBe(id)
    expect(isItemId(map['トマト'])).toBe(true)
  })

  it('形の正しくない値は捨てて付け直す', () => {
    const { map } = ensureItemIds({ トマト: 'bad' }, ['トマト'], 'S')
    expect(map['トマト']).toBe(itemIdFor('S', 'トマト'))
  })
})
