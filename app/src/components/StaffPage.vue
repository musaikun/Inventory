<script setup>
/**
 * スタッフの管理（段 2-1・User決定 2026-10-07。管理者だけ）。
 * - 招待: 名前と役割を決めて出す → QR とリンク（10分・1回きり）。その場で読み取ってもらう
 * - 承認待ち: 承認／断る（招待を受けた人が名前と暗証番号を入れたもの）
 * - スタッフ: 役割の変更・停止／再開・暗証番号の失敗で止まったのを解除・削除（記録は「○○（削除済み）」で残る）
 * - 個別の許可（段 2-3）: 役割に足す5つ。役割でもうできるものは出さない
 */
import { ref, computed, onMounted, onUnmounted } from 'vue'
import QRCode from 'qrcode'
import {
  listStaff, createStaffInvite, revokeStaffInvite, staffAction, ROLE_LABELS, currentStaff,
} from '../composables/useAuth.js'
import { registerInnerLayerCloser } from '../composables/appMenuState.js'
import { GRANT_KEYS, GRANT_PERMS, can as roleCan, normalizeGrants } from '../services/permissions.js'

const emit = defineEmits(['close'])
onUnmounted(registerInnerLayerCloser(() => { emit('close'); return true }))

const ROLES = [
  { key: 'arbeit', label: 'アルバイト', note: '数える・発注数を入れる・品目を足す・やることを終える（金額は見えない）' },
  { key: 'shain',  label: '社員',       note: 'アルバイト＋棚卸・発注の開始と完了・品目を直す・金額を見る・やることを作る' },
  { key: 'admin',  label: '管理者',     note: '社員＋品目の削除と取り込み・並び替え・発注点・スタッフの管理' },
]

const staff = ref([])
const invites = ref([])
const loadError = ref('')
async function load() {
  try {
    const r = await listStaff()
    staff.value = r.staff ?? []
    invites.value = r.invites ?? []
    loadError.value = ''
    // 出していた招待が使われたら（一覧から消えたら）QR を閉じ、承認待ちへ目を向けてもらう
    if (issued.value && !invites.value.some(i => i.id === issued.value.id)) {
      const used = staff.value.some(st => st.status === 'pending' && st.name === issued.value.name)
      inviteNotice.value = used ? `${issued.value.name}さんが参加を申請しました。下の「承認待ち」で承認してください` : ''
      issued.value = null
    }
  } catch (e) { loadError.value = e.message }
}
let poll = null
onMounted(() => { load(); poll = setInterval(load, 10000) })   // 承認待ちが届くのを拾う
onUnmounted(() => clearInterval(poll))

const pending = computed(() => staff.value.filter(s => s.status === 'pending'))
const members = computed(() => staff.value.filter(s => s.status === 'active' || s.status === 'stopped'))
const deleted = computed(() => staff.value.filter(s => s.status === 'deleted'))

// ── 招待 ──
const inviteOpen = ref(false)
const invName = ref('')
const invRole = ref('arbeit')
const invError = ref('')
const issued = ref(null)    // { id, name, role, expiresAt, url, qr }
const inviteNotice = ref('')
const now = ref(Date.now())
let clock = null
onMounted(() => { clock = setInterval(() => { now.value = Date.now() }, 1000) })
onUnmounted(() => clearInterval(clock))
const left = computed(() => {
  if (!issued.value) return ''
  const ms = new Date(issued.value.expiresAt).getTime() - now.value
  if (ms <= 0) return '期限切れ'
  const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000)
  return `あと ${m}:${String(s).padStart(2, '0')}`
})
async function issue() {
  invError.value = ''
  if (!invName.value.trim()) { invError.value = '名前を入れてください'; return }
  try {
    const { invite } = await createStaffInvite(invName.value.trim(), invRole.value)
    const url = `${location.origin}${location.pathname}?join=${invite.token}`
    const qr = await QRCode.toDataURL(url, { width: 240, margin: 1 })
    issued.value = { ...invite, url, qr }
    inviteOpen.value = false
    invName.value = ''
    load()
  } catch (e) { invError.value = e.message }
}
const copied = ref('')
async function copyUrl() {
  try { await navigator.clipboard.writeText(issued.value.url); copied.value = 'コピーしました' }
  catch (_) { copied.value = 'コピーできませんでした。下のリンクを長押しして選んでください' }
}
async function shareUrl() {
  try { await navigator.share({ text: `タナオロに参加してください（10分で使えなくなります）\n${issued.value.url}` }) } catch (_) {}
}
const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'
async function revoke(inv) { await revokeStaffInvite(inv.id).catch(() => {}); if (issued.value?.id === inv.id) issued.value = null; load() }

