<script setup>
/**
 * 招待から参加する画面（段 2-1・User決定 2026-10-07）。
 * 招待の URL（?join=…）を開くとここ。名前と6桁の暗証番号を入れて申請し、管理者の承認を待つ。
 * 承認されたら、この端末がそのままスタッフとしてログインする（暗証番号を入れ直さない）。
 */
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { getInvite, joinAsStaff, pendingJoin, checkPendingJoin, forgetPendingJoin, ROLE_LABELS } from '../composables/useAuth.js'

const props = defineProps({ token: { type: String, default: '' } })
const emit = defineEmits(['done', 'cancel'])

const step = ref('loading')   // loading | form | waiting | invalid | rejected
const invite = ref(null)
const name = ref('')
const pin = ref('')
const pin2 = ref('')
const error = ref('')
const busy = ref(false)
const waiting = ref(pendingJoin())

let timer = null
function startWaiting() {
  step.value = 'waiting'
  clearInterval(timer)
  const poll = async () => {
    try {
      const st = await checkPendingJoin()
      if (st === 'active') { clearInterval(timer); emit('done') }
      else if (st === 'rejected' || st === 'gone' || st === 'deleted') { clearInterval(timer); step.value = 'rejected' }
    } catch (_) { /* 通信できないときは次に聞く */ }
  }
  poll()
  timer = setInterval(poll, 5000)
}
onUnmounted(() => clearInterval(timer))

onMounted(async () => {
  if (!props.token && waiting.value) { startWaiting(); return }
  if (!props.token) { step.value = 'invalid'; return }
  try {
    invite.value = await getInvite(props.token)
    name.value = invite.value.name
    step.value = 'form'
  } catch (e) {
    error.value = e.message
    step.value = 'invalid'
  }
})

const minutesLeft = computed(() => {
  if (!invite.value?.expiresAt) return null
  return Math.max(0, Math.ceil((new Date(invite.value.expiresAt).getTime() - Date.now()) / 60000))
})

async function submit() {
  error.value = ''
  if (!name.value.trim()) { error.value = '名前を入れてください'; return }
  if (!/^\d{6}$/.test(pin.value)) { error.value = '暗証番号は6桁の数字です'; return }
  if (pin.value !== pin2.value) { error.value = '確認の暗証番号が合いません'; return }
  busy.value = true
  try {
    waiting.value = await joinAsStaff(props.token, name.value.trim(), pin.value)
    try { localStorage.setItem('_last_staff_code', waiting.value.shopCode); localStorage.setItem('_last_staff_name', waiting.value.name) } catch (_) {}
    startWaiting()
  } catch (e) {
    error.value = e.message
  } finally {
    busy.value = false
  }
}
function giveUp() { forgetPendingJoin(); clearInterval(timer); emit('cancel') }
const digits = v => v.replace(/\D/g, '').slice(0, 6)
</script>

