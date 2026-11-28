<script setup>
/**
 * トップ（ホーム）。アプリを開いて最初の画面（User決定 2026-10-07・モック docs/mocks/home-top.html）。
 * - 上部: アイコンと同じ「暗い地に光る輪」に、日付・天気（あいさつはやめて帯を低くした・User決定 2026-10-30）
 * - 本日の状況: 輪（本日の分の済み）と、今日のやること・定期・期限切れ・持ち越し・進行中を同じ形の進み具合の棒で1列に
 *   （済んだものは出さない。札は 遅れ／本日まで／明日まで だけ。進行中は「予定ではここまで」の印）。
 *   以前の「今日のやること」と「店の今」を1枚にした（User決定 2026-11-12・D-042・モック docs/mocks/home-status.html。並べ方は services/homeStatus.js）
 * - ボードは廃止（User決定 2026-11-06）。貼り紙のデータとサーバーはそのまま（消していない）
 * - 棚卸・発注が始まっていれば、ショートカットのアイコンで知らせる（進行中のカードはやめた・User決定 2026-10-27）。
 *   だれかがルームに入っていれば「進行中」（外の輪が回る）、だれもいなければ「中断中」（光って止まっている）
 * - メニュー（以前のショートカット）: 業務／在庫／棚卸／発注／品目リスト整理／スタッフ／データ／レポート／設定（説明文なし・User決定 2026-10-26）。
 *   下のタブはやめ、業務・在庫もここから開く（D-047・User決定 2026-11-28）。レポート・設定もここから（2026-11-27）
 *   管理者には「スタッフ」も（承認待ちの数。管理から移した・User決定 2026-10-14）
 * 棚卸・発注は在庫タブの今のボタンからも始められる（両方に置く・User決定）。
 */
import LineIcon from './LineIcon.vue'
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import AppMark from './AppMark.vue'
import { tasksOn, eventsOn, overdueTasks, carriedTasks, isMarkedByMe, pullTasks, progressTasks, newTasks, todayOpenCount } from '../composables/useTasks.js'
import { checklistsForDay, pullChecklists } from '../composables/useChecklists.js'
import { homeStatus } from '../services/homeStatus.js'
import { buildDayTimeline } from '../services/dayTimeline.js'
import { storeName, isAuthenticated, isAdmin, can, canSeeReport } from '../composables/useAuth.js'
import { aliveTasks } from '../composables/useTasks.js'
import { useWeather } from '../composables/useWeather.js'
import { ringColors, seasonMotifs, DEFAULT_RING } from '../services/seasonBg.js'
import { seasonBgOn } from '../composables/useSeasonBg.js'
import { localDateKey } from '../utils/localDate.js'
import { APP_NAME } from '../appInfo.js'
import { useSortSetup } from '../composables/useSortSetup.js'
import { useConfig } from '../composables/useConfig.js'
import { STORAGE_KEYS } from '../utils/storageKeys.js'
import { useMovements } from '../composables/useMovements.js'
import { useHistory } from '../composables/useHistory.js'

const props = defineProps({
  activeSession:      { type: Object, default: null },
  activeOrderSession: { type: Object, default: null },
  orderDeadline:      { type: String, default: '' },   // 今日が発注日なら締切（'' は発注日でない）
  isOrderDay:         { type: Boolean, default: false },
  reorderCount:       { type: Number, default: 0 },
  startingKind:       { type: String, default: null },
  live:               { type: Object, default: null },   // 棚卸のルームの状態（このセッションのときだけ）。人がいれば「進行中」
  liveOrder:          { type: Object, default: null },
  // 品目がまだ1つも無い店（登録した直後）。最初の一歩をホームに出す（User 2026-11-13）
  firstRun:           { type: Boolean, default: false },
  // 業務・在庫などがホームの上に重なっているとき（背景の動きを止める）
  covered:            { type: Boolean, default: false },
})
const emit = defineEmits(['go', 'stock', 'order', 'resume', 'openTodo', 'openBoard', 'openItem', 'firstImport', 'firstCount'])

onMounted(() => { pullTasks(); pullChecklists() })

// ── 日付（あいさつは出さない・User決定 2026-10-30）──
const now = new Date()
const WEEK = ['日', '月', '火', '水', '木', '金', '土']
const dateLabel = `${now.getMonth() + 1}/${now.getDate()}（${WEEK[now.getDay()]}）`

const { state: weatherState } = useWeather()
const today = localDateKey()
const wx = computed(() => {
  const w = weatherState.weather?.[today]
  if (!w) return null
  const t = w.tempHi != null ? `${Math.round(w.tempHi)}°` : ''
  const pop = w.pop != null ? `降水 ${w.pop}%` : ''
  // 上部は1行なので気温だけ出す。全部（地名・降水）は押さえたときの説明に（User決定 2026-11-28）
  return { icon: w.icon, short: t, text: [t, weatherState.loc?.name || '', pop].filter(Boolean).join(' ・ ') }   // アイコンは線のアイコンで（2026-11-05）
})

