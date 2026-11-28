// 重複の候補（ITEM-001 I-5）
import { describe, it, expect } from 'vitest'
import { findDuplicatePairs } from './duplicateItems.js'

const idOf = n => `id:${n}`

describe('findDuplicatePairs', () => {
  it('コード一致 → 名前と単位が同じ → 名前が含まれる の順', () => {
    const r = findDuplicatePairs({
      order: ['トマト', 'とまと', 'ベーコンスライス', 'Pスライスベーコン', 'ミニトマト', '塩'],
      units: { トマト: '個', とまと: '個', ミニトマト: '個' },
      codes: { ベーコンスライス: '1023', Pスライスベーコン: '1023' },
      idOf,
    })
    expect(r.map(p => [p.a, p.b, p.why])).toEqual([
      ['ベーコンスライス', 'Pスライスベーコン', 'code'],
      ['トマト', 'とまと', 'name'],
      ['トマト', 'ミニトマト', 'like'],
      ['とまと', 'ミニトマト', 'like'],
    ])
  })

  it('単位が違う同名は出さない。「別の品目」と答えた組・非表示の品目も出さない', () => {
    expect(findDuplicatePairs({ order: ['トマト', 'とまと'], units: { トマト: '個', とまと: '箱' }, idOf })).toEqual([])
    expect(findDuplicatePairs({ order: ['トマト', 'とまと'], notDuplicates: ['id:とまと|id:トマト'].map(s => s.split('|').sort().join('|')), idOf })).toEqual([])
    expect(findDuplicatePairs({ order: ['トマト', 'とまと'], hidden: ['とまと'], idOf })).toEqual([])
  })

  it('1文字の名前は「含まれる」で拾わない', () => {
    expect(findDuplicatePairs({ order: ['酢', '黒酢'], idOf })).toEqual([])
  })
})
