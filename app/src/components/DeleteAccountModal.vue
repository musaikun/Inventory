<script setup>
// アカウント削除モーダル（PLAY-002 / account-deletion-contract 準拠）
// - 再認証: 現在PIN + 店舗コード再入力 → 最終確認
// - requestId は店舗スコープで保持（別店舗の残存IDは破棄）。再試行では変えない
// - 200 deleted / alreadyDeleted を受けてから端末のローカルデータを消去する
// - 503 / 通信失敗では local token を先に消さず、同じ requestId で再試行できる
// - 409（別requestId競合）は retryable:false。保存済みの元IDを保持し自動再送しない
import { ref, computed, onMounted, nextTick } from 'vue'
import { useEscapeKey } from '../composables/useEscapeKey.js'
import { deleteAccount, clearAuthLocal, storeName } from '../composables/useAuth.js'
import { shopCode } from '../composables/useStore.js'
import { unsubscribePushLocal } from '../composables/usePush.js'
import { clearLocalAccountData } from '../composables/accountData.js'
import { resetAnalytics } from '../utils/analytics.js'
import { STORAGE_KEYS } from '../utils/storageKeys.js'
import { resolveRequestId, mapDeletionError } from '../utils/accountDeletionFlow.js'

const emit = defineEmits(['close', 'deleted'])

// 表示用に対象店舗を確保しておく（成功時のローカル掃除で shopCode/storeName が消えても
// 完了画面を正しく描画できるようにする）。
const targetShop = shopCode.value
const targetName = storeName.value || '店舗'

// ── requestId（店舗スコープ・再試行では変えない）─────────────────────────────
function genUuid() {
  try {
    if (crypto?.randomUUID) return crypto.randomUUID()
  } catch (_) { /* fall through */ }
  // Secure context 以外向けのフォールバック（v4 相当）
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

// 別店舗の残存 requestId を再利用すると、越境 replay を削除成功と誤認し得る（Blocker 対策）。
const _resolved = resolveRequestId(localStorage.getItem(STORAGE_KEYS.deleteRequestId), targetShop, genUuid)
const requestId = _resolved.id
try { localStorage.setItem(STORAGE_KEYS.deleteRequestId, _resolved.record) } catch (_) {}

// ── 画面状態 ─────────────────────────────────────────────────────────────────
// 'form'（PIN・店舗コード入力）| 'confirm'（最終確認）| 'deleting'（処理中）
// | 'error'（再試行可能なエラー）| 'done'（完了）
const phase      = ref('form')
const pin        = ref('')
const confirmVal = ref('')
const formError  = ref('')
const errorMsg   = ref('')
const retryable  = ref(false)
// close 時に requestId を保持するか（削除が進行中/保留になり得るケースは保持して再開可能に）
let keepId = false

const pinRef = ref(null)

const busy = computed(() => phase.value === 'deleting')
const canSubmit = computed(() => /^\d{4}$/.test(pin.value) && confirmVal.value === targetShop)

// ESC: 処理中と完了後は閉じない（誤操作・二重操作の防止）
useEscapeKey(() => { if (phase.value !== 'deleting' && phase.value !== 'done') requestClose() })

onMounted(() => { nextTick(() => pinRef.value?.focus()) })

function onPinInput(e) {
  const v = e.target.value.replace(/\D/g, '').slice(0, 4)
  e.target.value = v
  pin.value = v
}
function onConfirmInput(e) {
  const v = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12)
  e.target.value = v
  confirmVal.value = v
}

function goConfirm() {
  formError.value = ''
  if (!/^\d{4}$/.test(pin.value)) { formError.value = 'PINは4桁の数字で入力してください'; return }
  if (confirmVal.value !== targetShop) { formError.value = '店舗コードが一致しません'; return }
  phase.value = 'confirm'
}

async function doDelete() {
  phase.value = 'deleting'
  errorMsg.value = ''
  try {
    await deleteAccount({ requestId, pin: pin.value, confirmation: confirmVal.value })
    await finalize()
  } catch (e) {
    applyError(e)
  }
}

function applyError(e) {
  const r = mapDeletionError(e)
  if (r.resetPin) pin.value = ''
  if (r.resetConfirm) confirmVal.value = ''
  if (r.keepId) keepId = true
  if (r.phase === 'form') {
    formError.value = r.message
    errorMsg.value = ''
  } else {
    errorMsg.value = r.message
    retryable.value = !!r.retryable
  }
  phase.value = r.phase
}

