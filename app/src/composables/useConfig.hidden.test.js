import { describe, it, expect, beforeEach } from 'vitest'
import { useConfig } from './useConfig.js'

const cfg = useConfig()

describe('useConfig 手動非表示', () => {
  beforeEach(() => {
    localStorage.clear()
    cfg.config.order = ['トマト', 'レタス', 'なす']
    cfg.config.hiddenItems = []
  })

  it('hideItem で非表示に追加され、activeItemCount が減る', () => {
    expect(cfg.activeItemCount.value).toBe(3)
    cfg.hideItem('レタス')
    expect(cfg.config.hiddenItems).toContain('レタス')
    expect(cfg.activeItemCount.value).toBe(2)
  })

  it('同じ品目を二重に非表示にしない', () => {
    cfg.hideItem('なす')
    cfg.hideItem('なす')
    expect(cfg.config.hiddenItems.filter(x => x === 'なす')).toHaveLength(1)
  })

  it('unhideItem で戻すと activeItemCount が回復する', () => {
    cfg.hideItem('トマト')
    expect(cfg.activeItemCount.value).toBe(2)
    cfg.unhideItem('トマト')
    expect(cfg.config.hiddenItems).not.toContain('トマト')
    expect(cfg.activeItemCount.value).toBe(3)
  })

  it('order に無い品目を非表示にしても activeItemCount は order 基準', () => {
    cfg.hideItem('存在しない')
    expect(cfg.activeItemCount.value).toBe(3)
  })
})
