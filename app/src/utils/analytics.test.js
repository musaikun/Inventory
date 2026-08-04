import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ANALYTICS_ENABLED,
  analyticsConsent,
  initAnalytics,
  isAnalyticsConfigured,
  normalizeAnalyticsEvent,
  resetAnalytics,
  sanitizePostHogEvent,
  setAnalyticsConsent,
  toCountBucket,
  track,
} from './analytics.js'

describe('PRIV-001: privacy-first analytics gate', () => {
  beforeEach(() => {
    localStorage.clear()
    analyticsConsent.value = 'unset'
    vi.restoreAllMocks()
  })

  it('既定buildはPostHogを初期化せず通信しない', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    expect(ANALYTICS_ENABLED).toBe(false)
    expect(await initAnalytics()).toBe(false)
    expect(track('feedback_submitted', { text: '個人情報を含み得る自由記述' })).toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('enabled・project token・正規EU hostがすべて揃った場合だけ構成済みになる', () => {
    expect(isAnalyticsConfigured({
      VITE_POSTHOG_ENABLED: 'true',
      VITE_POSTHOG_KEY: 'phc_public_project_token',
      VITE_POSTHOG_HOST: 'https://eu.i.posthog.com',
    })).toBe(true)
    expect(isAnalyticsConfigured({
      VITE_POSTHOG_ENABLED: 'true',
      VITE_POSTHOG_KEY: 'phc_public_project_token',
      VITE_POSTHOG_HOST: 'https://us.i.posthog.com',
    })).toBe(false)
    expect(isAnalyticsConfigured({ VITE_POSTHOG_ENABLED: 'true' })).toBe(false)
  })

  it('送信eventを固定allowlistへ正規化し、自由記述eventを拒否する', () => {
    expect(normalizeAnalyticsEvent('item_added_walk')).toEqual({
      event: 'item_added', properties: { method: 'walk' },
    })
    expect(normalizeAnalyticsEvent('session_completed', { item_count: 42, mode: 'solo', shop_code: 'ABCD' })).toEqual({
      event: 'session_completed', properties: { item_count_bucket: '11-50', mode: 'solo' },
    })
    expect(normalizeAnalyticsEvent('review_rated', { stars: 4, positive: false, text: '本文' })).toEqual({
      event: 'review_rated', properties: { stars: 4, positive: true },
    })
    expect(normalizeAnalyticsEvent('feedback_submitted', { text: '本文' })).toBeNull()
    expect(normalizeAnalyticsEvent('review_feedback_submitted', { text: '本文' })).toBeNull()
  })

  it('件数は生値ではなくbucketへ変換する', () => {
    expect([0, 1, 10, 11, 50, 51, 100, 101].map(toCountBucket)).toEqual([
      '0', '1-10', '1-10', '11-50', '11-50', '51-100', '51-100', '101+',
    ])
    expect(toCountBucket(-1)).toBeNull()
  })

  it('before_sendでURL・自由記述・店舗／端末dataを除去する', () => {
    expect(sanitizePostHogEvent({
      event: 'review_rated',
      properties: {
        token: 'public-token',
        distinct_id: 'analytics-id',
        stars: 5,
        positive: true,
        '$current_url': 'https://example.test/?shop=ABCD',
        shop_code: 'ABCD',
        device_name: '厨房',
        text: '自由記述',
      },
    })).toEqual({
      event: 'review_rated',
      properties: {
        token: 'public-token', distinct_id: 'analytics-id', stars: 5, positive: true,
      },
    })
    expect(sanitizePostHogEvent({ event: '$pageview', properties: {} })).toBeNull()
  })

  it('拒否・account削除で同意、analytics ID、旧PostHog dataを消す', async () => {
    localStorage.setItem('ph_example_posthog', '{distinct_id:legacy}')
    localStorage.setItem('__posthog_debug', 'true')
    localStorage.setItem('_analytics_id_v1', 'a_00000000-0000-4000-8000-000000000000')
    localStorage.setItem('_device_id', 'device-1')

    expect(await setAnalyticsConsent(false)).toBe(false)
    expect(analyticsConsent.value).toBe('denied')
    expect(localStorage.getItem('_analytics_id_v1')).toBeNull()

    resetAnalytics()
    expect(analyticsConsent.value).toBe('unset')
    expect(localStorage.getItem('_analytics_consent_v1')).toBeNull()
    expect(localStorage.getItem('ph_example_posthog')).toBeNull()
    expect(localStorage.getItem('__posthog_debug')).toBeNull()
    expect(localStorage.getItem('_device_id')).toBe('device-1')
  })
})
