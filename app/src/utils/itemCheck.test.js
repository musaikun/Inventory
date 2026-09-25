import { describe, it, expect } from 'vitest'
import { missingFields, itemCheckRows } from './itemCheck.js'

const cfg = (over = {}) => ({
  order: ['A', 'B', 'C'], hiddenItems: [],
  units: { A: '個', B: '本' }, prices: { A: 100, B: 0 }, categories: { A: '野菜' }, lotSizes: { A: '24本', B: '本' },
  ...over,
})

describe('itemCheck', () => {
  it('入数は数字が読めなければ空扱い、単価は0も空扱い', () => {
    expect(missingFields('A', cfg())).toEqual([])
    expect(missingFields('B', cfg())).toEqual(['lot', 'price', 'genre'])
    expect(missingFields('C', cfg())).toEqual(['lot', 'unit', 'price', 'genre'])
  })
  it('空欄のある品目だけをリストの順で返し、非表示は数えない', () => {
    expect(itemCheckRows(cfg()).map(r => r.item)).toEqual(['B', 'C'])
    expect(itemCheckRows(cfg({ hiddenItems: ['C'] })).map(r => r.item)).toEqual(['B'])
  })
})
