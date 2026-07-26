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

// アカウント削除時などに端末の分析 identity をリセットする（distinct_id 再生成・
// localStorage 上の PostHog 永続データを破棄）。
export function resetAnalytics() {
  if (!KEY) return
  try { posthog.reset() } catch (_) {}
}
