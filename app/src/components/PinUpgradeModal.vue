<script setup>
/**
 * 以前に4桁で登録した店のオーナーに、PIN を6桁へ変えてもらう画面（D-030）。
 *
 * 4桁（1万通り）は、ログインの段階的なロックを入れても1年で当たる見込みが残る。
 * サーバーがログインの応答と /auth/me で「変更が要る」と返している間（pinUpgradeRequired）、App はこの画面を出し続ける。
 * 閉じるボタンは置かない。変えるとサーバーは、この端末以外のオーナーのログインを切る。
 */
import { ref, computed, onMounted } from 'vue'
import { useFocusTrap } from '../composables/useFocusTrap.js'
import { changeOwnerPin } from '../composables/useAuth.js'

const emit = defineEmits(['done'])

const current = ref('')
const next    = ref('')
const confirm = ref('')
const error   = ref('')
const busy    = ref(false)
const sheetRef = ref(null)
const { focusFirst } = useFocusTrap(sheetRef)
onMounted(() => focusFirst())

const digits = (e, n) => { const v = e.target.value.replace(/\D/g, '').slice(0, n); e.target.value = v; return v }
const canSubmit = computed(() => /^\d{4}$/.test(current.value) && /^\d{6}$/.test(next.value) && next.value === confirm.value && !busy.value)

async function submit() {
  error.value = ''
  if (!/^\d{4}$/.test(current.value)) { error.value = '今のPIN（4桁）を入れてください'; return }
  if (!/^\d{6}$/.test(next.value)) { error.value = '新しいPINは6桁の数字で入れてください'; return }
  if (next.value !== confirm.value) { error.value = '新しいPINの確認が一致しません'; return }
  busy.value = true
  try {
    await changeOwnerPin(current.value, next.value)
    emit('done')
  } catch (e) {
    error.value = e?.message || 'PINを変えられませんでした。時間をおいてお試しください'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="modal-overlay pu-overlay">
    <div ref="sheetRef" class="modal-sheet pu-sheet" role="dialog" aria-modal="true" aria-labelledby="pu-title" tabindex="-1">
      <div id="pu-title" class="pu-title">PIN を6桁に変えてください</div>
      <p class="pu-desc">
        店舗のPINを4桁から6桁にしました。4桁は総当たりで当てられやすいため、続ける前に新しい6桁のPINを決めてください。
        変えると、ほかの端末のオーナーのログインは切れます（スタッフのログインはそのままです）。
      </p>

      <label class="pu-label" for="pu-current">今のPIN（4桁）</label>
      <input id="pu-current" class="pu-input" type="password" inputmode="numeric" autocomplete="current-password"
             maxlength="4" placeholder="●●●●" :value="current" @input="current = digits($event, 4)" />

      <label class="pu-label" for="pu-next">新しいPIN（6桁）</label>
      <input id="pu-next" class="pu-input" type="password" inputmode="numeric" autocomplete="new-password"
             maxlength="6" placeholder="●●●●●●" :value="next" @input="next = digits($event, 6)" />
      <p class="pu-hint">同じ数字だけ（111111）・連番（123456）・くり返し（121212）は使えません</p>

      <label class="pu-label" for="pu-confirm">新しいPIN（確認）</label>
      <input id="pu-confirm" class="pu-input" type="password" inputmode="numeric" autocomplete="new-password"
             maxlength="6" placeholder="●●●●●●" :value="confirm" @input="confirm = digits($event, 6)"
             @keyup.enter="submit" />

      <div v-if="error" class="pu-error" role="alert">{{ error }}</div>
      <button class="btn btn-primary pu-submit" type="button" :disabled="!canSubmit" @click="submit">
        {{ busy ? '変更中…' : '6桁のPINにする' }}
      </button>
      <p class="pu-help">今のPINがわからないときは <a href="/support" target="_blank" rel="noopener">サポート</a> へお問い合わせください。</p>
    </div>
  </div>
</template>

<style scoped>
.pu-overlay { z-index: 2600; }
.pu-sheet { max-height: 92vh; overflow-y: auto; padding-bottom: 24px; }
.pu-title { font-size: 17px; font-weight: 800; color: var(--text); margin: 4px 0 8px; }
.pu-desc { font-size: 13px; color: var(--text-muted); line-height: 1.6; margin: 0 0 14px; }
.pu-label { display: block; font-size: 13px; font-weight: 700; color: var(--text); margin: 12px 0 6px; }
.pu-input {
  width: 100%; box-sizing: border-box; padding: 12px 14px; font-size: 18px; letter-spacing: 0.3em;
  border: 1.5px solid var(--border); border-radius: 10px; background: #fff; font-family: inherit;
}
.pu-input:focus { outline: none; border-color: var(--primary); }
.pu-hint { font-size: 12px; color: var(--text-muted); margin: 4px 0 0; }
.pu-error { font-size: 13px; color: #b91c1c; background: #fef2f2; border-radius: 8px; padding: 8px 12px; margin-top: 12px; }
.pu-submit { width: 100%; margin-top: 16px; padding: 14px; font-size: 15px; }
.pu-help { font-size: 12px; color: var(--text-muted); margin: 12px 0 0; text-align: center; }
</style>
