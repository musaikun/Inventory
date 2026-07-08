<script setup>
import { ref, nextTick, onMounted, onUnmounted } from 'vue'
import { createStore, loadStore, shopCode } from '../composables/useStore.js'
import { isTwaApp } from '../utils/appMode.js'

const emit = defineEmits(['started'])

const isTwa   = isTwaApp()
const version = __APP_VERSION__

// ── 契約済みユーザーのログイン（認証ページのログインタブへ）─────────────────
function onLogin() {
  emit('started', { hostMode: true })
}

const loading      = ref(false)
const error        = ref('')
const showScanner  = ref(false)
const showRestore  = ref(false)
const restoreCode  = ref('')

const videoRef  = ref(null)
const canvasRef = ref(null)
let   _stream   = null
let   _scanRaf  = null
let   _jsQR     = null

// ── ホストとして開始（認証フローへ）─────────────────────────────────────────
async function onStart() {
  // hostMode フラグを渡すことで App.vue が認証チェックを行う
  emit('started', { hostMode: true })
}

// ── QRコード解析（招待リンクのみ。コードの手入力参加は廃止）──────────────────
async function _handleQrData(data) {
  closeScanner()
  try {
    const url = new URL(data)
    const storeParam = url.searchParams.get('store')
    const sParam     = url.searchParams.get('s')
    if (storeParam) { emit('started', { joinRoom: storeParam, joinSessionId: sParam }); return }
    // 旧形式 ?room= も引き続きサポート
    const roomParam = url.searchParams.get('room')
    if (roomParam) { emit('started', { joinRoom: roomParam.toUpperCase(), joinSessionId: sParam }); return }
  } catch (_) {}
  error.value = '招待リンクのQRコードを読み取ってください'
}

// ── カメラスキャン ────────────────────────────────────────────────────────────
async function openScanner() {
  error.value = ''
  if (!navigator.mediaDevices?.getUserMedia) {
    error.value = 'このブラウザはカメラに対応していません。ホストの招待リンクを直接開いてください。'
    return
  }
  showScanner.value = true
  try {
    _stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
    await nextTick()
    if (videoRef.value) {
      videoRef.value.srcObject = _stream
      videoRef.value.play()
      if (!_jsQR) _jsQR = (await import('jsqr')).default
      _tick()
    }
  } catch {
    error.value       = 'カメラへのアクセスを許可してください。または招待リンクを直接開いてください。'
    showScanner.value = false
  }
}

async function _tick() {
  if (!showScanner.value) return
  const video  = videoRef.value
  const canvas = canvasRef.value
  if (!video || !canvas || video.readyState < 2) {
    _scanRaf = requestAnimationFrame(_tick)
    return
  }
  canvas.width  = video.videoWidth
  canvas.height = video.videoHeight
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(video, 0, 0)
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const result = _jsQR(imageData.data, imageData.width, imageData.height)
  if (result) { await _handleQrData(result.data); return }
  _scanRaf = requestAnimationFrame(_tick)
}

function closeScanner() {
  showScanner.value = false
  cancelAnimationFrame(_scanRaf)
  if (_stream) { _stream.getTracks().forEach(t => t.stop()); _stream = null }
}

// ── 既存データを引き継ぐ ──────────────────────────────────────────────────────
async function onRestoreSubmit() {
  const code = restoreCode.value.toUpperCase().replace(/[^A-Z]/g, '')
  if (!/^[A-Z]{4,8}$/.test(code)) { error.value = '4〜8文字の英字で入力してください'; return }
  loading.value = true
  error.value   = ''
  try {
    await loadStore(code)
    emit('started')
  } catch {
    error.value   = 'そのコードは見つかりません。'
    loading.value = false
  }
}

onUnmounted(() => closeScanner())
</script>

