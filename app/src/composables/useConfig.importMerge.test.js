import { describe, it, expect, beforeEach } from 'vitest'
import { useConfig, IMPORT_MODE_REPLACE } from './useConfig.js'
import { FREE_ITEM_LIMIT } from '../utils/planLimits.js'

// S5: 品目マスタ取込は既定で「追加・更新」。全入れ替えは明示指定のときだけ。
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
  cfg.config.hiddenItems   = []
  cfg.config.hiddenAuto    = []
}

describe('S5: 既定の取込（追加・更新）は既存品目を消さない', () => {
  beforeEach(() => { localStorage.clear(); resetConfig() })

  it('ファイルに無い既存品目は残り、新しい品目は末尾に追加される', () => {
    resetConfig(['トマト', 'レタス', 'なす'])
    cfg.config.units  = { トマト: '個', レタス: '玉', なす: '本' }
    cfg.config.prices = { なす: 80 }

    const r = cfg.loadFromCSV('品目名,単位\nトマト,箱\nきゅうり,本')

    expect(cfg.config.order).toEqual(['トマト', 'レタス', 'なす', 'きゅうり'])
    expect(cfg.config.units['レタス']).toBe('玉')   // ファイルに無くても消えない
    expect(cfg.config.prices['なす']).toBe(80)      // 属性も消えない
    expect(cfg.config.units['トマト']).toBe('箱')   // 同名はファイルの値で更新
    expect(r.added).toBe(1)
    expect(r.updated).toBe(1)
    expect(r.removed).toBe(0)
    expect(r.count).toBe(4)
  })

  it('同名品目は空欄の列で既存値を消さない', () => {
    resetConfig(['トマト'])
    cfg.config.units      = { トマト: '個' }
    cfg.config.prices     = { トマト: 120 }
    cfg.config.categories = { トマト: '野菜' }

    // 単価とカテゴリは空欄
    cfg.loadFromCSV('品目名,単位,単価,カテゴリ\nトマト,箱,,')

    expect(cfg.config.units['トマト']).toBe('箱')
    expect(cfg.config.prices['トマト']).toBe(120)
    expect(cfg.config.categories['トマト']).toBe('野菜')
  })

  // 別名の取込は止めた（5列目を列名で確かめずに別名として読み、全件衝突していたため）。
  // 既存の別名は音声入力の名寄せに使うので、取込で壊さない。
  it('既存のエイリアスは取込で消えず、ファイルからは増えない', () => {
    resetConfig(['トマト'])
    cfg.config.dictionary = { とまと: 'トマト' }

    cfg.loadFromCSV('品目名,単位,単価,カテゴリ,エイリアス\nトマト,個,,,"あかいやつ"')

    expect(cfg.config.dictionary['とまと']).toBe('トマト')
    expect(cfg.config.dictionary['あかいやつ']).toBeUndefined()
  })

  it('手動追加した品目はファイルに無くても保持される', () => {
    resetConfig(['手動品目'])
    cfg.config.manualItems = ['手動品目']

    cfg.loadFromCSV('品目名,単位\nトマト,個')

    expect(cfg.config.order).toContain('手動品目')
    expect(cfg.config.manualItems).toEqual(['手動品目'])
  })

  it('同じファイルを二度取り込んでも件数が増えない（冪等）', () => {
    resetConfig()
    const csv = '品目名,単位\nトマト,個\nレタス,玉'
    cfg.loadFromCSV(csv)
    const second = cfg.loadFromCSV(csv)

    expect(cfg.config.order).toEqual(['トマト', 'レタス'])
    expect(second.added).toBe(0)
    expect(second.updated).toBe(0)
    expect(second.unchanged).toBe(2)
  })

  it('loadFromCSVMapped も既定は追加・更新', () => {
    resetConfig(['トマト'])
    const r = cfg.loadFromCSVMapped('名前,場所\nレタス,冷蔵庫', { name: 0, axisA: 1 })
    expect(cfg.config.order).toEqual(['トマト', 'レタス'])
    expect(r.added).toBe(1)
    expect(r.removed).toBe(0)
  })
})

