<script setup>
import { ref, nextTick, onMounted, onUnmounted } from 'vue'
import { createStore, loadStore, shopCode } from '../composables/useStore.js'

const emit = defineEmits(['started'])

const loading     = ref(false)
const error       = ref('')
const showJoin    = ref(false)
const showRestore = ref(false)
const joinCode    = ref('')
const restoreCode = ref('')
const showScanner = ref(false)

const videoRef  = ref(null)
const canvasRef = ref(null)
let   _stream   = null
let   _scanRaf  = null

// ── はじめる ──────────────────────────────────────────────────────────────────
async function onStart() {
  if (shopCode.value) {
    emit('started')
    return
  }
  loading.value = true
  error.value   = ''
  try {
    await createStore()
    emit('started')
  } catch {
    error.value = '接続できませんでした。もう一度お試しください。'
    loading.value = false
  }
}

// ── QRで参加（テキスト入力）────────────────────────────────────────────────────
function onJoinSubmit() {
  const code = joinCode.value.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (code.length < 4) { error.value = '4文字以上入力してください'; return }
  emit('started', { joinRoom: code })
}

// ── QRカメラスキャン ──────────────────────────────────────────────────────────
function _extractRoomCode(data) {
  try {
    const url = new URL(data)
    const code = url.searchParams.get('room')
    if (code && code.length >= 4) return code.toUpperCase()
  } catch (_) {
    const cleaned = data.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (cleaned.length >= 4 && cleaned.length <= 8) return cleaned
  }
  return null
}

async function startScanner() {
  error.value = ''
  if (!navigator.mediaDevices?.getUserMedia) {
    error.value = 'このブラウザはカメラに対応していません'
    return
  }
  showScanner.value = true
  showJoin.value    = true
  try {
    _stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
    await nextTick()
    if (videoRef.value) {
      videoRef.value.srcObject = _stream
      videoRef.value.play()
      _tick()
    }
  } catch {
    error.value = 'カメラへのアクセスを許可してください'
    stopScanner()
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
  // 動的 import で jsQR をロード（初回スキャン時のみ）
  const jsQR = (await import('jsqr')).default
  const code  = jsQR(imageData.data, imageData.width, imageData.height)
  if (code) {
    const roomCode = _extractRoomCode(code.data)
    if (roomCode) {
      stopScanner()
      emit('started', { joinRoom: roomCode })
      return
    }
  }
  _scanRaf = requestAnimationFrame(_tick)
}

function stopScanner() {
  showScanner.value = false
  cancelAnimationFrame(_scanRaf)
  if (_stream) {
    _stream.getTracks().forEach(t => t.stop())
    _stream = null
  }
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

function toggleJoin() {
  showJoin.value    = !showJoin.value
  showRestore.value = false
  error.value       = ''
  if (!showJoin.value) stopScanner()
}

function toggleRestore() {
  showRestore.value = !showRestore.value
  showJoin.value    = false
  error.value       = ''
  stopScanner()
}

// ── スクロールフェードイン ────────────────────────────────────────────────────
let observer = null
onMounted(() => {
  observer = new IntersectionObserver(
    entries => entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('is-visible') }),
    { threshold: 0.12 }
  )
  document.querySelectorAll('[data-fade]').forEach(el => observer.observe(el))
})
onUnmounted(() => {
  observer?.disconnect()
  stopScanner()
})
</script>