// ── スタッフの操作 ──
const busy = ref('')
const msg = ref('')
async function act(s, action, body) {
  busy.value = s.id + action
  try { await staffAction(s.id, action, body); msg.value = ''; await load() }
  catch (e) { msg.value = e.message }
  finally { busy.value = '' }
}
const confirmDel = ref('')
const isMe = s => currentStaff.value?.id === s.id
const roleLabel = r => ROLE_LABELS[r] ?? r

const GRANT_LABELS = {
  orderStart: '発注を始める',
  orderFinish: '発注を確定・書き出す',
  stock: '棚卸を始める・完了する',
  task: 'やることを作る',
  itemEdit: '品目を直す・並び替え・発注点',
}
/** その役割にまだ無い（足す意味がある）許可だけ */
const grantChoices = role => GRANT_KEYS.filter(k => GRANT_PERMS[k].some(p => !roleCan(role, [], p)))
const hasGrant = (s, k) => normalizeGrants(s.grants).includes(k)
function toggleGrant(s, k) {
  const now = normalizeGrants(s.grants)
  const next = now.includes(k) ? now.filter(x => x !== k) : [...now, k]
  act(s, 'grants', { grants: next })
}
</script>

<template>
  <div class="sp2">
    <header class="sp2-head">
      <button type="button" class="sp2-back" @click="emit('close')">‹ 戻る</button>
      <span class="sp2-title">スタッフ</span>
    </header>
    <div class="sp2-body">
      <p v-if="loadError" class="sp2-err">{{ loadError }}</p>

      <!-- 招待 -->
      <section class="sp2-card">
        <template v-if="issued">
          <div class="sp2-issued">
            <b>{{ issued.name }}さん（{{ roleLabel(issued.role) }}）への招待</b>
            <img :src="issued.qr" alt="招待のQRコード" class="sp2-qr" width="200" height="200" />
            <span :class="['sp2-left', { over: left === '期限切れ' }]">{{ left }}</span>
            <p class="sp2-note">スタッフのスマホのカメラで読み取ってもらってください。10分で使えなくなり、1回使うと使えなくなります。</p>
            <div class="sp2-row">
              <button v-if="canShare" type="button" class="sp2-btn sec" @click="shareUrl">リンクを送る</button>
              <button type="button" class="sp2-btn sec" @click="copyUrl">リンクをコピー</button>
            </div>
            <p v-if="copied" class="sp2-note">{{ copied }}</p>
            <div class="sp2-row">
              <button type="button" class="sp2-btn sec" @click="issued = null">閉じる</button>
              <button type="button" class="sp2-btn danger-sec" @click="revoke(issued)">この招待を取り消す</button>
            </div>
          </div>
        </template>
        <template v-else-if="inviteOpen">
          <label class="sp2-label" for="inv-name">名前（店で呼んでいる名前）</label>
          <input id="inv-name" v-model="invName" class="sp2-input" maxlength="30" placeholder="例：山田" />
          <div class="sp2-label">役割</div>
          <label v-for="r in ROLES" :key="r.key" :class="['sp2-role', { on: invRole === r.key }]">
            <input v-model="invRole" type="radio" :value="r.key" />
            <span><b>{{ r.label }}</b><small>{{ r.note }}</small></span>
          </label>
          <p v-if="invError" class="sp2-err">{{ invError }}</p>
          <div class="sp2-row">
            <button type="button" class="sp2-btn sec" @click="inviteOpen = false">やめる</button>
            <button type="button" class="sp2-btn pri" @click="issue">招待を出す</button>
          </div>
        </template>
        <template v-else>
          <p v-if="inviteNotice" class="sp2-notice" role="status">{{ inviteNotice }}</p>
          <button type="button" class="sp2-btn pri wide" @click="inviteOpen = true; inviteNotice = ''">＋ スタッフを招待する</button>
        </template>
      </section>

      <!-- 承認待ち -->
      <section v-if="pending.length" class="sp2-card pend">
        <div class="sp2-h">承認待ち（{{ pending.length }}）</div>
        <div v-for="s in pending" :key="s.id" class="sp2-item">
          <div class="sp2-who"><b>{{ s.name }}</b><span>{{ roleLabel(s.role) }}</span></div>
          <div class="sp2-row">
            <button type="button" class="sp2-btn sec" :disabled="!!busy" @click="act(s, 'reject')">断る</button>
            <button type="button" class="sp2-btn pri" :disabled="!!busy" @click="act(s, 'approve')">承認する</button>
          </div>
        </div>
      </section>

      <!-- スタッフ -->
      <section class="sp2-card">
        <div class="sp2-h">スタッフ（{{ members.length + 1 }}）</div>
        <div class="sp2-item">
          <div class="sp2-who"><b>オーナー</b><span>店を登録した人・外せません</span></div>
        </div>
        <div v-for="s in members" :key="s.id" class="sp2-item">
          <div class="sp2-who">
            <b>{{ s.name }}<template v-if="isMe(s)">（自分）</template></b>
            <span>{{ roleLabel(s.role) }}<em v-if="s.status === 'stopped'" class="sp2-stop">停止中</em></span>
          </div>
          <div v-if="!isMe(s)" class="sp2-acts">
            <select :value="s.role" :aria-label="`${s.name}の役割`" :disabled="!!busy" @change="act(s, 'role', { role: $event.target.value })">
              <option v-for="r in ROLES" :key="r.key" :value="r.key">{{ r.label }}</option>
            </select>
            <button v-if="s.status === 'active'" type="button" class="sp2-mini" :disabled="!!busy" @click="act(s, 'stop')">停止</button>
            <button v-else type="button" class="sp2-mini" :disabled="!!busy" @click="act(s, 'resume')">再開</button>
            <button type="button" class="sp2-mini" :disabled="!!busy" title="暗証番号を5回まちがえて止まったのを解除" @click="act(s, 'unlock')">ロック解除</button>
            <button v-if="confirmDel !== s.id" type="button" class="sp2-mini danger" :disabled="!!busy" @click="confirmDel = s.id">削除</button>
            <span v-else class="sp2-confirm">
              記録は「{{ s.name }}（削除済み）」で残ります
              <button type="button" class="sp2-mini" @click="confirmDel = ''">やめる</button>
              <button type="button" class="sp2-mini danger" @click="confirmDel = ''; act(s, 'delete')">削除する</button>
            </span>
          </div>
          <div v-if="!isMe(s) && grantChoices(s.role).length" class="sp2-grants" role="group" :aria-label="`${s.name}に足す許可`">
            <span class="sp2-glabel">個別に許可:</span>
            <button v-for="k in grantChoices(s.role)" :key="k" type="button"
              :class="['sp2-chip', { on: hasGrant(s, k) }]" :aria-pressed="hasGrant(s, k)" :disabled="!!busy"
              @click="toggleGrant(s, k)">{{ hasGrant(s, k) ? '✓ ' : '' }}{{ GRANT_LABELS[k] }}</button>
          </div>
        </div>
        <p v-if="msg" class="sp2-err">{{ msg }}</p>
      </section>

      <!-- 使われていない招待 -->
      <section v-if="invites.length" class="sp2-card">
        <div class="sp2-h">まだ使われていない招待</div>
        <div v-for="i in invites" :key="i.id" class="sp2-item">
          <div class="sp2-who"><b>{{ i.name }}</b><span>{{ roleLabel(i.role) }}</span></div>
          <button type="button" class="sp2-mini" @click="revoke(i)">取り消す</button>
        </div>
      </section>

      <p v-if="deleted.length" class="sp2-note">削除済み {{ deleted.length }}人（記録には名前が残っています）</p>
    </div>
  </div>
