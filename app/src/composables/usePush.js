import { ref } from 'vue'
import { shopCode } from './useStore.js'
import { HTTP_BASE, apiFetch } from '../utils/api.js'
import { normalizePrefs } from '../services/notifyPrefs.js'

const _KEY = 'tanaoro_push_subscribed'
const _PREFS_KEY = 'tanaoro_push_prefs'

export const pushSubscribed = ref(localStorage.getItem(_KEY) === '1')
export const pushLoading    = ref(false)
export const pushSupported  = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
// ONにできなかった理由（画面に出す）。'' | 'blocked' | 'server' | 'failed'
export const pushError      = ref('')

function _loadPrefs() {
  try { return normalizePrefs(JSON.parse(localStorage.getItem(_PREFS_KEY) || 'null')) } catch (_) { return normalizePrefs(null) }
}
/** この端末の通知の設定（受け取る種類・時刻）。サーバーにも同じものを置く */
export const pushPrefs = ref(_loadPrefs())

/** iPhone・iPad で、ホーム画面に追加せずブラウザで開いている（このときは通知を受け取れない） */
export function isIosBrowserTab() {
  const ua = navigator.userAgent || ''
  const ios = /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1)
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true
  return ios && !standalone
}

/** 通知の許可が端末側で拒否されている（もう一度ONを押しても許可を求められない） */
export function isPushBlocked() {
  return pushSupported && Notification.permission === 'denied'
}

function _urlBase64ToUint8Array(base64) {
  const pad = '='.repeat((4 - base64.length % 4) % 4)
  const b64 = (base64 + pad).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
}

export async function subscribePush() {
  if (!pushSupported) return false
  pushLoading.value = true
  pushError.value = ''
  try {
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') { pushError.value = 'blocked'; return false }

    const { key } = await apiFetch('/api/push/vapid-key')
    if (!key) { pushError.value = 'server'; return false }

    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly:      true,
      applicationServerKey: _urlBase64ToUint8Array(key),
    })

    const code = shopCode.value
    if (code) {
      await apiFetch(`/store/${code}/push/subscribe`, {
        method: 'POST',
        body:   JSON.stringify({ ...sub.toJSON(), prefs: pushPrefs.value }),
      })
    }

    pushSubscribed.value = true
    localStorage.setItem(_KEY, '1')
    return true
  } catch (_) {
    pushError.value = 'failed'
    return false
  } finally {
    pushLoading.value = false
  }
}

// アカウント削除の成功後などに、サーバー通信なしで端末の購読だけ解除する。
// 削除成功時点でサーバー側の購読は既に削除済み・token も失効しているため、
// remote DELETE を呼ぶと 401 になり、その throw で browser の unsubscribe に到達せず、
// さらに失効ハンドラを誤発火させる。ここでは local の PushSubscription 解除だけを行う。
export async function unsubscribePushLocal() {
  // 表示用の購読フラグは環境に関わらず必ず落とす（削除後に「通知ON」表示が残らないように）。
  // Push 非対応環境でもここで消してから抜ける。
  pushSubscribed.value = false
  try { localStorage.removeItem(_KEY) } catch (_) {}
  if (!pushSupported) return false
  try {
    // `serviceWorker.ready` は SW 未登録だと永久に解決せず、呼び出し元（削除の finalize）を
    // ハングさせる。`getRegistration()` は登録が無ければ即 undefined を返すので hang しない。
    const reg = await navigator.serviceWorker.getRegistration()
    const sub = reg ? await reg.pushManager.getSubscription() : null
    if (sub) await sub.unsubscribe()
  } catch (_) { /* best-effort（購読が無い/解除済みでも成功扱い） */ }
  return true
}

export async function unsubscribePush() {
  if (!pushSupported) return false
  pushLoading.value = true
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (sub) {
      const code = shopCode.value
      if (code) {
        await apiFetch(`/store/${code}/push/subscribe`, {
          method: 'DELETE',
          body:   JSON.stringify({ endpoint: sub.endpoint }),
        })
      }
      await sub.unsubscribe()
    }
    pushSubscribed.value = false
    localStorage.removeItem(_KEY)
    return true
  } catch (_) {
    return false
  } finally {
    pushLoading.value = false
  }
}

/** この端末の通知の購読先（無ければ空）。やることを追加したとき、自分の端末へは通知しないために使う */
export async function ownPushEndpoint() {
  if (!pushSupported) return ''
  try {
    const reg = await navigator.serviceWorker.getRegistration()
    const sub = reg ? await reg.pushManager.getSubscription() : null
    return sub?.endpoint ?? ''
  } catch (_) { return '' }
}

let _prefsTimer = null
/**
 * 通知の設定を変える。端末に覚え、通知を受け取っている端末ならサーバーへも送る（続けて触っても1回にまとめる）。
 */
export function updatePushPrefs(next) {
  pushPrefs.value = normalizePrefs(next)
  try { localStorage.setItem(_PREFS_KEY, JSON.stringify(pushPrefs.value)) } catch (_) {}
  if (!pushSubscribed.value) return
  clearTimeout(_prefsTimer)
  _prefsTimer = setTimeout(_sendPrefs, 600)
}
async function _sendPrefs() {
  const code = shopCode.value
  const endpoint = await ownPushEndpoint()
  if (!code || !endpoint) return
  try {
    await apiFetch(`/store/${code}/push/prefs`, { method: 'PUT', body: JSON.stringify({ endpoint, prefs: pushPrefs.value }) })
  } catch (e) {
    // サーバーがこの購読を知らない（消えた・別の端末から解除した）ときは、もう一度購読し直す
    if (e?.status === 404) await subscribePush()
  }
}

/** この端末へ試しの通知を送る。'' = 送った / それ以外は理由 */
export async function sendTestPush() {
  const code = shopCode.value
  const endpoint = await ownPushEndpoint()
  if (!code || !endpoint) return 'failed'
  try {
    await apiFetch(`/store/${code}/push/test`, { method: 'POST', body: JSON.stringify({ endpoint }) })
    return ''
  } catch (e) {
    return e?.status === 503 ? 'server' : 'failed'
  }
}
