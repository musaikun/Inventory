// PRIV-001: PostHogは明示同意後だけ初期化し、許可済みcustom eventだけを送信する。
// build設定・同意・EU hostのいずれかが欠ける場合は通信もSDK初期化も行わない。
import { ref } from 'vue'

const POSTHOG_EU_HOST = 'https://eu.i.posthog.com'
const CONSENT_KEY = '_analytics_consent_v1'
const ANALYTICS_ID_KEY = '_analytics_id_v1'
const CONSENT_GRANTED = 'granted'
const CONSENT_DENIED = 'denied'

export const ANALYTICS_RETENTION_DAYS = 365
export const ANALYTICS_EVENT_ALLOWLIST = Object.freeze([
  'session_started',
  'session_completed',
  'item_added',
  'voice_used',
  'review_prompt_shown',
  'review_rated',
])

const EVENT_NAMES = new Set(ANALYTICS_EVENT_ALLOWLIST)
const ALLOWED_POSTHOG_PROPERTIES = new Set([
  'token',
  'distinct_id',
  '$device_id',
  '$lib',
  '$lib_version',
  '$process_person_profile',
  'item_count_bucket',
  'completed_count_bucket',
  'mode',
  'method',
  'stars',
  'positive',
])

export function isAnalyticsConfigured(env = import.meta.env) {
  return env?.VITE_POSTHOG_ENABLED === 'true'
    && typeof env?.VITE_POSTHOG_KEY === 'string'
    && env.VITE_POSTHOG_KEY.trim().length > 0
    && env?.VITE_POSTHOG_HOST === POSTHOG_EU_HOST
}

export const ANALYTICS_ENABLED = isAnalyticsConfigured()
export const analyticsConsent = ref(readConsent())

let posthogClient = null
let posthogPromise = null

function readConsent() {
  try {
    const value = localStorage.getItem(CONSENT_KEY)
    return value === CONSENT_GRANTED || value === CONSENT_DENIED ? value : 'unset'
  } catch (_) {
    return 'unset'
  }
}

function writeConsent(value) {
  analyticsConsent.value = value
  try { localStorage.setItem(CONSENT_KEY, value) } catch (_) {}
}

function clearPostHogStorage() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i)
      if (key && (
        /^ph_.*_posthog(?:$|_)/.test(key)
        || key.startsWith('__posthog')
        || key.startsWith('__ph_opt_in_out_')
      )) {
        localStorage.removeItem(key)
      }
    }
  } catch (_) {}
}

function createAnalyticsId() {
  try {
    if (typeof crypto?.randomUUID !== 'function') return null
    const id = `a_${crypto.randomUUID()}`
    localStorage.setItem(ANALYTICS_ID_KEY, id)
    return id
  } catch (_) {
    return null
  }
}

function getOrCreateAnalyticsId() {
  try {
    const current = localStorage.getItem(ANALYTICS_ID_KEY)
    if (/^a_[0-9a-f-]{36}$/i.test(current || '')) return current
  } catch (_) {}
  return createAnalyticsId()
}

export function toCountBucket(value) {
  if (!Number.isFinite(value) || value < 0) return null
  if (value === 0) return '0'
  if (value <= 10) return '1-10'
  if (value <= 50) return '11-50'
  if (value <= 100) return '51-100'
  return '101+'
}

export function normalizeAnalyticsEvent(event, rawProps = {}) {
  if (event === 'item_added_walk') return { event: 'item_added', properties: { method: 'walk' } }
  if (event === 'item_added_manual') return { event: 'item_added', properties: { method: 'manual' } }

  if (!EVENT_NAMES.has(event)) return null

  if (event === 'session_started' || event === 'voice_used') {
    return { event, properties: {} }
  }

  if (event === 'session_completed') {
    const itemCountBucket = toCountBucket(rawProps.item_count)
    if (!itemCountBucket || rawProps.mode !== 'solo') return null
    return { event, properties: { item_count_bucket: itemCountBucket, mode: 'solo' } }
  }

  if (event === 'item_added') {
    if (rawProps.method !== 'walk' && rawProps.method !== 'manual') return null
    return { event, properties: { method: rawProps.method } }
  }

  if (event === 'review_prompt_shown') {
    const completedCountBucket = toCountBucket(rawProps.completed_count)
    if (!completedCountBucket) return null
    return { event, properties: { completed_count_bucket: completedCountBucket } }
  }

  if (event === 'review_rated') {
    const stars = Number(rawProps.stars)
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) return null
    return { event, properties: { stars, positive: stars >= 4 } }
  }

  return null
}

