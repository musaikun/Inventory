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

  it('CSVマッピング取込で軸値と軸名（ヘッダ由来）が入る', () => {
    cfg.config.axisNames = ['', '']
    const csv = '品目名,場所,仕入先\nパスタ,冷凍庫,八百屋\nトマト,常温棚,青果店'
    cfg.loadFromCSVMapped(csv, { name: 0, axisA: 1, axisB: 2 })
    expect(cfg.config.tagsA['パスタ']).toBe('冷凍庫')
    expect(cfg.config.tagsB['トマト']).toBe('青果店')
    // 軸名が未設定だったのでヘッダ名を採用
    expect(cfg.config.axisNames).toEqual(['場所', '仕入先'])
  })

  it('CSV出力に軸列が含まれる（往復）', () => {
    cfg.config.order = ['パスタ']
    cfg.config.axisNames = ['場所', '仕入先']
    cfg.config.tagsA = { パスタ: '冷凍庫' }
    cfg.config.tagsB = { パスタ: '八百屋' }
    const out = cfg.exportConfigCSV()
    expect(out.split('\r\n')[0]).toContain('場所')
    expect(out.split('\r\n')[0]).toContain('仕入先')
    expect(out).toContain('冷凍庫')
    expect(out).toContain('八百屋')
  })
})