// 200 deleted / alreadyDeleted 後の端末側クリーンアップ（data map の client 担当分）。
// Push はサーバー側で削除済み・token 失効済みのため local-only 解除にする。
async function finalize() {
  try { localStorage.removeItem(STORAGE_KEYS.deleteRequestId) } catch (_) {}
  try { await unsubscribePushLocal() } catch (_) {}
  try { clearLocalAccountData() } catch (_) {}
  try { resetAnalytics() } catch (_) {}
  try { clearAuthLocal() } catch (_) {}
  phase.value = 'done'
}

function requestClose() {
  if (!keepId) {
    try { localStorage.removeItem(STORAGE_KEYS.deleteRequestId) } catch (_) {}
  }
  emit('close')
}

function onOverlay() {
  if (phase.value === 'deleting' || phase.value === 'done') return
  requestClose()
}
</script>

<template>
  <div class="modal-overlay" @click.self="onOverlay">
    <div class="modal-sheet da-sheet" role="dialog" aria-modal="true" aria-labelledby="da-title">
      <div class="sheet-handle"></div>

      <!-- 完了 -->
      <template v-if="phase === 'done'">
        <div class="da-done">
          <div class="da-done-icon" aria-hidden="true">✓</div>
          <div id="da-title" class="da-done-title">アカウントを削除しました</div>
          <p class="da-done-text">
            「{{ targetName }}（{{ targetShop }}）」のデータを削除し、この端末からもログアウトしました。
            ご利用ありがとうございました。
          </p>
          <button class="btn da-btn-primary" @click="emit('deleted')">閉じる</button>
        </div>
      </template>

      <!-- 処理中 -->
      <template v-else-if="phase === 'deleting'">
        <div id="da-title" class="sheet-title da-title">削除しています…</div>
        <div class="da-spinner" aria-hidden="true"></div>
        <p class="da-progress-text" role="status" aria-live="polite">
          アカウントと関連データを削除しています。画面を閉じずにお待ちください。
        </p>
      </template>

      <!-- 再試行可能なエラー（429 / 409 / 503 / 通信失敗）-->
      <template v-else-if="phase === 'error'">
        <div id="da-title" class="sheet-title da-title">削除を完了できませんでした</div>
        <div class="da-error-box" role="alert" aria-live="assertive">{{ errorMsg }}</div>
        <div class="da-actions">
          <button class="btn da-btn-secondary" @click="requestClose">閉じる</button>
          <button v-if="retryable" class="btn da-btn-danger" @click="doDelete">再試行する</button>
        </div>
      </template>

      <!-- 最終確認 -->
      <template v-else-if="phase === 'confirm'">
        <div id="da-title" class="sheet-title da-title">本当に削除しますか？</div>
        <div class="da-final">
          <p class="da-final-lead">
            「<strong>{{ targetName }}（{{ targetShop }}）</strong>」のアカウントと
            すべての関連データを<strong class="da-strong">完全に削除</strong>します。
          </p>
          <p class="da-final-warn">この操作は取り消せません。復元はできません。</p>
        </div>
        <div class="da-actions">
          <button class="btn da-btn-secondary" @click="phase = 'form'">戻る</button>
          <button class="btn da-btn-danger" @click="doDelete">完全に削除する</button>
        </div>
      </template>

      <!-- 入力フォーム -->
      <template v-else>
        <div id="da-title" class="sheet-title da-title da-title-danger">アカウントを削除</div>

        <div class="da-target">
          <div class="da-target-name">{{ targetName }}</div>
          <div class="da-target-code">{{ targetShop }}</div>
        </div>

        <div class="da-warn-box">
          <div class="da-warn-head">⚠️ 次のデータがすべて削除され、復元できません</div>
          <ul class="da-warn-list">
            <li>品目リスト・辞書・単価</li>
            <li>棚卸データと履歴</li>
            <li>発注・入出庫の記録</li>
            <li>店舗設定・ログイン情報（PIN）</li>
            <li>通知の購読・共有ルーム</li>
          </ul>
          <p class="da-warn-note">削除後は同じ店舗コードでログインできなくなります。</p>
        </div>

        <label class="da-label" for="da-pin">現在の PIN（4桁）</label>
        <input
          id="da-pin"
          ref="pinRef"
          type="password"
          inputmode="numeric"
          class="da-input"
          placeholder="●●●●"
          :value="pin"
          @input="onPinInput"
          maxlength="4"
          autocomplete="off"
        />

        <label class="da-label" for="da-confirm">確認のため店舗コードを入力</label>
        <input
          id="da-confirm"
          type="text"
          class="da-input"
          :placeholder="targetShop"
          :value="confirmVal"
          @input="onConfirmInput"
          maxlength="12"
          autocomplete="off"
        />

        <div v-if="formError" class="da-form-error" role="alert">{{ formError }}</div>

        <div class="da-actions">
          <button class="btn da-btn-secondary" @click="requestClose">キャンセル</button>
          <button class="btn da-btn-danger" :disabled="!canSubmit || busy" @click="goConfirm">削除に進む</button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.da-sheet { max-height: 90vh; overflow-y: auto; }

