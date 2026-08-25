// 補充目標と発注スケジュールを config に足したことの回帰（事故B-01の再発防止を含む）。
// config に足したフィールドは useConfig のシリアライズと RoomDO.normalizeConfig の
// 両方に無いと、ホストの品目更新でゲスト側から消える。
import { describe, it, expect, beforeEach, vi } from 'vitest'

let cfg
beforeEach(async () => {
  localStorage.clear()
  vi.resetModules()
  const { useConfig } = await import('./useConfig.js')
  cfg = useConfig()
  cfg.setEmptyList()
  cfg.addItem('トマト', 120, '', '個')
})

describe('補充目標', () => {
  it('設定・解除ができ、解除は自動算出へ戻す（キーを残さない）', () => {
    expect(cfg.setReplenishTarget('トマト', 24)).toBe(true)
    expect(cfg.config.replenishTargets['トマト']).toBe(24)

    cfg.setReplenishTarget('トマト', '')
    expect('トマト' in cfg.config.replenishTargets).toBe(false)
  })

  it('0は明示的な指定として保存する（未設定と区別する）', () => {
    cfg.setReplenishTarget('トマト', 0)
    expect(cfg.config.replenishTargets['トマト']).toBe(0)
  })

  it('不正値・未登録品目は受け付けない', () => {
    cfg.setReplenishTarget('トマト', 'abc')
    expect('トマト' in cfg.config.replenishTargets).toBe(false)
    expect(cfg.setReplenishTarget('存在しない', 10)).toBe(false)
  })

  it('リロードしても残る', async () => {
    cfg.setReplenishTarget('トマト', 18)
    vi.resetModules()
    const { useConfig } = await import('./useConfig.js')
    expect(useConfig().config.replenishTargets['トマト']).toBe(18)
  })
})

// 発注数の決め方は「自分で入力する」に統一したので、店舗ごとの選択（orderInputMode）は持たない。
describe('発注スケジュール（複数）', () => {
  it('既定は空配列', () => {
    expect(cfg.config.orderSchedules).toEqual([])
  })

  it('名前つきで複数保存でき、再読み込みしても残る', async () => {
    cfg.setOrderSchedules([
      { name: '青果', days: [2, 5], deadline: '15:00' },
      { name: '肉',   days: [1],    deadline: '' },
    ])
    expect(cfg.config.orderSchedules.map(s => [s.name, s.days, s.deadline]))
      .toEqual([['青果', [2, 5], '15:00'], ['肉', [1], '']])

    vi.resetModules()
    const { useConfig } = await import('./useConfig.js')
    const restored = useConfig().config.orderSchedules
    expect(restored.map(s => s.name)).toEqual(['青果', '肉'])
    expect(restored[0].days).toEqual([2, 5])
  })

  it('曜日が空の行は保存されず、上限5件で切り捨てる', () => {
    cfg.setOrderSchedules([
      { name: 'A', days: [1] }, { name: '空', days: [] }, { name: 'B', days: [2] },
      { name: 'C', days: [3] }, { name: 'D', days: [4] }, { name: 'E', days: [5] },
      { name: 'F', days: [6] },
    ])
    expect(cfg.config.orderSchedules.map(s => s.name)).toEqual(['A', 'B', 'C', 'D', 'E'])
  })

  it('旧・単一形式の orderSchedule は1件へ移行する', async () => {
    // 旧versionが書いた localStorage を直接置く
    const raw = JSON.parse(localStorage.getItem('inventory_config_v1'))
    delete raw.orderSchedules
    raw.orderSchedule = { days: [3, 6], deadline: '10:30' }
    localStorage.setItem('inventory_config_v1', JSON.stringify(raw))

    vi.resetModules()
    const { useConfig } = await import('./useConfig.js')
    const list = useConfig().config.orderSchedules
    expect(list).toHaveLength(1)
    expect(list[0].days).toEqual([3, 6])
    expect(list[0].deadline).toBe('10:30')
    expect(list[0].name).toBe('')
  })
})
