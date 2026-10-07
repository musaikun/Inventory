// アプリを開いている知らせ（スタッフのログイン 段 2-5・User決定 2026-10-07）。
//
// - 画面が見えている間だけ 90秒ごとに POST /presence。見えなくなったら（画面を消す・別のアプリへ）
//   「閉じた」を送って止める。管理者の画面で「いま開いている」「最後に開いたのは○分前」と作業時間になる
// - スタッフは本人（サーバーがトークンで決める）、オーナーは端末名
// - 送れなくても何もしない（在席の表示が遅れるだけ。業務の操作は止めない）
import { watch } from 'vue'
import { apiFetch } from '../utils/api.js'
import { isAuthenticated } from './useAuth.js'
import { shopCode } from './useStore.js'
import { deviceName, actorId } from './useDeviceId.js'

const BEAT_MS = 90_000
let _timer = null
let _started = false

function _send(state) {
  if (!isAuthenticated.value || !shopCode.value) return
  const body = JSON.stringify({ state, by: deviceName.value || '', byId: actorId() })
  Promise.resolve()
    .then(() => apiFetch(`/store/${shopCode.value}/presence`, { method: 'POST', keepalive: state === 'off', body }))   // off は閉じる途中でも届くように
    .catch(() => {})
}

function _visible() { return typeof document === 'undefined' || document.visibilityState !== 'hidden' }

function _run() {
  clearInterval(_timer)
  _timer = null
  if (!isAuthenticated.value || !_visible()) return
  _send('on')
  _timer = setInterval(() => _send('on'), BEAT_MS)
}

export function startPresence() {
  if (_started || typeof document === 'undefined') return
  _started = true
  document.addEventListener('visibilitychange', () => {
    if (_visible()) _run()
    else { clearInterval(_timer); _timer = null; _send('off') }
  })
  window.addEventListener('pagehide', () => _send('off'))
  // ログイン・ログアウトに合わせて始める・止める
  watch(isAuthenticated, on => { if (on) _run(); else { clearInterval(_timer); _timer = null } })
  _run()
}

// テスト用
export function _stopPresence() { clearInterval(_timer); _timer = null; _started = false }
