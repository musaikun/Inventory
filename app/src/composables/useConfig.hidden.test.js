import { describe, it, expect, beforeEach } from 'vitest'
import { useConfig } from './useConfig.js'

const cfg = useConfig()

describe('useConfig 手動非表示', () => {
  beforeEach(() => {
    localStorage.clear()
    cfg.config.order = ['トマト', 'レタス', 'なす']
    cfg.config.hiddenItems = []
    cfg.config.hiddenAuto = []
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

  it('auto フラグで非表示にすると hiddenAuto にも記録される', () => {
    cfg.hideItem('レタス', true)
    cfg.hideItem('なす')          // 手動
    expect(cfg.config.hiddenAuto).toContain('レタス')
    expect(cfg.config.hiddenAuto).not.toContain('なす')
    expect(cfg.config.hiddenItems).toEqual(expect.arrayContaining(['レタス', 'なす']))
  })

  it('unhideItem は hiddenAuto からも除去する', () => {
    cfg.hideItem('トマト', true)
    cfg.unhideItem('トマト')
    expect(cfg.config.hiddenItems).not.toContain('トマト')
    expect(cfg.config.hiddenAuto).not.toContain('トマト')
  })

  it('自動非表示を手動 hideItem で呼び直すと手動へ再分類される', () => {
    cfg.hideItem('なす', true)
    expect(cfg.config.hiddenAuto).toContain('なす')
    cfg.hideItem('なす')          // auto=false で再分類
    expect(cfg.config.hiddenAuto).not.toContain('なす')
    expect(cfg.config.hiddenItems.filter(x => x === 'なす')).toHaveLength(1)
  })
})
