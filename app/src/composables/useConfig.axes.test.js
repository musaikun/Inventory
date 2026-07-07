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
    cfg.config.axisGroupsA = []
    cfg.config.axisGroupsB = []
    cfg.config.isCustom    = true
  })

  it('軸名と軸値を設定できる（配列）', () => {
    cfg.setAxisName(0, '場所')
    cfg.setAxisName(1, '仕入先')
    cfg.setItemTag('パスタ', 0, '冷凍庫')
    cfg.setItemTag('パスタ', 1, '八百屋')
    expect(cfg.config.axisNames).toEqual(['場所', '仕入先'])
    expect(cfg.config.tagsA['パスタ']).toEqual(['冷凍庫'])
    expect(cfg.config.tagsB['パスタ']).toEqual(['八百屋'])
  })

  it('空文字で軸値を削除できる', () => {
    cfg.setItemTag('パスタ', 0, '冷凍庫')
    cfg.setItemTag('パスタ', 0, '')
    expect(cfg.config.tagsA['パスタ']).toBeUndefined()
  })

  it('多ロケーション: 1品目を複数グループに追加できる', () => {
    cfg.addItemToGroup(0, 'パスタ', '冷凍庫')
    cfg.addItemToGroup(0, 'パスタ', '仕込み場')
    expect(cfg.config.tagsA['パスタ']).toEqual(['冷凍庫', '仕込み場'])
    // 重複追加は無視
    cfg.addItemToGroup(0, 'パスタ', '冷凍庫')
    expect(cfg.config.tagsA['パスタ']).toEqual(['冷凍庫', '仕込み場'])
    // 片方だけ外す
    cfg.removeItemFromGroup(0, 'パスタ', '冷凍庫')
    expect(cfg.config.tagsA['パスタ']).toEqual(['仕込み場'])
    // 最後を外すと削除
    cfg.removeItemFromGroup(0, 'パスタ', '仕込み場')
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
    expect(saved.tagsA['パスタ']).toEqual(['冷凍庫'])
  })

  it('リネームで軸値が引き継がれる', () => {
    cfg.setItemTag('パスタ', 0, '冷凍庫')
    cfg.setItemTag('パスタ', 1, '八百屋')
    cfg.updateConfigItem('パスタ', 'スパゲティ', null, null, undefined)
    expect(cfg.config.tagsA['スパゲティ']).toEqual(['冷凍庫'])
    expect(cfg.config.tagsB['スパゲティ']).toEqual(['八百屋'])
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
    expect(cfg.config.tagsA['A']).toEqual(['棚1'])   // 文字列→配列に正規化
  })

  it('旧config（軸なし）でも落ちずデフォルトになる', () => {
    applyRemoteConfig({ order: ['A'] })
    expect(cfg.config.axisNames).toEqual(['', ''])
    expect(cfg.config.tagsA).toEqual({})
  })

  it('空の品目リストでも軸名がlocalStorageに保存される', () => {
    cfg.config.order = []          // 空リスト開始
    cfg.setAxisName(0, '場所')
    const saved = JSON.parse(localStorage.getItem('inventory_config_v1'))
    expect(Array.isArray(saved.order)).toBe(true)
    expect(saved.order.length).toBe(0)
    expect(saved.axisNames).toEqual(['場所', ''])   // 空リストでも軸名が残る
  })

  it('CSVマッピング取込で軸値と軸名（ヘッダ由来）が入る', () => {
    cfg.config.axisNames = ['', '']
    const csv = '品目名,場所,仕入先\nパスタ,冷凍庫,八百屋\nトマト,常温棚,青果店'
    cfg.loadFromCSVMapped(csv, { name: 0, axisA: 1, axisB: 2 })
    expect(cfg.config.tagsA['パスタ']).toEqual(['冷凍庫'])
    expect(cfg.config.tagsB['トマト']).toEqual(['青果店'])
    // 軸名が未設定だったのでヘッダ名を採用
    expect(cfg.config.axisNames).toEqual(['場所', '仕入先'])
  })

  it('CSV出力に軸列が含まれる（往復）', () => {
    cfg.config.order = ['パスタ']
    cfg.config.axisNames = ['場所', '仕入先']
    cfg.config.tagsA = { パスタ: ['冷凍庫'] }
    cfg.config.tagsB = { パスタ: ['八百屋'] }
    const out = cfg.exportConfigCSV()
    expect(out.split('\r\n')[0]).toContain('場所')
    expect(out.split('\r\n')[0]).toContain('仕入先')
    expect(out).toContain('冷凍庫')
    expect(out).toContain('八百屋')
  })

  it('グループの追加・リネーム・削除が割り当てに追従する', () => {
    cfg.config.order = ['パスタ', 'トマト']
    cfg.addAxisGroup(0, '冷凍庫')
    expect(cfg.config.axisGroupsA).toContain('冷凍庫')
    cfg.assignItemsToGroup(0, ['パスタ', 'トマト'], '冷凍庫')
    expect(cfg.config.tagsA['パスタ']).toEqual(['冷凍庫'])
    // リネーム→所属も追従
    cfg.renameAxisGroup(0, '冷凍庫', '冷凍室')
    expect(cfg.config.axisGroupsA).toContain('冷凍室')
    expect(cfg.config.tagsA['パスタ']).toEqual(['冷凍室'])
    // 削除→所属はその他（未割り当て）に戻る
    cfg.removeAxisGroup(0, '冷凍室')
    expect(cfg.config.axisGroupsA).not.toContain('冷凍室')
    expect(cfg.config.tagsA['パスタ']).toBeUndefined()
  })

  it('グループを上下に並び替えできる', () => {
    cfg.config.axisGroupsA = ['A', 'B', 'C']
    cfg.moveAxisGroup(0, 'C', -1)
    expect(cfg.config.axisGroupsA).toEqual(['A', 'C', 'B'])
    cfg.moveAxisGroup(0, 'A', 1)
    expect(cfg.config.axisGroupsA).toEqual(['C', 'A', 'B'])
    // 端は移動しない
    expect(cfg.moveAxisGroup(0, 'C', -1)).toBe(false)
    // 先頭へ
    cfg.moveAxisGroupToTop(0, 'B')
    expect(cfg.config.axisGroupsA).toEqual(['B', 'C', 'A'])
  })

  it('左のジャンルを1個だけ軸へコピーできる', () => {
    cfg.config.order = ['パスタ', 'トマト', 'レタス']
    cfg.config.categories = { パスタ: '乾物', トマト: '野菜', レタス: '野菜' }
    const n = cfg.copyCategoryToAxis(0, '野菜')
    expect(n).toBe(2)  // トマト・レタス
    expect(cfg.config.axisGroupsA).toEqual(['野菜'])       // 野菜だけ作成
    expect(cfg.config.tagsA['トマト']).toEqual(['野菜'])
    expect(cfg.config.tagsA['レタス']).toEqual(['野菜'])
    expect(cfg.config.tagsA['パスタ']).toBeUndefined()      // 乾物は対象外
    // 冪等
    cfg.copyCategoryToAxis(0, '野菜')
    expect(cfg.config.tagsA['トマト']).toEqual(['野菜'])
  })

  it('その他へ振り分けると割り当てが解除される', () => {
    cfg.config.order = ['パスタ']
    cfg.config.tagsA = { パスタ: ['冷凍庫'] }
    cfg.assignItemsToGroup(0, ['パスタ'], '')
    expect(cfg.config.tagsA['パスタ']).toBeUndefined()
  })

  it('再インポートで既存割り当てを名前一致で維持し、新規はその他', () => {
    cfg.config.order = ['パスタ', 'トマト']
    cfg.config.axisNames = ['場所', '']
    cfg.config.axisGroupsA = ['冷凍庫']
    cfg.config.tagsA = { パスタ: ['冷凍庫'], トマト: ['冷凍庫'] }
    // 軸列なしのCSVを再インポート（トマト消滅・レタス新規）
    cfg.loadFromCSVMapped('品目名\nパスタ\nレタス', { name: 0 })
    expect(cfg.config.tagsA['パスタ']).toEqual(['冷凍庫'])  // 維持
    expect(cfg.config.tagsA['トマト']).toBeUndefined() // 消えた品目は破棄
    expect(cfg.config.tagsA['レタス']).toBeUndefined() // 新規はその他
    expect(cfg.config.axisGroupsA).toContain('冷凍庫')  // グループ定義は維持
  })
})
