<script setup>
import { ref } from 'vue'
import { register, login, staffLogin } from '../composables/useAuth.js'
import { deviceId } from '../composables/useDeviceId.js'

const emit = defineEmits(['done'])

// 'login' | 'staff' | 'register'
const tab = ref('login')

// ── スタッフとしてログイン（段 2-1・店舗コード＋名前＋6桁の暗証番号）──────────
const stCode    = ref(localStorage.getItem('_last_staff_code') ?? '')
const stName    = ref(localStorage.getItem('_last_staff_name') ?? '')
const stPin     = ref('')
const stError   = ref('')
const stLoading = ref(false)
async function onStaffLogin() {
  stError.value = ''
  const code = stCode.value.trim().toUpperCase()
  if (!code || !stName.value.trim()) { stError.value = '店舗コードと名前を入れてください'; return }
  if (!/^\d{6}$/.test(stPin.value)) { stError.value = '暗証番号は6桁の数字です'; return }
  stLoading.value = true
  try {
    await staffLogin(code, stName.value.trim(), stPin.value, deviceId)
    try { localStorage.setItem('_last_staff_code', code); localStorage.setItem('_last_staff_name', stName.value.trim()) } catch (_) {}
    emit('done')
  } catch (e) {
    stError.value = e.message
    stPin.value = ''
  } finally {
    stLoading.value = false
  }
}

// ── 新規登録 ────────────────────────────────────────────────────────────────
const regStoreName   = ref('')
const regPin         = ref('')
const regPinConfirm  = ref('')
const regError       = ref('')
const regLoading     = ref(false)
const regResult      = ref(null) // { shopCode }

async function onRegister() {
  regError.value = ''
  if (!/^\d{4}$/.test(regPin.value)) {
    regError.value = 'PINは4桁の数字で入力してください'
    return
  }
  if (regPin.value !== regPinConfirm.value) {
    regError.value = 'PINの確認が一致しません'
    return
  }
  regLoading.value = true
  try {
    const result   = await register(regStoreName.value, regPin.value)
    regResult.value = result
  } catch (e) {
    regError.value = e.message
  } finally {
    regLoading.value = false
  }
}

function onPinInput(e, target) {
  const val = e.target.value.replace(/\D/g, '').slice(0, 4)
  e.target.value = val
  if (target === 'pin')    regPin.value        = val
  if (target === 'confirm') regPinConfirm.value = val
}

// ── ログイン ────────────────────────────────────────────────────────────────
const loginCode    = ref('')
const loginPin     = ref('')
const loginError   = ref('')
const loginLoading = ref(false)

async function onLogin() {
  loginError.value = ''
  const code = loginCode.value.trim().toUpperCase()
  if (!code) {
    loginError.value = '店舗コードを入力してください'
    return
  }
  if (!/^\d{4}$/.test(loginPin.value)) {
    loginError.value = 'PINは4桁の数字で入力してください'
    return
  }
  loginLoading.value = true
  try {
    await login(code, loginPin.value)
    emit('done')
  } catch (e) {
    loginError.value = e.message
  } finally {
    loginLoading.value = false
  }
}

function onLoginCodeInput(e) {
  const val = e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 8)
  e.target.value = val
  loginCode.value = val
}

function onLoginPinInput(e) {
  const val = e.target.value.replace(/\D/g, '').slice(0, 4)
  e.target.value = val
  loginPin.value = val
}
</script>