// ── 今日のやること ──
const todays = computed(() => tasksOn(today))
const late = computed(() => overdueTasks(today))
// 輪の数は業務管理の日の輪と同じ数え方（やること＋ルーティン。進行中・いつかは数えない・User 2026-11-10）
const ring = computed(() => buildDayTimeline({
  date: today, today, tasks: todays.value.filter(t => !t.progress), lists: checklistsForDay(today),
  late: late.value, carry: carriedTasks(today),
}))
const doneCount = computed(() => ring.value.done)
const total = computed(() => ring.value.count)
const R = 24, C = 2 * Math.PI * R
const dash = computed(() => (total.value ? `${(doneCount.value / total.value) * C} ${C}` : `0 ${C}`))
// 気になる順の一覧（今の時刻は1分ごとに更新して、遅れを数え直す）
const nowHm = ref('')
const _tickNow = () => { const d = new Date(); nowHm.value = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }
_tickNow()
let _nowTimer = null
onMounted(() => { _nowTimer = setInterval(_tickNow, 60_000) })
onUnmounted(() => clearInterval(_nowTimer))

// ── 背景の月ごとの色とモチーフ（User決定 2026-11-28）。南半球・季節の無い地域は天気の位置（緯度）で決める ──
const _lat = computed(() => (typeof weatherState.loc?.lat === 'number' ? weatherState.loc.lat : null))
const bgRing = computed(() => (seasonBgOn.value ? ringColors(today, _lat.value) : DEFAULT_RING))
const _reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
const motifs = computed(() => (seasonBgOn.value && !_reduceMotion ? seasonMotifs(today, _lat.value) : []))

// ── 背景の動きを止めるとき: 上に画面が重なっている・アプリが裏にある・1分さわらない（電池のため・User決定 2026-11-28）──
const IDLE_MS = 60_000
const idle = ref(false)
const hidden = ref(typeof document !== 'undefined' && document.visibilityState === 'hidden')
const bgPaused = computed(() => props.covered || idle.value || hidden.value)
let _idleT = null
function _wake() { idle.value = false; clearTimeout(_idleT); _idleT = setTimeout(() => { idle.value = true }, IDLE_MS) }
function _onVis() { hidden.value = document.visibilityState === 'hidden'; if (!hidden.value) _wake() }
const _WAKE_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart']
onMounted(() => {
  _wake()
  for (const ev of _WAKE_EVENTS) document.addEventListener(ev, _wake, { passive: true })
  document.addEventListener('visibilitychange', _onVis)
})
onUnmounted(() => {
  clearTimeout(_idleT)
  for (const ev of _WAKE_EVENTS) document.removeEventListener(ev, _wake)
  document.removeEventListener('visibilitychange', _onVis)
})

// ── 背景はスクロールや画面の切り替えでは動かさない（操作とは関係なく、ゆっくり動くだけ・User 2026-11-28）。
// 以前はスクロールの速さで輪を揺らしていた。ここでは、送ったときに切れ目で中身がふっと消える印だけ付ける
const bodyEl = ref(null)
let _sc = null, _scrolled = false
function _onScroll() {
  const scrolled = _sc.scrollTop > 0
  if (scrolled !== _scrolled) { _scrolled = scrolled; bodyEl.value?.classList.toggle('scrolled', scrolled) }
}
onMounted(() => {
  _sc = bodyEl.value
  if (!_sc) return
  _sc.addEventListener('scroll', _onScroll, { passive: true })
})
onUnmounted(() => { _sc?.removeEventListener('scroll', _onScroll) })
// 本日の状況: 今日のやること・定期・期限切れ・持ち越し・進行中を同じ形の棒で1列に。済んだものは出さない（User決定 2026-11-12・D-042）
// 1枚目は中でスクロールさせないので、画面に入る分だけ出す（残りは「ほか n件」・User 2026-11-28）。
// 行の高さは中身で変わる（長い名前は2行・進行中の印など）ので、行数を計算で決めず、実際に並べて測る:
// まず全部並べ、1枚目からはみ出す間だけ1件ずつ減らす（同じ描画の前に済むので、ちらつかない）
const pageH = ref(0)
const p1El = ref(null)
const all = computed(() => homeStatus({
  today, now: nowHm.value,
  tasks: todays.value, overdue: late.value, carry: carriedTasks(today),
  checklists: checklistsForDay(today), progress: progressTasks.value, events: eventsOn(today),
  isDone: t => (t.assign === 'all' ? isMarkedByMe(t) || !!t.doneAt : !!t.doneAt),
}, 999, 999))
const fit = ref({ rows: 8, events: 2 })   // 測れない環境（テスト）では以前の上限
const status = computed(() => {
  const a = all.value
  const r = Math.min(fit.value.rows, a.rows.length), e = Math.min(fit.value.events, a.events.length)
  return { ...a, rows: a.rows.slice(0, r), more: a.rows.length - r, events: a.events.slice(0, e), eventsMore: a.events.length - e }
})
let _fitRun = 0
async function refit() {
  const el = p1El.value
  if (!el || !el.clientHeight) return
  const run = ++_fitRun
  const a = all.value
  fit.value = { rows: a.rows.length, events: a.events.length }
  for (let i = 0; i < 200; i++) {
    await nextTick()
    if (run !== _fitRun) return                         // 途中で中身が変わった（新しい測り直しに任せる）
    if (el.scrollHeight <= el.clientHeight + 1) return  // 収まった
    const { rows, events } = fit.value
    // 減らす順: やること（2件より多い分）→ イベント（1件まで）→ やること（1件まで）→ イベント
    if (rows > 2) fit.value = { rows: rows - 1, events }
    else if (events > 1) fit.value = { rows, events: events - 1 }
    else if (rows > 1) fit.value = { rows: rows - 1, events }
    else if (events > 0) fit.value = { rows, events: events - 1 }
    else return
  }
}
watch([pageH, () => all.value.rows.map(r => r.key).join(), () => all.value.events.map(e => e.key).join(), () => props.firstRun], refit, { flush: 'post' })