<template>
  <div class="lp">

    <!-- ── QRカメラスキャナー（全画面） ── -->
    <div v-if="showScanner" class="scanner-overlay">
      <video ref="videoRef" class="scanner-video" autoplay playsinline muted></video>
      <canvas ref="canvasRef" style="display:none"></canvas>
      <div class="scanner-aim"></div>
      <p class="scanner-hint">QRコードをカメラに向けてください</p>
      <div class="scanner-footer">
        <button class="scanner-btn-close"  @click="closeScanner()">閉じる</button>
      </div>
    </div>

    <!-- ── メイン ── -->
    <div class="lp-body">
      <!-- ロゴ -->
      <div class="lp-logo">
        <span class="lp-logo-icon">📋</span>
        <span class="lp-logo-name">棚卸アプリ</span>
        <span class="lp-version">v{{ version }}</span>
      </div>

      <p class="lp-tagline">棚卸作業を開始してください</p>

      <!-- アプリ版（TWA）: 無料版の案内＋契約済みログイン入口 -->
      <div v-if="isTwa" class="lp-twa-banner">
        <p class="lp-twa-free"><span class="lp-twa-check">✓</span>無料版をご利用いただけます</p>
        <button class="lp-twa-login" @click="onLogin">
          PRO契約済みの店舗はこちら<span class="lp-twa-login-strong">ログイン ›</span>
        </button>
      </div>

      <!-- エラー -->
      <div v-if="error" class="lp-error">{{ error }}</div>

      <!-- ── ホストカード ── -->
      <button
        class="lp-card lp-card-host"
        :disabled="loading"
        @click="onStart"
      >
        <span class="lp-card-icon">📋</span>
        <span class="lp-card-body">
          <span class="lp-card-title">ホストとして開始</span>
          <span class="lp-card-sub">
            {{ loading ? '準備中...' : shopCode ? `店舗コード: ${shopCode}` : '棚卸作業を主導します' }}
          </span>
        </span>
        <span class="lp-card-arrow">›</span>
      </button>

      <!-- ── ゲストカード（招待リンク／QRから参加）── -->
      <div class="lp-card-guest-wrap">
        <button class="lp-card lp-card-guest" @click="openScanner">
          <span class="lp-card-icon">📷</span>
          <span class="lp-card-body">
            <span class="lp-card-title">QRコードで参加</span>
            <span class="lp-card-sub">ホストの招待リンク／QRから参加します</span>
          </span>
          <span class="lp-card-arrow">›</span>
        </button>
      </div>

      <!-- ── データ引き継ぎ ── -->
      <button class="lp-restore-link" @click="showRestore = !showRestore; error = ''">
        別端末に店舗データを引き継ぐ ›
      </button>

      <div v-if="showRestore" class="lp-restore-form">
        <input
          class="lp-join-input"
          type="text"
          placeholder="店舗コード（例: SAKURA）"
          v-model="restoreCode"
          @keyup.enter="onRestoreSubmit"
          maxlength="8"
          autocomplete="off"
          autocorrect="off"
          autocapitalize="characters"
          spellcheck="false"
          autofocus
        />
        <button
          class="lp-btn-join"
          :disabled="loading"
          @click="onRestoreSubmit"
          style="width:100%; margin-top:8px"
        >
          {{ loading ? '確認中...' : '引き継ぐ' }}
        </button>
      </div>
    </div>

  </div>
</template>

<style scoped>
.lp {
  min-height: 100vh;
  background: #f8fafc;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 20px;
}

.lp-body {
  width: 100%;
  max-width: 400px;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 12px;
}

/* ── ロゴ ── */
.lp-logo {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-bottom: 4px;
}
.lp-logo-icon { font-size: 28px; }
.lp-logo-name {
  font-size: 22px;
  font-weight: 900;
  color: #0f172a;
  letter-spacing: -0.02em;
}
.lp-version {
  font-size: 11px;
  font-weight: 700;
  color: #94a3b8;
  background: #f1f5f9;
  border-radius: 6px;
  padding: 2px 6px;
  align-self: flex-start;
  margin-top: 2px;
}

.lp-tagline {
  text-align: center;
  font-size: 13px;
  color: #64748b;
  margin: 0 0 8px;
}

/* ── アプリ版（TWA）バナー ── */
.lp-twa-banner {
  background: #fff;
  border: 1.5px solid #e2e8f0;
  border-radius: 14px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.05);
}

.lp-twa-free {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  color: #0f172a;
  display: flex;
  align-items: center;
  gap: 8px;
}
.lp-twa-check {
  color: #16a34a;
  font-weight: 900;
}

.lp-twa-login {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 11px 14px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  font-size: 13px;
  color: #475569;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background 0.15s;
}
.lp-twa-login:active { background: #f1f5f9; }
.lp-twa-login-strong {
  font-weight: 800;
  color: var(--primary);
  white-space: nowrap;
}

/* ── エラー ── */
.lp-error {
  padding: 10px 14px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 600;
  color: #dc2626;
  text-align: center;
}

/* ── カード共通 ── */
.lp-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 18px 20px;
  border-radius: 16px;
  border: 2px solid transparent;
  cursor: pointer;
  width: 100%;
  text-align: left;
  transition: transform 0.15s, box-shadow 0.15s;
  -webkit-tap-highlight-color: transparent;
}
.lp-card:active { transform: scale(0.98); }
.lp-card:disabled { opacity: 0.55; cursor: not-allowed; transform: none; }

.lp-card-host {
  background: var(--primary);
  color: #fff;
  box-shadow: 0 4px 20px rgba(37,99,235,0.28);
}
.lp-card-host:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 8px 28px rgba(37,99,235,0.36);
}

