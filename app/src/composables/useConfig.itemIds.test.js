// 品目の変わらない ID（ITEM-001 段 I-1）
import { describe, it, expect, beforeEach } from 'vitest'
import { useConfig, applyRemoteConfig, itemIdOf } from './useConfig.js'
import { itemIdFor } from '../services/itemId.js'
import { STORAGE_KEYS } from '../utils/storageKeys.js'

const cfg = useConfig()

describe('品目の ID', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem(STORAGE_KEYS.shopCode, 'SHOP01')
    cfg.config.itemIds = {}
    cfg.config.order = ['トマト']
    cfg.config.manualItems = []
    cfg.config.deletedItems = []
  })

  it('品目が増えるとすぐ ID が付く。保存・同期の中身に入る', () => {
    cfg.addItem('レタス', 120, '野菜', '玉')
    expect(cfg.config.itemIds['レタス']).toBe(itemIdFor('SHOP01', 'レタス'))
    expect(cfg.serializeConfigData().itemIds['レタス']).toBe(itemIdFor('SHOP01', 'レタス'))
    expect(itemIdOf('レタス')).toBe(itemIdFor('SHOP01', 'レタス'))
  })

  it('名前を変えても ID は変わらない', () => {
    cfg.addItem('なす')
    const id = cfg.config.itemIds['なす']
    cfg.updateConfigItem('なす', '長なす', null, '')
    expect(cfg.config.itemIds['長なす']).toBe(id)
    expect(cfg.config.itemIds['なす']).toBeUndefined()
  })

  it('ID を持たない config（古い端末）が届いても手元の ID を残し、無い品目には付ける', () => {
    cfg.addItem('レタス')
    const id = cfg.config.itemIds['レタス']
    applyRemoteConfig({ order: ['トマト', 'レタス', 'きゅうり'], units: {} })
    expect(cfg.config.itemIds['レタス']).toBe(id)
    expect(cfg.config.itemIds['きゅうり']).toBe(itemIdFor('SHOP01', 'きゅうり'))
  })

  it('ID を持つ config が届いたら、その対応を使う', () => {
    applyRemoteConfig({ order: ['トマト'], itemIds: { トマト: 'it_00000000000000aa' } })
    expect(cfg.config.itemIds['トマト']).toBe('it_00000000000000aa')
  })
})