<template>
  <div class="auth-page">
    <div class="auth-card">
      <div class="auth-logo">🏪</div>
      <h1 class="auth-title">タナオロ</h1>
      <p class="auth-subtitle">店舗アカウントでログインして<br>セッション履歴を管理できます</p>

      <!-- タブ切り替え -->
      <div class="auth-tabs">
        <button
          class="auth-tab"
          :class="{ active: tab === 'login' }"
          @click="tab = 'login'"
        >ログイン</button>
        <button
          class="auth-tab"
          :class="{ active: tab === 'staff' }"
          @click="tab = 'staff'"
        >スタッフ</button>
        <button
          class="auth-tab"
          :class="{ active: tab === 'register' }"
          @click="tab = 'register'"
        >新規登録</button>
      </div>

      <!-- ログインフォーム -->
      <template v-if="tab === 'login'">
        <div class="auth-form">
          <label class="form-label">店舗コード</label>
          <input
            type="text"
            class="form-input"
            placeholder="例：ABCDEF"
            :value="loginCode"
            @input="onLoginCodeInput"
            maxlength="8"
            autocomplete="off"
          />

          <label class="form-label">PIN（4桁）</label>
          <input
            type="password"
            inputmode="numeric"
            class="form-input"
            placeholder="●●●●"
            :value="loginPin"
            @input="onLoginPinInput"
            maxlength="4"
          />

          <div v-if="loginError" class="form-error">{{ loginError }}</div>

          <button
            class="btn btn-primary auth-submit"
            :disabled="loginLoading"
            @click="onLogin"
          >
            {{ loginLoading ? 'ログイン中...' : 'ログイン' }}
          </button>
        </div>
      </template>

      <!-- スタッフとしてログイン -->
      <template v-else-if="tab === 'staff'">
        <div class="auth-form">
          <label class="form-label" for="st-code">店舗コード</label>
          <input id="st-code" v-model="stCode" type="text" class="form-input" placeholder="例：ABCDEF" maxlength="8" autocomplete="off"
            @input="stCode = stCode.toUpperCase().replace(/[^A-Z]/g, '')" />
          <label class="form-label" for="st-name">名前（参加したときの名前）</label>
          <input id="st-name" v-model="stName" type="text" class="form-input" placeholder="例：山田" maxlength="30" autocomplete="username" />
          <label class="form-label" for="st-pin">暗証番号（6桁）</label>
          <input id="st-pin" v-model="stPin" type="password" inputmode="numeric" class="form-input" placeholder="●●●●●●" maxlength="6"
            autocomplete="current-password" @input="stPin = stPin.replace(/\D/g, '').slice(0, 6)" @keydown.enter="onStaffLogin" />
          <div v-if="stError" class="form-error">{{ stError }}</div>
          <button class="btn btn-primary auth-submit" :disabled="stLoading" @click="onStaffLogin">
            {{ stLoading ? 'ログイン中...' : 'スタッフとしてログイン' }}
          </button>
          <p class="auth-staff-note">はじめての人は、管理者から招待（QRコードかリンク）を受け取ってください。</p>
        </div>
      </template>

      <!-- 新規登録フォーム -->
      <template v-else>
        <!-- 登録完了画面 -->
        <template v-if="regResult">
          <div class="reg-success">
            <div class="reg-success-icon">✅</div>
            <p class="reg-success-msg">登録が完了しました！</p>
            <div class="shop-code-box">
              <div class="shop-code-label">あなたの店舗コード</div>
              <div class="shop-code-value">{{ regResult.shopCode }}</div>
              <div class="shop-code-hint">このコードを控えておいてください。スタッフに共有すると参加できます。</div>
            </div>
            <button class="btn btn-primary auth-submit" @click="emit('done')">
              セッション一覧へ
            </button>
          </div>
        </template>

        <!-- 登録フォーム -->
        <template v-else>
          <div class="auth-form">
            <label class="form-label">店舗名（任意）</label>
            <input
              type="text"
              class="form-input"
              placeholder="例：渋谷カフェ"
              v-model="regStoreName"
              maxlength="50"
            />

            <label class="form-label">PIN（4桁の数字）</label>
            <input
              type="password"
              inputmode="numeric"
              class="form-input"
              placeholder="●●●●"
              :value="regPin"
              @input="onPinInput($event, 'pin')"
              maxlength="4"
            />

            <label class="form-label">PIN（確認）</label>
            <input
              type="password"
              inputmode="numeric"
              class="form-input"
              placeholder="●●●●"
              :value="regPinConfirm"
              @input="onPinInput($event, 'confirm')"
              maxlength="4"
            />

            <div v-if="regError" class="form-error">{{ regError }}</div>

            <button
              class="btn btn-primary auth-submit"
              :disabled="regLoading"
              @click="onRegister"
            >
              {{ regLoading ? '登録中...' : '登録して店舗コードを発行' }}
            </button>
          </div>
        </template>
      </template>

    </div>
  </div>