// ── 上下の2画面（本日の状況 / ショートカット）。1画面ずつ止まる（User 2026-11-28・モック https://claude.ai/artifact/WskkjpxqUixRRWNVDxho2W）──
const page = ref(0)
function _savedPage() { try { return localStorage.getItem(STORAGE_KEYS.homePage) === '1' ? 1 : 0 } catch (_) { return 0 } }
function goPage(i, smooth = true) {
  const el = bodyEl.value
  if (!el) return
  const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  if (typeof el.scrollTo === 'function') el.scrollTo({ top: i * el.clientHeight, behavior: smooth && !still ? 'smooth' : 'auto' })
  else el.scrollTop = i * el.clientHeight
}
function _onPage() {
  const el = bodyEl.value
  if (!el || !el.clientHeight) return
  const i = Math.round(el.scrollTop / el.clientHeight) ? 1 : 0
  if (i !== page.value) { page.value = i; try { localStorage.setItem(STORAGE_KEYS.homePage, String(i)) } catch (_) { /* 覚えられなくても動く */ } }
}
let _ro = null
onMounted(() => {
  const el = bodyEl.value
  if (!el) return
  pageH.value = el.clientHeight
  refit()
  if (typeof ResizeObserver === 'function') { _ro = new ResizeObserver(() => { pageH.value = el.clientHeight; goPage(page.value, false) }); _ro.observe(el) }
  el.addEventListener('scroll', _onPage, { passive: true })
  const p = _savedPage()
  if (p) { page.value = p; requestAnimationFrame?.(() => goPage(p, false)) }
})
onUnmounted(() => { _ro?.disconnect(); bodyEl.value?.removeEventListener('scroll', _onPage) })

