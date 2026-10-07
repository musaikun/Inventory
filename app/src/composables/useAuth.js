import { ref, computed, watch } from 'vue'
import { shopCode } from './useStore.js'
import { STORAGE_KEYS } from '../utils/storageKeys.js'
import { apiFetch as _api } from '../utils/api.js'
import { can as canFor, PERMS } from '../services/permissions.js'
import { setStaffIdentity, deviceName, actorId } from './useDeviceId.js'

// ── モジュールスコープ シングルトン ───────────────────────────────────────────
const _token     = ref(localStorage.getItem(STORAGE_KEYS.authToken)     ?? null)
const _storeName = ref(localStorage.getItem(STORAGE_KEYS.authStoreName) ?? null)
// スタッフとしてログインしているとき { id, name, role }。null ならオーナー（今の店舗ログイン）
function _readStaff() { try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.authStaff) || 'null') } catch (_) { return null } }
const _staff = ref(_readStaff())

export const authToken       = computed(() => _token.value)
export const storeName       = computed(() => _storeName.value)
export const isAuthenticated = computed(() => !!_token.value)
/** スタッフとしてのログイン（無ければ null＝オーナー） */
// 記録の「誰が」を本人の名前にする（段 2-2。オーナーは端末名のまま）
watch(_staff, s => setStaffIdentity(s), { immediate: true })
export const currentStaff    = computed(() => _staff.value)
/** 役割: 'owner' | 'admin' | 'shain' | 'arbeit' */
export const currentRole     = computed(() => (_staff.value ? _staff.value.role : 'owner'))
/** スタッフの管理ができるか（オーナーか管理者） */
export const isAdmin         = computed(() => !_staff.value || _staff.value.role === 'admin')
export const ROLE_LABELS     = { owner: 'オーナー', admin: '管理者', shain: '社員', arbeit: 'アルバイト' }
/** この人がその操作をできるか（段 2-3。サーバーでも同じ表で確かめている） */
export function can(perm) {
  return canFor(currentRole.value, _staff.value?.grants ?? [], perm)
}
/** 金額（単価・在庫金額・レポート）を見られるか。アルバイトは見ない（User決定 2026-10-07） */
export const canSeeMoney = computed(() => canFor(currentRole.value, _staff.value?.grants ?? [], 'money'))
/** できない操作を押されたときの一言 */
export function denyMessage(perm) {
  return `この操作（${PERMS[perm] ?? perm}）は、管理者の許可が必要です`
}
/** 役割と足し引きをサーバーから取り直す（管理者が変えたら次に開いたとき反映） */
export async function refreshMe() {
  if (!_token.value) return
  try {
    const me = await _api('/auth/me')
    if (me?.staff) { _staff.value = me.staff; localStorage.setItem(STORAGE_KEYS.authStaff, JSON.stringify(me.staff)) }
  } catch (_) { /* 失効は api.js の 401 で扱う */ }
}

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

function _setAuth(token, code, name, staff = null) {
  _ensureAccountData(code)   // 別アカウントへ切り替わるなら先にローカルを掃除する
  _staff.value     = staff
  if (staff) localStorage.setItem(STORAGE_KEYS.authStaff, JSON.stringify(staff))
  else localStorage.removeItem(STORAGE_KEYS.authStaff)
  _token.value     = token
  _storeName.value = name ?? null
  shopCode.value   = code
  localStorage.setItem(STORAGE_KEYS.authToken,     token)
  localStorage.setItem(STORAGE_KEYS.authStoreName, name ?? '')
  localStorage.setItem(STORAGE_KEYS.shopCode, code)
}

