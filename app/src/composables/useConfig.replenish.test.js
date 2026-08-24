// 補充目標と発注数の決め方を config に足したことの回帰（事故B-01の再発防止を含む）。
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

describe('発注数の決め方', () => {
  it('既定は自動追従', () => {
    expect(cfg.config.orderInputMode).toBe('auto')
  })

  it('manual を保存でき、未知の値は auto に寄せる', async () => {
    cfg.setOrderInputMode('manual')
    expect(cfg.config.orderInputMode).toBe('manual')
    cfg.setOrderInputMode('なにか')
    expect(cfg.config.orderInputMode).toBe('auto')

    cfg.setOrderInputMode('manual')
    vi.resetModules()
    const { useConfig } = await import('./useConfig.js')
    expect(useConfig().config.orderInputMode).toBe('manual')
  })
})
