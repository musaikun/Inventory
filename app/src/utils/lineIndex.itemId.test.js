// 記録の行を品目の変わらない ID で結ぶ（ITEM-001 I-4a）
import { describe, it, expect, afterEach } from 'vitest'
import { findLine, linesOf, sameItem, setItemKeyResolver, bumpItemKeys } from './lineIndex.js'

const ids = { ミニトマト: 'it_00000000000000aa', 塩: 'it_00000000000000bb' }
const hash = { トマト: 'it_00000000000000aa' }   // 「トマト」から決まる ID ＝ 名前を変える前の品目
afterEach(() => setItemKeyResolver(null))

describe('lineIndex — 品目の ID で結ぶ', () => {
  it('名前を変えた品目の古い行（ID なし・古い名前）を、新しい名前で見つける', () => {
    setItemKeyResolver(n => ids[n] ?? hash[n] ?? `it_${'0'.repeat(15)}f`)
    const lines = [{ item: 'トマト', qty: 7 }, { item: 'ミニトマト', itemId: 'it_00000000000000aa', qty: 5 }, { item: '塩', qty: 1 }]
    expect(linesOf(lines, 'ミニトマト').map(l => l.qty)).toEqual([7, 5])
    expect(findLine(lines, '塩').qty).toBe(1)
    expect(sameItem(lines[0], 'ミニトマト')).toBe(true)
  })

  it('対応が変わったら索引を作り直す', () => {
    const map = { A: 'it_0000000000000001' }
    setItemKeyResolver(n => map[n] ?? 'it_000000000000000f')
    const lines = [{ item: 'A', qty: 1 }]
    expect(findLine(lines, 'A')?.qty).toBe(1)
    map.B = 'it_0000000000000001'; delete map.A
    bumpItemKeys()
    expect(findLine(lines, 'B')).toBeUndefined()   // 行は A の名前のまま、A は別の ID（…0f）になった
  })

  it('求め方が無ければ名前で結ぶ（行の ID は見ない）', () => {
    setItemKeyResolver(null)
    const lines = [{ item: 'トマト', itemId: 'it_00000000000000aa', qty: 3 }]
    expect(findLine(lines, 'トマト').qty).toBe(3)
    expect(findLine(lines, 'ミニトマト')).toBeUndefined()
  })
})
