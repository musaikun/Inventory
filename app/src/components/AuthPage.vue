<script setup>
import { ref } from 'vue'
import { register, login } from '../composables/useAuth.js'

const emit = defineEmits(['done', 'skip'])

// 'login' | 'register'
const tab = ref('login')

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

      <!-- ゲストとして続行 -->
      <button class="auth-skip" @click="emit('skip')">
        ゲストとして参加する（認証不要）
      </button>
    </div>
  </div>
</template>

<style scoped>
.auth-page {
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-secondary, #f8fafc);
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
  color: var(--text-primary, #1e293b);
  margin: 0 0 6px;
}

.auth-subtitle {
  font-size: 13px;
  color: var(--text-muted, #64748b);
  text-align: center;
  line-height: 1.6;
  margin: 0 0 24px;
}

.auth-tabs {
  display: flex;
  gap: 0;
  width: 100%;
  background: #f1f5f9;
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
  color: var(--text-muted, #64748b);
  cursor: pointer;
  transition: all 0.15s;
}

.auth-tab.active {
  background: white;
  color: var(--text-primary, #1e293b);
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
  color: var(--text-muted, #64748b);
  margin-top: 10px;
  margin-bottom: 2px;
}

.form-input {
  width: 100%;
  padding: 12px 14px;
  border: 1.5px solid #e2e8f0;
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

.auth-skip {
  margin-top: 20px;
  background: none;
  border: none;
  color: var(--text-muted, #64748b);
  font-size: 13px;
  cursor: pointer;
  text-decoration: underline;
  padding: 4px;
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
  color: var(--text-primary, #1e293b);
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
      var(--bg-secondary, #f8fafc);
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
