import { describe, it, expect } from 'vitest'
import { entitlement } from './entitlements.js'

describe('entitlement（プラン算出）', () => {
  it('新規のfree店舗はトライアルなしの無料枠になる', () => {
    const e = entitlement({ plan: 'free', created_at: '2026-07-28T00:00:00Z' })
    expect(e.inTrial).toBe(false)
    expect(e.trialEndsAt).toBeNull()
    expect(e.isPro).toBe(false)
    expect(e.plan).toBe('free')
  })

  it('created_atに関係なくfreeは自動的にPROにならない', () => {
    const e = entitlement({ plan: 'free', created_at: '2099-12-31T23:59:59Z' })
    expect(e.inTrial).toBe(false)
    expect(e.isPro).toBe(false)
  })

  it('plan=proだけがPROになる', () => {
    const e = entitlement({ plan: 'pro' })
    expect(e.inTrial).toBe(false)
    expect(e.trialEndsAt).toBeNull()
    expect(e.isPro).toBe(true)
  })

  it('plan の異常値は free として扱う', () => {
    const e = entitlement({ plan: 'enterprise' })
    expect(e.plan).toBe('free')
    expect(e.isPro).toBe(false)
  })
})
