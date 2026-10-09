// ルームから届く品目設定に単価が無いとき、手元の単価を残す。
// ルームはゲスト（と金額を見られないホスト）宛てに単価を取り除いて送る。空で上書きすると、
// オーナーの2台目がゲストで入った後の保存（丸ごと PUT）で、店の単価が消えていた。
import { describe, it, expect, beforeEach } from 'vitest'
import { useConfig, applyRemoteConfig } from './useConfig.js'

const cfg = useConfig()

describe('applyRemoteConfig と単価', () => {
  beforeEach(() => {
    localStorage.clear()
    cfg.config.order  = ['トマト']
    cfg.config.prices = { トマト: 100 }
  })

  it('prices の無い設定（ルームのゲスト宛て）では、手元の単価を残す', () => {
    applyRemoteConfig({ order: ['トマト', 'なす'], units: { なす: '本' } })
    expect(cfg.config.order).toEqual(['トマト', 'なす'])
    expect(cfg.config.prices).toEqual({ トマト: 100 })
  })

  it('prices: {} を明示した設定（サーバーの「単価なし」）では消す', () => {
    applyRemoteConfig({ order: ['トマト'], prices: {} })
    expect(cfg.config.prices).toEqual({})
  })

  it('単価が届けばそれに揃える', () => {
    applyRemoteConfig({ order: ['トマト'], prices: { トマト: 120 } })
    expect(cfg.config.prices).toEqual({ トマト: 120 })
  })
})
