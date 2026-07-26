<script setup>
// 公開Web削除申請ページ（PLAY-002 Deliverable B）。
// Play Console の Data deletion URL（`https://<app>/?delete-account`）から到達し、
// アプリ未インストールでもブラウザからログイン→承認済みの削除フローを実行できる。
import { ref } from 'vue'
import { isAuthenticated, storeName, login, logout } from '../composables/useAuth.js'
import { shopCode } from '../composables/useStore.js'
import DeleteAccountModal from './DeleteAccountModal.vue'

// Google Play の公開Web削除リソースは store listing 上のアプリ名（＝PWA manifest の name）と
// 一致している必要がある。表示名を変える場合は vite.config.js の manifest と併せて更新する。
const APP_NAME = 'タナオロ'
// TODO(PLAY-003/PLAY-004): 確定した公開URLに差し替える。未設定なら導線は非表示。
const PRIVACY_URL = ''
const TERMS_URL = ''
const SUPPORT_URL = ''

const showModal = ref(false)
const done = ref(false)

// ── 削除するアカウントでログイン（未ログイン時）─────────────────────────────
const code = ref('')
const pin = ref('')
const loginError = ref('')
const loginLoading = ref(false)

function onCodeInput(e) {
  const v = e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 8)
  e.target.value = v
  code.value = v
}
function onPinInput(e) {
  const v = e.target.value.replace(/\D/g, '').slice(0, 4)
  e.target.value = v
  pin.value = v
}

async function onLogin() {
  loginError.value = ''
  if (!code.value) { loginError.value = '店舗コードを入力してください'; return }
  if (!/^\d{4}$/.test(pin.value)) { loginError.value = 'PINは4桁の数字で入力してください'; return }
  loginLoading.value = true
  try {
    await login(code.value, pin.value)
  } catch (e) {
    loginError.value = e.message || 'ログインに失敗しました'
  } finally {
    loginLoading.value = false
  }
}

async function onSwitchAccount() {
  await logout().catch(() => {})
  code.value = ''
  pin.value = ''
}

function onDeleted() {
  showModal.value = false
  done.value = true
}
</script>

<template>
  <div class="dap">
    <div class="dap-card">
      <!-- 完了 -->
      <template v-if="done">
        <div class="dap-done-icon" aria-hidden="true">✓</div>
        <h1 class="dap-title">アカウント削除が完了しました</h1>
        <p class="dap-text">
          {{ APP_NAME }}のアカウントと関連データを削除しました。ご利用ありがとうございました。
          この画面は閉じていただいて構いません。
        </p>
      </template>

      <template v-else>
        <div class="dap-logo" aria-hidden="true">🏪</div>
        <h1 class="dap-title">アカウント削除の申請</h1>
        <p class="dap-app">{{ APP_NAME }}</p>
        <p class="dap-text">
          このページから、{{ APP_NAME }}の店舗アカウントとすべての関連データ
          （品目・棚卸・発注・入出庫・履歴・設定・ログイン情報）を削除できます。
          <strong class="dap-strong">削除すると元に戻せません。</strong>
        </p>

        <!-- 削除対象でログイン済み -->
        <template v-if="isAuthenticated">
          <div class="dap-account">
            <div class="dap-account-label">削除対象のアカウント</div>
            <div class="dap-account-name">{{ storeName || '店舗' }}</div>
            <div class="dap-account-code">{{ shopCode }}</div>
          </div>
          <button class="dap-btn dap-btn-danger" @click="showModal = true">アカウント削除に進む</button>
          <button class="dap-btn-link" @click="onSwitchAccount">別のアカウントでログインし直す</button>
        </template>

        <!-- 未ログイン → 削除するアカウントでログイン -->
        <template v-else>
          <p class="dap-login-note">削除するアカウントの店舗コードと PIN でログインしてください。</p>
          <label class="dap-label" for="dap-code">店舗コード</label>
          <input
            id="dap-code" class="dap-input" type="text" inputmode="text"
            :value="code" @input="onCodeInput" maxlength="8" placeholder="例：ABCDEF" autocomplete="off"
          />
          <label class="dap-label" for="dap-pin">PIN（4桁）</label>
          <input
            id="dap-pin" class="dap-input" type="password" inputmode="numeric"
            :value="pin" @input="onPinInput" maxlength="4" placeholder="●●●●" autocomplete="off"
          />
          <div v-if="loginError" class="dap-error" role="alert">{{ loginError }}</div>
          <button class="dap-btn dap-btn-primary" :disabled="loginLoading" @click="onLogin">
            {{ loginLoading ? 'ログイン中…' : 'ログイン' }}
          </button>
        </template>

        <!-- 導線（確定URLがあるときだけ表示）-->
        <div v-if="PRIVACY_URL || TERMS_URL || SUPPORT_URL" class="dap-links">
          <a v-if="PRIVACY_URL" :href="PRIVACY_URL" target="_blank" rel="noopener">プライバシーポリシー</a>
          <a v-if="TERMS_URL" :href="TERMS_URL" target="_blank" rel="noopener">利用規約</a>
          <a v-if="SUPPORT_URL" :href="SUPPORT_URL" target="_blank" rel="noopener">お問い合わせ</a>
        </div>
      </template>
    </div>

    <DeleteAccountModal v-if="showModal" @close="showModal = false" @deleted="onDeleted" />
  </div>
