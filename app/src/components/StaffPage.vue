<script setup>
/**
 * スタッフの管理（段 2-1・管理者だけ。User決定 2026-10-15 で作り直し・モック docs/mocks/staff-page-v2.html）。
 * - 一覧: スタッフと「ログイン中・作業時間」をひとつに。いま開いている人を上、名前の横に緑の点、作業時間（7日／30日）
 * - 招待（QR とリンク・10分・1回きり）、承認待ちは一覧の上でその場で承認／断る
 * - 人を押すとその人の画面: 権限（4つのまとまりのスイッチ）・肩書き・使った日とやったこと・ログインを止める／戻す・削除（ロック解除は暗証番号で止まっているときだけ）
 *   スタッフの管理と全品目・アカウントの削除は管理者だけ（切り替えられない）。管理者・自分の権限は変えられない
 * - オーナーの名前（User決定 2026-10-14）: オーナーの画面で、オーナー本人だけが変えられる。変えると過去の記録もそろう
 */
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import QRCode from 'qrcode'
import {
  listStaff, createStaffInvite, revokeStaffInvite, staffAction, ROLE_LABELS, currentStaff, getPresence,
  ownerName, updateOwnerName, getStaffActivity,
} from '../composables/useAuth.js'
import { registerInnerLayerCloser } from '../composables/appMenuState.js'
import { groupsOf } from '../services/permissions.js'

const emit = defineEmits(['close'])

// 肩書き（表示だけ）と管理者（店に1人・すべての権限とスタッフの管理）
const ROLES = [
  { key: 'arbeit', label: 'アルバイト', note: '肩書きだけ。できることは招待のあとで人ごとに決めます（最初は在庫管理とタスク管理）' },
  { key: 'shain',  label: '社員',       note: '肩書きだけ。できることは招待のあとで人ごとに決めます（最初は在庫管理とタスク管理）' },
  { key: 'admin',  label: '管理者',     note: '店に1人。すべての権限と、スタッフの招待・権限の付与' },
]
// 権限の4つのまとまり（User決定 2026-10-15）
const GROUPS = [
  { key: 'inventory', label: '在庫管理', note: '数える・入出庫・発注・棚卸の開始と完了・ルームを作る・並び替え・金額を見る' },
  { key: 'tasks',     label: 'タスク管理', note: 'やることを作る（完了の印は誰でも）' },
  { key: 'data',      label: 'データの更新', note: '品目の取り込み・書き出し・品目の情報を直す・発注日と発注点' },
  { key: 'report',    label: 'レポート・分析・証跡', note: 'レポート・過去の履歴・ほかのスタッフの使用履歴' },
]
const GROUP_SHORT = { inventory: '在庫管理', tasks: 'タスク', data: 'データ', report: 'レポート' }

// ── 読み込み（10秒ごとに承認待ち・ログイン中を拾う）──
const staff = ref([])
const invites = ref([])
const loadError = ref('')
const presence = ref(null)
async function load() {
  try {
    const r = await listStaff()
    staff.value = r.staff ?? []
    invites.value = r.invites ?? []
    loadError.value = ''
    // 出していた招待が使われたら（一覧から消えたら）QR を閉じ、承認待ちへ目を向けてもらう
    if (issued.value && !invites.value.some(i => i.id === issued.value.id)) {
      const used = staff.value.some(st => st.status === 'pending' && st.name === issued.value.name)
      inviteNotice.value = used ? `${issued.value.name}さんが参加を申請しました。上の承認待ちで承認してください` : ''
      issued.value = null
    }
  } catch (e) { loadError.value = e.message }
}
async function loadPresence() {
  // 一覧はいま開いているか・最後に使った日時だけ（合計時間は出さない。User決定 2026-10-15）
  try { presence.value = await getPresence(1) } catch (_) { /* 次の読み直しで */ }
}
let poll = null
onMounted(() => { load(); loadPresence(); poll = setInterval(() => { load(); loadPresence() }, 10000) })
onUnmounted(() => clearInterval(poll))

const now = ref(Date.now())
let clock = null
onMounted(() => { clock = setInterval(() => { now.value = Date.now() }, 1000) })
onUnmounted(() => clearInterval(clock))

const pending = computed(() => staff.value.filter(s => s.status === 'pending'))
const members = computed(() => staff.value.filter(s => s.status === 'active' || s.status === 'stopped'))
const deleted = computed(() => staff.value.filter(s => s.status === 'deleted'))
const roleLabel = r => ROLE_LABELS[r] ?? r
const isMe = s => currentStaff.value?.id === s.id

