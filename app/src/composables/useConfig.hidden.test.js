import { describe, it, expect, beforeEach } from 'vitest'
import { useConfig } from './useConfig.js'

const cfg = useConfig()

describe('useConfig 手動非表示', () => {
  beforeEach(() => {
    localStorage.clear()
    cfg.config.order = ['トマト', 'レタス', 'なす']
    cfg.config.hiddenItems = []
    cfg.config.hiddenAuto = []
    cfg.config.hiddenAt = {}
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

  // 非表示は確認なしで決まるので、あとから「いつ隠したか」を一覧で辿れるようにしている。
  it('hideItem は非表示にした時刻を残し、unhideItem で消す', () => {
    cfg.hideItem('レタス')
    expect(cfg.config.hiddenAt['レタス']).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    cfg.unhideItem('レタス')
    expect(cfg.config.hiddenAt['レタス']).toBeUndefined()
  })

  it('隠し直すと時刻が新しくなる（一覧の先頭へ来る）', () => {
    cfg.hideItem('なす')
    const first = cfg.config.hiddenAt['なす']
    cfg.unhideItem('なす')
    cfg.hideItem('なす')
    expect(cfg.config.hiddenAt['なす'] >= first).toBe(true)
  })

  it('自動非表示にも時刻を残す（由来の区別は hiddenAuto が持つ）', () => {
    cfg.hideItem('トマト', true)
    expect(cfg.config.hiddenAt['トマト']).toBeTruthy()
    expect(cfg.config.hiddenAuto).toContain('トマト')
  })

  it('自動非表示を手動 hideItem で呼び直すと手動へ再分類される', () => {
    cfg.hideItem('なす', true)
    expect(cfg.config.hiddenAuto).toContain('なす')
    cfg.hideItem('なす')          // auto=false で再分類
    expect(cfg.config.hiddenAuto).not.toContain('なす')
    expect(cfg.config.hiddenItems.filter(x => x === 'なす')).toHaveLength(1)
  })
})