<template>
  <div class="lp">

    <!-- ── ヘッダー ── -->
    <header class="lp-header">
      <div class="lp-logo">
        <span class="lp-logo-icon">📋</span>
        <span class="lp-logo-text">棚卸アプリ</span>
      </div>
      <button class="lp-header-btn" @click="toggleJoin">QRで参加</button>
    </header>

    <!-- ── QR参加フォーム ── -->
    <div v-if="showJoin" class="lp-bar">
      <!-- カメラビュー -->
      <div v-if="showScanner" class="lp-scanner-wrap">
        <video ref="videoRef" class="lp-scanner-video" autoplay playsinline muted></video>
        <canvas ref="canvasRef" style="display:none"></canvas>
        <div class="lp-scanner-aim"></div>
        <button class="lp-scanner-close" @click="stopScanner">✕ 閉じる</button>
      </div>

      <!-- テキスト入力 -->
      <template v-else>
        <button class="lp-camera-btn" @click="startScanner" title="カメラでスキャン">📷</button>
        <input
          class="lp-bar-input"
          type="text"
          placeholder="ルームコード（例: ABC123）"
          v-model="joinCode"
          @keyup.enter="onJoinSubmit"
          maxlength="8"
          autocomplete="off"
          autocorrect="off"
          autocapitalize="characters"
          spellcheck="false"
          autofocus
        />
        <button class="lp-bar-btn" @click="onJoinSubmit">参加する</button>
      </template>
    </div>

    <!-- ── データ復元フォーム ── -->
    <div v-if="showRestore" class="lp-bar">
      <input
        class="lp-bar-input"
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
      <button class="lp-bar-btn" :disabled="loading" @click="onRestoreSubmit">
        {{ loading ? '確認中...' : '引き継ぐ' }}
      </button>
    </div>

    <!-- エラー -->
    <div v-if="error" class="lp-error">{{ error }}</div>

    <!-- ── ヒーロー ── -->
    <section class="lp-hero">
      <div class="lp-hero-inner" data-fade>
        <div class="lp-badge">飲食店向け 棚卸管理ツール</div>
        <h1 class="lp-heading">棚卸を、<br>もっとシンプルに。</h1>
        <p class="lp-sub">
          音声入力でスピードアップ。チームで同時に作業。<br>
          月次データで原価管理まで、ひとつのアプリで。
        </p>
        <div class="lp-cta">
          <button class="lp-btn-primary" :disabled="loading" @click="onStart">
            <span>{{ loading ? '準備中...' : shopCode ? '続きから' : 'はじめる' }}</span>
            <span v-if="!loading" class="lp-btn-arrow">→</span>
          </button>
          <button class="lp-btn-secondary" @click="toggleJoin">QRで参加</button>
        </div>
        <button class="lp-restore-link" @click="toggleRestore">
          既存データを引き継ぐ ›
        </button>
      </div>
    </section>

    <!-- ── 特徴 ── -->
    <section class="lp-section">
      <p class="lp-section-label" data-fade>特徴</p>
      <div class="lp-features">
        <div class="lp-feature" data-fade style="transition-delay:0s">
          <div class="lp-feature-icon">🎤</div>
          <div class="lp-feature-title">音声で即入力</div>
          <div class="lp-feature-desc">「ビール 3本」と話すだけ。商品名を自動補正してすばやく登録できます。</div>
        </div>
        <div class="lp-feature" data-fade style="transition-delay:0.1s">
          <div class="lp-feature-icon">👥</div>
          <div class="lp-feature-title">チームで同時作業</div>
          <div class="lp-feature-desc">QRコードをスキャンするだけで複数端末が連動。作業が半分の時間で終わります。</div>
        </div>
        <div class="lp-feature" data-fade style="transition-delay:0.2s">
          <div class="lp-feature-icon">📊</div>
          <div class="lp-feature-title">履歴・原価管理</div>
          <div class="lp-feature-desc">月次比較で在庫の異常を即発見。CSV出力でPOSデータとの連携も簡単。</div>
        </div>
      </div>
    </section>

    <!-- ── 使い方 ── -->
    <section class="lp-section lp-section-gray">
      <p class="lp-section-label" data-fade>使い方</p>
      <div class="lp-steps">
        <div class="lp-step" data-fade style="transition-delay:0s">
          <div class="lp-step-num">1</div>
          <div class="lp-step-icon">🏪</div>
          <div class="lp-step-title">店舗を登録</div>
          <div class="lp-step-desc">「はじめる」を押すだけ。アカウント不要で即スタート。</div>
        </div>
        <div class="lp-step-connector" data-fade>›</div>
        <div class="lp-step" data-fade style="transition-delay:0.1s">
          <div class="lp-step-num">2</div>
          <div class="lp-step-icon">📦</div>
          <div class="lp-step-title">棚卸を入力</div>
          <div class="lp-step-desc">音声または検索で商品を選び、数量を確認して登録。</div>
        </div>
        <div class="lp-step-connector" data-fade>›</div>
        <div class="lp-step" data-fade style="transition-delay:0.2s">
          <div class="lp-step-num">3</div>
          <div class="lp-step-icon">💾</div>
          <div class="lp-step-title">データを確認</div>
          <div class="lp-step-desc">CSVで出力。月次比較で原価の異常を早期発見。</div>
        </div>
      </div>
    </section>

    <!-- ── フッター ── -->
    <footer class="lp-footer">
      <div class="lp-footer-logo">📋 棚卸アプリ</div>
      <div class="lp-footer-text">飲食店の棚卸作業を効率化する Web アプリです</div>
    </footer>

  </div>
