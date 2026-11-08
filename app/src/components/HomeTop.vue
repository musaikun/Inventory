<script setup>
/**
 * トップ（ホーム）。アプリを開いて最初の画面（User決定 2026-10-07・モック docs/mocks/home-top.html）。
 * - 上部: アイコンと同じ「暗い地に光る輪」に、日付・天気（あいさつはやめて帯を低くした・User決定 2026-10-30）
 * - 今日のやること: 進み具合の輪と、気になる順の一覧（期限切れ・遅れ・止まっている・自分の・次の時刻。最大5行）。押すと業務管理
 *   （User決定 2026-11-06・モック docs/mocks/home-trim.html。並べ方は services/homeAttention.js）
 * - 店の今（HomeNowCard）: 今日の流れ（人×時間の小さなガント）と進行中（締め切りまでの棒）。User決定 2026-11-08
 * - ボードは廃止（User決定 2026-11-06）。貼り紙のデータとサーバーはそのまま（消していない）
 * - 棚卸・発注が始まっていれば、ショートカットのアイコンで知らせる（進行中のカードはやめた・User決定 2026-10-27）。
 *   だれかがルームに入っていれば「進行中」（外の輪が回る）、だれもいなければ「中断中」（光って止まっている）
 * - ショートカット: 棚卸／発注／品目リスト整理／スタッフ／データ／設定（説明文なし・User決定 2026-10-26）。
 *   在庫・業務管理・レポートは下のメニューと同じなので外した（User決定 2026-11-06）
 *   管理者には「スタッフ」も（承認待ちの数。管理から移した・User決定 2026-10-14）
 * 棚卸・発注は在庫タブの今のボタンからも始められる（両方に置く・User決定）。
 */
import LineIcon from './LineIcon.vue'
import HomeNowCard from './HomeNowCard.vue'
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { tasksOn, overdueTasks, isAssignedToMe, isMarkedByMe, pullTasks, progressTasks, isStale } from '../composables/useTasks.js'
import { checklistsForDay, pullChecklists } from '../composables/useChecklists.js'
import { homeAttention } from '../services/homeAttention.js'
import { storeName, isAuthenticated, isAdmin, can } from '../composables/useAuth.js'
import { aliveTasks } from '../composables/useTasks.js'
import { useWeather } from '../composables/useWeather.js'
import { localDateKey } from '../utils/localDate.js'
import { APP_NAME } from '../appInfo.js'
import { useSortSetup } from '../composables/useSortSetup.js'
import { useConfig } from '../composables/useConfig.js'
import { STORAGE_KEYS } from '../utils/storageKeys.js'

const props = defineProps({
  activeSession:      { type: Object, default: null },
  activeOrderSession: { type: Object, default: null },
  orderDeadline:      { type: String, default: '' },   // 今日が発注日なら締切（'' は発注日でない）
  isOrderDay:         { type: Boolean, default: false },
  reorderCount:       { type: Number, default: 0 },
  startingKind:       { type: String, default: null },
  live:               { type: Object, default: null },   // 棚卸のルームの状態（このセッションのときだけ）。人がいれば「進行中」
  liveOrder:          { type: Object, default: null },
})
const emit = defineEmits(['go', 'stock', 'order', 'resume', 'openTodo'])

onMounted(() => { pullTasks(); pullChecklists() })

// ── 日付（あいさつは出さない・User決定 2026-10-30）──
const now = new Date()
const WEEK = ['日', '月', '火', '水', '木', '金', '土']
const dateLabel = `${now.getMonth() + 1}月${now.getDate()}日（${WEEK[now.getDay()]}）`

const { state: weatherState } = useWeather()
const today = localDateKey()
const wx = computed(() => {
  const w = weatherState.weather?.[today]
  if (!w) return null
  const t = w.tempHi != null ? `${Math.round(w.tempHi)}°` : ''
  const pop = w.pop != null ? `降水 ${w.pop}%` : ''
  return { icon: w.icon, text: [t, weatherState.loc?.name || '', pop].filter(Boolean).join(' ・ ') }   // アイコンは線のアイコンで（2026-11-05）
})

