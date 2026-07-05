import { describe, it, expect, beforeEach } from 'vitest'
import { useConfig, applyRemoteConfig } from './useConfig.js'

const cfg = useConfig()

describe('useConfig 汎用2軸（A-1配線）', () => {
  beforeEach(() => {
    localStorage.clear()
    cfg.config.order       = ['パスタ', 'トマト']
    cfg.config.units       = {}
    cfg.config.prices      = {}
    cfg.config.categories  = {}
    cfg.config.codes       = {}
    cfg.config.prevMonths  = {}
    cfg.config.lotSizes    = {}
    cfg.config.dictionary  = {}
    cfg.config.manualItems = []
    cfg.config.axisNames   = ['', '']
    cfg.config.tagsA       = {}
    cfg.config.tagsB       = {}
    cfg.config.isCustom    = true
  })

  it('軸名と軸値を設定できる', () => {
    cfg.setAxisName(0, '場所')
    cfg.setAxisName(1, '仕入先')
    cfg.setItemTag('パスタ', 0, '冷凍庫')
    cfg.setItemTag('パスタ', 1, '八百屋')
    expect(cfg.config.axisNames).toEqual(['場所', '仕入先'])
    expect(cfg.config.tagsA['パスタ']).toBe('冷凍庫')
    expect(cfg.config.tagsB['パスタ']).toBe('八百屋')
  })

  it('空文字で軸値を削除できる', () => {
    cfg.setItemTag('パスタ', 0, '冷凍庫')
    cfg.setItemTag('パスタ', 0, '')
    expect(cfg.config.tagsA['パスタ']).toBeUndefined()
  })

  it('未登録品目には設定しない', () => {
    expect(cfg.setItemTag('存在しない', 0, 'x')).toBe(false)
  })

  it('localStorage に永続化される（保存→再読込）', () => {
    cfg.setAxisName(0, '場所')
    cfg.setItemTag('パスタ', 0, '冷凍庫')
    const saved = JSON.parse(localStorage.getItem('inventory_config_v1'))
    expect(saved.axisNames).toEqual(['場所', ''])
    expect(saved.tagsA['パスタ']).toBe('冷凍庫')
  })

  it('リネームで軸値が引き継がれる', () => {
    cfg.setItemTag('パスタ', 0, '冷凍庫')
    cfg.setItemTag('パスタ', 1, '八百屋')
    cfg.updateConfigItem('パスタ', 'スパゲティ', null, null, undefined)
    expect(cfg.config.tagsA['スパゲティ']).toBe('冷凍庫')
    expect(cfg.config.tagsB['スパゲティ']).toBe('八百屋')
    expect(cfg.config.tagsA['パスタ']).toBeUndefined()
  })

  it('削除で軸値も消える', () => {
    cfg.setItemTag('パスタ', 0, '冷凍庫')
    cfg.removeConfigItem('パスタ')
    expect(cfg.config.tagsA['パスタ']).toBeUndefined()
  })

  it('リモートconfig適用で軸が反映される', () => {
    applyRemoteConfig({
      order: ['A'], axisNames: ['棚', '業者'], tagsA: { A: '棚1' }, tagsB: { A: '業者X' },
    })
    expect(cfg.config.axisNames).toEqual(['棚', '業者'])
    expect(cfg.config.tagsA['A']).toBe('棚1')
  })

  it('旧config（軸なし）でも落ちずデフォルトになる', () => {
    applyRemoteConfig({ order: ['A'] })
    expect(cfg.config.axisNames).toEqual(['', ''])
    expect(cfg.config.tagsA).toEqual({})
  })
})
