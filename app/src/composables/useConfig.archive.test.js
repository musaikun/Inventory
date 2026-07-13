import { describe, it, expect, beforeEach } from 'vitest'
import { useConfig } from './useConfig.js'

const cfg = useConfig()

describe('useConfig 振り分けアーカイブ（再取込/再登録で復元）', () => {
  beforeEach(() => {
    localStorage.clear()
    cfg.config.order = ['トマト', 'レタス']
    cfg.config.tagsA = {}
    cfg.config.tagsB = {}
    cfg.config.tagsArchiveA = {}
    cfg.config.tagsArchiveB = {}
    cfg.config.axisNames = ['場所', '']
    cfg.config.axisGroupsA = []
  })

  it('割り当てるとアーカイブにも記憶される', () => {
    cfg.addItemToGroup(0, 'トマト', '冷蔵庫')
    expect(cfg.config.tagsArchiveA['トマト']).toEqual(['冷蔵庫'])
  })

  it('一括削除（既定）ではアーカイブが残り、同名再登録で復元される', () => {
    cfg.addItemToGroup(0, 'トマト', '冷蔵庫')
    cfg.setEmptyList()
    expect(cfg.config.tagsA).toEqual({})
    expect(cfg.config.tagsArchiveA['トマト']).toEqual(['冷蔵庫'])
    cfg.addItem('トマト')
    expect(cfg.config.tagsA['トマト']).toEqual(['冷蔵庫'])
  })

  it('resetAssignments 指定でアーカイブも消え、再登録しても復元しない', () => {
    cfg.addItemToGroup(0, 'トマト', '冷蔵庫')
    cfg.setEmptyList({ resetAssignments: true })
    expect(cfg.config.tagsArchiveA).toEqual({})
    cfg.addItem('トマト')
    expect(cfg.config.tagsA['トマト']).toBeUndefined()
  })

  it('再取込（loadFromCSV）で同名品目の振り分けを復元し件数を返す', () => {
    cfg.addItemToGroup(0, 'トマト', '冷蔵庫')
    cfg.setEmptyList()
    const r = cfg.loadFromCSV('品目名,単位\nトマト,個\nレタス,個')
    expect(cfg.config.tagsA['トマト']).toEqual(['冷蔵庫'])
    expect(r.restoredTags).toBe(1)
  })

  it('マッピング取込の軸列はアーカイブより優先される', () => {
    cfg.config.tagsArchiveA = { トマト: ['冷蔵庫'] }
    const r = cfg.loadFromCSVMapped('品目名,場所\nトマト,倉庫', { name: 0, axisA: 1 })
    expect(cfg.config.tagsA['トマト']).toEqual(['倉庫'])
    expect(r.restoredTags).toBe(0)
  })

  it('軸を丸ごと削除するとその軸のアーカイブも消える', () => {
    cfg.addItemToGroup(0, 'トマト', '冷蔵庫')
    cfg.clearAxis(0)
    expect(cfg.config.tagsArchiveA).toEqual({})
  })
})
