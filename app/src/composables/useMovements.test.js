import { describe, it, expect, beforeEach } from 'vitest'
import { useMovements } from './useMovements.js'

const m = useMovements()

describe('useMovements（入出庫データ層）', () => {
  beforeEach(() => {
    localStorage.clear()
    for (const rec of m.getMovements()) m.deleteMovement(rec.id)
  })

  it('qty>0 の行だけ保存される', () => {
    const rec = m.saveMovement({
      type: 'in',
      lines: [
        { item: 'トマト', qty: 3, unit: 'ケース' },
        { item: 'レタス', qty: 0, unit: '玉' },   // 0 は除外
        { item: 'なす',  qty: null },              // 無効は除外
      ],
    })
    expect(rec).not.toBeNull()
    expect(rec.lines).toEqual([{ item: 'トマト', qty: 3, unit: 'ケース' }])
    expect(rec.type).toBe('in')
    expect(rec.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('有効行が無ければ保存しない', () => {
    const rec = m.saveMovement({ type: 'out', lines: [{ item: 'ネギ', qty: 0 }] })
    expect(rec).toBeNull()
    expect(m.getMovements()).toHaveLength(0)
  })

  it('type は in/out に正規化される', () => {
    const rec = m.saveMovement({ type: 'invalid', lines: [{ item: 'A', qty: 1 }] })
    expect(rec.type).toBe('in')
    const out = m.saveMovement({ type: 'out', lines: [{ item: 'B', qty: 1 }] })
    expect(out.type).toBe('out')
  })

  it('getMovements は date 降順で返す', () => {
    m.saveMovement({ type: 'in', date: '2026-07-01', lines: [{ item: 'A', qty: 1 }] })
    m.saveMovement({ type: 'out', date: '2026-07-10', lines: [{ item: 'B', qty: 2 }] })
    const list = m.getMovements()
    expect(list.map(r => r.date)).toEqual(['2026-07-10', '2026-07-01'])
  })

  it('deleteMovement で削除される', () => {
    const rec = m.saveMovement({ type: 'in', lines: [{ item: 'A', qty: 1 }] })
    m.deleteMovement(rec.id)
    expect(m.getMovements()).toHaveLength(0)
  })
})