// ── 最近の記録（2枚目。押すとそこへ戻る）──
const { getMovements } = useMovements()
const { getSnapshots } = useHistory()
const _md = d => (d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : '')
const recent = computed(() => {
  const out = []
  if (props.activeSession) out.push({ key: 'stock', label: `棚卸（${stockLive.value ? '進行中' : '中断中'}）`, when: '', go: () => onShortcut('stock') })
  if (props.activeOrderSession) out.push({ key: 'order', label: `発注（${orderLive.value ? '進行中' : '中断中'}）`, when: '', go: () => onShortcut('order') })
  const mv = getMovements().find(m => !m.deletedAt)
  if (mv) out.push({ key: 'mv', label: `${mv.type === 'out' ? '出庫' : '入庫'}${mv.note ? ` ・ ${mv.note}` : ''}`, when: _md(mv.date), go: () => emit('go', 'sessions') })
  const snaps = [...getSnapshots()].sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.savedAt).localeCompare(String(a.savedAt)))
  if (snaps[0]) out.push({ key: 'snap', label: '棚卸（完了）', when: _md(snaps[0].date), go: canSeeReport.value ? () => emit('go', 'report') : null })
  return out.slice(0, 3)
})
const BAR_PCT = x => `${Math.round(x * 100)}%`

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
// 業務・在庫は以前の下部ナビのタブ。タブをやめてメニューの先頭に置いた（User決定 2026-11-28）。
// 業務の数は以前のナビのバッジと同じ: 他の端末が足したやることがあれば「新着」、無ければ今日のまだの数
const workBadge = computed(() => (newTasks.value.length ? { text: '新着', kind: 'cy' } : todayOpenCount.value ? { text: String(todayOpenCount.value), kind: 'red' } : null))
const shortcuts = computed(() => [
  { key: 'work', label: '業務', big: true, badge: workBadge.value,
    d: ['M9 6h11M9 12h11M9 18h11', 'M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2'] },
  { key: 'inventory', label: '在庫', big: true, d: ['M3 8l9-5 9 5v8l-9 5-9-5z', 'M3 8l9 5 9-5M12 13v8'] },
  { key: 'stock', label: '棚卸', run: !!props.activeSession, live: stockLive.value,
    badge: props.activeSession ? _runBadge(stockLive.value, 'cy') : null,
    d: ['M9 4h6v3H9zM7 5H5v15h14V5h-2', 'M8 12l2.5 2.5L16 9'] },
  { key: 'order', label: '発注', ord: true, run: !!props.activeOrderSession, live: orderLive.value,
    badge: props.activeOrderSession ? _runBadge(orderLive.value, 'or') : (props.orderDeadline ? { text: props.orderDeadline, kind: 'or' } : null),
    d: ['M6 3h12v18l-3-2-3 2-3-2-3 2z', 'M9 8h6M9 12h6'] },
  // 品目リスト整理（並び替え）。名前は「数える順」から変えた（ぱっと見て意味が分からない・User決定 2026-10-28）。在庫タブから移した。振り分けが終わるまで残りの数を出す（光らせると棚卸の中断中と紛れるので印だけ・User決定 2026-10-27）
  // 印は導線のこと: まだ無ければ「順番 未設定」（「まだ」だけでは何がまだか読めない・User 2026-11-14）、あって入っていない品目があればその数（品目を足したら気づける・User決定 2026-10-30）
  ...(can('sort') ? [{ key: 'sort', label: '品目リスト整理',
    badge: !routeStats.value.total ? null
      : !hasRoute.value ? { text: '順番 未設定', kind: 'cy' }
      : routeStats.value.missing ? { text: `導線 ${routeStats.value.missing}`, kind: 'red' } : null,
    d: ['M4 6h10M4 12h16M4 18h7', 'M17 15l3 3-3 3'] }] : []),
  ...(isAuthenticated.value && isAdmin.value ? [{
    key: 'staff', label: 'スタッフ',
    badge: joinWaiting.value ? { text: String(joinWaiting.value), kind: 'red' } : null, hot: !!joinWaiting.value,
    d: ['M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M2 21v-1a6 6 0 0 1 12 0v1', 'M16 3.5a4 4 0 0 1 0 7M22 21v-1a6 6 0 0 0-4-5.6'],
  }] : []),
  // 取り込む・書き出すは1枚の「データ」にまとめ、押すと2択（数える順を入れて9枚に収める・User決定 2026-10-26）
  ...(can('item.admin') ? [{ key: 'data', label: 'データ', d: ['M8 4v12', 'M4 12l4 4 4-4', 'M16 20V8', 'M12 12l4-4 4 4'] }] : []),
  // レポート（在庫分析）。金額を見られる人だけ（以前は下部ナビのタブ・User決定 2026-11-27）
  ...(canSeeReport.value ? [{ key: 'report', label: 'レポート', d: ['M5 20V10M12 20V4M19 20v-7'] }] : []),
  // 設定（以前は下部ナビのタブ。ここから重ねて開く画面にした・User決定 2026-11-27）
  { key: 'settings', label: '設定',
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
    <!-- ホーム全体の背景: アプリの輪が2本、別々の速さ（23秒・31秒）でほんの少し傾きを変える。
         全部を一緒に動かすとチープに見えたので、動くのは2本の輪の傾きだけ（User決定 2026-11-28・モック https://claude.ai/artifact/CddkWTeBkdbVjFoVm1y6td の「2 重なる輪」を全体に）。
         動かすのは HTML 要素の transform だけ（GPU で動く）。業務・在庫などが上に重なっている間・裏にあるとき・1分さわらないときは止める（bgPaused） -->
    <div :class="['ht-bg', { paused: bgPaused }]" aria-hidden="true">
      <svg width="0" height="0" class="ht-defs"><defs>
        <linearGradient :id="gid" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#2563eb" /><stop offset=".55" stop-color="#22d3ee" /><stop offset="1" stop-color="#34d399" /></linearGradient>
        <!-- 背景の輪の色は月ごと（本日の状況の輪はいつもの色のまま） -->
        <linearGradient :id="`${gid}-bg`" x1="0" y1="0" x2="1" y2="0"><stop offset="0" :stop-color="bgRing[0]" /><stop offset=".55" :stop-color="bgRing[1]" /><stop offset="1" :stop-color="bgRing[2]" /></linearGradient>
      </defs></svg>
      <div class="ht-artw">
        <div class="ht-stage">
          <div class="ht-lay l1">
            <svg viewBox="0 0 380 291"><ellipse class="ht-rl soft" cx="190" cy="152" rx="152" ry="73.5" transform="rotate(-18 190 152)" :stroke="`url(#${gid}-bg)`" /><ellipse class="ht-rl" cx="190" cy="152" rx="152" ry="73.5" transform="rotate(-18 190 152)" :stroke="`url(#${gid}-bg)`" /></svg>
          </div>
          <div class="ht-lay l2">
            <svg viewBox="0 0 380 291"><ellipse class="ht-rl" cx="190" cy="152" rx="152" ry="73.5" transform="rotate(-18 190 152)" :stroke="`url(#${gid}-bg)`" /></svg>
          </div>
        </div>
      </div>
      <!-- 月のモチーフ（雪・梅・桜・雨・花火・紅葉など）。1つずつ別の速さ・向きで動く（services/seasonBg.js） -->
      <div v-if="motifs.length" class="ht-mot">
        <i v-for="(p, i) in motifs" :key="i" :class="['ht-p', p.cls]" :style="p.style">
          <svg v-if="p.svg" :width="p.w" :height="p.h" :viewBox="p.vb" :style="{ stroke: p.col }" v-html="p.svg"></svg>
        </i>
      </div>
    </div>
    <!-- 上部は1行だけ（名前・店名・日付・天気・User決定 2026-11-28） -->
    <header class="ht-hd">
      <AppMark :size="22" />
      <span class="ht-brand">{{ APP_NAME }}</span>
      <span v-if="storeName" class="ht-store">{{ storeName }}</span>
      <span class="ht-when"><span>{{ dateLabel }}</span><span v-if="wx" class="ht-wx" :title="wx.text"><LineIcon :name="wx.icon" />{{ wx.short }}</span></span>
    </header>

    <!-- 上部は止めたまま、ここから下だけが動く（上下の2画面・D-046） -->
    <div ref="bodyEl" class="ht-body">
    <!-- 1枚目: 本日の状況。中ではスクロールさせない（上下のスワイプは画面の切り替え・User 2026-11-28） -->
    <div ref="p1El" class="ht-page p1" aria-label="本日の状況">
    <!-- 本日の状況（以前の「今日のやること」と「店の今」を1枚に・User決定 2026-11-12・D-042） -->
    <section class="ht-today" aria-label="本日の状況">
      <button type="button" class="ht-th" aria-label="今日の一覧を開く" @click="emit('openTodo')">
        <span class="ht-pr" aria-hidden="true">
          <svg width="56" height="56" viewBox="0 0 56 56">
            <circle cx="28" cy="28" :r="R" fill="none" stroke="#e2eef1" stroke-width="6" />
            <circle cx="28" cy="28" :r="R" fill="none" :stroke="`url(#${gid})`" stroke-width="6" stroke-linecap="round" :stroke-dasharray="dash" transform="rotate(-90 28 28)" />
          </svg>
          <span>{{ doneCount }}/{{ total }}<small>済み</small></span>
        </span>
        <span class="ht-tx">
          <span class="ht-tt">本日の状況<i>一覧 ›</i></span>
          <small class="ht-sum">本日の分 {{ doneCount }}/{{ total }} 済み<template v-if="status.eventCount"> ・ イベント {{ status.eventCount }}</template><template v-if="status.progressCount"> ・ 進行中 {{ status.progressCount }}</template></small>
        </span>
      </button>
      <!-- イベントとやることは分ける（User 2026-11-25） -->
      <div v-if="status.events.length" class="ht-evs" aria-label="今日のイベント">
        <span class="ht-cap">イベント</span>
        <button v-for="e in status.events" :key="e.key" type="button" class="ht-ev" :data-key="e.key" :aria-label="`${e.title}を開く`" @click="emit('openItem', e.ref)">
          <span class="t">{{ e.title }}</span><span :class="['due', { end: e.ends }]">{{ e.right }}</span>
        </button>
        <button v-if="status.eventsMore" type="button" class="ht-more" @click="emit('openTodo')">ほか {{ status.eventsMore }}件</button>
      </div>
      <span v-if="status.events.length" class="ht-cap">やること</span>
      <div v-if="status.rows.length" class="ht-rows">
        <button v-for="r in status.rows" :key="r.key" type="button" :class="['ht-it', r.tag?.k]" :data-key="r.key" :aria-label="`${r.title}を開く`" @click="emit('openItem', r.ref)">
          <span class="ht-r1"><span class="t">{{ r.title }}</span><span v-if="r.kind" :class="['k', { p: r.kind === '進行中' }]">{{ r.kind }}</span><em v-if="r.tag" :class="r.tag.k">{{ r.tag.label }}</em></span>
          <span class="ht-pb"><i :style="{ width: BAR_PCT(r.pct) }"></i><b v-if="r.plan !== null" class="plan" :style="{ left: BAR_PCT(r.plan) }" title="予定ではここまで"></b></span>
          <span class="ht-r3"><span>{{ r.left }}</span><span :class="['due', r.tag?.k]">{{ r.right }}</span></span>
        </button>
      </div>
      <span v-else class="ht-none">{{ total ? 'ぜんぶ終わりました' : '今日のやることはありません' }}</span>
      <button v-if="status.more" type="button" class="ht-more" @click="emit('openTodo')">ほか {{ status.more }}件</button>
    </section>

    <!-- 登録した直後: 品目が無いと何も始まらないので、最初の一歩だけを出す。品目が入れば消える -->
    <section v-if="firstRun" class="ht-first" aria-label="はじめに">
      <b>まず、品目を用意します</b>
      <small>今ある表を取り込むか、数えながらその場で登録できます。</small>
      <div class="ht-first-acts">
        <button type="button" class="pri" @click="emit('firstImport')">ファイルから取り込む<small>CSV・Excel・PDF</small></button>
        <button type="button" @click="emit('firstCount')">数えながら登録する<small>棚卸を始める</small></button>
      </div>
    </section>

    <button type="button" class="ht-peek" aria-label="メニューへ" @click="goPage(1)">メニュー
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
    </button>
    </div><!-- /.p1 -->

    <!-- 2枚目: メニューと最近の記録。業務・在庫もここから開く（下のタブはやめた・User決定 2026-11-28） -->
    <div class="ht-page p2" aria-label="メニュー">
    <button type="button" class="ht-peek up" aria-label="本日の状況へ" @click="goPage(0)">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 15l6-6 6 6" /></svg>本日の状況
    </button>
    <div class="ht-grid">
      <button
        v-for="s in shortcuts" :key="s.key" type="button" :class="['ht-sc', { hot: s.hot, ord: s.ord, run: s.run, live: s.live, big: s.big }]"
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
    <section v-if="recent.length" class="ht-recent" aria-label="最近の記録">
      <b>最近の記録</b>
      <component :is="r.go ? 'button' : 'div'" v-for="r in recent" :key="r.key" :type="r.go ? 'button' : undefined" class="ht-rc" @click="r.go?.()">
        <span>{{ r.label }}</span><small>{{ r.when }}</small>
      </component>
    </section>
    </div><!-- /.p2 -->
    </div><!-- /.ht-body -->
    <div class="ht-dots" role="tablist" aria-label="ホームの画面">
      <button type="button" role="tab" :class="{ on: page === 0 }" :aria-selected="page === 0" aria-label="本日の状況" @click="goPage(0)"></button>
      <button type="button" role="tab" :class="{ on: page === 1 }" :aria-selected="page === 1" aria-label="メニュー" @click="goPage(1)"></button>
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
/* ホームは上部1行と、その下の上下2画面（D-046）。上部は止めたまま。
   背景（.ht-bg）はホーム全体の後ろで、アプリの輪が2本、別々の速さで傾きを変える（User決定 2026-11-28）。
   動かすのは HTML の要素の transform だけ（GPU で動く。SVG の中は動かさない＝描き直さない） */
.ht { position: relative; flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
.ht-bg { position: absolute; inset: 0; z-index: 0; overflow: hidden; pointer-events: none; }
.ht-defs { position: absolute; }
.ht-artw { position: absolute; inset: 0; }
.ht-stage { position: absolute; left: 50%; top: 56%; width: max(150%, 560px); aspect-ratio: 380 / 291; transform: translate(-50%, -50%); }
.ht-lay { position: absolute; inset: 0; transform-origin: 50% 52%; will-change: transform; }
.ht-lay svg { display: block; width: 100%; height: 100%; overflow: visible; }
.ht-rl { fill: none; stroke-width: 1.6; opacity: .5; vector-effect: non-scaling-stroke; }
.ht-rl.soft { stroke-width: 10; opacity: .09; }   /* にじみ（ぼかしは使わず太い線を薄く） */
.ht-lay.l1 { animation: ht-tilt-a 23s ease-in-out infinite alternate; }
.ht-lay.l2 { animation: ht-tilt-b 31s ease-in-out infinite alternate; }
.ht-lay.l2 .ht-rl { opacity: .3; }
@keyframes ht-tilt-a { from { transform: rotate(-3deg); } to { transform: rotate(4deg); } }
@keyframes ht-tilt-b { from { transform: rotate(14deg) scale(.86); } to { transform: rotate(6deg) scale(.9); } }
.ht-bg.paused .ht-lay { animation-play-state: paused; }
@media (prefers-reduced-motion: reduce) { .ht-lay { animation: none; } }
/* 月のモチーフ。動きの名前はクラス（k-fall など）、速さ・遅れ・揺れ幅は style（services/seasonBg.js） */
.ht-mot { position: absolute; inset: 0; overflow: hidden; }
.ht-p { position: absolute; top: 0; left: 0; will-change: transform, opacity; animation-iteration-count: infinite; }
.ht-p svg { display: block; overflow: visible; }
.ht-bg.paused .ht-p { animation-play-state: paused; }
.k-fall { animation-name: ht-fall; animation-timing-function: linear; }
.k-rise { animation-name: ht-rise; animation-timing-function: ease-out; }
.k-rain { animation-name: ht-rain; animation-timing-function: linear; }
.k-twinkle { animation-name: ht-twinkle; animation-timing-function: ease-in-out; }
.k-burst { animation-name: ht-burst; animation-timing-function: cubic-bezier(.2, .7, .3, 1); }
.k-sway { opacity: .7; transform-origin: 50% 100%; animation-name: ht-sway; animation-timing-function: ease-in-out; animation-direction: alternate; }
.k-glow { animation-name: ht-glow; animation-timing-function: ease-in-out; animation-direction: alternate; }
.k-drift { left: 0; opacity: var(--op); animation-name: ht-drift; animation-timing-function: linear; }
.k-halo { width: 260px; height: 260px; margin: -130px 0 0 -130px; border-radius: 50%;
  background: radial-gradient(closest-side, rgba(251,146,60,.32), rgba(251,191,36,.12) 55%, transparent);
  animation-name: ht-halo; animation-timing-function: ease-in-out; animation-direction: alternate; animation-duration: 12s !important; }
@keyframes ht-fall { 0% { transform: translate(0, -6vh) rotate(0deg); opacity: 0; } 8% { opacity: var(--op); }
  50% { transform: translate(var(--sw), 50vh) rotate(var(--r1)); } 92% { opacity: var(--op); } 100% { transform: translate(var(--sw2), 106vh) rotate(var(--r2)); opacity: 0; } }
@keyframes ht-rise { 0% { transform: translate(0, 100vh) scale(.6); opacity: 0; } 15% { opacity: var(--op); } 100% { transform: translate(var(--sw), 25vh) scale(1.15); opacity: 0; } }
@keyframes ht-rain { 0% { transform: translate(30px, -6vh); opacity: 0; } 10% { opacity: var(--op); } 90% { opacity: var(--op); } 100% { transform: translate(-40px, 106vh); opacity: 0; } }
@keyframes ht-twinkle { 0%, 100% { transform: scale(.5); opacity: 0; } 50% { transform: scale(1.05); opacity: var(--op); } }
@keyframes ht-burst { 0% { transform: scale(.15); opacity: 0; } 4% { opacity: var(--op); } 18% { transform: scale(1); opacity: calc(var(--op) * .7); } 26%, 100% { transform: scale(1.08); opacity: 0; } }
@keyframes ht-sway { from { transform: rotate(-5deg); } to { transform: rotate(7deg); } }
@keyframes ht-glow { from { opacity: .45; } to { opacity: .95; } }
@keyframes ht-drift { from { transform: translateX(-40vw); } to { transform: translateX(110vw); } }
@keyframes ht-halo { from { transform: scale(.9); opacity: .55; } to { transform: scale(1.06); opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .ht-mot { display: none; } }
.ht-hd { position: relative; z-index: 1; flex: none; display: flex; align-items: center; gap: 8px; color: var(--text, #12303a);
  padding: calc(12px + env(safe-area-inset-top, 0px)) 16px 6px; }
.ht-brand { font-weight: 900; letter-spacing: .08em; font-size: 15px; }
.ht-store { font-size: 11px; font-weight: 700; padding: 2px 9px; border-radius: 999px; background: rgba(14,116,144,.08); border: 1px solid rgba(14,116,144,.2); color: var(--text-muted); max-width: 34%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ht-when { margin-left: auto; display: flex; align-items: center; gap: 8px; font-size: 12.5px; font-weight: 700; color: var(--text-muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
.ht-wx { display: inline-flex; align-items: center; gap: 2px; }

/* 下の余白は多めに: 実機ではホームバーの分などで下部ナビが高くなり、最後の行の名前がナビに隠れて
   そこまで送れなかった（User報告 2026-11-28）。端末の差があっても最後の行がナビの上まで上がるように */
.ht-body { position: relative; z-index: 1; flex: 1; min-height: 0;
  overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch;
  /* 上下の2画面を1画面ずつ止める（User 2026-11-28） */
  scroll-snap-type: y mandatory; scrollbar-width: none; }
.ht-body::-webkit-scrollbar { display: none; }
/* 1画面の高さ＝見えている枠。下部ナビに隠れない分（端末差あり）を各画面の下に取る */
.ht-page { height: 100%; box-sizing: border-box; scroll-snap-align: start; scroll-snap-stop: always; display: flex; flex-direction: column;
  padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px)); overflow: hidden; }   /* 下のメニューはやめた（2026-11-28） */
.ht-page.p1 { padding-top: 14px; }
.ht-page.p2 { padding-top: 6px; }
.ht-peek { flex: none; margin: auto auto 0; display: flex; align-items: center; gap: 4px; padding: 10px 16px 6px; border: none; background: none;
  font: inherit; font-size: 12px; font-weight: 700; color: var(--text-muted); cursor: pointer; }
.ht-peek.up { margin: 0 auto 2px; padding: 4px 16px 6px; }
.ht-dots { position: absolute; right: 2px; top: 58%; z-index: 3; display: grid; gap: 8px; }
.ht-dots button { width: 7px; height: 18px; padding: 0; border: none; border-radius: 4px; background: #c6d6da; cursor: pointer; transition: height .2s, background .2s; }
.ht-dots button.on { height: 26px; background: var(--primary, #0e7490); }
.ht-recent { margin: 14px 14px 0; padding: 10px 12px; border-radius: 16px; background: var(--surface, #fff); box-shadow: 0 1px 4px rgba(0,0,0,.05); display: grid; gap: 2px; }
.ht-recent > b { font-size: 12px; color: var(--text-muted); padding-bottom: 4px; }
.ht-rc { display: flex; justify-content: space-between; gap: 8px; padding: 7px 0; border: none; border-top: 1px solid #edf3f4; background: none; font: inherit; font-size: 13px; color: var(--text); text-align: left; }
button.ht-rc { cursor: pointer; }
.ht-rc small { color: var(--text-muted); font-size: 12px; }
/* PC の幅では切り替えず、2つを横に並べる */
@media (min-width: 1024px) {
  .ht-body { scroll-snap-type: none; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); align-items: start; }
  .ht-page { height: auto; overflow: visible; }
  .ht-page.p2 { padding-top: 14px; }
  .ht-peek, .ht-dots { display: none; }
}
.ht-body.scrolled { -webkit-mask-image: linear-gradient(to bottom, transparent, #000 18px); mask-image: linear-gradient(to bottom, transparent, #000 18px); }
.ht-today { position: relative; z-index: 1; width: calc(100% - 28px); margin: 0 14px; color: var(--text);
  background: rgba(255,255,255,.97); border-radius: 20px; padding: 14px; box-shadow: 0 10px 28px rgba(6,34,43,.18); display: grid; gap: 6px; }
.ht-th { display: flex; gap: 12px; align-items: center; border: none; background: none; padding: 0 0 8px; font: inherit; color: inherit; text-align: left; cursor: pointer; border-bottom: 1px solid #e2ecef; }
.ht-pr { flex: none; position: relative; width: 56px; height: 56px; }
.ht-pr > span { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; font-weight: 900; font-size: 14px; line-height: 1.1; font-variant-numeric: tabular-nums; }
.ht-pr small { font-size: 9px; color: var(--text-muted); font-weight: 700; }
.ht-tx { flex: 1; min-width: 0; display: grid; gap: 3px; }
.ht-tt { font-size: 16px; font-weight: 900; color: var(--text); display: flex; justify-content: space-between; align-items: baseline; gap: 6px; }
.ht-tt i { font-style: normal; font-size: 12.5px; font-weight: 800; color: var(--primary); white-space: nowrap; }
.ht-sum { font-size: 11.5px; font-weight: 700; color: var(--text-muted); }
/* 1行＝名前と札・進み具合の棒（進行中は予定の印）・担当と日時 */
.ht-rows { display: grid; }
.ht-cap { display: block; margin: 10px 0 2px; font-size: 11px; font-weight: 800; letter-spacing: .08em; color: var(--text-muted); }
.ht-evs { display: grid; }
.ht-evs .ht-cap { color: #c2410c; }
.ht-ev { display: flex; align-items: center; gap: 8px; padding: 8px 0; border: none; border-top: 1px solid #e2ecef; background: none; font: inherit; color: inherit; text-align: left; cursor: pointer; }
.ht-ev .t { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 700; padding-left: 8px; border-left: 3px solid #c2410c; }
.ht-ev .due { flex: none; font-size: 12px; color: var(--text-muted); }
.ht-ev .due.end { color: #c2410c; font-weight: 700; }
.ht-it { display: grid; gap: 5px; padding: 9px 0; border: none; border-top: 1px solid #e2ecef; background: none; font: inherit; color: inherit; text-align: left; cursor: pointer; }
.ht-it:first-child { border-top: none; }
.ht-r1 { display: flex; align-items: center; gap: 6px; min-width: 0; }
.ht-r1 .t { flex: 1; min-width: 0; font-size: 14px; font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ht-r1 .k { flex: none; font-size: 10px; font-weight: 800; border-radius: 6px; padding: 1px 6px; background: #ece9fd; color: #4c35b5; }
.ht-r1 .k.p { background: #e0f2fe; color: #075985; }
.ht-r1 em { flex: none; font-style: normal; font-size: 10.5px; font-weight: 900; border-radius: 6px; padding: 0 6px; line-height: 18px; }
.ht-r1 em.late { background: #fef2f2; color: #dc2626; } .ht-r1 em.today { background: #fff1e6; color: #c2410c; } .ht-r1 em.tmr { background: #fef9c3; color: #a16207; }
.ht-pb { position: relative; height: 8px; border-radius: 4px; background: #dcedf2; }
.ht-pb i { position: absolute; inset: 0 auto 0 0; border-radius: 4px; background: var(--primary); }
.ht-it.late .ht-pb { background: #fef2f2; } .ht-it.late .ht-pb i { background: #dc2626; }
.ht-pb .plan { position: absolute; top: -3px; width: 14px; height: 14px; margin-left: -7px; border-radius: 50%; background: #fff; border: 2.5px solid #12303a; box-sizing: border-box; }
.ht-r3 { display: flex; justify-content: space-between; gap: 8px; font-size: 11px; font-weight: 700; color: #94a3b8; font-variant-numeric: tabular-nums; }
.ht-r3 > span:first-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ht-r3 .due { flex: none; } .ht-r3 .due.late { color: #dc2626; font-weight: 900; } .ht-r3 .due.today { color: #c2410c; font-weight: 900; } .ht-r3 .due.tmr { color: #a16207; font-weight: 900; }
.ht-more { border: none; background: none; font: inherit; font-size: 11.5px; font-weight: 800; color: var(--primary); text-align: center; cursor: pointer; min-height: 32px; }
.ht-none { font-size: 13px; color: var(--text-muted); font-weight: 700; text-align: center; padding: 4px 0 2px; }


.ht-first { margin: 14px 14px 0; padding: 14px; border-radius: 18px; background: var(--surface, #fff); border: 1px solid var(--border, #d6e6ea); display: grid; gap: 4px; }
.ht-first > b { font-size: 15px; font-weight: 800; color: var(--text); }
.ht-first > small { font-size: 12.5px; color: var(--text-muted); line-height: 1.6; }
.ht-first-acts { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px; }
.ht-first-acts button { min-height: 56px; border-radius: 14px; border: 1px solid var(--border, #d6e6ea); background: var(--surface, #fff); color: var(--text); font-size: 14px; font-weight: 800; cursor: pointer; display: grid; gap: 2px; align-content: center; padding: 6px 8px; }
.ht-first-acts button.pri { border: none; background: var(--grad-btn); color: var(--on-grad); }
.ht-first-acts button small { font-size: 11px; font-weight: 700; opacity: .8; }
.ht-grid { margin: 16px 14px 0; display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.ht-sc { position: relative; border: none; font: inherit; color: var(--text); background: var(--surface); border-radius: 18px; padding: 14px 4px 11px; text-align: center; box-shadow: 0 1px 4px rgba(0,0,0,.05); cursor: pointer; min-width: 0; }
.ht-sc:disabled { opacity: .6; }
.ht-ic { width: 44px; height: 44px; margin: 0 auto 7px; border-radius: 14px; display: grid; place-items: center; color: var(--primary); background: linear-gradient(145deg, #ecfeff, #e0f2fe); }
.ht-sc.big .ht-ic { color: #fff; background: linear-gradient(145deg, #0e7490, #0b3b48); }   /* 業務・在庫（以前のタブ） */
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
/* 狭い画面（320px）で「品目リスト整理」が「整／理」と折れないよう、小さくして1行に（2026-11-09 触診） */
@media (max-width: 359px) { .ht-sc b { font-size: 11px; letter-spacing: -.02em; white-space: nowrap; } }
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