</template>

<style scoped>
.sp2 { position: fixed; inset: 0; z-index: 70; background: var(--bg, #f6fafb); display: flex; flex-direction: column; }
.sp2-head { flex: none; display: flex; align-items: center; gap: 8px; padding: 10px 12px; padding-top: calc(10px + env(safe-area-inset-top)); background: var(--surface, #fff); border-bottom: 1px solid var(--border, #d6e6ea); }
.sp2-back { min-height: 40px; border: none; background: none; color: var(--primary); font-size: 14px; font-weight: 700; cursor: pointer; }
.sp2-title { font-size: 16px; font-weight: 800; color: var(--text, #12303a); }
.sp2-body { flex: 1; min-height: 0; overflow-y: auto; padding: 12px; padding-bottom: calc(24px + env(safe-area-inset-bottom)); display: flex; flex-direction: column; gap: 12px; }
.sp2-body > * { flex: none; }
.sp2-card { background: var(--surface, #fff); border: 1px solid var(--border, #d6e6ea); border-radius: 14px; padding: 12px; display: grid; gap: 8px; }
.sp2-card.pend { border-color: #f59e0b; background: #fffbeb; }
.sp2-h { font-size: 13px; font-weight: 800; color: var(--text-muted, #4c6a72); }
.sp2-item { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; padding: 8px 0; border-top: 1px solid var(--border, #eef4f6); }
.sp2-item:first-of-type { border-top: none; }
.sp2-who { display: grid; min-width: 0; }
.sp2-who b { font-size: 15px; color: var(--text, #12303a); }
.sp2-who span { font-size: 12px; color: var(--text-muted, #4c6a72); }
.sp2-stop { font-style: normal; margin-left: 6px; padding: 1px 6px; border-radius: 6px; background: #fee2e2; color: #b91c1c; font-weight: 800; }
.sp2-acts { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.sp2-acts select { min-height: 34px; border: 1px solid var(--border, #d6e6ea); border-radius: 8px; background: var(--surface, #fff); font-size: 13px; padding: 0 6px; }
.sp2-mini { min-height: 34px; padding: 0 10px; border: 1px solid var(--border, #d6e6ea); border-radius: 8px; background: var(--surface, #fff); color: var(--text, #12303a); font-size: 12.5px; font-weight: 700; cursor: pointer; }
.sp2-mini.danger { color: #b91c1c; border-color: #fecaca; }
.sp2-confirm { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 12px; color: #7f1d1d; }
.sp2-label { font-size: 12.5px; font-weight: 700; color: #3d5a62; }
.sp2-input { width: 100%; box-sizing: border-box; border: 1.5px solid #bfd6dc; border-radius: 10px; padding: 11px 12px; font-size: 16px; }
.sp2-role { display: flex; align-items: flex-start; gap: 10px; padding: 10px; border: 1px solid var(--border, #d6e6ea); border-radius: 10px; cursor: pointer; }
.sp2-role.on { border-color: var(--primary, #0e7490); background: var(--primary-weak, #ecfeff); }
.sp2-role span { display: grid; }
.sp2-role b { font-size: 14px; }
.sp2-role small { font-size: 12px; color: var(--text-muted, #4c6a72); }
.sp2-row { display: flex; gap: 8px; }
.sp2-row .sp2-btn { flex: 1; }
.sp2-btn { min-height: 44px; border-radius: 12px; font-size: 14px; font-weight: 800; cursor: pointer; padding: 0 12px; white-space: nowrap; }
.sp2-item .sp2-row { flex: none; }
.sp2-item .sp2-row .sp2-btn { flex: none; min-width: 84px; }
.sp2-notice { margin: 0 0 4px; padding: 8px 10px; border-radius: 10px; background: #fffbeb; color: #92400e; font-size: 13px; font-weight: 700; line-height: 1.5; }
.sp2-btn.wide { width: 100%; }
.sp2-btn.pri { border: none; background: var(--grad-btn); color: var(--on-grad); }
.sp2-btn.sec { border: 1px solid var(--border, #d6e6ea); background: var(--surface, #fff); color: var(--text, #12303a); }
.sp2-btn.danger-sec { border: 1px solid #fecaca; background: #fff; color: #b91c1c; }
.sp2-issued { display: grid; gap: 8px; justify-items: center; text-align: center; }
.sp2-qr { width: 200px; height: 200px; image-rendering: pixelated; }
.sp2-left { font-size: 15px; font-weight: 800; color: var(--primary, #0e7490); font-variant-numeric: tabular-nums; }
.sp2-left.over { color: #b91c1c; }
.sp2-note { margin: 0; font-size: 12px; color: var(--text-muted, #4c6a72); line-height: 1.6; }
.sp2-err { margin: 0; font-size: 13px; font-weight: 700; color: #b91c1c; }
.sp2-grants { flex-basis: 100%; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.sp2-glabel { font-size: 12px; font-weight: 700; color: var(--text-muted, #4c6a72); }
.sp2-chip { min-height: 32px; padding: 0 10px; border: 1px solid var(--border, #d6e6ea); border-radius: 999px; background: var(--surface, #fff); color: var(--text, #12303a); font-size: 12px; font-weight: 700; cursor: pointer; }
.sp2-chip.on { border-color: var(--primary, #0e7490); background: var(--primary-weak, #ecfeff); color: var(--primary, #0e7490); }
</style>
