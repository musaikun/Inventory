import { describe, it, expect, beforeEach } from 'vitest'
import { useConfig, resetLocalData, applyRemoteConfig, IMPORT_MODE_REPLACE } from './useConfig.js'
import { FREE_ITEM_LIMIT } from '../utils/planLimits.js'

// S6: 取込前プレビューと取り消し。
// プレビューは実際の取込と同じ計画を使うので、件数はそのまま取込結果と一致する。
const cfg = useConfig()

// useConfig はモジュール単位のシングルトン。テスト間で取込の退避が残らないよう捨ててから始める。
function resetConfig(order = []) {
  cfg.undoLastImport()
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

describe('S6: 取込前プレビュー', () => {
  beforeEach(() => { localStorage.clear(); resetConfig() })

  it('プレビューは品目マスタを一切変更しない', () => {
    resetConfig(['トマト'])
    cfg.config.units = { トマト: '個' }

    cfg.previewCSVImport('品目名,単位\nトマト,箱\nレタス,玉')
    cfg.previewCSVImport('品目名,単位\nトマト,箱\nレタス,玉', { mode: IMPORT_MODE_REPLACE })

    expect(cfg.config.order).toEqual(['トマト'])
    expect(cfg.config.units['トマト']).toBe('個')
  })

  it('追加・更新・変更なしの件数が実際の取込結果と一致する', () => {
    resetConfig(['トマト', 'レタス'])
    cfg.config.units = { トマト: '個', レタス: '玉' }
    const csv = '品目名,単位\nトマト,個\nレタス,箱\nなす,本'

    const preview = cfg.previewCSVImport(csv)
    expect(preview.added.length).toBe(1)      // なす
    expect(preview.updated.length).toBe(1)    // レタス（単位が変わる）
    expect(preview.unchanged.length).toBe(1)  // トマト（同じ値）

    const result = cfg.loadFromCSV(csv)
    expect(result.added).toBe(preview.added.length)
    expect(result.updated).toBe(preview.updated.length)
    expect(result.unchanged).toBe(preview.unchanged.length)
    expect(result.count).toBe(preview.total)
  })

  it('更新される品目の変更前後の値を出す', () => {
    resetConfig(['トマト'])
    cfg.config.units  = { トマト: '個' }
    cfg.config.prices = { トマト: 100 }

    const preview = cfg.previewCSVImport('品目名,単位,単価\nトマト,箱,150')
    const changes = preview.updated[0].changes

    expect(preview.updated[0].name).toBe('トマト')
    expect(changes).toContainEqual({ field: '単位', before: '個', after: '箱' })
    expect(changes).toContainEqual({ field: '単価', before: '100', after: '150' })
  })

  // 別名の取込は止めたので、5列目の値は差分にも出ない（＝取り込まれない）
  it('エイリアス列は差分に出ない', () => {
    resetConfig(['トマト'])
    const preview = cfg.previewCSVImport('品目名,単位,単価,カテゴリ,エイリアス\nトマト,,,,"とまと"')
    const changes = preview.updated[0]?.changes ?? []
    expect(changes.some(c => c.field === 'エイリアス')).toBe(false)
    expect(preview.aliasConflicts ?? []).toEqual([])
  })

  it('全入れ替えのプレビューは削除される品目を名前で挙げる', () => {
    resetConfig(['トマト', 'レタス', 'なす'])
    const preview = cfg.previewCSVImport('品目名,単位\nトマト,個', { mode: IMPORT_MODE_REPLACE })
    expect(preview.removed).toEqual(['レタス', 'なす'])
    expect(preview.total).toBe(1)
  })

  it('追加・更新のプレビューでは削除される品目が0件', () => {
    resetConfig(['トマト', 'レタス'])
    const preview = cfg.previewCSVImport('品目名,単位\nトマト,個')
    expect(preview.removed).toEqual([])
    expect(preview.total).toBe(2)
  })

  it('除外された行を行番号・品目名・理由つきで返す', () => {
    resetConfig()
    const preview = cfg.previewCSVImport('品目名,単位\nトマト,個\n,個\nトマト,箱\nレタス,玉')
    expect(preview.skipped).toEqual([
      { line: 3, name: '',      reason: '品目名が空' },
      { line: 4, name: 'トマト', reason: 'ファイル内の重複（先に出てきた行を採用）' },
    ])
  })

  it('Free上限で取り込めない品目をプレビュー時点で挙げる（黙って切らない）', () => {
    resetConfig(Array.from({ length: FREE_ITEM_LIMIT }, (_, i) => `既存${i}`))
    const preview = cfg.previewCSVImport('品目名,単位\n新規A,個\n新規B,個')
    expect(preview.truncated).toEqual(['新規A', '新規B'])
    expect(preview.added).toEqual([])
  })

  it('列指定取込のプレビューも同じ形で返る', () => {
    resetConfig(['トマト'])
    const preview = cfg.previewMappedImport('名前,場所\nトマト,冷蔵庫\nレタス,常温棚', { name: 0, axisA: 1 })
    expect(preview.added).toEqual(['レタス'])
    expect(preview.updated[0].changes).toContainEqual({ field: '並び替え①', before: '', after: '冷蔵庫' })
    expect(cfg.config.order).toEqual(['トマト'])   // プレビューでは書き換わらない
  })
})

describe('S6: 直前の取込を取り消す', () => {
  beforeEach(() => { localStorage.clear(); resetConfig() })

  it('取込前は取り消せない', () => {
    resetConfig(['トマト'])
    expect(cfg.importUndoAvailable.value).toBe(false)
    expect(cfg.undoLastImport()).toBe(false)
  })

  it('取込直後は取込前の品目マスタへ戻せる', () => {
    resetConfig(['トマト'])
    cfg.config.units = { トマト: '個' }

    cfg.loadFromCSV('品目名,単位\nトマト,箱\nレタス,玉', { mode: IMPORT_MODE_REPLACE })
    expect(cfg.config.order).toEqual(['トマト', 'レタス'])
    expect(cfg.importUndoAvailable.value).toBe(true)

    expect(cfg.undoLastImport()).toBe(true)
    expect(cfg.config.order).toEqual(['トマト'])
    expect(cfg.config.units['トマト']).toBe('個')
    expect(cfg.importUndoAvailable.value).toBe(false)
  })

  it('取り消せるのは直前の1回だけ', () => {
    resetConfig([])
    cfg.loadFromCSV('品目名,単位\nトマト,個')
    cfg.loadFromCSV('品目名,単位\nレタス,玉')

    expect(cfg.undoLastImport()).toBe(true)
    expect(cfg.config.order).toEqual(['トマト'])   // 1回目の取込後まで
    expect(cfg.undoLastImport()).toBe(false)       // それ以上は戻せない
  })

  it('取込のあとに品目を編集したら取り消せなくなる（編集を巻き戻さない）', () => {
    resetConfig([])
    cfg.loadFromCSV('品目名,単位\nトマト,個')
    expect(cfg.importUndoAvailable.value).toBe(true)

    cfg.addItem('あとから追加した品目')

    expect(cfg.importUndoAvailable.value).toBe(false)
    expect(cfg.undoLastImport()).toBe(false)
    expect(cfg.config.order).toContain('あとから追加した品目')
  })

  it('アカウント切替の全消去で退避も捨てる（前アカウントの品目を復元させない）', () => {
    resetConfig([])
    cfg.loadFromCSV('品目名,単位\n前アカウントの品目,個')
    expect(cfg.importUndoAvailable.value).toBe(true)

    resetLocalData()

    expect(cfg.importUndoAvailable.value).toBe(false)
    expect(cfg.undoLastImport()).toBe(false)
    expect(cfg.config.order).not.toContain('前アカウントの品目')
  })

  it('ホストの品目リストを受け取ったら退避を捨てる', () => {
    resetConfig([])
    cfg.loadFromCSV('品目名,単位\nローカル品目,個')
    applyRemoteConfig({ order: ['ホスト品目'], units: {} })

    expect(cfg.importUndoAvailable.value).toBe(false)
    expect(cfg.undoLastImport()).toBe(false)
    expect(cfg.config.order).toEqual(['ホスト品目'])
  })
})