function _clearAuth() {
  _staff.value     = null
  localStorage.removeItem(STORAGE_KEYS.authStaff)
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

// ── スタッフ（段 2-1）────────────────────────────────────────────
// POST /auth/staff-login  { shopCode, name, pin, deviceId }
export async function staffLogin(code, name, pin, deviceId) {
  const data = await _api('/auth/staff-login', {
    method: 'POST',
    body:   JSON.stringify({ shopCode: code, name, pin, deviceId }),
  })
  _setAuth(data.token, data.shopCode, data.storeName, data.staff)
  return data
}
/** 招待の中身（店の名前・名前・役割・期限） */
export function getInvite(token) { return _api(`/staff/invite?token=${encodeURIComponent(token)}`) }
/** 招待から参加を申請する。承認を待つ鍵を端末に覚える */
export async function joinAsStaff(token, name, pin) {
  const data = await _api('/staff/join', { method: 'POST', body: JSON.stringify({ token, name, pin }) })
  const pending = { pendingKey: data.pendingKey, shopCode: data.shopCode, storeName: data.storeName, name: data.name }
  try { localStorage.setItem(STORAGE_KEYS.staffJoin, JSON.stringify(pending)) } catch (_) {}
  return pending
}
export function pendingJoin() { try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.staffJoin) || 'null') } catch (_) { return null } }
export function forgetPendingJoin() { try { localStorage.removeItem(STORAGE_KEYS.staffJoin) } catch (_) {} }
/** 承認を待つ。承認されたらそのままログインして 'active' を返す */
export async function checkPendingJoin() {
  const p = pendingJoin()
  if (!p) return 'none'
  const data = await _api(`/staff/pending?key=${p.pendingKey}`)
  if (data.status === 'active' && data.token) {
    _setAuth(data.token, data.shopCode, data.storeName, data.staff)
    forgetPendingJoin()
  } else if (data.status !== 'pending') {
    forgetPendingJoin()
  }
  return data.status
}

// スタッフの管理（管理者）
export const listStaff         = () => _api(`/store/${shopCode.value}/staff`)
export const createStaffInvite = (name, role) => _api(`/store/${shopCode.value}/staff/invites`, { method: 'POST', body: JSON.stringify({ name, role }) })
export const revokeStaffInvite = id => _api(`/store/${shopCode.value}/staff/invites/${id}`, { method: 'DELETE' })
export const staffAction       = (id, action, body = {}) => _api(`/store/${shopCode.value}/staff/${id}/${action}`, { method: 'POST', body: JSON.stringify(body) })

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
  // by/byId は始めた人（オーナーの端末名。スタッフはサーバーがトークンの本人で刻む・段 2-2）
  return _api(`/store/${code}/sessions`, { method: 'POST', body: JSON.stringify({ type, by: deviceName.value || '', byId: actorId() }) })
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
// 進行中だけを破棄する（完了済みはサーバーが 409 で拒否）。破棄は24時間取り戻せるので、
// 取り戻したときに数量を戻すための下書き（端末にあれば）を一緒に送る。
export async function deleteSession(sessionId, { draft = null } = {}) {
  const code = shopCode.value
  if (!code || !_token.value || !sessionId) return
  return _api(`/store/${code}/sessions/${sessionId}`, {
    method: 'DELETE',
    ...(draft ? { body: JSON.stringify({ draft }) } : {}),
  })
}

// GET /store/:code/sessions/discarded … 24時間以内に破棄した（取り戻せる）セッション
export async function getDiscardedSessions() {
  const code = shopCode.value
  if (!code || !_token.value) return []
  return _api(`/store/${code}/sessions/discarded`)
}

// POST /store/:code/sessions/:id/restore … 破棄を取り消す。{ ok, session, payload }
export async function restoreSession(sessionId) {
  const code = shopCode.value
  if (!code || !_token.value || !sessionId) return null
  return _api(`/store/${code}/sessions/${sessionId}/restore`, { method: 'POST' })
}

// POST /store/:code/sessions/purge-unfinished
// 品目マスタの一括削除に合わせて、完了していない棚卸・発注（中断中・取り戻せる破棄）を完全に消す。
// 失敗（未対応の古いサーバーを含む）は例外。呼び出し側は品目を消さずに止まる
export async function purgeUnfinishedSessions() {
  const code = shopCode.value
  if (!code || !_token.value) throw new Error('ログインが必要です')
  return _api(`/store/${code}/sessions/purge-unfinished`, { method: 'POST' })
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
  // 完了した人（段 2-2）はクエリで渡す。body は再送の照合に使うので送ったものから変えない
  const who = new URLSearchParams({ by: deviceName.value || '', byId: actorId() })
  return _api(`/store/${code}/sessions/${sessionId}/complete?${who}`, {
    method: 'POST',
    body:   JSON.stringify(body ?? {}),
  })
}