describe('S5: 全入れ替えは明示指定のときだけ', () => {
  beforeEach(() => { localStorage.clear(); resetConfig() })

  it('mode=replace でファイルに無い品目が削除される', () => {
    resetConfig(['トマト', 'レタス'])
    cfg.config.units = { トマト: '個', レタス: '玉' }

    const r = cfg.loadFromCSV('品目名,単位\nトマト,箱', { mode: IMPORT_MODE_REPLACE })

    expect(cfg.config.order).toEqual(['トマト'])
    expect(cfg.config.units['レタス']).toBeUndefined()
    expect(r.removed).toBe(1)
    expect(r.mode).toBe('replace')
  })

  it('mode=replace は取り込まれない属性も消す', () => {
    resetConfig(['トマト'])
    cfg.config.prices     = { トマト: 120 }
    cfg.config.categories = { トマト: '野菜' }

    cfg.loadFromCSV('品目名,単位\nトマト,個', { mode: IMPORT_MODE_REPLACE })

    expect(cfg.config.order).toEqual(['トマト'])
    expect(cfg.config.prices['トマト']).toBeUndefined()
    expect(cfg.config.categories['トマト']).toBeUndefined()
  })

  it('loadFromCSVMapped も mode=replace で全入れ替えになる', () => {
    resetConfig(['トマト', 'レタス'])
    const r = cfg.loadFromCSVMapped('名前\nトマト', { name: 0 }, { mode: IMPORT_MODE_REPLACE })
    expect(cfg.config.order).toEqual(['トマト'])
    expect(r.removed).toBe(1)
  })
})

describe('S5: Free 上限は既存品目を削らない', () => {
  beforeEach(() => { localStorage.clear(); resetConfig() })

  it('追加・更新では既存を残し、入り切らない新規だけ truncated になる', () => {
    const existing = Array.from({ length: FREE_ITEM_LIMIT - 2 }, (_, i) => `既存${i}`)
    resetConfig(existing)

    const rows = ['品目名,単位']
    for (let i = 0; i < 10; i++) rows.push(`新規${i},個`)
    const r = cfg.loadFromCSV(rows.join('\n'))

    expect(cfg.config.order.length).toBe(FREE_ITEM_LIMIT)
    expect(cfg.config.order.slice(0, existing.length)).toEqual(existing)  // 既存は1件も消えない
    expect(r.added).toBe(2)
    expect(r.truncated).toBe(8)
  })

  it('既に上限に達していれば新規は1件も入らない（既存は無傷）', () => {
    const existing = Array.from({ length: FREE_ITEM_LIMIT }, (_, i) => `既存${i}`)
    resetConfig(existing)

    const r = cfg.loadFromCSV('品目名,単位\n新規A,個\n新規B,個')

    expect(cfg.config.order.length).toBe(FREE_ITEM_LIMIT)
    expect(cfg.config.order).toEqual(existing)
    expect(r.added).toBe(0)
    expect(r.truncated).toBe(2)
  })

  it('既存品目の更新は上限に達していても行える', () => {
    const existing = Array.from({ length: FREE_ITEM_LIMIT }, (_, i) => `既存${i}`)
    resetConfig(existing)

    const r = cfg.loadFromCSV('品目名,単位\n既存0,箱')

    expect(cfg.config.units['既存0']).toBe('箱')
    expect(r.updated).toBe(1)
    expect(r.truncated).toBe(0)
  })
})

