import posthog from 'posthog-js'

const KEY = import.meta.env.VITE_POSTHOG_KEY || ''

export function initAnalytics() {
  if (!KEY) return
  posthog.init(KEY, {
    api_host: 'https://app.posthog.com',
    capture_pageview: false,
    persistence: 'localStorage',
  })
}

export function track(event, props = {}) {
  if (!KEY) return
  try { posthog.capture(event, props) } catch (_) {}
}
