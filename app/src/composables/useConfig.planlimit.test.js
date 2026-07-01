import { describe, it, expect, beforeEach } from 'vitest'
import { useConfig } from './useConfig.js'
import { FREE_ITEM_LIMIT } from '../utils/planLimits.js'

const cfg = useConfig()

// 品目リストを空にしてから N 件登録する CSV を生成
function makeCsv(n) {
  const rows = ['品目名,単位']
  for (let i = 0; i < n; i++) rows.push(`品目${i},個`)
  return rows.join('\n')
}

describe('useConfig 無料プラン上限', () => {
  beforeEach(() => {
    localStorage.clear()
    // clearConfig はデフォルト品目を入れるため、空に揃えてからテストする
    cfg.config.order = []
    cfg.config.units = {}
    cfg.config.codes = {}
    cfg.config.manualItems = []
  })

  describe('addItem の上限', () => {
    it('無料: 上限未満なら追加できる', () => {
      cfg.config.order = Array.from({ length: FREE_ITEM_LIMIT - 1 }, (_, i) => `x${i}`)
      expect(cfg.addItem('新品目', null, null, null, null)).toBe(true)
      expect(cfg.config.order.length).toBe(FREE_ITEM_LIMIT)
    })

    it('無料: 上限ちょうどでは追加できない', () => {
      cfg.config.order = Array.from({ length: FREE_ITEM_LIMIT }, (_, i) => `x${i}`)
      expect(cfg.addItem('はみ出し品目', null, null, null, null)).toBe(false)
      expect(cfg.config.order.length).toBe(FREE_ITEM_LIMIT)
    })

    it('PRO: 上限を超えて追加できる', () => {
      localStorage.setItem('tanaoro_is_pro', '1')
      cfg.config.order = Array.from({ length: FREE_ITEM_LIMIT }, (_, i) => `x${i}`)
      expect(cfg.addItem('PRO品目', null, null, null, null)).toBe(true)
      expect(cfg.config.order.length).toBe(FREE_ITEM_LIMIT + 1)
    })

    it('重複品目は上限と無関係に false', () => {
      cfg.config.order = ['唯一']
      expect(cfg.addItem('唯一', null, null, null, null)).toBe(false)
    })
  })

  describe('loadFromCSV の切り捨て', () => {
    it('無料: 上限以内はそのまま取り込み、truncated=0', () => {
      const r = cfg.loadFromCSV(makeCsv(100))
      expect(r.count).toBe(100)
      expect(r.truncated).toBe(0)
      expect(cfg.config.order.length).toBe(100)
    })

    it('無料: 上限超過は150件で切り捨て、truncated に超過分', () => {
      const r = cfg.loadFromCSV(makeCsv(FREE_ITEM_LIMIT + 30))
      expect(r.count).toBe(FREE_ITEM_LIMIT)
      expect(r.truncated).toBe(30)
      expect(cfg.config.order.length).toBe(FREE_ITEM_LIMIT)
    })

    it('PRO: 上限を超えても全件取り込み、truncated=0', () => {
      localStorage.setItem('tanaoro_is_pro', '1')
      const r = cfg.loadFromCSV(makeCsv(FREE_ITEM_LIMIT + 30))
      expect(r.count).toBe(FREE_ITEM_LIMIT + 30)
      expect(r.truncated).toBe(0)
    })
  })

  describe('loadFromCSVMapped の切り捨て', () => {
    const mapping = { name: 0, unit: 1, price: null, category: null, alias: null, code: null }

    it('無料: 上限超過は切り捨て', () => {
      const r = cfg.loadFromCSVMapped(makeCsv(FREE_ITEM_LIMIT + 10), mapping)
      expect(r.count).toBe(FREE_ITEM_LIMIT)
      expect(r.truncated).toBe(10)
    })

    it('PRO: 全件取り込み', () => {
      localStorage.setItem('tanaoro_is_pro', '1')
      const r = cfg.loadFromCSVMapped(makeCsv(FREE_ITEM_LIMIT + 10), mapping)
      expect(r.count).toBe(FREE_ITEM_LIMIT + 10)
      expect(r.truncated).toBe(0)
    })
  })
})
