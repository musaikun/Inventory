import { describe, it, expect, beforeEach } from 'vitest'
import { useConfig } from './useConfig.js'

const cfg = useConfig()

describe('useConfig インポート時の同名品目の統合', () => {
  beforeEach(() => {
    localStorage.clear()
    cfg.config.order = []
    cfg.config.units = {}
    cfg.config.prices = {}
    cfg.config.categories = {}
    cfg.config.codes = {}
    cfg.config.manualItems = []
    cfg.config.tagsA = {}
    cfg.config.tagsB = {}
  })

  it('loadFromCSV: 品目名が完全一致する行は1件に統合される（最初の1件を採用）', () => {
    const csv = '品目名,単位\nトマト,個\nトマト,箱\nレタス,個'
    const r = cfg.loadFromCSV(csv)
    expect(cfg.config.order).toEqual(['トマト', 'レタス'])
    expect(cfg.config.units['トマト']).toBe('個')   // 最初の行が勝つ
    expect(r.count).toBe(2)
    expect(r.merged).toBe(1)
  })

  it('loadFromCSV: 同名はまとめたまま、括弧を勝手に付けない', () => {
    // コードが違うので「別の商品かもしれない」行として数える（既定では名前を変えない）。
    // 品目名に括弧を足すのは、確認画面で明示的に選んだときだけ。
    const csv = '品目名,単位,単価,カテゴリ,エイリアス,商品コード\n'
      + 'トマト,個,100,野菜,,A1\n'
      + 'トマト,個,120,乾物,,B2'
    const r = cfg.loadFromCSV(csv)
    expect(cfg.config.order).toEqual(['トマト'])
    expect(cfg.config.categories['トマト']).toBe('野菜')
    expect(cfg.config.prices['トマト']).toBe(100)
    expect(r.merged).toBe(0)
    expect(r.codeCollisions).toBe(1)
  })

  it('loadFromCSVMapped: 品目名が完全一致する行は1件に統合される', () => {
    const csv = '名前,場所\nトマト,冷蔵庫\nトマト,常温棚\nレタス,冷蔵庫'
    const r = cfg.loadFromCSVMapped(csv, { name: 0, axisA: 1 })
    expect(cfg.config.order).toEqual(['トマト', 'レタス'])
    expect(cfg.config.tagsA['トマト']).toEqual(['冷蔵庫'])  // 最初の行が勝つ
    expect(r.count).toBe(2)
    expect(r.merged).toBe(1)
  })

  it('重複がなければ merged は 0', () => {
    const r = cfg.loadFromCSV('品目名,単位\nトマト,個\nレタス,個')
    expect(r.merged).toBe(0)
  })
})
