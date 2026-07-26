import { describe, it, expect } from 'vitest'
import { entitlement } from './entitlements.js'
import { TRIAL_DAYS } from './constants.js'

const DAY = 86_400_000
const NOW = Date.parse('2026-07-15T00:00:00Z')

describe('entitlement（プラン／トライアル算出）', () => {
  it('作成直後（トライアル中）は plan=free でも isPro=true', () => {
    const e = entitlement({ plan: 'free', created_at: new Date(NOW).toISOString() }, NOW)
    expect(e.inTrial).toBe(true)
    expect(e.isPro).toBe(true)
    expect(e.plan).toBe('free')
  })

  it('トライアル境界の直前は pro 相当、経過後は free で isPro=false', () => {
    const created = new Date(NOW - (TRIAL_DAYS * DAY) + 1000).toISOString()  // あと1秒でトライアル終了
    expect(entitlement({ plan: 'free', created_at: created }, NOW).isPro).toBe(true)

    const expired = new Date(NOW - (TRIAL_DAYS * DAY) - 1000).toISOString()  // トライアル終了済み
    const e = entitlement({ plan: 'free', created_at: expired }, NOW)
    expect(e.inTrial).toBe(false)
    expect(e.isPro).toBe(false)
  })

  it('トライアル終了後でも plan=pro なら isPro=true（据え置き・課金）', () => {
    const expired = new Date(NOW - (TRIAL_DAYS * DAY) - DAY).toISOString()
    const e = entitlement({ plan: 'pro', created_at: expired }, NOW)
    expect(e.inTrial).toBe(false)
    expect(e.isPro).toBe(true)
  })

  it('trialEndsAt は created_at + TRIAL_DAYS 日', () => {
    const created = new Date(NOW).toISOString()
    const e = entitlement({ plan: 'free', created_at: created }, NOW)
    expect(Date.parse(e.trialEndsAt)).toBe(NOW + TRIAL_DAYS * DAY)
  })

  it('created_at 不正・欠損は now 起点でトライアル中扱い（フェイルオープン）', () => {
    expect(entitlement({ plan: 'free' }, NOW).isPro).toBe(true)
    expect(entitlement({ plan: 'free', created_at: '' }, NOW).isPro).toBe(true)
  })

  it('plan の異常値は free として扱う', () => {
    const expired = new Date(NOW - (TRIAL_DAYS * DAY) - DAY).toISOString()
    expect(entitlement({ plan: 'enterprise', created_at: expired }, NOW).plan).toBe('free')
  })
})
