<script setup>
import { ref, onMounted, onUnmounted } from 'vue'

const emit = defineEmits(['scanned', 'close'])

const videoRef = ref(null)
const status   = ref('loading') // 'loading' | 'scanning' | 'error'
const errorMsg = ref('')

let _reader = null

async function start() {
  try {
    const { BrowserMultiFormatReader } = await import('@zxing/browser')
    _reader = new BrowserMultiFormatReader()
    status.value = 'scanning'

    await _reader.decodeFromConstraints(
      { video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } } },
      videoRef.value,
      (result, err) => {
        if (result) {
          emit('scanned', result.getText())
          stop()
        }
      }
    )
  } catch (e) {
    status.value = 'error'
    if (e?.name === 'NotAllowedError') {
      errorMsg.value = 'カメラへのアクセスが拒否されました。\nブラウザ設定でカメラを許可してください。'
    } else {
      errorMsg.value = 'カメラを起動できませんでした。\n' + (e?.message ?? '')
    }
  }
}

function stop() {
  if (_reader) { _reader.reset(); _reader = null }
}

onMounted(start)
onUnmounted(stop)
</script>

<template>
  <div class="barcode-overlay" @click.self="$emit('close')">
    <div class="barcode-sheet">
      <div class="barcode-header">
        <span class="barcode-title">バーコードをスキャン</span>
        <button class="barcode-close" @click="$emit('close')">✕</button>
      </div>

      <!-- カメラビューファインダー -->
      <div class="barcode-viewer">
        <video
          ref="videoRef"
          class="barcode-video"
          autoplay
          muted
          playsinline
        ></video>

        <!-- スキャンライン（アニメーション） -->
        <div v-if="status === 'scanning'" class="scan-overlay">
          <div class="scan-frame">
            <div class="scan-line"></div>
          </div>
        </div>

        <!-- ローディング -->
        <div v-if="status === 'loading'" class="scan-msg">
          <div class="scan-spinner"></div>
          <p>カメラを起動中...</p>
        </div>

        <!-- エラー -->
        <div v-if="status === 'error'" class="scan-error">
          <div class="scan-error-icon">📷</div>
          <p class="scan-error-msg">{{ errorMsg }}</p>
          <button class="btn btn-primary scan-retry-btn" @click="stop(); start()">再試行</button>
        </div>
      </div>

      <p class="barcode-hint">JAN / EAN バーコードをカメラに向けてください</p>

      <button class="btn btn-secondary barcode-cancel" @click="$emit('close')">キャンセル</button>
    </div>
  </div>
</template>

<style scoped>
.barcode-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.75);
  z-index: 9000;
  display: flex;
  align-items: flex-end;
}

.barcode-sheet {
  width: 100%;
  background: var(--surface, white);
  border-radius: 20px 20px 0 0;
  padding: 16px 16px 32px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.barcode-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}

.barcode-title {
  font-size: 16px;
  font-weight: 800;
  color: var(--text);
}

.barcode-close {
  width: 32px;
  height: 32px;
  border: none;
  background: #f1f5f9;
  border-radius: 50%;
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  -webkit-tap-highlight-color: transparent;
}

.barcode-viewer {
  position: relative;
  width: 100%;
  aspect-ratio: 4/3;
  background: #000;
  border-radius: 14px;
  overflow: hidden;
}

.barcode-video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.scan-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.scan-frame {
  width: 70%;
  height: 40%;
  border: 2.5px solid rgba(255, 255, 255, 0.8);
  border-radius: 12px;
  position: relative;
  overflow: hidden;
}

.scan-frame::before,
.scan-frame::after {
  content: '';
  position: absolute;
  width: 20px;
  height: 20px;
  border-color: #3b82f6;
  border-style: solid;
  border-width: 0;
}

.scan-frame::before {
  top: -2px; left: -2px;
  border-top-width: 4px; border-left-width: 4px;
  border-radius: 4px 0 0 0;
}

.scan-frame::after {
  bottom: -2px; right: -2px;
  border-bottom-width: 4px; border-right-width: 4px;
  border-radius: 0 0 4px 0;
}

@keyframes scan {
  0%   { top: 0; }
  50%  { top: calc(100% - 3px); }
  100% { top: 0; }
}

.scan-line {
  position: absolute;
  left: 0;
  right: 0;
  height: 3px;
  background: linear-gradient(90deg, transparent, #3b82f6, transparent);
  animation: scan 2s linear infinite;
}

.scan-msg {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: white;
  font-size: 14px;
}

@keyframes spin { to { transform: rotate(360deg); } }
.scan-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid rgba(255, 255, 255, 0.3);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.scan-error {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 20px;
  background: rgba(0,0,0,0.7);
  color: white;
  text-align: center;
}

.scan-error-icon { font-size: 36px; }
.scan-error-msg  { font-size: 13px; line-height: 1.5; white-space: pre-line; }
.scan-retry-btn  { margin-top: 6px; }

.barcode-hint {
  font-size: 13px;
  color: var(--text-muted);
  text-align: center;
  margin: 0;
}

.barcode-cancel {
  width: 100%;
}
</style>
