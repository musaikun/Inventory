import { describe, it, expect, beforeEach } from 'vitest'
import { useConfig } from './useConfig.js'

const cfg = useConfig()

describe('useConfig 練習モード/空リスト', () => {
  beforeEach(() => {
    localStorage.clear()
    cfg.config.order = []
    cfg.config.units = {}
    cfg.config.codes = {}
    cfg.config.prices = {}
    cfg.config.categories = {}
    cfg.config.dictionary = {}
    cfg.config.manualItems = []
    cfg.config.isCustom = false
  })

  describe('setEmptyList', () => {
    it('品目を空にして isCustom=true にする', () => {
      cfg.config.order = ['A', 'B']
      cfg.config.isCustom = false
      cfg.setEmptyList()
      expect(cfg.config.order).toEqual([])
      expect(cfg.config.isCustom).toBe(true)
    })
  })

  describe('snapshot / restore（練習モードの退避・復元）', () => {
    it('退避→上書き→復元で元の品目リストに戻る', () => {
      // 本来の店舗リスト
      cfg.config.order = ['牛乳', 'ビール']
      cfg.config.units = { 牛乳: '本', ビール: '本' }
      cfg.config.codes = { 牛乳: '4900000000001' }
      cfg.config.isCustom = true

      const snap = cfg.snapshotConfig()

      // 練習用に上書き（loadSampleData 相当）
      cfg.config.order = ['【テスト】りんご']
      cfg.config.units = {}
      cfg.config.codes = {}
      cfg.config.isCustom = false

      // 復元
      cfg.restoreConfigSnapshot(snap)
      expect(cfg.config.order).toEqual(['牛乳', 'ビール'])
      expect(cfg.config.units).toEqual({ 牛乳: '本', ビール: '本' })
      expect(cfg.config.codes).toEqual({ 牛乳: '4900000000001' })
      expect(cfg.config.isCustom).toBe(true)
    })

    it('スナップショットは独立コピー（後から元を変えても影響しない）', () => {
      cfg.config.order = ['A']
      const snap = cfg.snapshotConfig()
      cfg.config.order.push('B')   // 元を破壊的に変更
      cfg.restoreConfigSnapshot(snap)
      expect(cfg.config.order).toEqual(['A'])
    })

    it('null を渡しても例外なく何もしない', () => {
      cfg.config.order = ['A']
      expect(() => cfg.restoreConfigSnapshot(null)).not.toThrow()
      expect(cfg.config.order).toEqual(['A'])
    })
  })
})
