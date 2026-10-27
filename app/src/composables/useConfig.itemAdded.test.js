// 手で足した品目の記録と、破棄したセッションで足した品目を外す・戻す（User決定 2026-10-27）
import { describe, it, expect, beforeEach } from 'vitest'
import { useConfig, setItemAddSession, applyRemoteConfig } from './useConfig.js'

const cfg = useConfig()

describe('手で足した品目の記録', () => {
  beforeEach(() => {
    localStorage.clear()
    setItemAddSession(null)
    cfg.config.order = ['トマト']
    cfg.config.manualItems = []
    cfg.config.itemAdded = {}
    cfg.config.deletedItems = []
  })

  it('セッションの最中に足した品目だけ、破棄で外す。削除した品目には入れず、戻せる', () => {
    cfg.addItem('レタス', 120, '野菜', '玉')
    setItemAddSession('s1')
    cfg.addItem('なす', null, '野菜', '本')
    setItemAddSession(null)
    expect(cfg.config.itemAdded['なす'].session).toBe('s1')
    expect(cfg.config.itemAdded['レタス'].session).toBeUndefined()

    const out = cfg.removeItemsAddedIn('s1')
    expect(out.map(r => r.name)).toEqual(['なす'])
    expect(cfg.config.order).toEqual(['トマト', 'レタス'])
    expect(cfg.config.deletedItems).not.toContain('なす')

    expect(cfg.restoreAddedItems(out)).toBe(1)
    expect(cfg.config.order).toContain('なす')
    expect(cfg.config.units['なす']).toBe('本')
    expect(cfg.config.itemAdded['なす'].session).toBe('s1')
  })

  it('名前を変えても記録は付いていく。記録を持たない config が届いても手元の記録は残す', () => {
    setItemAddSession('s1')
    cfg.addItem('なす')
    setItemAddSession(null)
    cfg.updateConfigItem('なす', '長なす', null, '')
    expect(cfg.config.itemAdded['長なす'].session).toBe('s1')
    applyRemoteConfig({ order: ['トマト', '長なす'] })
    expect(cfg.config.itemAdded['長なす'].session).toBe('s1')
  })
})
