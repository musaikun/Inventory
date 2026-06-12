import { ref, computed } from 'vue'
import { shopCode } from './useStore.js'
import { STORAGE_KEYS } from '../utils/storageKeys.js'
import { apiFetch as _api } from '../utils/api.js'

// ── モジュールスコープ シングルトン ───────────────────────────────────────────
const _token     = ref(localStorage.getItem(STORAGE_KEYS.authToken)     ?? null)
const _storeName = ref(localStorage.getItem(STORAGE_KEYS.authStoreName) ?? null)

export const authToken       = computed(() => _token.value)
export const storeName       = computed(() => _storeName.value)
export const isAuthenticated = computed(() => !!_token.value)

function _setAuth(token, code, name) {
  _token.value     = token
  _storeName.value = name ?? null
  shopCode.value   = code
  localStorage.setItem(STORAGE_KEYS.authToken,     token)
  localStorage.setItem(STORAGE_KEYS.authStoreName, name ?? '')
  localStorage.setItem(STORAGE_KEYS.shopCode, code)
}

function _clearAuth() {
  _token.value     = null
  _storeName.value = null
  shopCode.value   = ''
  localStorage.removeItem(STORAGE_KEYS.authToken)
  localStorage.removeItem(STORAGE_KEYS.authStoreName)
  localStorage.removeItem(STORAGE_KEYS.shopCode)
}

// 認証ヘッダーを返す（他のAPIコールで使用）
export function getAuthHeaders() {
  if (!_token.value) return {}
  return { Authorization: `Bearer ${_token.value}` }
}

// POST /auth/register  { storeName?, pin }
export async function register(storeNameVal, pin) {
  const data = await _api('/auth/register', {
    method: 'POST',
    body:   JSON.stringify({ storeName: storeNameVal, pin }),
  })
  _setAuth(data.token, data.shopCode, data.storeName)
  return data
}

// POST /auth/login  { shopCode, pin }
export async function login(code, pin) {
  const data = await _api('/auth/login', {
    method: 'POST',
    body:   JSON.stringify({ shopCode: code, pin }),
  })
  _setAuth(data.token, data.shopCode, data.storeName)
  return data
}

// POST /auth/logout
export async function logout() {
  await _api('/auth/logout', { method: 'POST' }).catch(() => {})
  _clearAuth()
}

// ── セッション API（認証必須）─────────────────────────────────────────────────

// GET /store/:code/sessions
export async function getSessions() {
  const code = shopCode.value
  if (!code || !_token.value) return []
  return _api(`/store/${code}/sessions`)
}

// POST /store/:code/sessions
export async function createSession() {
  const code = shopCode.value
  if (!code || !_token.value) throw new Error('認証が必要です')
  return _api(`/store/${code}/sessions`, { method: 'POST' })
}

// PUT /store/:code/sessions/:id  { status, itemCount }
export async function updateSession(sessionId, status, itemCount = 0) {
  const code = shopCode.value
  if (!code || !_token.value || !sessionId) return
  return _api(`/store/${code}/sessions/${sessionId}`, {
    method: 'PUT',
    body:   JSON.stringify({ status, itemCount }),
  })
}

// DELETE /store/:code/sessions/:id
export async function deleteSession(sessionId) {
  const code = shopCode.value
  if (!code || !_token.value || !sessionId) return
  return _api(`/store/${code}/sessions/${sessionId}`, { method: 'DELETE' })
}

// POST /store/:code/sessions/:id/complete
// 棚卸完了の一括処理（inventory_lines 展開 + sessions 更新）
export async function completeSession(sessionId, inventory, prices, takenAt) {
  const code = shopCode.value
  if (!code || !_token.value || !sessionId) return
  return _api(`/store/${code}/sessions/${sessionId}/complete`, {
    method: 'POST',
    body:   JSON.stringify({ inventory, prices, takenAt }),
  })
}