// ── 今日のやること ──
const todays = computed(() => tasksOn(today))
const late = computed(() => overdueTasks(today))
const doneOf = t => !!t.doneAt   // 「全員」は全員の印がそろったときにサーバーが doneAt を立てる
const doneCount = computed(() => todays.value.filter(doneOf).length)
const total = computed(() => todays.value.length)
const R = 24, C = 2 * Math.PI * R
const dash = computed(() => (total.value ? `${(doneCount.value / total.value) * C} ${C}` : `0 ${C}`))
// 気になる順の一覧（今の時刻は1分ごとに更新して、遅れを数え直す）
const nowHm = ref('')
const _tickNow = () => { const d = new Date(); nowHm.value = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }
_tickNow()
let _nowTimer = null
onMounted(() => { _nowTimer = setInterval(_tickNow, 60_000) })
onUnmounted(() => clearInterval(_nowTimer))
const attention = computed(() => homeAttention({
  today: todays.value,
  overdue: late.value,
  stale: progressTasks.value.filter(isStale),
  checklists: checklistsForDay(today),
  now: nowHm.value,
  isMine: isAssignedToMe,
  isDone: t => (t.assign === 'all' ? isMarkedByMe(t) || !!t.doneAt : !!t.doneAt),
}))
const COUNT_LABELS = [['over', '期限切れ', 'l'], ['late', '遅れ', 'l'], ['stuck', '止まっている', 's'], ['mine', '自分の', 'm']]
const countChips = computed(() => COUNT_LABELS.map(([k, label, cls]) => ({ k, label, cls, n: attention.value.counts[k] })).filter(c => c.n))

// 承認待ち（参加申請のやることのうち、まだ決まっていないもの）
const joinWaiting = computed(() => aliveTasks.value.filter(t => t.kind === 'staff_join' && !t.doneAt).length)

