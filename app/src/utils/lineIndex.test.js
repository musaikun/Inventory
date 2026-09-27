import { describe, it, expect } from 'vitest'
import { findLine, linesOf } from './lineIndex.js'

describe('lineIndex', () => {
  const lines = [{ item: 'A', qty: null }, { item: 'B', qty: 2 }, { item: 'A', qty: 5 }]
  it('find と同じ結果（条件つき・同名の行は先のものから）', () => {
    expect(findLine(lines, 'A')).toBe(lines[0])
    expect(findLine(lines, 'A', l => l.qty != null)).toBe(lines[2])
    expect(findLine(lines, 'Z')).toBeUndefined()
    expect(linesOf(lines, 'A')).toEqual([lines[0], lines[2]])
  })
  it('行の数量を書き換えても追従する（値は行そのものを持つ）', () => {
    findLine(lines, 'B')
    lines[1].qty = null
    expect(findLine(lines, 'B', l => l.qty != null)).toBeUndefined()
  })
  it('行数が変われば作り直す', () => {
    const ls = [{ item: 'A', qty: 1 }]
    findLine(ls, 'A')
    ls.push({ item: 'C', qty: 1 })
    expect(findLine(ls, 'C')).toBe(ls[1])
  })
  it('配列でなければ undefined / 空', () => {
    expect(findLine(null, 'A')).toBeUndefined()
    expect(linesOf(undefined, 'A')).toEqual([])
  })
})
