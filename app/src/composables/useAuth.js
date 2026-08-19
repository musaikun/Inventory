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

// 既存インストールの移行: dataOwner 未設定でもログイン中（shopCode あり）なら、
// 現在のローカルデータはその店舗のものとみなしてマーカーを付ける。
// これにより、この修正の適用後に別アカウントへ切り替えても初回から漏洩を検出できる。
try {
  if (!localStorage.getItem(STORAGE_KEYS.dataOwner) && shopCode.value) {
    localStorage.setItem(STORAGE_KEYS.dataOwner, shopCode.value)
  }
} catch (_) {}

// アカウント切替時に前アカウントのローカルデータを消すハンドラ（App.vue が登録）。
// import 循環を避けるためコールバック方式にする（useSession → useAuth の依存があるため）。
let _onAccountReset = null
export function setAccountResetHandler(fn) { _onAccountReset = fn }

// この端末の localStorage 業務データが属する店舗と code が異なれば、前アカウント分を消す。
// dataOwner マーカーは認証状態と独立（ログアウトでは消えない）＝データの実所有者を追う。
function _ensureAccountData(code) {
  try {
    // owner 未設定の端末では、直前まで使っていた店舗コード（_shop_code）を実所有者とみなす
    const owner = localStorage.getItem(STORAGE_KEYS.dataOwner)
                  ?? localStorage.getItem(STORAGE_KEYS.shopCode)
    if (owner && owner !== code) {
      try { _onAccountReset?.() } catch (_) {}
    }
    localStorage.setItem(STORAGE_KEYS.dataOwner, code)
  } catch (_) {}
}

function _setAuth(token, code, name) {
  _ensureAccountData(code)   // 別アカウントへ切り替わるなら先にローカルを掃除する
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

// サーバー通信なしでローカル認証状態だけ破棄する（別端末ログインによる失効時など）
export function clearAuthLocal() {
  _clearAuth()
}

// DELETE /auth/account  { requestId, pin, confirmation }
// account-deletion-contract に従う。成功/replay は
// { ok, status:'deleted', deletedAt, alreadyDeleted, requestId } を返す。
// 失敗は err.status / err.code / err.body（retryable 等）を投げる（api.js が付与）。
// requestId は「削除画面を開いた時点で1回だけ生成」した値を再試行でも変えずに渡す。
// 成功時のローカル掃除（Push解除・業務data消去・auth破棄・分析reset）は呼び出し側で行う。
export async function deleteAccount({ requestId, pin, confirmation }) {
  return _api('/auth/account', {
    method: 'DELETE',
    body:   JSON.stringify({ requestId, pin, confirmation }),
  })
}

// ── セッション API（認証必須）─────────────────────────────────────────────────

// GET /store/:code/sessions
export async function getSessions() {
  const code = shopCode.value
  if (!code || !_token.value) return []
  return _api(`/store/${code}/sessions`)
}

// POST /store/:code/sessions  body: { type }
export async function createSession(type = 'stock') {
  const code = shopCode.value
  if (!code || !_token.value) throw new Error('認証が必要です')
  return _api(`/store/${code}/sessions`, { method: 'POST', body: JSON.stringify({ type }) })
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

// GET /store/:code/sessions/:id/lines
// 端末に snapshot が無い完了済み棚卸の明細を D1 から読む（DATA-002 Phase 1 / R-001）。
// 見つからない・他店舗のIDは 404 が返る。呼び出し側で握って従来の案内へ倒す。
export async function getSessionLines(sessionId) {
  const code = shopCode.value
  if (!code || !_token.value || !sessionId) return null
  return _api(`/store/${code}/sessions/${sessionId}/lines`)
}

// POST /store/:code/sessions/:id/complete
//
// 契約は `sessions.type` で分かれる（DATA-002 §1 / api-design §3.1）。
//   stock … `{ inventory, prices, takenAt, snapshot }`。3テーブルを1トランザクションで書く
//   order … `{ itemCount }` だけ。snapshot も非空 inventory も 400 になる
//
// **body は呼び出し側が組み立てたものをそのまま送る。** ここで形を固定していたため、
// 発注セッションでも棚卸の形で送られていた。完了の再送は fingerprint が一致する必要が
// あるので（`409 completion_intent_conflict`）、送る内容を途中で作り替えないことも重要。
// 組み立ては services/sessionCompletion.js が一手に引き受ける。
export async function completeSession(sessionId, body) {
  const code = shopCode.value
  if (!code || !_token.value || !sessionId) return
  return _api(`/store/${code}/sessions/${sessionId}/complete`, {
    method: 'POST',
    body:   JSON.stringify(body ?? {}),
  })
}
