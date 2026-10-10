// 何百品目の一括（振り分けの「残りをまとめる」）は保存1回（User報告 2026-10-10: 600品目で固まり連打した）
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../utils/api.js', () => ({ HTTP_BASE: '', WS_BASE: '', apiFetch: vi.fn(async () => ({})), setAuthInvalidatedHandler: vi.fn() }))

let cfg
beforeEach(async () => {
  localStorage.clear(); vi.resetModules()
  const { useConfig } = await import('./useConfig.js')
  cfg = useConfig(); cfg.setEmptyList()
  for (let i = 0; i < 600; i++) cfg.addItem(`品目${i}`, 0, '', '個')
  cfg.setAxisName(0, '保管場所')
})

describe('一括の振り分け・非表示', () => {
  it('600品目をまとめて1グループへ入れても保存は1回。知らない品目・入っている品目は数えない', () => {
    cfg.setItemTag('品目0', 0, 'その他')
    const set = vi.spyOn(Storage.prototype, 'setItem')
    const n = cfg.addItemsToGroup(0, [...cfg.config.order, '無い品目'], 'その他')
    const saves = set.mock.calls.filter(([k]) => k === 'inventory_config_v1').length
    set.mockRestore()
    expect(n).toBe(599)
    expect(saves).toBe(1)
    expect(cfg.config.tagsA['品目599']).toEqual(['その他'])
    expect(cfg.config.tagsArchiveA['品目599']).toEqual(['その他'])
  })

  it('まとめて隠す・戻すも保存は1回', () => {
    const names = cfg.config.order.slice(0, 300)
    const set = vi.spyOn(Storage.prototype, 'setItem')
    expect(cfg.hideItems(names)).toBe(300)
    expect(cfg.unhideItems(names.slice(0, 100))).toBe(100)
    const saves = set.mock.calls.filter(([k]) => k === 'inventory_config_v1').length
    set.mockRestore()
    expect(saves).toBe(2)
    expect(cfg.config.hiddenItems.length).toBe(200)
    expect(cfg.config.hiddenAt['品目0']).toBeUndefined()
    expect(cfg.config.hiddenAt['品目299']).toBeTruthy()
  })
})