.da-title { text-align: center; }
.da-title-danger { color: var(--danger); }

/* 対象店舗 */
.da-target {
  text-align: center;
  background: #fef2f2;
  border: 1.5px solid #fecaca;
  border-radius: 12px;
  padding: 12px;
  margin-bottom: 14px;
}
.da-target-name { font-size: 16px; font-weight: 800; color: var(--text); }
.da-target-code {
  font-size: 14px; font-weight: 700; color: var(--danger);
  font-family: monospace; letter-spacing: 0.08em; margin-top: 2px;
}

/* 削除対象の警告 */
.da-warn-box {
  background: #fff7ed;
  border: 1.5px solid #fdba74;
  border-radius: 12px;
  padding: 12px 14px;
  margin-bottom: 16px;
}
.da-warn-head { font-size: 13px; font-weight: 800; color: #9a3412; margin-bottom: 8px; }
.da-warn-list { margin: 0; padding-left: 18px; }
.da-warn-list li { font-size: 13px; color: #7c2d12; line-height: 1.7; }
.da-warn-note { font-size: 12px; color: #9a3412; margin: 8px 0 0; line-height: 1.5; }

/* 入力 */
.da-label {
  display: block;
  font-size: 12px; font-weight: 700; color: var(--text-muted);
  margin: 10px 2px 4px;
}
.da-input {
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
.da-input:focus { border-color: var(--danger); }

.da-form-error {
  font-size: 12px; color: var(--danger);
  background: #fef2f2; border-radius: 8px;
  padding: 8px 12px; margin-top: 10px;
}

/* 最終確認 */
.da-final {
  background: #fef2f2;
  border: 1.5px solid #fecaca;
  border-radius: 12px;
  padding: 14px;
  margin-bottom: 16px;
}
.da-final-lead { font-size: 14px; color: var(--text); line-height: 1.7; margin: 0 0 8px; }
.da-strong { color: var(--danger); }
.da-final-warn { font-size: 13px; font-weight: 700; color: var(--danger); margin: 0; }

/* 処理中 */
.da-spinner {
  width: 40px; height: 40px;
  margin: 18px auto;
  border: 4px solid #fecaca;
  border-top-color: var(--danger);
  border-radius: 50%;
  animation: da-spin 0.8s linear infinite;
}
@keyframes da-spin { to { transform: rotate(360deg); } }
.da-progress-text {
  text-align: center; font-size: 13px; color: var(--text-muted);
  line-height: 1.6; margin: 0 8px 8px;
}

/* エラー */
.da-error-box {
  background: #fef2f2;
  border: 1.5px solid #fecaca;
  border-radius: 12px;
  padding: 14px;
  font-size: 14px;
  color: #991b1b;
  line-height: 1.6;
  margin-bottom: 16px;
}

/* 完了 */
.da-done { text-align: center; padding: 8px 4px 4px; }
.da-done-icon {
  width: 56px; height: 56px; line-height: 56px;
  margin: 4px auto 12px;
  border-radius: 50%;
  background: #dcfce7; color: var(--success);
  font-size: 30px; font-weight: 800;
}
.da-done-title { font-size: 17px; font-weight: 800; color: var(--text); margin-bottom: 8px; }
.da-done-text { font-size: 13px; color: var(--text-muted); line-height: 1.7; margin: 0 4px 18px; }

/* アクション・ボタン */
.da-actions { display: flex; gap: 10px; margin-top: 12px; }
.da-actions .btn { flex: 1; }

.da-btn-danger {
  background: var(--danger);
  color: #fff;
  border: none;
}
.da-btn-danger:active { opacity: 0.85; }
.da-btn-danger:disabled { opacity: 0.45; cursor: default; }

.da-btn-secondary {
  background: #f1f5f9;
  color: var(--text);
  border: 1.5px solid var(--border);
}
.da-btn-secondary:active { background: #e2e8f0; }

.da-btn-primary {
  width: 100%;
  background: var(--primary);
  color: #fff;
  border: none;
  margin-top: 4px;
}
.da-btn-primary:active { opacity: 0.85; }
</style>