</template>

<style scoped>
/* ── ベース ── */
.lp {
  min-height: 100vh;
  background: #fff;
  color: #0f172a;
  overflow-x: hidden;
}

/* ── フェードインアニメーション ── */
[data-fade] {
  opacity: 0;
  transform: translateY(22px);
  transition: opacity 0.55s ease, transform 0.55s ease;
}
[data-fade].is-visible {
  opacity: 1;
  transform: translateY(0);
}

/* ── ヘッダー ── */
.lp-header {
  position: sticky;
  top: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  background: rgba(255, 255, 255, 0.88);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border-bottom: 1px solid #f1f5f9;
}

.lp-logo {
  display: flex;
  align-items: center;
  gap: 7px;
}
.lp-logo-icon { font-size: 18px; }
.lp-logo-text {
  font-size: 16px;
  font-weight: 800;
  color: #0f172a;
  letter-spacing: -0.01em;
}

.lp-header-btn {
  font-size: 13px;
  font-weight: 700;
  color: #2563eb;
  background: none;
  border: 1.5px solid #2563eb;
  border-radius: 9px;
  padding: 7px 16px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  -webkit-tap-highlight-color: transparent;
}
.lp-header-btn:hover { background: #2563eb; color: #fff; }

/* ── インラインフォームバー ── */
.lp-bar {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
  animation: slideDown 0.2s ease;
  align-items: center;
}
@keyframes slideDown {
  from { opacity: 0; transform: translateY(-8px); }
  to   { opacity: 1; transform: translateY(0); }
}

.lp-bar-input {
  flex: 1;
  padding: 10px 14px;
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 0.12em;
  border: 1.5px solid #e2e8f0;
  border-radius: 9px;
  outline: none;
  font-family: 'SF Mono', 'Menlo', monospace;
  background: #fff;
  color: #0f172a;
  -webkit-appearance: none;
  min-width: 0;
}
.lp-bar-input:focus { border-color: #2563eb; }
.lp-bar-input::placeholder { font-family: inherit; letter-spacing: 0; font-weight: 400; color: #94a3b8; font-size: 14px; }

.lp-camera-btn {
  font-size: 22px;
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px;
  flex-shrink: 0;
  -webkit-tap-highlight-color: transparent;
}

.lp-bar-btn {
  padding: 10px 18px;
  background: #2563eb;
  color: #fff;
  border: none;
  border-radius: 9px;
  font-weight: 700;
  font-size: 14px;
  cursor: pointer;
  flex-shrink: 0;
  transition: opacity 0.15s;
  -webkit-tap-highlight-color: transparent;
}
.lp-bar-btn:active  { opacity: 0.8; }
.lp-bar-btn:disabled { opacity: 0.5; cursor: not-allowed; }

/* ── QRカメラスキャナー ── */
.lp-scanner-wrap {
  position: relative;
  width: 100%;
  aspect-ratio: 4/3;
  background: #000;
  border-radius: 12px;
  overflow: hidden;
}

.lp-scanner-video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.lp-scanner-aim {
  position: absolute;
  inset: 0;
  margin: auto;
  width: 56%;
  height: 56%;
  border: 3px solid #2563eb;
  border-radius: 8px;
  box-shadow: 0 0 0 9999px rgba(0,0,0,0.45);
  pointer-events: none;
}

.lp-scanner-close {
  position: absolute;
  top: 10px;
  right: 10px;
  background: rgba(0,0,0,0.6);
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 6px 12px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.lp-error {
  padding: 8px 20px;
  font-size: 13px;
  font-weight: 600;
  color: #dc2626;
  background: #fef2f2;
  border-bottom: 1px solid #fecaca;
}

/* ── ヒーロー ── */
.lp-hero {
  padding: 72px 24px 68px;
  text-align: center;
  background: linear-gradient(170deg, #ffffff 30%, #eff6ff 100%);
}

.lp-hero-inner {
  max-width: 440px;
  margin: 0 auto;
}

.lp-badge {
  display: inline-block;
  font-size: 10px;
  font-weight: 700;
  color: #2563eb;
  background: #dbeafe;
  border-radius: 99px;
  padding: 4px 14px;
  margin-bottom: 22px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.lp-heading {
  font-size: 38px;
  font-weight: 900;
  line-height: 1.18;
  color: #0f172a;
  margin: 0 0 18px;
  letter-spacing: -0.025em;
}

.lp-sub {
  font-size: 14px;
  color: #475569;
  line-height: 1.75;
  margin: 0 0 36px;
}

.lp-cta {
  display: flex;
  gap: 12px;
  justify-content: center;
  flex-wrap: wrap;
  margin-bottom: 20px;
}

.lp-btn-primary {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px 34px;
  background: #2563eb;
  color: #fff;
  border: none;
  border-radius: 14px;
  font-size: 16px;
  font-weight: 800;
  cursor: pointer;
  box-shadow: 0 4px 20px rgba(37, 99, 235, 0.32);
  transition: transform 0.18s ease, box-shadow 0.18s ease;
  -webkit-tap-highlight-color: transparent;
}
.lp-btn-primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 28px rgba(37, 99, 235, 0.38);
}
.lp-btn-primary:active  { transform: translateY(0); }
.lp-btn-primary:disabled { opacity: 0.55; cursor: not-allowed; transform: none; }

.lp-btn-arrow {
  font-size: 18px;
  transition: transform 0.18s;
}
.lp-btn-primary:hover .lp-btn-arrow { transform: translateX(3px); }

.lp-btn-secondary {
  padding: 16px 28px;
  background: #fff;
  color: #2563eb;
  border: 2px solid #2563eb;
  border-radius: 14px;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.15s;
  -webkit-tap-highlight-color: transparent;
}
.lp-btn-secondary:hover { background: #eff6ff; }

.lp-restore-link {
  font-size: 12px;
  color: #94a3b8;
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px 0;
  text-decoration: underline;
  text-underline-offset: 3px;
  -webkit-tap-highlight-color: transparent;
}
.lp-restore-link:hover { color: #475569; }

/* ── セクション共通 ── */
.lp-section {
  padding: 64px 20px;
}
.lp-section-gray { background: #f8fafc; }

.lp-section-label {
  text-align: center;
  font-size: 10px;
  font-weight: 700;
  color: #94a3b8;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  margin: 0 0 32px;
}

/* ── 特徴 ── */
.lp-features {
  display: grid;
  grid-template-columns: 1fr;
  gap: 14px;
  max-width: 440px;
  margin: 0 auto;
}
@media (min-width: 600px) {
  .lp-features {
    grid-template-columns: repeat(3, 1fr);
    max-width: 760px;
  }
}

.lp-feature {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 18px;
  padding: 24px 20px;
  text-align: center;
}

.lp-feature-icon  { font-size: 30px; margin-bottom: 12px; }
.lp-feature-title { font-size: 14px; font-weight: 800; color: #0f172a; margin-bottom: 8px; }
.lp-feature-desc  { font-size: 12px; color: #64748b; line-height: 1.65; }

/* ── 使い方 ── */
.lp-steps {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0;
  max-width: 560px;
  margin: 0 auto;
}
@media (min-width: 600px) {
  .lp-steps { flex-direction: row; align-items: flex-start; }
}

.lp-step {
  text-align: center;
  flex: 1;
  padding: 16px 12px;
}

.lp-step-num {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  background: #2563eb;
  color: #fff;
  border-radius: 50%;
  font-size: 12px;
  font-weight: 800;
  margin-bottom: 10px;
}

.lp-step-icon  { font-size: 26px; margin-bottom: 10px; }
.lp-step-title { font-size: 14px; font-weight: 700; color: #0f172a; margin-bottom: 6px; }
.lp-step-desc  { font-size: 12px; color: #64748b; line-height: 1.65; }

.lp-step-connector {
  font-size: 22px;
  color: #cbd5e1;
  padding: 8px 0;
  display: none;
}
@media (min-width: 600px) {
  .lp-step-connector { display: block; padding: 40px 0 0; }
}

/* ── フッター ── */
.lp-footer {
  padding: 28px 20px;
  text-align: center;
  border-top: 1px solid #f1f5f9;
}
.lp-footer-logo {
  font-size: 14px;
  font-weight: 700;
  color: #0f172a;
  margin-bottom: 6px;
}
.lp-footer-text {
  font-size: 11px;
  color: #94a3b8;
}
</style>