</template>

<style scoped>
.auth-staff-note { margin: 10px 0 0; font-size: 12px; color: #4c6a72; line-height: 1.6; text-align: center; }
.auth-page {
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-secondary, #f6fafb);
  padding: 24px 16px;
}

.auth-card {
  width: 100%;
  max-width: 400px;
  background: white;
  border-radius: 20px;
  padding: 32px 24px;
  box-shadow: 0 4px 24px rgba(0,0,0,0.10);
  display: flex;
  flex-direction: column;
  align-items: center;
}

.auth-logo {
  font-size: 48px;
  margin-bottom: 8px;
}

.auth-title {
  font-size: 22px;
  font-weight: 700;
  color: var(--text-primary, #12303a);
  margin: 0 0 6px;
}

.auth-subtitle {
  font-size: 13px;
  color: var(--text-muted, #4c6a72);
  text-align: center;
  line-height: 1.6;
  margin: 0 0 24px;
}

.auth-tabs {
  display: flex;
  gap: 0;
  width: 100%;
  background: #edf5f7;
  border-radius: 10px;
  padding: 3px;
  margin-bottom: 20px;
}

.auth-tab {
  flex: 1;
  padding: 8px;
  border: none;
  background: transparent;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-muted, #4c6a72);
  cursor: pointer;
  transition: all 0.15s;
}

.auth-tab.active {
  background: white;
  color: var(--text-primary, #12303a);
  box-shadow: 0 1px 3px rgba(0,0,0,0.12);
}

.auth-form {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.form-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted, #4c6a72);
  margin-top: 10px;
  margin-bottom: 2px;
}

.form-input {
  width: 100%;
  padding: 12px 14px;
  border: 1.5px solid #d6e6ea;
  border-radius: 10px;
  font-size: 16px;
  outline: none;
  box-sizing: border-box;
  transition: border-color 0.15s;
}

.form-input:focus {
  border-color: var(--primary, var(--primary-bright));
}

.form-error {
  font-size: 12px;
  color: #ef4444;
  margin-top: 6px;
  padding: 8px 12px;
  background: #fef2f2;
  border-radius: 8px;
}

.auth-submit {
  width: 100%;
  margin-top: 16px;
  padding: 14px;
  font-size: 15px;
}


/* 登録完了 */
.reg-success {
  width: 100%;
  text-align: center;
  padding: 8px 0;
}

.reg-success-icon {
  font-size: 40px;
  margin-bottom: 8px;
}

.reg-success-msg {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary, #12303a);
  margin: 0 0 16px;
}

.shop-code-box {
  background: #f0fdf4;
  border: 2px solid #86efac;
  border-radius: 14px;
  padding: 16px;
  margin-bottom: 20px;
}

.shop-code-label {
  font-size: 11px;
  font-weight: 600;
  color: #16a34a;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 4px;
}

.shop-code-value {
  font-size: 28px;
  font-weight: 800;
  letter-spacing: 0.15em;
  color: #15803d;
  font-family: monospace;
}

.shop-code-hint {
  font-size: 11px;
  color: #166534;
  margin-top: 8px;
  line-height: 1.5;
}

/* ── デスクトップ（>= 1024px）──
   カード自体はモバイルで既に成立しているので、幅と余白を少し足し、
   マウス/キーボード操作の手応え（hover・フォーカスリング）だけ補う。 */
@media (min-width: 1024px) {
  .auth-page {
    background:
      radial-gradient(1100px 520px at 50% -10%, var(--primary-weak) 0%, transparent 62%),
      var(--bg-secondary, #f6fafb);
    padding: 40px;
  }

  .auth-card {
    max-width: 448px;
    padding: 38px 34px;
    border: 1px solid var(--border);
    box-shadow: 0 18px 48px rgba(15, 23, 42, 0.09);
  }

  .auth-tab:hover:not(.active) { color: var(--text); }

  .auth-page button:focus-visible,
  .auth-page input:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }
}
</style>