// ── ショートカット ──
const { axesProgress, freeSlot, openSortAxis, addSortAxis, routeStats, openRoute } = useSortSetup()
const { moveAxisToRoute } = useConfig()
// 品目リスト整理 = 棚卸の導線（店に1つ）と、品目並び替え（仕入先など2つまで）の2つに分ける（User決定 2026-10-30）
const hasRoute = computed(() => routeStats.value.places.length > 0)
const routeLabel = computed(() => {
  const p = routeStats.value.places
  return p.length > 3 ? `${p.slice(0, 3).join(' → ')} → …（${p.length}か所）` : p.join(' → ')
})
// 今の並び替えに「保管場所」のような分け方があれば、導線へ移すか1回だけ訊く（この端末で）
const PLACE_RE = /保管|場所|棚|ロケーション|置き場|location/i
const migrateFrom = computed(() => (hasRoute.value ? null : axesProgress.value.find(a => PLACE_RE.test(a.name)) || null))
const _asked = () => { try { return localStorage.getItem(STORAGE_KEYS.routeMigrateAsked) === '1' } catch (_) { return true } }
const _markAsked = () => { try { localStorage.setItem(STORAGE_KEYS.routeMigrateAsked, '1') } catch (_) {} }
function answerMigrate(move) {
  if (move && migrateFrom.value) moveAxisToRoute(migrateFrom.value.idx)
  _markAsked()
  sheet.value = 'sort'
}
const sheet = ref('')   // '' | 'sort'（導線か並び替えか）| 'cls'（品目並び替え）| 'migrate' | 'data'
function pickSheet(fn) { sheet.value = ''; fn() }
const sheetTitle = computed(() => ({ sort: '品目リスト整理', cls: '品目並び替え', migrate: '導線にしますか？', data: 'データ' })[sheet.value] || '')
const newAxis = ref('')   // 分類がまだ無いときの名前の入力
const AXIS_EXAMPLES = ['仕入先', '用途', '温度帯']
function addFirstAxis() {
  const n = newAxis.value.trim()
  if (n) pickSheet(() => addSortAxis(n))
}
// 始まっている棚卸・発注: だれかがルームに入っていれば進行中、いなければ中断中
const _inRoom = room => (room?.participants?.length ?? 0) > 0
const stockLive = computed(() => !!props.activeSession && _inRoom(props.live))
const orderLive = computed(() => !!props.activeOrderSession && _inRoom(props.liveOrder))
const _runBadge = (live, kind) => ({ text: live ? '進行中' : '中断中', kind: live ? `${kind} live` : kind })
const shortcuts = computed(() => [
  { key: 'stock', label: '棚卸', run: !!props.activeSession, live: stockLive.value,
    badge: props.activeSession ? _runBadge(stockLive.value, 'cy') : null,
    d: ['M9 4h6v3H9zM7 5H5v15h14V5h-2', 'M8 12l2.5 2.5L16 9'] },
  { key: 'order', label: '発注', ord: true, run: !!props.activeOrderSession, live: orderLive.value,
    badge: props.activeOrderSession ? _runBadge(orderLive.value, 'or') : (props.orderDeadline ? { text: props.orderDeadline, kind: 'or' } : null),
    d: ['M6 3h12v18l-3-2-3 2-3-2-3 2z', 'M9 8h6M9 12h6'] },
  // 品目リスト整理（並び替え）。名前は「数える順」から変えた（ぱっと見て意味が分からない・User決定 2026-10-28）。在庫タブから移した。振り分けが終わるまで残りの数を出す（光らせると棚卸の中断中と紛れるので印だけ・User決定 2026-10-27）
  // 印は導線のこと: まだ無ければ「まだ」、あって入っていない品目があればその数（品目を足したら気づける・User決定 2026-10-30）
  ...(can('sort') ? [{ key: 'sort', label: '品目リスト整理',
    badge: !routeStats.value.total ? null
      : !hasRoute.value ? { text: 'まだ', kind: 'cy' }
      : routeStats.value.missing ? { text: `導線 ${routeStats.value.missing}`, kind: 'red' } : null,
    d: ['M4 6h10M4 12h16M4 18h7', 'M17 15l3 3-3 3'] }] : []),
  ...(isAuthenticated.value && isAdmin.value ? [{
    key: 'staff', label: 'スタッフ',
    badge: joinWaiting.value ? { text: String(joinWaiting.value), kind: 'red' } : null, hot: !!joinWaiting.value,
    d: ['M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M2 21v-1a6 6 0 0 1 12 0v1', 'M16 3.5a4 4 0 0 1 0 7M22 21v-1a6 6 0 0 0-4-5.6'],
  }] : []),
  // 取り込む・書き出すは1枚の「データ」にまとめ、押すと2択（数える順を入れて9枚に収める・User決定 2026-10-26）
  ...(can('item.admin') ? [{ key: 'data', label: 'データ', d: ['M8 4v12', 'M4 12l4 4 4-4', 'M16 20V8', 'M12 12l4-4 4 4'] }] : []),
  { key: 'dashboard', label: '設定',
    d: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z'] },
])
function onShortcut(k) {
  // 分類がまだ1つも無ければ、並び方の説明と名前の入力を出す（User決定 2026-10-28）
  if (k === 'sort') { newAxis.value = ''; sheet.value = migrateFrom.value && !_asked() ? 'migrate' : 'sort'; return }
  if (k === 'data') { sheet.value = 'data'; return }
  if (k === 'stock') { props.activeSession ? emit('resume', props.activeSession) : emit('stock'); return }
  if (k === 'order') { props.activeOrderSession ? emit('resume', props.activeOrderSession) : emit('order'); return }
  emit('go', k)
}
const gid = `ht-${Math.random().toString(36).slice(2, 8)}`
</script>

<template>
  <div class="ht">
    <section class="ht-hero">
      <div class="ht-glow" aria-hidden="true"></div>
      <svg class="ht-ring" width="300" height="230" viewBox="0 0 300 230" aria-hidden="true">
        <defs>
          <linearGradient :id="gid" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#2563eb" /><stop offset=".55" stop-color="#22d3ee" /><stop offset="1" stop-color="#34d399" /></linearGradient>
          <filter :id="`${gid}-b`"><feGaussianBlur stdDeviation="3" /></filter>
        </defs>
        <ellipse cx="150" cy="120" rx="120" ry="58" transform="rotate(-18 150 120)" fill="none" :stroke="`url(#${gid})`" stroke-width="9" opacity=".55" :filter="`url(#${gid}-b)`" />
        <ellipse cx="150" cy="120" rx="120" ry="58" transform="rotate(-18 150 120)" fill="none" :stroke="`url(#${gid})`" stroke-width="3.5" />
        <!-- 輪の上を光が流れる（短い明るい線を輪に沿って回す） -->
        <ellipse class="ht-spark" cx="150" cy="120" rx="120" ry="58" transform="rotate(-18 150 120)" fill="none" stroke="#e0fdff" stroke-width="3.5" stroke-linecap="round" pathLength="100" :filter="`url(#${gid}-b)`" />
        <ellipse class="ht-spark core" cx="150" cy="120" rx="120" ry="58" transform="rotate(-18 150 120)" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" pathLength="100" />
        <!-- 重なったカードがゆっくり浮き沈みする（少しずつずらして） -->
        <g opacity=".85">
          <g class="ht-card c1"><rect x="150" y="56" width="34" height="48" rx="6" transform="skewY(-12)" fill="rgba(165,243,252,.22)" stroke="rgba(165,243,252,.7)" stroke-width="1.2" /></g>
          <g class="ht-card c2"><rect x="172" y="44" width="34" height="48" rx="6" transform="skewY(-12)" fill="rgba(110,231,183,.25)" stroke="rgba(110,231,183,.8)" stroke-width="1.2" /></g>
          <g class="ht-card c3"><rect x="194" y="32" width="34" height="48" rx="6" transform="skewY(-12)" fill="rgba(52,211,153,.3)" stroke="rgba(167,243,208,.9)" stroke-width="1.2" /></g>
        </g>
      </svg>
      <div class="ht-top">
        <svg width="24" height="24" viewBox="0 0 40 40" aria-hidden="true"><ellipse cx="20" cy="20" rx="16" ry="10" transform="rotate(-18 20 20)" fill="none" :stroke="`url(#${gid})`" stroke-width="3.4" /></svg>
        <span class="ht-brand">{{ APP_NAME }}</span>
        <span v-if="storeName" class="ht-store">{{ storeName }}</span>
      </div>
      <div class="ht-hi">
        <b>{{ dateLabel }}</b>
        <span v-if="wx" class="ht-wx"><LineIcon :name="wx.icon" /> {{ wx.text }}</span>
      </div>
    </section>

    <button type="button" class="ht-today" aria-label="業務管理を開く" @click="emit('openTodo')">
      <span class="ht-th">
        <span class="ht-pr" aria-hidden="true">
          <svg width="56" height="56" viewBox="0 0 56 56">
            <circle cx="28" cy="28" :r="R" fill="none" stroke="#e2eef1" stroke-width="6" />
            <circle cx="28" cy="28" :r="R" fill="none" :stroke="`url(#${gid})`" stroke-width="6" stroke-linecap="round" :stroke-dasharray="dash" transform="rotate(-90 28 28)" />
          </svg>
          <span>{{ doneCount }}/{{ total }}<small>完了</small></span>
        </span>
        <span class="ht-tx">
          <span class="ht-tt">今日のやること<i>業務管理を開く ›</i></span>
          <span class="ht-cnt">
            <span v-for="c in countChips" :key="c.k" :class="c.cls">{{ c.label }} {{ c.n }}</span>
            <span v-if="!countChips.length" class="m">気になるものはありません</span>
          </span>
        </span>
      </span>
      <span v-if="attention.rows.length" class="ht-rows">
        <span v-for="r in attention.rows" :key="r.key" :class="['ht-rw', { me: r.mine }]" :data-kind="r.kind">
          <em :class="r.kind">{{ r.tag }}</em><span>{{ r.text }}</span><small>{{ r.side }}</small>
        </span>
      </span>
      <span v-else class="ht-none">{{ total ? 'ぜんぶ終わりました' : '今日のやることはありません' }}</span>
      <span v-if="attention.more" class="ht-more">ほか {{ attention.more }}件</span>
    </button>

    <!-- 店の今（今日の流れ・進行中。User決定 2026-11-08） -->
    <HomeNowCard @open="emit('openTodo')" />


    <div class="ht-sec">ショートカット</div>
    <div class="ht-grid">
      <button
        v-for="s in shortcuts" :key="s.key" type="button" :class="['ht-sc', { hot: s.hot, ord: s.ord, run: s.run, live: s.live }]"
        :aria-label="s.run ? `${s.label}（${s.badge.text}）を続ける` : undefined"
        :disabled="(s.key === 'stock' && startingKind === 'stock') || (s.key === 'order' && startingKind === 'order')"
        @click="onShortcut(s.key)"
      >
        <span v-if="s.badge" :class="['ht-bd', s.badge.kind]">{{ s.badge.text }}</span>
        <span class="ht-ic" aria-hidden="true">
          <template v-if="s.live"><i class="ht-halo"></i><i class="ht-spin"></i></template>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path v-for="d in s.d" :key="d" :d="d" /></svg>
        </span>
        <b>{{ s.label }}</b>
      </button>
    </div>

    <Teleport to="body">
      <div v-if="sheet" class="ht-sh-bg" @click.self="sheet = ''">
        <section class="ht-sh" :aria-label="sheetTitle">
          <div class="ht-sh-h">
            <button v-if="sheet === 'cls'" type="button" class="ht-sh-back" aria-label="戻る" @click="sheet = 'sort'">‹</button>
            <b>{{ sheetTitle }}</b><button type="button" aria-label="閉じる" @click="sheet = ''">✕</button>
          </div>
          <template v-if="sheet === 'migrate'">
            <p class="ht-sh-ex">
              これからは、棚卸で歩く順番は<b>導線</b>、仕入先などのまとまりは<b>品目並び替え</b>として分けます。<br>
              今の並び替え「{{ migrateFrom?.name }}」は、棚卸で歩く順番ですか？
            </p>
            <button type="button" class="ht-sh-b route" @click="answerMigrate(true)"><b>導線にする</b><small>場所・振り分け・並び順はそのまま移ります</small></button>
            <button type="button" class="ht-sh-b" @click="answerMigrate(false)"><b>並び替えのまま</b><small>導線は別に作ります</small></button>
          </template>
          <template v-else-if="sheet === 'sort'">
            <button type="button" class="ht-sh-b route" @click="pickSheet(() => openRoute())">
              <b><LineIcon name="route" /> 導線作成</b>
              <small v-if="hasRoute">{{ routeLabel }}</small>
              <small v-else>棚卸で歩く順番。場所ごとに品目を入れ、その順で数えます</small>
              <span v-if="hasRoute" class="ht-sh-bar" aria-hidden="true"><span :style="{ width: (routeStats.total ? routeStats.done / routeStats.total * 100 : 0) + '%' }"></span></span>
              <small v-if="hasRoute && routeStats.more" class="more">2か所以上の途中 {{ routeStats.more }}品目</small>
            </button>
            <button v-if="hasRoute && routeStats.missing" type="button" class="ht-sh-alert" @click="pickSheet(() => openRoute({ unassigned: true }))">
              導線に入っていない品目 {{ routeStats.missing }}<span>入れる ›</span>
            </button>
            <button type="button" class="ht-sh-b" @click="sheet = 'cls'">
              <b>⇅ 品目並び替え</b>
              <small v-if="axesProgress.length">{{ axesProgress.map(a => `${a.name} ${a.assigned} / ${a.total}`).join(' ・ ') }}</small>
              <small v-else>仕入先・用途などのまとまり。発注書の分け方や一覧の絞り込みに</small>
            </button>
          </template>
          <form v-else-if="sheet === 'cls' && !axesProgress.length" class="ht-sh-new" @submit.prevent="addFirstAxis">
            <p class="ht-sh-ex">
              品目を<b>仕入先</b>や<b>用途</b>などでまとめます。発注書を仕入先ごとに分けたり、一覧を絞ったりするのに使います。<br>
              棚卸で歩く順番は「導線作成」で作ります。並び替えは2つまで作れます。
            </p>
            <label class="ht-sh-lb">分類の名前<input v-model="newAxis" type="text" maxlength="20" placeholder="例：保管場所" class="ht-sh-in" /></label>
            <div class="ht-sh-chips">
              <button v-for="x in AXIS_EXAMPLES" :key="x" type="button" :class="{ on: newAxis === x }" @click="newAxis = x">{{ x }}</button>
            </div>
            <button type="submit" class="ht-sh-b add" :disabled="!newAxis.trim()"><b>＋ 分類を追加</b></button>
          </form>
          <template v-else-if="sheet === 'cls'">
            <button v-for="a in axesProgress" :key="a.idx" type="button" class="ht-sh-b" @click="pickSheet(() => openSortAxis(a.idx))">
              <b>{{ a.name }}</b>
              <span class="ht-sh-bar" aria-hidden="true"><span :style="{ width: (a.total ? a.assigned / a.total * 100 : 0) + '%' }"></span></span>
              <small :class="{ ok: a.assigned >= a.total }">{{ a.assigned >= a.total ? 'そろっています' : `${a.assigned} / ${a.total} 品目` }}</small>
            </button>
            <button v-if="freeSlot >= 0" type="button" class="ht-sh-b add" @click="pickSheet(() => addSortAxis())"><b>＋ 分類を追加</b></button>
          </template>
          <template v-else>
            <button type="button" class="ht-sh-b" @click="pickSheet(() => emit('go', 'import'))"><b>取り込む</b><small>品目・納品・棚卸</small></button>
            <button type="button" class="ht-sh-b" @click="pickSheet(() => emit('go', 'export'))"><b>書き出す</b><small>品目・棚卸結果</small></button>
          </template>
        </section>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.ht { padding-bottom: 24px; }
.ht-hero { position: relative; min-height: 168px; padding: 16px 18px 76px; color: #e6fbff; overflow: hidden;
  background: radial-gradient(120% 90% at 85% 10%, #0f4c5c 0%, #0a3340 45%, #06222b 100%); }
.ht-ring { position: absolute; right: -80px; top: -6px; opacity: .9; pointer-events: none; }
.ht-glow { position: absolute; right: 10px; top: -16px; width: 140px; height: 140px; border-radius: 50%; background: radial-gradient(circle, rgba(34,211,238,.35), transparent 70%); filter: blur(6px); pointer-events: none;
  animation: ht-breathe 5s ease-in-out infinite; }
/* 上部のイメージの動き（アイコンの光る輪）。動きを減らす設定の端末では止める */
.ht-spark { stroke-dasharray: 7 93; animation: ht-orbit 6s linear infinite; opacity: .9; }
.ht-spark.core { opacity: 1; }
.ht-card { transform-box: fill-box; transform-origin: center; animation: ht-float 4.8s ease-in-out infinite; }
.ht-card.c2 { animation-delay: -1.6s; }
.ht-card.c3 { animation-delay: -3.2s; }
@keyframes ht-orbit { from { stroke-dashoffset: 100; } to { stroke-dashoffset: 0; } }
@keyframes ht-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
@keyframes ht-breathe { 0%, 100% { opacity: .75; transform: scale(1); } 50% { opacity: 1; transform: scale(1.12); } }
@media (prefers-reduced-motion: reduce) {
  .ht-spark, .ht-card, .ht-glow { animation: none; }
  .ht-spark { display: none; }
}
.ht-top { position: relative; display: flex; align-items: center; gap: 8px; }
.ht-brand { font-weight: 900; letter-spacing: .08em; font-size: 15px; }
.ht-store { font-size: 11px; font-weight: 700; padding: 3px 9px; border-radius: 999px; background: rgba(255,255,255,.1); border: 1px solid rgba(255,255,255,.18); max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ht-hi { position: relative; margin-top: 14px; }
.ht-hi b { display: block; font-size: 18px; font-weight: 800; letter-spacing: .04em; line-height: 1.35; }
.ht-wx { display: inline-block; margin-top: 8px; font-size: 12px; color: #bfeaf2; }

.ht-today { position: relative; z-index: 1; width: calc(100% - 28px); margin: -64px 14px 0; border: none; text-align: left; font: inherit; color: var(--text);
  background: rgba(255,255,255,.97); border-radius: 20px; padding: 14px; box-shadow: 0 10px 28px rgba(6,34,43,.18); display: grid; gap: 10px; cursor: pointer; }
.ht-th { display: flex; gap: 12px; align-items: center; }
.ht-pr { flex: none; position: relative; width: 56px; height: 56px; }
.ht-pr > span { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; font-weight: 900; font-size: 14px; line-height: 1.1; }
.ht-pr small { font-size: 9px; color: var(--text-muted); font-weight: 700; }
.ht-tx { flex: 1; min-width: 0; display: grid; gap: 5px; }
.ht-tt { font-size: 13px; font-weight: 800; color: var(--text-muted); display: flex; justify-content: space-between; gap: 6px; }
.ht-tt i { font-style: normal; color: var(--primary); white-space: nowrap; }
.ht-cnt { display: flex; gap: 5px; flex-wrap: wrap; }
.ht-cnt span { font-size: 11px; font-weight: 900; border-radius: 999px; padding: 2px 8px; }
.ht-cnt .l { background: #fef2f2; color: #b91c1c; }
.ht-cnt .s { background: #fffbeb; color: #b45309; }
.ht-cnt .m { background: #ecfeff; color: var(--primary); }
.ht-rows { display: grid; border-top: 1px solid #e2ecef; }
.ht-rw { display: grid; grid-template-columns: 70px minmax(0, 1fr) auto; gap: 8px; align-items: baseline; padding: 8px 0 7px; border-bottom: 1px solid #e2ecef; font-size: 13px; }
.ht-rw:last-child { border-bottom: none; padding-bottom: 0; }
.ht-rw em { font-style: normal; font-size: 10.5px; font-weight: 900; border-radius: 6px; padding: 1px 0; text-align: center; color: var(--primary); white-space: nowrap; overflow: hidden; }
.ht-rw em.over { background: #b91c1c; color: #fff; }
.ht-rw em.late { background: #fef2f2; color: #b91c1c; }
.ht-rw em.stuck { background: #fffbeb; color: #b45309; }
.ht-rw em.mine { background: #ecfeff; }
.ht-rw > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 700; }
.ht-rw small { font-size: 11px; color: var(--text-muted); font-weight: 800; white-space: nowrap; }
.ht-rw.me > span { color: var(--primary); }
.ht-more { font-size: 11.5px; font-weight: 800; color: var(--primary); text-align: center; }
.ht-none { font-size: 13px; color: var(--text-muted); font-weight: 700; text-align: center; padding: 4px 0 2px; }


.ht-sec { margin: 16px 18px 8px; font-size: 11px; font-weight: 800; letter-spacing: .1em; color: var(--text-muted); }
.ht-grid { margin: 0 14px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.ht-sc { position: relative; border: none; font: inherit; color: var(--text); background: var(--surface); border-radius: 18px; padding: 14px 4px 11px; text-align: center; box-shadow: 0 1px 4px rgba(0,0,0,.05); cursor: pointer; min-width: 0; }
.ht-sc:disabled { opacity: .6; }
.ht-ic { width: 44px; height: 44px; margin: 0 auto 7px; border-radius: 14px; display: grid; place-items: center; color: var(--primary); background: linear-gradient(145deg, #ecfeff, #e0f2fe); }
.ht-sc.hot .ht-ic { color: #fff; background: linear-gradient(145deg, #0e7490, #0b3b48); box-shadow: 0 0 0 2px rgba(34,211,238,.35), 0 6px 14px rgba(14,116,144,.35); }
.ht-sc.ord .ht-ic { color: #c2410c; background: linear-gradient(145deg, #fff7ed, #ffedd5); }
/* 始まっている棚卸・発注: 光る（中断中は止まったまま、進行中は外の輪が回って後ろが脈打つ） */
.ht-ic { position: relative; }
.ht-ic svg { position: relative; }
.ht-sc.run .ht-ic { color: #fff; background: linear-gradient(145deg, #0e7490, #0b3b48); box-shadow: 0 0 0 2px rgba(34,211,238,.35), 0 6px 14px rgba(14,116,144,.35); }
.ht-sc.ord.run .ht-ic { background: linear-gradient(145deg, #ea580c, #9a3412); box-shadow: 0 0 0 2px rgba(251,146,60,.35), 0 6px 14px rgba(234,88,12,.35); }
.ht-halo { position: absolute; inset: -9px; border-radius: 20px; background: radial-gradient(closest-side, rgba(34,211,238,.55), rgba(52,211,153,.2) 65%, transparent); animation: ht-pulse 1.8s ease-in-out infinite; }
.ht-spin { position: absolute; inset: -5px; border-radius: 18px; padding: 2px; background: conic-gradient(from 0deg, transparent 0 55%, #22d3ee 75%, #34d399 90%, transparent);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor; mask-composite: exclude; animation: ht-spin 2.4s linear infinite; }
.ht-sc.ord .ht-halo { background: radial-gradient(closest-side, rgba(251,146,60,.55), rgba(251,191,36,.2) 65%, transparent); }
.ht-sc.ord .ht-spin { background: conic-gradient(from 0deg, transparent 0 55%, #fb923c 75%, #fbbf24 90%, transparent); }
@keyframes ht-pulse { 0%, 100% { opacity: .55; transform: scale(1); } 50% { opacity: 1; transform: scale(1.12); } }
@keyframes ht-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .ht-halo, .ht-spin { animation: none; } }
.ht-sc b { font-size: 12.5px; display: block; }
.ht-sh-bg { position: fixed; inset: 0; z-index: 60; background: rgba(6,34,43,.42); display: flex; align-items: flex-end; }
.ht-sh { width: 100%; box-sizing: border-box; background: var(--surface, #fff); border-radius: 22px 22px 0 0; padding: 14px 16px calc(22px + env(safe-area-inset-bottom)); display: grid; gap: 10px; }
.ht-sh-h { display: flex; align-items: center; }
.ht-sh-h b { flex: 1; font-size: 16px; }
.ht-sh-h button { border: none; background: none; font-size: 16px; color: var(--text-muted); cursor: pointer; min-width: 40px; min-height: 40px; }
.ht-sh-b { display: grid; gap: 4px; text-align: left; border: none; border-radius: 14px; background: #f2fafc; padding: 14px; font: inherit; color: var(--text); cursor: pointer; }
.ht-sh-b b { font-size: 15px; }
.ht-sh-b small { font-size: 11.5px; font-weight: 700; color: var(--text-muted); }
.ht-sh-b small.ok { color: #17663a; }
.ht-sh-b.add { background: none; border: 1.5px dashed #9ccfdb; color: #0b5f73; }
.ht-sh-b.route { background: #f5f3ff; box-shadow: inset 0 0 0 2px #7c3aed; }
.ht-sh-b.route b { color: #6d28d9; }
.ht-sh-b.route .ht-sh-bar span { background: #7c3aed; }
.ht-sh-b small.more { color: #b45309; }
.ht-sh-alert { display: flex; justify-content: space-between; align-items: center; border: none; border-radius: 12px; background: #fef2f2; color: #b91c1c; font: inherit; font-size: 13px; font-weight: 800; padding: 11px 14px; cursor: pointer; margin-top: -4px; }
.ht-sh-h .ht-sh-back { font-size: 24px; line-height: 1; min-width: 32px; text-align: left; padding: 0; }
.ht-sh-new { display: grid; gap: 10px; }
.ht-sh-ex { margin: 0; font-size: 13px; line-height: 1.7; color: var(--text); background: #f2fafc; border-radius: 12px; padding: 12px; }
.ht-sh-lb { display: grid; gap: 4px; font-size: 12px; font-weight: 800; color: var(--text-muted); }
.ht-sh-in { font-size: 16px; padding: 10px 12px; border: 1.5px solid #c9dde3; border-radius: 10px; }
.ht-sh-chips { display: flex; gap: 6px; flex-wrap: wrap; }
.ht-sh-chips button { min-height: 36px; border: 1px solid #c9dde3; background: #fff; border-radius: 999px; padding: 0 12px; font-size: 13px; font-weight: 700; color: #0b5f73; cursor: pointer; }
.ht-sh-chips button.on { border-color: #0b5f73; box-shadow: inset 0 0 0 1px #0b5f73; }
.ht-sh-new .ht-sh-b.add { text-align: center; }
.ht-sh-new .ht-sh-b.add:disabled { opacity: .45; cursor: default; }
.ht-sh-bar { height: 6px; border-radius: 3px; background: #dbeef2; overflow: hidden; }
.ht-sh-bar span { display: block; height: 100%; background: #0e7490; }
.ht-bd { position: absolute; z-index: 2; top: 8px; right: 8px; font-size: 9.5px; font-weight: 800; border-radius: 999px; padding: 1px 6px; }
.ht-bd.red { background: #fee2e2; color: #b91c1c; }
.ht-bd.cy { background: #cffafe; color: var(--primary-deep); }
.ht-bd.or { background: #ffedd5; color: #c2410c; }
.ht-bd.cy.live { background: #0e7490; color: #fff; }
.ht-bd.or.live { background: #ea580c; color: #fff; }
</style>
