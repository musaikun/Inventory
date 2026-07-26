import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ANALYTICS_ENABLED, initAnalytics, resetAnalytics, track } from './analytics.js'

describe('PRIV-001: third-party analytics disabled', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('eventや自由記述を送信しない', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    expect(ANALYTICS_ENABLED).toBe(false)
    expect(initAnalytics()).toBe(false)
    expect(track('feedback_submitted', { text: '個人情報を含み得る自由記述' })).toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('旧PostHog永続dataだけを削除し、アプリ固有dataは残す', () => {
    localStorage.setItem('ph_example_posthog', '{distinct_id:legacy}')
    localStorage.setItem('__posthog_debug', 'true')
    localStorage.setItem('_device_id', 'device-1')

    resetAnalytics()

    expect(localStorage.getItem('ph_example_posthog')).toBeNull()
    expect(localStorage.getItem('__posthog_debug')).toBeNull()
    expect(localStorage.getItem('_device_id')).toBe('device-1')
  })
})
