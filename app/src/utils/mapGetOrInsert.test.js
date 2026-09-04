// pdfjs-dist 5.6 が素で呼ぶ Map.prototype.getOrInsertComputed の穴埋め。
// 無いままだと「列を指定して読み取る」でページが描画されず、白い枠とエラーになる。
import { describe, it, expect } from 'vitest'
import { installMapGetOrInsert } from './mapGetOrInsert.js'

describe('installMapGetOrInsert', () => {
  it('無い環境に、仕様どおりの実装を足す', () => {
    class FakeMap extends Map {}
    delete FakeMap.prototype.getOrInsert
    const target = { Map: FakeMap }
    installMapGetOrInsert(target)

    const m = new FakeMap()
    expect(m.getOrInsert('a', 1)).toBe(1)
    expect(m.getOrInsert('a', 2)).toBe(1)      // すでにあれば入れ替えない
    expect(m.get('a')).toBe(1)

    let calls = 0
    const make = () => { calls++; return { n: calls } }
    expect(m.getOrInsertComputed('b', make)).toEqual({ n: 1 })
    expect(m.getOrInsertComputed('b', make)).toEqual({ n: 1 })
    expect(calls, 'あるときは作らない').toBe(1)
  })

  it('すでに実装がある環境では触らない', () => {
    const mine = function () { return 'original' }
    class FakeMap extends Map {}
    FakeMap.prototype.getOrInsert = mine
    FakeMap.prototype.getOrInsertComputed = mine
    installMapGetOrInsert({ Map: FakeMap })
    expect(FakeMap.prototype.getOrInsert).toBe(mine)
    expect(FakeMap.prototype.getOrInsertComputed).toBe(mine)
  })

  it('列挙されない（for...in や Object.keys に出ない）', () => {
    class FakeMap extends Map {}
    delete FakeMap.prototype.getOrInsert
    installMapGetOrInsert({ Map: FakeMap })
    expect(Object.keys(FakeMap.prototype)).not.toContain('getOrInsert')
  })

  it('コールバックでなければ TypeError', () => {
    class FakeMap extends Map {}
    installMapGetOrInsert({ Map: FakeMap })
    expect(() => new FakeMap().getOrInsertComputed('a', 1)).toThrow(TypeError)
  })
})