.lp-card-guest {
  background: #fff;
  border-color: #e2e8f0;
  color: #0f172a;
  box-shadow: 0 2px 8px rgba(0,0,0,0.06);
}
.lp-card-guest:hover:not(.is-open) { border-color: #94a3b8; }
.lp-card-guest.is-open { border-color: var(--primary); border-bottom-left-radius: 0; border-bottom-right-radius: 0; border-bottom: none; }

.lp-card-icon { font-size: 26px; flex-shrink: 0; }

.lp-card-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.lp-card-title {
  font-size: 16px;
  font-weight: 800;
  line-height: 1.2;
}

.lp-card-sub {
  font-size: 12px;
  opacity: 0.72;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lp-card-arrow {
  font-size: 22px;
  opacity: 0.6;
  flex-shrink: 0;
}

.lp-close-btn {
  background: none;
  border: none;
  font-size: 18px;
  color: #94a3b8;
  cursor: pointer;
  padding: 2px 4px;
  flex-shrink: 0;
  -webkit-tap-highlight-color: transparent;
}

/* ── ゲスト展開フォーム ── */
.lp-card-guest-wrap { display: flex; flex-direction: column; }

.lp-join-form {
  background: #fff;
  border: 2px solid var(--primary);
  border-top: none;
  border-bottom-left-radius: 16px;
  border-bottom-right-radius: 16px;
  padding: 14px 16px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.lp-join-input {
  padding: 12px 14px;
  font-size: 17px;
  font-weight: 700;
  letter-spacing: 0.1em;
  border: 1.5px solid #e2e8f0;
  border-radius: 10px;
  outline: none;
  font-family: 'SF Mono', 'Menlo', monospace;
  background: #f8fafc;
  color: #0f172a;
  -webkit-appearance: none;
  width: 100%;
}
.lp-join-input:focus { border-color: var(--primary); background: #fff; }
.lp-join-input::placeholder { font-family: inherit; letter-spacing: 0; font-weight: 400; color: #94a3b8; font-size: 14px; }

.lp-join-actions {
  display: flex;
  gap: 8px;
}

.lp-btn-qr {
  padding: 12px 14px;
  background: #f1f5f9;
  color: #374151;
  border: 1.5px solid #e2e8f0;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  flex-shrink: 0;
  -webkit-tap-highlight-color: transparent;
  white-space: nowrap;
}
.lp-btn-qr:active { background: #e2e8f0; }

.lp-btn-join {
  flex: 1;
  padding: 12px;
  background: var(--primary);
  color: #fff;
  border: none;
  border-radius: 10px;
  font-size: 15px;
  font-weight: 800;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: opacity 0.15s;
}
.lp-btn-join:active  { opacity: 0.8; }
.lp-btn-join:disabled { opacity: 0.45; cursor: not-allowed; }

/* ── データ引き継ぎ ── */
.lp-restore-link {
  font-size: 12px;
  color: #94a3b8;
  background: none;
  border: none;
  cursor: pointer;
  text-align: center;
  padding: 4px 0;
  text-decoration: underline;
  text-underline-offset: 3px;
  -webkit-tap-highlight-color: transparent;
  margin-top: 4px;
}
.lp-restore-link:hover { color: #475569; }

.lp-restore-form {
  background: #fff;
  border: 1.5px solid #e2e8f0;
  border-radius: 14px;
  padding: 14px;
}

/* ── QRカメラスキャナー（全画面） ── */
.scanner-overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: #000;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}
.scanner-video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.scanner-aim {
  position: relative;
  z-index: 1;
  width: min(72vw, 280px);
  height: min(72vw, 280px);
  border: 3px solid var(--primary);
  border-radius: 16px;
  box-shadow: 0 0 0 9999px rgba(0,0,0,0.55);
}
.scanner-hint {
  position: relative;
  z-index: 1;
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  margin: 20px 0 0;
  text-align: center;
  text-shadow: 0 1px 4px rgba(0,0,0,0.8);
}
.scanner-footer {
  position: relative;
  z-index: 1;
  display: flex;
  gap: 12px;
  margin-top: 28px;
}
.scanner-btn-manual {
  padding: 12px 24px;
  background: rgba(255,255,255,0.15);
  color: #fff;
  border: 1.5px solid rgba(255,255,255,0.5);
  border-radius: 12px;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  -webkit-tap-highlight-color: transparent;
}
.scanner-btn-close {
  padding: 12px 24px;
  background: rgba(255,255,255,0.08);
  color: rgba(255,255,255,0.7);
  border: 1.5px solid rgba(255,255,255,0.25);
  border-radius: 12px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
</style>