// SDK側・call site側の二重防御。URL、自由記述、店舗・端末識別子などはここで落とす。
export function sanitizePostHogEvent(event) {
  if (!event || !EVENT_NAMES.has(event.event)) return null

  const properties = {}
  for (const [key, value] of Object.entries(event.properties || {})) {
    if (ALLOWED_POSTHOG_PROPERTIES.has(key)) properties[key] = value
  }

  if (event.event === 'session_completed') {
    if (!['0', '1-10', '11-50', '51-100', '101+'].includes(properties.item_count_bucket)
      || properties.mode !== 'solo') return null
  } else if (event.event === 'item_added') {
    if (!['walk', 'manual'].includes(properties.method)) return null
  } else if (event.event === 'review_prompt_shown') {
    if (!['0', '1-10', '11-50', '51-100', '101+'].includes(properties.completed_count_bucket)) return null
  } else if (event.event === 'review_rated') {
    if (!Number.isInteger(properties.stars) || properties.stars < 1 || properties.stars > 5
      || properties.positive !== (properties.stars >= 4)) return null
  }

  return { ...event, properties }
}

async function ensurePostHog() {
  if (posthogClient) return posthogClient
  if (posthogPromise) return posthogPromise
  if (!ANALYTICS_ENABLED || analyticsConsent.value !== CONSENT_GRANTED) return null

  const analyticsId = getOrCreateAnalyticsId()
  if (!analyticsId) return null

  posthogPromise = import('posthog-js/dist/module.slim.no-external.js')
    .then(({ default: posthog }) => {
      posthog.init(import.meta.env.VITE_POSTHOG_KEY.trim(), {
        api_host: POSTHOG_EU_HOST,
        defaults: '2026-05-30',
        autocapture: false,
        capture_pageview: false,
        capture_pageleave: false,
        capture_dead_clicks: false,
        capture_exceptions: false,
        capture_heatmaps: false,
        capture_performance: false,
        disable_session_recording: true,
        disable_surveys: true,
        advanced_disable_flags: true,
        person_profiles: 'never',
        persistence: 'localStorage',
        cross_subdomain_cookie: false,
        secure_cookie: true,
        respect_dnt: true,
        opt_out_capturing_by_default: true,
        opt_out_persistence_by_default: true,
        opt_out_capturing_persistence_type: 'localStorage',
        request_batching: false,
        bootstrap: { distinctID: analyticsId, isIdentifiedID: false },
        before_send: sanitizePostHogEvent,
      })
      posthog.opt_in_capturing({ captureEventName: false })
      posthogClient = posthog
      return posthog
    })
    .catch(() => null)
    .finally(() => { posthogPromise = null })

  return posthogPromise
}

export async function initAnalytics() {
  // 未構成buildは旧buildのPostHog永続dataだけを消してno-opにする。
  if (!ANALYTICS_ENABLED) {
    clearPostHogStorage()
    return false
  }
  if (analyticsConsent.value !== CONSENT_GRANTED) return false
  return Boolean(await ensurePostHog())
}

export function track(event, props = {}) {
  const payload = normalizeAnalyticsEvent(event, props)
  if (!payload || !ANALYTICS_ENABLED || analyticsConsent.value !== CONSENT_GRANTED) return false

  void ensurePostHog().then(posthog => {
    posthog?.capture(payload.event, payload.properties)
  })
  return true
}

export async function setAnalyticsConsent(granted) {
  if (!granted) {
    writeConsent(CONSENT_DENIED)
    try { posthogClient?.reset() } catch (_) {}
    try { posthogClient?.opt_out_capturing() } catch (_) {}
    try { localStorage.removeItem(ANALYTICS_ID_KEY) } catch (_) {}
    clearPostHogStorage()
    return false
  }

  writeConsent(CONSENT_GRANTED)
  if (!ANALYTICS_ENABLED) return false
  return Boolean(await ensurePostHog())
}

// account削除時は同意状態とanalytics専用IDも消去する。server側event削除は有効化前gate。
export function resetAnalytics() {
  try { posthogClient?.reset() } catch (_) {}
  try { posthogClient?.opt_out_capturing() } catch (_) {}
  try {
    localStorage.removeItem(CONSENT_KEY)
    localStorage.removeItem(ANALYTICS_ID_KEY)
  } catch (_) {}
  analyticsConsent.value = 'unset'
  clearPostHogStorage()
  return false
}