describe('S5: CSV の堅牢性', () => {
  beforeEach(() => { localStorage.clear(); resetConfig() })

  it('引用符で囲まれたカンマを含む品目名を1つの値として読む', () => {
    cfg.loadFromCSV('品目名,単位\n"ビール, 生樽",本')
    expect(cfg.config.order).toEqual(['ビール, 生樽'])
    expect(cfg.config.units['ビール, 生樽']).toBe('本')
  })

  it('BOM 付きファイルの1列目をヘッダとして認識する', () => {
    cfg.loadFromCSV('﻿品目名,単位,単価\nトマト,個,120')
    expect(cfg.config.order).toEqual(['トマト'])
    expect(cfg.config.prices['トマト']).toBe(120)
  })

  it('CRLF 改行と末尾の空行を扱える', () => {
    cfg.loadFromCSV('品目名,単位\r\nトマト,個\r\nレタス,玉\r\n\r\n')
    expect(cfg.config.order).toEqual(['トマト', 'レタス'])
  })

  it('日本語・全角スペース・記号を含む品目名を保持する', () => {
    const name = '牛乳　成分無調整（1Lパック）'
    cfg.loadFromCSV(`品目名,単位\n"${name}",パック`)
    expect(cfg.config.order).toEqual([name])
  })

  it('品目名が空の行を行番号と理由つきでスキップする', () => {
    const preview = cfg.previewCSVImport('品目名,単位\nトマト,個\n,個\nレタス,玉')
    expect(preview.skipped).toEqual([{ line: 3, name: '', reason: '品目名が空' }])
    expect(preview.added.length).toBe(2)
  })

  it('ファイル内の重複は行番号つきでスキップし、先に出た行を採用する', () => {
    const preview = cfg.previewCSVImport('品目名,単位\nトマト,個\nトマト,箱')
    expect(preview.duplicates).toBe(1)
    expect(preview.skipped[0]).toMatchObject({ line: 3, name: 'トマト' })

    const r = cfg.loadFromCSV('品目名,単位\nトマト,個\nトマト,箱')
    expect(cfg.config.units['トマト']).toBe('個')
    expect(r.merged).toBe(1)
  })

  it('データ行が無いファイルはエラーになる', () => {
    expect(() => cfg.loadFromCSV('品目名,単位')).toThrow('データ行がありません')
  })

  it('有効な品目が1件も無いファイルはエラーになる', () => {
    expect(() => cfg.loadFromCSV('品目名,単位\n,個\n,本')).toThrow('有効な品目が見つかりませんでした')
  })
})

describe('S5: 推奨フォーマット（エクスポートCSV）の往復', () => {
  beforeEach(() => { localStorage.clear(); resetConfig() })

  it('軸列を含むエクスポートCSVを取り込むと振り分けと軸名まで復元される', () => {
    resetConfig(['トマト'])
    cfg.config.axisNames = ['場所', '仕入先']
    cfg.config.tagsA     = { トマト: ['冷蔵庫'] }
    cfg.config.tagsB     = { トマト: ['八百屋'] }
    cfg.config.units     = { トマト: '個' }
    cfg.config.prices    = { トマト: 120 }
    cfg.setReorderPoint('トマト', 5)
    const csv = cfg.exportConfigCSV()

    resetConfig([])
    cfg.loadFromCSV(csv)

    expect(cfg.config.order).toEqual(['トマト'])
    expect(cfg.config.units['トマト']).toBe('個')
    expect(cfg.config.prices['トマト']).toBe(120)
    expect(cfg.config.reorderPoints['トマト']).toBe(5)
    expect(cfg.config.tagsA['トマト']).toEqual(['冷蔵庫'])
    expect(cfg.config.tagsB['トマト']).toEqual(['八百屋'])
    expect(cfg.config.axisNames).toEqual(['場所', '仕入先'])
  })

  it('軸列の値はアーカイブより優先される', () => {
    resetConfig([])
    cfg.config.tagsArchiveA = { トマト: ['常温棚'] }
    const csv = '品目名,単位,単価,カテゴリ,エイリアス,商品コード,分類コード,前月実績,入数,場所,仕入先,発注点\n'
              + 'トマト,個,,,,,,,,冷蔵庫,,'
    cfg.loadFromCSV(csv)
    expect(cfg.config.tagsA['トマト']).toEqual(['冷蔵庫'])
  })
})