// 一覧の行: オーナー＋スタッフ。ログイン中・作業時間をくっつけ、いま開いている人を上に
const presOf = id => (presence.value?.people ?? []).find(p => p.id === id) ?? null
const rows = computed(() => {
  const owner = { id: 'owner', name: ownerName.value || presOf('owner')?.name || 'オーナー', role: 'owner', status: 'active', owner: true }
  return [owner, ...members.value].map(s => {
    const p = presOf(s.id)
    return { ...s, online: !!p?.online, onlineSince: p?.onlineSince ?? null, lastSeenAt: p?.lastSeenAt ?? null }
  }).sort((a, b) => (b.online - a.online) || (a.owner ? -1 : b.owner ? 1 : 0) || (b.lastSeenAt || '').localeCompare(a.lastSeenAt || ''))
})
function summary(s) {
  if (s.owner) return 'すべての権限'
  if (s.role === 'admin') return 'すべての権限・スタッフの管理'
  const g = s.groups ?? groupsOf(s.role, s.grants)
  return g.length ? g.map(k => GROUP_SHORT[k]).join('・') : '権限なし（やることの完了だけ）'
}
const initial = n => String(n || '?').trim().slice(0, 1)
const fmtMin = m => (m >= 60 ? `${Math.floor(m / 60)}時間${m % 60 ? `${m % 60}分` : ''}` : `${m}分`)
const hm = iso => { const d = new Date(iso); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}` }
const md = iso => { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()}` }
function ago(iso) {
  if (!iso) return 'まだ使っていません'
  const m = Math.floor((now.value - new Date(iso).getTime()) / 60000)
  if (m < 60) return m < 1 ? '1分以内' : `${m}分前`
  const d = new Date(iso), t = new Date(now.value)
  if (d.toDateString() === t.toDateString()) return `今日 ${hm(iso)}`
  if (d.toDateString() === new Date(now.value - 86400_000).toDateString()) return `昨日 ${hm(iso)}`
  return `${md(iso)} ${hm(iso)}`
}

// ── 招待 ──
const inviteOpen = ref(false)
const invName = ref('')
const invRole = ref('arbeit')
const invError = ref('')
const issued = ref(null)    // { id, name, role, expiresAt, url, qr }
const inviteNotice = ref('')
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
// 管理者（店長）は店に1人（User決定 2026-10-14）
const adminNow = computed(() => staff.value.find(st => st.role === 'admin' && ['active', 'stopped', 'pending'].includes(st.status))
  || invites.value.find(i => i.role === 'admin'))

// ── 操作 ──
const busy = ref('')
const msg = ref('')
async function act(s, action, body) {
  busy.value = s.id + action
  try { await staffAction(s.id, action, body); msg.value = ''; await load() }
  catch (e) { msg.value = e.message }
  finally { busy.value = '' }
}