</template>

<style scoped>
.dap {
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-secondary, #f8fafc);
  padding: 24px 16px;
}

.dap-card {
  width: 100%;
  max-width: 420px;
  background: #fff;
  border-radius: 20px;
  padding: 28px 22px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.10);
  text-align: center;
}

.dap-logo { font-size: 40px; margin-bottom: 4px; }

.dap-title { font-size: 20px; font-weight: 800; color: var(--text); margin: 0 0 4px; }
.dap-app { font-size: 13px; font-weight: 700; color: var(--primary); margin: 0 0 14px; }

.dap-text { font-size: 13px; color: var(--text-muted); line-height: 1.7; margin: 0 0 18px; text-align: left; }
.dap-strong { color: var(--danger); }

/* 削除対象アカウント */
.dap-account {
  background: #fef2f2;
  border: 1.5px solid #fecaca;
  border-radius: 12px;
  padding: 12px;
  margin-bottom: 16px;
}
.dap-account-label { font-size: 11px; font-weight: 700; color: #9a3412; margin-bottom: 4px; }
.dap-account-name { font-size: 16px; font-weight: 800; color: var(--text); }
.dap-account-code {
  font-size: 14px; font-weight: 700; color: var(--danger);
  font-family: monospace; letter-spacing: 0.08em; margin-top: 2px;
}

/* ログインフォーム */
.dap-login-note { font-size: 13px; color: var(--text); line-height: 1.6; margin: 0 0 12px; text-align: left; }
.dap-label {
  display: block; text-align: left;
  font-size: 12px; font-weight: 700; color: var(--text-muted);
  margin: 10px 2px 4px;
}
.dap-input {
  width: 100%;
  box-sizing: border-box;
  border: 1.5px solid var(--border);
  border-radius: 10px;
  padding: 12px 14px;
  font-size: 16px;
  outline: none;
  background: #fff;
  color: var(--text);
}
.dap-input:focus { border-color: var(--primary); }

.dap-error {
  font-size: 12px; color: var(--danger);
  background: #fef2f2; border-radius: 8px;
  padding: 8px 12px; margin-top: 10px; text-align: left;
}

/* ボタン */
.dap-btn {
  width: 100%;
  padding: 13px;
  font-size: 15px;
  font-weight: 700;
  border-radius: 10px;
  border: none;
  cursor: pointer;
  margin-top: 16px;
  -webkit-tap-highlight-color: transparent;
}
.dap-btn-primary { background: var(--primary); color: #fff; }
.dap-btn-primary:active { opacity: 0.85; }
.dap-btn-primary:disabled { opacity: 0.5; cursor: default; }
.dap-btn-danger { background: var(--danger); color: #fff; }
.dap-btn-danger:active { opacity: 0.85; }

.dap-btn-link {
  display: block;
  width: 100%;
  margin-top: 12px;
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 13px;
  text-decoration: underline;
  cursor: pointer;
}

/* 完了 */
.dap-done-icon {
  width: 56px; height: 56px; line-height: 56px;
  margin: 4px auto 12px;
  border-radius: 50%;
  background: #dcfce7; color: var(--success);
  font-size: 30px; font-weight: 800;
}

/* 導線リンク */
.dap-links {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 14px;
  margin-top: 22px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
}
.dap-links a { font-size: 12px; color: var(--text-muted); text-decoration: underline; }
</style>
