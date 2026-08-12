import { describe, it, expect, beforeEach } from 'vitest'
import { useConfig } from './useConfig.js'

// R3-02: 発注点（reorderPoints）の CSV 往復・非破壊を検証。
const cfg = useConfig()

function resetConfig(order = []) {
  cfg.config.order         = [...order]
  cfg.config.units         = {}
  cfg.config.prices        = {}
  cfg.config.categories    = {}
  cfg.config.codes         = {}
  cfg.config.categoryCodes = {}
  cfg.config.prevMonths    = {}
  cfg.config.lotSizes      = {}
  cfg.config.reorderPoints = {}
  cfg.config.dictionary    = {}
  cfg.config.manualItems   = []
  cfg.config.tagsA         = {}
  cfg.config.tagsB         = {}
  cfg.config.tagsArchiveA  = {}
  cfg.config.tagsArchiveB  = {}
  cfg.config.axisNames     = ['', '']
  cfg.config.isCustom      = true
}

describe('R3-02: 発注点の CSV エクスポート/インポート', () => {
  beforeEach(() => { localStorage.clear(); resetConfig() })

  it('エクスポートCSVのヘッダと値に発注点が含まれる', () => {
    resetConfig(['トマト', 'レタス'])
    cfg.setReorderPoint('トマト', 5)
    const out  = cfg.exportConfigCSV()
    const rows = out.split('\r\n')
    expect(rows[0].split(',').pop()).toBe('発注点')
    // トマト行の末尾セルが 5、レタス行（未設定）は空
    // （エスケープが要らないセルは引用符で囲まない＝RFC4180 どおりの共通実装）
    const tomato = rows.find(r => r.startsWith('トマト,'))
    expect(tomato.split(',').pop()).toBe('5')
    const lettuce = rows.find(r => r.startsWith('レタス,'))
    expect(lettuce.split(',').pop()).toBe('')
  })

  it('発注点列を含むCSVを取り込むと発注点が復元される（往復）', () => {
    resetConfig(['トマト'])
    cfg.setReorderPoint('トマト', 8)
    const csv = cfg.exportConfigCSV()

    resetConfig([])  // まっさらから取り込む
    cfg.loadFromCSV(csv)
    expect(cfg.config.reorderPoints['トマト']).toBe(8)
  })

  it('発注点列が無い旧CSVの取込では既存の発注点を消さない（非破壊）', () => {
    resetConfig(['トマト'])
    cfg.setReorderPoint('トマト', 3)
    // 発注点列を持たない旧フォーマット（品目名・単位のみ）
    cfg.loadFromCSV('品目名,単位\nトマト,個')
    expect(cfg.config.reorderPoints['トマト']).toBe(3)
  })

  it('発注点列があり空セルなら発注点を解除する', () => {
    resetConfig(['トマト'])
    cfg.setReorderPoint('トマト', 4)
    // カテゴリ形式＋末尾に発注点列（空）
    const csv = '品目名,単位,単価,カテゴリ,エイリアス,商品コード,分類コード,前月実績,入数,場所,仕入先,発注点\n'
              + 'トマト,個,,,,,,,,,,'
    cfg.loadFromCSV(csv)
    expect(cfg.config.reorderPoints['トマト']).toBeUndefined()
  })
})