// ── 人の画面 ──
const selId = ref('')
const sel = computed(() => rows.value.find(r => r.id === selId.value) ?? null)
const tab = ref('work')       // work（使った日） | actions
const activity = ref(null)
const actDays = ref(30)      // 直近30日。「もっと見る」で残している90日まで
const openDay = ref('')
const actError = ref('')
const confirmDel = ref(false)
const confirmStop = ref(false)
// 暗証番号を5回まちがえて止まっている（残りの分。0 以下なら解けている）
const lockLeft = computed(() => {
  const u = sel.value?.lockedUntil
  return u ? Math.ceil((Date.parse(u) - now.value) / 60000) : 0
})
async function openPerson(id) {
  selId.value = id; tab.value = 'work'; activity.value = null; actError.value = ''; confirmDel.value = false; confirmStop.value = false; msg.value = ''
  actDays.value = 30; openDay.value = ''
  try { activity.value = await getStaffActivity(id, 30) } catch (e) { actError.value = e.message }
}
async function moreDays() {
  const id = selId.value
  try {
    const r = await getStaffActivity(id, 90)
    if (selId.value === id) { activity.value = r; actDays.value = 90 }
  } catch (e) { actError.value = e.message }
}
const canEditPerms = computed(() => sel.value && !sel.value.owner && sel.value.role !== 'admin' && !isMe(sel.value))
const groupsSel = computed(() => (sel.value && !sel.value.owner ? (sel.value.groups ?? groupsOf(sel.value.role, sel.value.grants)) : []))
const hasGroup = k => !sel.value || sel.value.owner || sel.value.role === 'admin' || groupsSel.value.includes(k)
function toggleGroup(k) {
  if (!canEditPerms.value) return
  const cur = groupsSel.value
  act(sel.value, 'grants', { groups: cur.includes(k) ? cur.filter(x => x !== k) : [...cur, k] })
}
// 使った日（1日1行にまとめ、押すと開いた回ごと）・やったこと（日ごと）
const WEEK = ['日', '月', '火', '水', '木', '金', '土']
const dayHead = iso => {
  const d = new Date(iso), t = new Date(now.value)
  const same = (a, b) => a.toDateString() === b.toDateString()
  const y = new Date(now.value - 86400_000)
  return `${same(d, t) ? '今日 ・ ' : same(d, y) ? '昨日 ・ ' : ''}${d.getMonth() + 1}月${d.getDate()}日（${WEEK[d.getDay()]}）`
}
const actionGroups = computed(() => {
  const out = []
  for (const a of activity.value?.actions ?? []) {
    const h = dayHead(a.at)
    if (!out.length || out[out.length - 1].head !== h) out.push({ head: h, items: [] })
    out[out.length - 1].items.push(a)
  }
  return out
})
const ACT_ICON = { stock: '📦', order: '🧾', in: '📥', out: '📤', task: '＋', done: '✓' }
const workDays = computed(() => {
  const map = new Map()
  for (const w of activity.value?.work ?? []) {
    const key = new Date(w.startedAt).toDateString()
    if (!map.has(key)) map.set(key, { key, head: dayHead(w.startedAt), first: w.startedAt, last: w.lastSeenAt, minutes: 0, runs: [] })
    const d = map.get(key)
    if (w.startedAt < d.first) d.first = w.startedAt
    if (w.lastSeenAt > d.last) d.last = w.lastSeenAt
    d.minutes += w.minutes
    d.runs.push(w)
  }
  return [...map.values()]
    .map(d => ({ ...d, runs: d.runs.sort((a, b) => a.startedAt.localeCompare(b.startedAt)) }))
    .sort((a, b) => b.first.localeCompare(a.first))
})
const toggleDay = k => { openDay.value = openDay.value === k ? '' : k }

// オーナーの名前（オーナー本人だけが変えられる）
const ownerEditing = ref(false)
const ownerInput = ref('')
const ownerError = ref('')
function editOwner() { ownerInput.value = ownerName.value; ownerError.value = ''; ownerEditing.value = true }
async function saveOwner() {
  const n = ownerInput.value.trim()
  if (!n) { ownerError.value = '名前を入れてください'; return }
  if (!confirm(`オーナーの名前を「${n}」にします。過去の記録（作った人・完了した人など）の名前も変わります。よろしいですか？`)) return
  try { await updateOwnerName(n); ownerEditing.value = false; loadPresence() } catch (e) { ownerError.value = e?.message || '変えられませんでした' }
}

// 戻る: 人の画面 → 一覧 → 閉じる
function back() { if (selId.value) { selId.value = ''; ownerEditing.value = false } else emit('close') }
onUnmounted(registerInnerLayerCloser(() => { back(); return true }))
watch(selId, id => { if (id && !rows.value.some(r => r.id === id)) selId.value = '' })
</script>

