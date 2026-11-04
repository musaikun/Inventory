<script setup>
/**
 * 招待から参加する画面（段 2-1・User決定 2026-10-07）。
 * 招待の URL（?join=…）を開くとここ。名前と6桁の暗証番号を入れて申請し、管理者の承認を待つ。
 * 承認されたら、この端末がそのままスタッフとしてログインする（暗証番号を入れ直さない）。
 * 承認はすぐ拾う（User 2026-11-04）: 3秒ごと＋画面に戻った・通信が戻ったときにすぐ聞く（裏にいる間はタイマーが止まる端末がある）。
 * 承認されたら「承認されました」を見せ、通知を許していれば端末の通知も出してから、アプリへ進む。
 */
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { getInvite, joinAsStaff, pendingJoin, checkPendingJoin, forgetPendingJoin, ROLE_LABELS } from '../composables/useAuth.js'
import PasswordReveal from './PasswordReveal.vue'

const props = defineProps({ token: { type: String, default: '' } })
const emit = defineEmits(['done', 'cancel'])

const step = ref('loading')   // loading | form | waiting | approved | invalid | rejected
const invite = ref(null)
const name = ref('')
const pin = ref('')
const pin2 = ref('')
const error = ref('')
const busy = ref(false)
const waiting = ref(pendingJoin())

let timer = null, goTimer = null
let _asking = false   // 聞いている途中は重ねて聞かない（承認の1回きりの返事を2本目が「もう無い」と受けないように）
const POLL_MS = 3000
async function poll() {
  if (step.value !== 'waiting' || _asking) return
  _asking = true
  try {
    const st = await checkPendingJoin()
    if (st === 'active') approved()
    else if (st === 'rejected' || st === 'gone' || st === 'deleted') { stopWaiting(); step.value = 'rejected' }
  } catch (_) { /* 通信できないときは次に聞く */ } finally { _asking = false }
}
// 画面に戻った・通信が戻ったら、次のタイマーを待たずに聞く
const _onBack = () => { if (document.visibilityState !== 'hidden') poll() }
function startWaiting() {
  step.value = 'waiting'
  stopWaiting()
  poll()
  timer = setInterval(poll, POLL_MS)
  document.addEventListener('visibilitychange', _onBack)
  window.addEventListener('focus', _onBack)
  window.addEventListener('online', _onBack)
}
function stopWaiting() {
  clearInterval(timer)
  document.removeEventListener('visibilitychange', _onBack)
  window.removeEventListener('focus', _onBack)
  window.removeEventListener('online', _onBack)
}
onUnmounted(() => { stopWaiting(); clearTimeout(goTimer) })

// ── 承認されたら ─────────────────────────────
// 「承認されました」を一瞬見せてからアプリへ（いきなり画面が変わると何が起きたか分からない）
function approved() {
  stopWaiting()
  step.value = 'approved'
  try { navigator.vibrate?.(30) } catch (_) {}
  notifyApproved()
  goTimer = setTimeout(goIn, 1800)
}
function goIn() { clearTimeout(goTimer); emit('done') }

// 端末の通知（待っている間に別のアプリを見ていても気づけるように）。許可は待ちの画面のボタンから訊く
const canAskNotify = ref(typeof Notification !== 'undefined' && Notification.permission === 'default')
const notifyOn = ref(typeof Notification !== 'undefined' && Notification.permission === 'granted')
async function askNotify() {
  try {
    const r = await Notification.requestPermission()
    notifyOn.value = r === 'granted'
  } catch (_) { /* 訊けない端末では何もしない */ }
  canAskNotify.value = false
}
async function notifyApproved() {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  const title = '参加が承認されました'
  const body = `${waiting.value?.storeName || waiting.value?.shopCode || ''} にスタッフとして入れます`
  try {
    const reg = await navigator.serviceWorker?.getRegistration?.()
    if (reg?.showNotification) { await reg.showNotification(title, { body, tag: 'staff-join', icon: './icon-192.png' }); return }
    new Notification(title, { body, tag: 'staff-join' })
  } catch (_) { /* 出せなくても画面の表示で分かる */ }
}

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
function giveUp() { forgetPendingJoin(); stopWaiting(); emit('cancel') }
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
        <PasswordReveal v-slot="{ type }">
          <input id="sj-pin" :value="pin" class="sj-input" :type="type" inputmode="numeric" maxlength="6" placeholder="●●●●●●"
            autocomplete="new-password" @input="pin = digits($event.target.value); $event.target.value = pin" />
        </PasswordReveal>
        <label class="sj-label" for="sj-pin2">暗証番号（確認）</label>
        <PasswordReveal v-slot="{ type }">
          <input id="sj-pin2" :value="pin2" class="sj-input" :type="type" inputmode="numeric" maxlength="6" placeholder="●●●●●●"
            autocomplete="new-password" @input="pin2 = digits($event.target.value); $event.target.value = pin2" @keydown.enter="submit" />
        </PasswordReveal>
        <p class="sj-hint">123456 や 000000 のような番号は使えません。次からは「店舗コード・名前・暗証番号」でログインします。</p>
        <p class="sj-hint">記録には名前が残り、アプリを開いていた時間は管理者から見えます（<a href="./privacy.html" target="_blank" rel="noopener">プライバシーポリシー</a>）。</p>
        <p v-if="error" class="sj-err">{{ error }}</p>
        <button type="button" class="sj-btn pri" :disabled="busy" @click="submit">{{ busy ? '送っています…' : '参加を申請する' }}</button>
      </template>

      <template v-else-if="step === 'waiting'">
        <div class="sj-wait" aria-hidden="true">⏳</div>
        <p class="sj-p"><b>{{ waiting?.name }}</b>さんの参加を申請しました。<br>管理者が承認すると、このままログインします。</p>
        <p class="sj-p sj-small">{{ waiting?.storeName || waiting?.shopCode }} ・ 店舗コード {{ waiting?.shopCode }}</p>
        <button v-if="canAskNotify" type="button" class="sj-btn sec" @click="askNotify">🔔 承認されたら通知で知らせる</button>
        <p v-else-if="notifyOn" class="sj-p sj-small">🔔 承認されたら、この端末に通知します</p>
        <button type="button" class="sj-btn sec" @click="giveUp">申請をやめる</button>
      </template>

      <template v-else-if="step === 'approved'">
        <div class="sj-ok" aria-hidden="true">✓</div>
        <p class="sj-p" role="status"><b>承認されました</b><br>{{ waiting?.storeName || waiting?.shopCode }} にスタッフとして入ります</p>
        <button type="button" class="sj-btn pri" @click="goIn">はじめる</button>
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
.sj-ok { width: 64px; height: 64px; margin: 0 auto; border-radius: 50%; background: #16a34a; color: #fff; font-size: 34px; font-weight: 900; display: flex; align-items: center; justify-content: center; animation: sj-pop .4s cubic-bezier(.2,1.6,.4,1); }
@keyframes sj-pop { from { transform: scale(.4); } to { transform: scale(1); } }
@media (prefers-reduced-motion: reduce) { .sj-ok { animation: none; } }
.sj-btn { min-height: 48px; border-radius: 12px; font-size: 15px; font-weight: 800; cursor: pointer; margin-top: 6px; }
.sj-btn.pri { border: none; background: var(--grad-btn); color: var(--on-grad); }
.sj-btn.pri:disabled { opacity: .6; }
.sj-btn.sec { border: 1px solid var(--border, #d6e6ea); background: var(--surface, #fff); color: var(--text, #12303a); }
</style>
