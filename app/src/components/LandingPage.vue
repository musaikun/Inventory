<script setup>
import { ref } from 'vue'
import { shopCode } from '../composables/useStore.js'
import { isTwaApp } from '../utils/appMode.js'

const emit = defineEmits(['started'])

const isTwa   = isTwaApp()
const version = __APP_VERSION__

// ── 契約済みユーザーのログイン（認証ページのログインタブへ）─────────────────
function onLogin() {
  emit('started', { hostMode: true })
}

const loading = ref(false)

// ── ホストとして開始（認証フローへ）─────────────────────────────────────────
async function onStart() {
  // hostMode フラグを渡すことで App.vue が認証チェックを行う
  emit('started', { hostMode: true })
}
</script>

<template>
  <div class="lp">

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

</style>
