// PRIV-001: Google Play公開対象buildでは第三者analyticsを送信しない。
// App側のcall siteは将来の再検討に備えて維持するが、このmoduleは常にlocal-only no-opとする。
// 再有効化にはUser判断、明示consent、event allowlist、retention、privacy/Data Safety更新が必要。
export const ANALYTICS_ENABLED = false

function clearLegacyPostHogStorage() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i)
      if (key && (/^ph_.*_posthog(?:$|_)/.test(key) || key.startsWith('__posthog'))) {
        localStorage.removeItem(key)
      }
    }
  } catch (_) {}
}

export function initAnalytics() {
  clearLegacyPostHogStorage()
  return false
}

export function track(_event, _props = {}) {
  return false
}

// 旧buildで作成された可能性があるPostHog永続dataだけを端末から除去する。
export function resetAnalytics() {
  clearLegacyPostHogStorage()
  return false
}
