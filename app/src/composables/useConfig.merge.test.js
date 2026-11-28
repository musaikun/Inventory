// 品目の統合（ITEM-001 I-5）
import { describe, it, expect, beforeEach } from 'vitest'
import { useConfig, canonItemId, itemIdOf } from './useConfig.js'
import { theoreticalStock } from '../services/theoreticalStock.js'
import { STORAGE_KEYS } from '../utils/storageKeys.js'

const cfg = useConfig()

describe('品目の統合', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem(STORAGE_KEYS.shopCode, 'SHOP01')
    cfg.setEmptyList()
    cfg.config.itemIds = {}
    cfg.config.itemAliases = {}
    cfg.config.notDuplicates = []
    cfg.addItem('トマト', 120, '野菜', '個')
    cfg.addItem('とまと', null, '', '個')
  })

  it('drop を keep にまとめる: 一覧から外れ、記録は keep の記録として続く。同じ棚卸の2行は足す', () => {
    const snaps = [{ date: '2026-11-20', savedAt: '2026-11-20T10:00:00Z', items: [{ item: 'トマト', qty: 10 }, { item: 'とまと', qty: 2 }] }]
    const moves = [{ type: 'in', date: '2026-11-21', savedAt: '2026-11-21T09:00:00Z', lines: [{ item: 'とまと', qty: 3 }] }]
    const r = cfg.mergeItems({ keep: 'トマト', drop: 'とまと' })
    expect(r.ok).toBe(true)
    expect(cfg.config.order).toEqual(['トマト'])
    expect(canonItemId(itemIdOf('とまと'))).toBe(itemIdOf('トマト'))
    expect(theoreticalStock('トマト', snaps, moves).qty).toBe(15)
    expect(cfg.config.dictionary['とまと']).toBe('トマト')   // 音声で「とまと」と言っても出る
  })

  it('keep に無い値は drop から引き継ぐ。名前も変えられる', () => {
    cfg.config.prices['トマト'] = undefined; delete cfg.config.prices['トマト']
    cfg.config.prices['とまと'] = 90
    const r = cfg.mergeItems({ keep: 'トマト', drop: 'とまと', name: 'ミニトマト' })
    expect(r.ok).toBe(true)
    expect(cfg.config.order).toEqual(['ミニトマト'])
    expect(cfg.config.prices['ミニトマト']).toBe(90)
  })

  it('単位が違えば止める', () => {
    cfg.config.units['とまと'] = '箱'
    expect(cfg.mergeItems({ keep: 'トマト', drop: 'とまと' })).toEqual({ ok: false, reason: 'unit' })
    expect(cfg.config.order).toEqual(['トマト', 'とまと'])
  })

  it('元に戻すと2つに分かれる', () => {
    const r = cfg.mergeItems({ keep: 'トマト', drop: 'とまと' })
    expect(cfg.undoMerge(r.undo)).toBe(true)
    expect(cfg.config.order).toEqual(['トマト', 'とまと'])
    expect(canonItemId(itemIdOf('とまと'))).toBe(itemIdOf('とまと'))
    const snaps = [{ date: '2026-11-20', savedAt: '2026-11-20T10:00:00Z', items: [{ item: 'トマト', qty: 10 }, { item: 'とまと', qty: 2 }] }]
    expect(theoreticalStock('トマト', snaps, []).qty).toBe(10)
  })

  it('「別の品目」の組を覚える', () => {
    cfg.markNotDuplicate('とまと', 'トマト')
    expect(cfg.config.notDuplicates).toEqual([[itemIdOf('トマト'), itemIdOf('とまと')].sort().join('|')])
  })
})