<template>
  <div class="sp2">
    <header class="sp2-head">
      <button type="button" class="sp2-back" @click="back">‹ {{ sel ? 'スタッフ' : '戻る' }}</button>
      <span class="sp2-title">{{ sel ? sel.name : 'スタッフ' }}</span>
    </header>

    <!-- 一覧 -->
    <div v-if="!sel" class="sp2-body">
      <p v-if="loadError" class="sp2-err">{{ loadError }}</p>

      <!-- 招待 -->
      <section v-if="issued || inviteOpen" class="sp2-card">
        <div v-if="issued" class="sp2-issued">
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
        <template v-else>
          <label class="sp2-label" for="inv-name">名前（店で呼んでいる名前）</label>
          <input id="inv-name" v-model="invName" class="sp2-input" maxlength="30" placeholder="例：山田" />
          <div class="sp2-label">肩書き</div>
          <label v-for="r in ROLES" :key="r.key" :class="['sp2-role', { on: invRole === r.key, off: r.key === 'admin' && adminNow }]">
            <input v-model="invRole" type="radio" :value="r.key" :disabled="r.key === 'admin' && !!adminNow" />
            <span><b>{{ r.label }}</b><small>{{ r.key === 'admin' && adminNow ? `管理者は店に1人です（今は${adminNow.name}さん）` : r.note }}</small></span>
          </label>
          <p v-if="invError" class="sp2-err">{{ invError }}</p>
          <div class="sp2-row">
            <button type="button" class="sp2-btn sec" @click="inviteOpen = false">やめる</button>
            <button type="button" class="sp2-btn pri" @click="issue">招待を出す</button>
          </div>
        </template>
      </section>
      <template v-else>
        <p v-if="inviteNotice" class="sp2-notice" role="status">{{ inviteNotice }}</p>
        <button type="button" class="sp2-btn pri wide" @click="inviteOpen = true; inviteNotice = ''">＋ スタッフを招待する</button>
      </template>

      <!-- 承認待ち（その場で） -->
      <div v-for="s in pending" :key="s.id" class="sp2-pend">
        <b>{{ s.name }}さんから参加の申請<small>{{ roleLabel(s.role) }}</small></b>
        <button type="button" class="sp2-mini" :disabled="!!busy" @click="act(s, 'reject')">断る</button>
        <button type="button" class="sp2-mini pri" :disabled="!!busy" @click="act(s, 'approve')">承認</button>
      </div>

      <!-- スタッフ（いま使用中・最後に使った日時をひとつに） -->
      <div class="sp2-sec"><span>スタッフ {{ rows.length }}人</span></div>
      <div class="sp2-box">
        <button v-for="s in rows" :key="s.id" type="button" class="sp2-p" @click="openPerson(s.id)">
          <span class="sp2-av">{{ initial(s.name) }}<i :class="{ on: s.online }"></i></span>
          <span class="sp2-tx">
            <b>{{ s.name }}<template v-if="isMe(s)">（自分）</template><span :class="['sp2-rl', { adm: s.role === 'admin' }]">{{ s.owner ? 'オーナー' : roleLabel(s.role) }}</span><em v-if="s.status === 'stopped'" class="sp2-stop">ログイン停止中</em><em v-else-if="s.lockedUntil && Date.parse(s.lockedUntil) > now" class="sp2-stop">ロック中</em></b>
            <small>{{ summary(s) }}</small>
          </span>
          <span class="sp2-rt">
            <b v-if="s.online" class="sp2-on">● いま使用中</b><template v-else>{{ ago(s.lastSeenAt) }}</template>
          </span>
          <span class="sp2-ar" aria-hidden="true">›</span>
        </button>
      </div>
      <p v-if="msg" class="sp2-err">{{ msg }}</p>

      <!-- 使われていない招待 -->
      <template v-if="invites.length">
        <div class="sp2-sec"><span>まだ使われていない招待</span></div>
        <div class="sp2-box">
          <div v-for="i in invites" :key="i.id" class="sp2-p static">
            <span class="sp2-tx"><b>{{ i.name }}</b><small>{{ roleLabel(i.role) }}</small></span>
            <button type="button" class="sp2-mini" @click="revoke(i)">取り消す</button>
          </div>
        </div>
      </template>
      <p class="sp2-note">アプリを開いている間を数えています（画面を消す・別のアプリにすると止まります）。スタッフには「管理者から見える」と伝えています。<template v-if="deleted.length">削除済み {{ deleted.length }}人（記録には名前が残っています）。</template></p>
    </div>

    <!-- 人の画面: 権限・作業時間・やったこと -->
    <div v-else class="sp2-body">
      <div class="sp2-whocard">
        <span class="sp2-av big">{{ initial(sel.name) }}<i :class="{ on: sel.online }"></i></span>
        <span class="sp2-tx">
          <b>{{ sel.name }}</b>
          <small>{{ sel.owner ? 'オーナー・店を登録した人' : roleLabel(sel.role) }}<template v-if="sel.approvedAt"> ・ {{ md(sel.approvedAt) }} から</template> ・ {{ sel.online ? 'いま使用中' : `最後に使ったのは${ago(sel.lastSeenAt)}` }}</small>
        </span>
      </div>

      <!-- 暗証番号の失敗で止まっているときだけ -->
      <div v-if="lockLeft > 0" class="sp2-lockwarn">
        <span>⚠ 暗証番号を5回まちがえて止まっています（あと{{ lockLeft }}分で自動で解けます）</span>
        <button type="button" class="sp2-btn sec" :disabled="!!busy" @click="act(sel, 'unlock')">解除する</button>
      </div>

      <!-- オーナーの名前（オーナー本人だけ） -->
      <template v-if="sel.owner && !currentStaff">
        <div v-if="ownerEditing" class="sp2-card">
          <input v-model="ownerInput" class="sp2-input" maxlength="40" aria-label="オーナーの名前" />
          <p class="sp2-note">どの端末から開いても、この名前で記録されます。変えると過去の記録の名前も変わります。</p>
          <p v-if="ownerError" class="sp2-err">{{ ownerError }}</p>
          <div class="sp2-row">
            <button type="button" class="sp2-btn sec" @click="ownerEditing = false">やめる</button>
            <button type="button" class="sp2-btn pri" @click="saveOwner">名前を変える</button>
          </div>
        </div>
        <button v-else type="button" class="sp2-btn sec wide" @click="editOwner">オーナーの名前を変える</button>
      </template>

      <!-- 権限 -->
      <div class="sp2-sec">
        <span>権限</span>
        <label v-if="!sel.owner && !isMe(sel)" class="sp2-title-sel">肩書き
          <select :value="sel.role" :disabled="!!busy" :aria-label="`${sel.name}の肩書き`" @change="act(sel, 'role', { role: $event.target.value })">
            <option v-for="r in ROLES" :key="r.key" :value="r.key" :disabled="r.key === 'admin' && !!adminNow && adminNow.id !== sel.id">{{ r.label }}{{ r.key === 'admin' && adminNow && adminNow.id !== sel.id ? '（1人まで）' : '' }}</option>
          </select>
        </label>
      </div>
      <div class="sp2-box">
        <div v-for="g in GROUPS" :key="g.key" class="sp2-perm">
          <span class="sp2-tx"><b>{{ g.label }}</b><small>{{ g.note }}</small></span>
          <button
            type="button" role="switch" :class="['sp2-sw', { on: hasGroup(g.key) }]" :aria-checked="hasGroup(g.key)"
            :aria-label="`${g.label}`" :disabled="!canEditPerms || !!busy" @click="toggleGroup(g.key)"
          ></button>
        </div>
        <div class="sp2-lock">🔒 スタッフの招待・権限の付与、全品目・アカウントの削除は管理者だけ（切り替えられません）<template v-if="sel.owner || sel.role === 'admin'">。オーナーと管理者はすべての権限を持っています</template><template v-else-if="isMe(sel)">。自分の権限は変えられません</template></div>
      </div>
      <p v-if="msg" class="sp2-err">{{ msg }}</p>

      <!-- 作業時間 / やったこと -->
      <div class="sp2-tabs" role="tablist">
        <button type="button" role="tab" :aria-selected="tab === 'work'" :class="{ on: tab === 'work' }" @click="tab = 'work'">使った日</button>
        <button type="button" role="tab" :aria-selected="tab === 'actions'" :class="{ on: tab === 'actions' }" @click="tab = 'actions'">やったこと</button>
      </div>
      <p v-if="actError" class="sp2-err">{{ actError }}</p>
      <div v-else-if="!activity" class="sp2-note">読み込み中…</div>
      <div v-else-if="tab === 'work'" class="sp2-box">
        <template v-for="d in workDays" :key="d.key">
          <button type="button" class="sp2-day" :aria-expanded="openDay === d.key" @click="toggleDay(d.key)">
            <span class="sp2-tx"><b>{{ d.head }}</b><small>{{ hm(d.first) }}〜{{ hm(d.last) }} ・ 計{{ fmtMin(d.minutes) }} ・ {{ d.runs.length }}回</small></span>
            <span class="sp2-ar" aria-hidden="true">{{ openDay === d.key ? '⌃' : '⌄' }}</span>
          </button>
          <div v-if="openDay === d.key" class="sp2-runs">
            <div v-for="w in d.runs" :key="w.startedAt" class="sp2-run">{{ hm(w.startedAt) }}〜{{ hm(w.lastSeenAt) }}<span>{{ fmtMin(w.minutes) }}</span></div>
          </div>
        </template>
        <p v-if="!workDays.length" class="sp2-note pad">この{{ actDays }}日は使っていません</p>
        <p class="sp2-note pad">アプリを開いていた時間です（5分操作がないと区切ります）。勤務時間とは一致しません</p>
        <button v-if="actDays < 90" type="button" class="sp2-more" @click="moreDays">もっと見る（90日まで）</button>
      </div>
      <div v-else class="sp2-box">
        <template v-for="g in actionGroups" :key="g.head">
          <div class="sp2-dh">{{ g.head }}</div>
          <div v-for="(a, i) in g.items" :key="g.head + i" class="sp2-act">
            <time>{{ hm(a.at) }}</time><span class="sp2-k" aria-hidden="true">{{ ACT_ICON[a.kind] || '・' }}</span>
            <span class="sp2-tx">{{ a.text }}<small v-if="a.sub">{{ a.sub }}</small></span>
          </div>
        </template>
        <p v-if="!actionGroups.length" class="sp2-note pad">この{{ actDays }}日の記録はありません</p>
        <button v-if="actDays < 90" type="button" class="sp2-more" @click="moreDays">もっと見る（90日まで）</button>
      </div>

      <!-- ログインを止める／戻す・削除 -->
      <div v-if="!sel.owner && !isMe(sel)" class="sp2-foot">
        <button v-if="sel.status === 'active'" type="button" class="sp2-btn sec" :disabled="!!busy" @click="confirmStop = true">ログインを止める</button>
        <button v-else type="button" class="sp2-btn sec" :disabled="!!busy" @click="act(sel, 'resume')">ログインを戻す</button>
        <button v-if="!confirmDel" type="button" class="sp2-btn danger-sec" :disabled="!!busy" @click="confirmDel = true">削除</button>
      </div>
      <p v-if="!sel.owner && sel.status === 'stopped'" class="sp2-note">ログインを止めています。記録と権限はそのままで、「ログインを戻す」でいつでも使えます</p>
      <div v-if="confirmStop" class="sp2-card">
        <p class="sp2-note">{{ sel.name }}さんのログインを止めます。いま開いている端末からも出されます。記録と権限は残り、いつでも戻せます（辞めた人は「削除」）。</p>
        <div class="sp2-foot">
          <button type="button" class="sp2-btn sec" @click="confirmStop = false">やめる</button>
          <button type="button" class="sp2-btn" :disabled="!!busy" @click="confirmStop = false; act(sel, 'stop')">止める</button>
        </div>
      </div>
      <div v-if="confirmDel" class="sp2-card danger">
        <p class="sp2-note">{{ sel.name }}さんを削除します。ログインできなくなり、記録は「{{ sel.name }}（削除済み）」で残ります。</p>
        <div class="sp2-row">
          <button type="button" class="sp2-btn sec" @click="confirmDel = false">やめる</button>
          <button type="button" class="sp2-btn danger-sec" @click="confirmDel = false; act(sel, 'delete').then(() => { selId = '' })">削除する</button>
        </div>
      </div>
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
.sp2-owner { display: grid; gap: 6px; width: 100%; }
.sp2-item { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; padding: 8px 0; border-top: 1px solid var(--border, #eef4f6); }
.sp2-item:first-of-type { border-top: none; }
.sp2-who { display: grid; min-width: 0; }
.sp2-who b { font-size: 15px; color: var(--text, #12303a); }
.sp2-who span { font-size: 12px; color: var(--text-muted, #4c6a72); }
.sp2-lockwarn { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 12px; background: #fff7ed; border: 1px solid #fdba74; color: #9a3412; font-size: 13px; font-weight: 700; }
.sp2-lockwarn span { flex: 1; }
.sp2-stop { font-style: normal; margin-left: 6px; padding: 1px 6px; border-radius: 6px; background: #fee2e2; color: #b91c1c; font-weight: 800; }
.sp2-acts { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.sp2-acts select { min-height: 34px; border: 1px solid var(--border, #d6e6ea); border-radius: 8px; background: var(--surface, #fff); font-size: 13px; padding: 0 6px; }
.sp2-mini { min-height: 34px; padding: 0 10px; border: 1px solid var(--border, #d6e6ea); border-radius: 8px; background: var(--surface, #fff); color: var(--text, #12303a); font-size: 12.5px; font-weight: 700; cursor: pointer; }
.sp2-mini.danger { color: #b91c1c; border-color: #fecaca; }
.sp2-confirm { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 12px; color: #7f1d1d; }
.sp2-label { font-size: 12.5px; font-weight: 700; color: #3d5a62; }
.sp2-input { width: 100%; box-sizing: border-box; border: 1.5px solid #bfd6dc; border-radius: 10px; padding: 11px 12px; font-size: 16px; }
.sp2-role { display: flex; align-items: flex-start; gap: 10px; padding: 10px; border: 1px solid var(--border, #d6e6ea); border-radius: 10px; cursor: pointer; }
.sp2-role.off { opacity: .55; cursor: default; }
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
.sp2-hrow { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.sp2-days { display: flex; gap: 4px; }
.sp2-pres { border-top: 1px solid var(--border, #eef4f6); }
.sp2-pres-row { width: 100%; display: flex; align-items: center; gap: 10px; padding: 10px 0; border: none; background: none; text-align: left; cursor: pointer; color: inherit; font: inherit; }
.sp2-pres-row .sp2-who { flex: 1; }
.sp2-dot { flex: none; width: 10px; height: 10px; border-radius: 50%; background: #cbd5e1; }
.sp2-dot.on { background: #22c55e; box-shadow: 0 0 0 3px rgba(34,197,94,.2); }
.sp2-pres-r { display: grid; justify-items: end; font-size: 12px; color: var(--text-muted, #4c6a72); text-align: right; }
.sp2-pres-r small { font-size: 11.5px; }
.sp2-on { color: #15803d; font-size: 12.5px; }
.sp2-pres-list { display: grid; gap: 2px; padding: 0 0 10px 20px; }
.sp2-pres-line { display: grid; grid-template-columns: 44px 1fr auto; gap: 8px; font-size: 12.5px; color: var(--text, #12303a); font-variant-numeric: tabular-nums; }
.sp2-grants { flex-basis: 100%; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.sp2-glabel { font-size: 12px; font-weight: 700; color: var(--text-muted, #4c6a72); }
.sp2-chip { min-height: 32px; padding: 0 10px; border: 1px solid var(--border, #d6e6ea); border-radius: 999px; background: var(--surface, #fff); color: var(--text, #12303a); font-size: 12px; font-weight: 700; cursor: pointer; }
.sp2-chip.on { border-color: var(--primary, #0e7490); background: var(--primary-weak, #ecfeff); color: var(--primary, #0e7490); }

/* ── 作り直し（2026-10-15）── */
.sp2-sec { display: flex; justify-content: space-between; align-items: center; font-size: 11.5px; font-weight: 800; letter-spacing: .06em; color: var(--text-muted, #4c6a72); padding: 4px 4px 0; }
.sp2-box { background: var(--surface, #fff); border: 1px solid var(--border, #d6e6ea); border-radius: 14px; overflow: hidden; }
.sp2-p { width: 100%; display: flex; align-items: center; gap: 10px; padding: 11px 12px; border: none; border-top: 1px solid var(--border, #eef4f6); background: none; font: inherit; color: inherit; text-align: left; cursor: pointer; }
.sp2-p:first-child { border-top: none; }
.sp2-p.static { cursor: default; }
.sp2-av { position: relative; flex: none; width: 36px; height: 36px; border-radius: 50%; background: #e2eef1; color: var(--primary-deep, #155e75); display: grid; place-items: center; font-weight: 900; font-size: 15px; }
.sp2-av.big { width: 48px; height: 48px; font-size: 19px; }
.sp2-av i { position: absolute; right: -1px; bottom: -1px; width: 11px; height: 11px; border-radius: 50%; border: 2px solid #fff; background: #cbd5e1; }
.sp2-av i.on { background: #22c55e; }
.sp2-tx { flex: 1; min-width: 0; display: grid; }
.sp2-tx b { font-size: 14.5px; color: var(--text, #12303a); }
.sp2-tx small { font-size: 11.5px; color: var(--text-muted, #4c6a72); line-height: 1.45; margin-top: 1px; }
.sp2-rl { font-size: 10.5px; font-weight: 800; padding: 1px 7px; border-radius: 6px; border: 1px solid var(--border, #d6e6ea); color: var(--text-muted, #4c6a72); margin-left: 6px; vertical-align: 1px; }
.sp2-rl.adm { border-color: var(--primary, #0e7490); color: var(--primary, #0e7490); }
.sp2-rt { flex: none; text-align: right; font-size: 11.5px; color: var(--text-muted, #4c6a72); line-height: 1.45; }
.sp2-rt .sp2-on { display: block; font-size: 12px; }
.sp2-ar { flex: none; color: #94a3b8; font-weight: 900; }
.sp2-pend { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border: 1px solid #fde68a; border-radius: 12px; background: #fffbeb; }
.sp2-pend b { flex: 1; font-size: 13.5px; display: grid; } .sp2-pend b small { font-size: 11px; color: #92400e; font-weight: 700; }
.sp2-mini.pri { border: none; background: var(--primary, #0e7490); color: #fff; }
.sp2-whocard { display: flex; align-items: center; gap: 12px; padding: 14px; background: var(--surface, #fff); border: 1px solid var(--border, #d6e6ea); border-radius: 14px; }
.sp2-whocard .sp2-tx b { font-size: 17px; }
.sp2-title-sel { display: flex; align-items: center; gap: 6px; letter-spacing: 0; }
.sp2-title-sel select { min-height: 32px; border: 1px solid var(--border, #d6e6ea); border-radius: 8px; background: var(--surface, #fff); font-size: 12.5px; font-weight: 700; color: var(--text, #12303a); padding: 0 6px; }
.sp2-perm { display: flex; align-items: center; gap: 12px; padding: 12px; border-top: 1px solid var(--border, #eef4f6); }
.sp2-perm:first-child { border-top: none; }
.sp2-sw { position: relative; flex: none; width: 46px; height: 28px; border-radius: 999px; border: none; background: #cbd5e1; cursor: pointer; padding: 0; transition: background .15s; }
.sp2-sw::after { content: ''; position: absolute; left: 3px; top: 3px; width: 22px; height: 22px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.25); transition: left .15s; }
.sp2-sw.on { background: var(--primary, #0e7490); }
.sp2-sw.on::after { left: 21px; }
.sp2-sw:disabled { cursor: default; opacity: .55; }
.sp2-lock { font-size: 11.5px; color: var(--text-muted, #4c6a72); padding: 9px 12px 11px; border-top: 1px solid var(--border, #eef4f6); background: #f8fafc; line-height: 1.55; }
.sp2-tabs { display: flex; background: #e2eef1; border-radius: 10px; padding: 3px; }
.sp2-tabs button { flex: 1; min-height: 36px; border: none; background: none; border-radius: 8px; font: inherit; font-size: 13px; font-weight: 800; color: var(--text-muted, #4c6a72); cursor: pointer; }
.sp2-tabs button.on { background: var(--surface, #fff); color: var(--primary-deep, #155e75); box-shadow: 0 1px 3px rgba(0,0,0,.1); }
.sp2-dh { font-size: 11px; font-weight: 800; color: var(--text-muted, #4c6a72); padding: 8px 12px 4px; background: #f8fafc; border-top: 1px solid var(--border, #eef4f6); }
.sp2-dh:first-child { border-top: none; }
.sp2-act { display: flex; gap: 10px; align-items: flex-start; padding: 9px 12px; border-top: 1px solid var(--border, #eef4f6); font-size: 13px; }
.sp2-dh + .sp2-act { border-top: none; }
.sp2-act time { flex: none; width: 42px; font-size: 12px; font-weight: 800; color: var(--text-muted, #4c6a72); font-variant-numeric: tabular-nums; padding-top: 1px; }
.sp2-k { flex: none; width: 20px; text-align: center; }
.sp2-day { display: flex; align-items: center; gap: 10px; width: 100%; padding: 10px 12px; border: none; border-top: 1px solid var(--border, #eef4f6); background: none; text-align: left; font: inherit; color: inherit; cursor: pointer; }
.sp2-day:first-child { border-top: none; }
.sp2-day .sp2-tx b { font-size: 13.5px; }
.sp2-runs { background: #f8fafc; padding: 4px 12px 8px 24px; }
.sp2-run { display: flex; justify-content: space-between; font-size: 12.5px; padding: 3px 0; font-variant-numeric: tabular-nums; color: var(--text-muted, #4c6a72); }
.sp2-more { display: block; width: 100%; min-height: 40px; border: none; border-top: 1px solid var(--border, #eef4f6); background: none; color: var(--primary, #0e7490); font-weight: 800; font-size: 13px; cursor: pointer; }
.sp2-note.pad { padding: 12px; }
.sp2-foot { display: flex; gap: 8px; }
.sp2-foot .sp2-btn { flex: 1; }
.sp2-card.danger { border-color: #fecaca; background: #fff7f7; }
</style>