<template>
  <div class="sj">
    <div class="sj-card">
      <div class="sj-title">スタッフとして参加</div>

      <p v-if="step === 'loading'" class="sj-p">招待を確かめています…</p>

      <template v-else-if="step === 'invalid'">
        <p class="sj-err">{{ error || 'この招待は使えません（期限切れ・使用済み・取り消し）。' }}</p>
        <p class="sj-p">管理者にもう一度招待を出してもらってください。招待は10分で使えなくなります。</p>
        <button type="button" class="sj-btn sec" @click="emit('cancel')">ログイン画面へ</button>
      </template>

      <template v-else-if="step === 'form'">
        <div class="sj-store">
          <b>{{ invite.storeName || invite.shopCode }}</b>
          <span>{{ ROLE_LABELS[invite.role] }}として招待されています<template v-if="minutesLeft != null">（あと{{ minutesLeft }}分）</template></span>
        </div>
        <label class="sj-label" for="sj-name">名前（店で呼ばれている名前）</label>
        <input id="sj-name" v-model="name" class="sj-input" maxlength="30" autocomplete="username" />
        <label class="sj-label" for="sj-pin">暗証番号（6桁の数字）</label>
        <input id="sj-pin" :value="pin" class="sj-input" type="password" inputmode="numeric" maxlength="6" placeholder="●●●●●●"
          autocomplete="new-password" @input="pin = digits($event.target.value); $event.target.value = pin" />
        <label class="sj-label" for="sj-pin2">暗証番号（確認）</label>
        <input id="sj-pin2" :value="pin2" class="sj-input" type="password" inputmode="numeric" maxlength="6" placeholder="●●●●●●"
          autocomplete="new-password" @input="pin2 = digits($event.target.value); $event.target.value = pin2" @keydown.enter="submit" />
        <p class="sj-hint">123456 や 000000 のような番号は使えません。次からは「店舗コード・名前・暗証番号」でログインします。</p>
        <p v-if="error" class="sj-err">{{ error }}</p>
        <button type="button" class="sj-btn pri" :disabled="busy" @click="submit">{{ busy ? '送っています…' : '参加を申請する' }}</button>
      </template>

      <template v-else-if="step === 'waiting'">
        <div class="sj-wait" aria-hidden="true">⏳</div>
        <p class="sj-p"><b>{{ waiting?.name }}</b>さんの参加を申請しました。<br>管理者が承認すると、このままログインします。</p>
        <p class="sj-p sj-small">{{ waiting?.storeName || waiting?.shopCode }} ・ 店舗コード {{ waiting?.shopCode }}</p>
        <button type="button" class="sj-btn sec" @click="giveUp">申請をやめる</button>
      </template>

      <template v-else-if="step === 'rejected'">
        <p class="sj-err">参加は承認されませんでした。</p>
        <p class="sj-p">管理者に確かめてください。</p>
        <button type="button" class="sj-btn sec" @click="giveUp">ログイン画面へ</button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.sj { min-height: 100dvh; display: flex; align-items: center; justify-content: center; padding: 24px 16px; background: var(--bg, #f6fafb); }
.sj-card { width: 100%; max-width: 400px; background: var(--surface, #fff); border-radius: 20px; padding: 28px 22px; box-shadow: 0 4px 24px rgba(0,0,0,.10); display: grid; gap: 10px; }
.sj-title { font-size: 20px; font-weight: 800; text-align: center; color: var(--text, #12303a); }
.sj-store { display: grid; gap: 2px; padding: 12px; border-radius: 12px; background: var(--primary-weak, #ecfeff); text-align: center; }
.sj-store b { font-size: 16px; color: var(--text, #12303a); }
.sj-store span { font-size: 12.5px; color: var(--primary, #0e7490); font-weight: 700; }
.sj-label { font-size: 12.5px; font-weight: 700; color: #3d5a62; margin-top: 4px; }
.sj-input { width: 100%; box-sizing: border-box; border: 1.5px solid #bfd6dc; border-radius: 10px; padding: 12px; font-size: 16px; }
.sj-input:focus { outline: none; border-color: var(--primary, #0e7490); }
.sj-hint { margin: 0; font-size: 12px; color: #4c6a72; line-height: 1.6; }
.sj-p { margin: 0; font-size: 14px; color: #3d5a62; line-height: 1.7; text-align: center; }
.sj-small { font-size: 12px; color: #7d969c; }
.sj-err { margin: 0; font-size: 13px; font-weight: 700; color: #b91c1c; text-align: center; }
.sj-wait { font-size: 40px; text-align: center; }
.sj-btn { min-height: 48px; border-radius: 12px; font-size: 15px; font-weight: 800; cursor: pointer; margin-top: 6px; }
.sj-btn.pri { border: none; background: var(--grad-btn); color: var(--on-grad); }
.sj-btn.pri:disabled { opacity: .6; }
.sj-btn.sec { border: 1px solid var(--border, #d6e6ea); background: var(--surface, #fff); color: var(--text, #12303a); }
</style>
