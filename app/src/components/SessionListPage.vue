<script>
import { ref, watch } from 'vue'
// App から参照する（戻る操作・ホームへ戻るときのリセット）。
// _persistedTab: 'home' = トップ / 'sessions' = 在庫 / 'calendar' = カレンダー / 'report' = レポート / 'dashboard' = 管理
// 再読み込みしても同じタブに留まる（履歴を見ていて再読み込みしたら履歴のまま）。タブ内だけ（sessionStorage）
const _TAB_KEY = 'tanaoro_home_tab'
function _readTab() {
  try { const t = sessionStorage.getItem(_TAB_KEY); return ['home', 'sessions', 'calendar', 'report', 'dashboard'].includes(t) ? t : 'home' } catch (_) { return 'home' }
}
export const _persistedTab  = ref(_readTab())
watch(_persistedTab, t => { try { sessionStorage.setItem(_TAB_KEY, t) } catch (_) { /* 保存できなくても動く */ } })
export const _showDashboard = ref(false)
export const _showOrders    = ref(false)
</script>

<script setup>
/**
 * ホーム（画面の再設計「表がホーム」・proposals.md 2026-09-30）。
 *
 * 起動したら品目・在庫の表（InventoryTable）が見える。棚卸・発注を始めると同じ表が
 * 青・橙に変わる（セッション画面）。上の段は、中断中のセッション → 今日のやること →
 * 操作ボタン（棚卸・発注・入出庫）。下部ナビは 在庫（ここ）／履歴／管理。
 *
 * 以前は縦長のカード（データ管理・棚卸・品目・履歴・β仕入れ）とダッシュボードタブで、
 * 最初の画面が「とっつきにくい」（User 2026-09-30）。確認はブラウザの confirm をやめて
 * 下から出るシートで訊く（OK/キャンセルの意味が読みにくかった）。
 */
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { isAuthenticated, storeName, logout, isAdmin, currentStaff, ROLE_LABELS, can, denyMessage, canSeeMoney } from '../composables/useAuth.js'
import StaffPage from './StaffPage.vue'
import { useSessionLauncher } from '../composables/useSessionLauncher.js'
import { shopCode, deleteSnapshotFromD1 } from '../composables/useStore.js'
import { useConfig } from '../composables/useConfig.js'
import { useHistory } from '../composables/useHistory.js'
import { settingsSection, registerInnerLayerCloser, showOrderSchedule, orderScheduleFocusId, pendingDiscardId } from '../composables/appMenuState.js'
import OrderScheduleModal from './OrderScheduleModal.vue'
import OrderBaseModal from './OrderBaseModal.vue'
import { useStockView } from '../composables/useStockView.js'
import { hasSchedule, scheduleName } from '../services/orderScheduleUtil.js'
import StockPage from './StockPage.vue'
import { useHorizontalSwipe } from '../composables/useSwipe.js'
import ManagerDashboard from './ManagerDashboard.vue'
import LoadingSpinner from './LoadingSpinner.vue'
import HomeFooterNav from './HomeFooterNav.vue'
import HomeTop from './HomeTop.vue'
import TodoPage from './TodoPage.vue'
import MasterManagePage from './MasterManagePage.vue'
import AppMark from './AppMark.vue'
import SortTile from './SortTile.vue'
import HistoryCalendarPage from './HistoryCalendarPage.vue'
import { completionBusy } from '../composables/useSession.js'
import { APP_NAME } from '../appInfo.js'

const props = defineProps({
  liveItemCount:  { type: Number, default: null },
  liveSessionId:  { type: String, default: null },
  newSessionId:   { type: String, default: null },
})
const emit = defineEmits(['startSession', 'resumeSession', 'calendarShown', 'viewSession', 'back', 'deleteSession', 'openSettings', 'openMaster', 'openUpgrade', 'startPractice', 'openFeedback', 'clearMaster'])

const { config, itemCount, setEmptyList } = useConfig()
const { getSnapshots, deleteSnapshotLocal } = useHistory()

const tab = _persistedTab

// ── 下部ナビのタブ（在庫 → 履歴 → レポート → 管理）。左右のスワイプでも移る ──
// 履歴は以前は別ページで、開くと下部ナビが消えた（User 2026-09-30）。ホームのタブにした。
// レポート（在庫分析）と、データ管理を統合した管理を加えた（User決定 2026-10-01）。
// 履歴カレンダーは下部ナビから外し、レポートの一番上から開く独立した画面にした。タブ送りのスワイプと
// カレンダーの月送りのスワイプが重なって使いにくかった（User 2026-10-01）
// カレンダー（履歴カレンダーをタブにした・User決定 2026-10-04）。日ごとに予定・やること・記録を並べる
// アルバイトには金額を見せないので、レポートのタブは飛ばす（段 2-3）
// トップ（ホーム）を先頭に（User決定 2026-10-07）
const tabsNow = () => ['home', 'sessions', 'calendar', 'report', 'dashboard'].filter(x => x !== 'report' || canSeeMoney.value)
const slideDir = ref('')                       // 'l' | 'r'（切り替えの動きの向き）
const todoOpen = ref(false)                    // トップから開く「やること」画面
function goTab(next) {
  const tabs = tabsNow()
  if (next === 'home') todoOpen.value = false
  if (!tabs.includes(next) || next === tab.value) return
  slideDir.value = tabs.indexOf(next) > tabs.indexOf(tab.value) ? 'l' : 'r'
  tab.value = next
}
// カレンダーの月は縦のスワイプで送るので、左右はどのタブでもタブの切り替え（User決定 2026-10-04）
const tabSwipe = useHorizontalSwipe({
  onLeft:  () => { const t = tabsNow(); goTab(t[t.indexOf(tab.value) + 1]) },
  onRight: () => { const t = tabsNow(); goTab(t[t.indexOf(tab.value) - 1]) },
})
// カレンダーを開いたら、発注・入出庫の記録を取り込み直す（App が受ける）
watch(tab, t => { if (t === 'calendar') emit('calendarShown') }, { immediate: true })

// セッションの一覧・開始・再開・破棄・ルーム状態（共通の部品）
const launcher = useSessionLauncher()
const {
  loading, error, startingKind, deletingId, discarded, restoringId,
  activeSession, otherActiveSessions, activeOrderSession, completedSessions, liveRoom,
} = launcher

onMounted(async () => {
  if (await launcher.load() === 'unauthorized') { emit('back'); return }
  launcher.startRoomPolling()
  // 棚卸中・発注中の ☰「破棄」から戻ってきた：その場で破棄の確認を開く
  const id = pendingDiscardId.value
  pendingDiscardId.value = null
  const target = id ? launcher.sessions.value.find(x => x.id === id && x.status !== 'completed') : null
  if (target) askDiscard(target)
})
// アプリに戻ってきたら一覧を読み直す。開いたままの画面では、別の端末で完了した棚卸が
// 「中断中」のまま残って見える（そこから破棄すると完了済みを消してしまう）
function _onVisible() { if (document.visibilityState === 'visible') launcher.load() }
onMounted(() => document.addEventListener('visibilitychange', _onVisible))
onUnmounted(() => { launcher.stopRoomPolling(); document.removeEventListener('visibilitychange', _onVisible) })

const stockRef = ref(null)   // StockPage（要補充の件数・＋の追加を借りる）

// ── 中断中のセッション（帯）────────────────────────────────
function _itemCount(session) {
  if (!session) return 0
  if (session.id === props.liveSessionId && props.liveItemCount > 0) return props.liveItemCount
  const r = liveRoom.value
  if (r?.isActive && session.id === r.sessionId && r.itemCount > 0) return r.itemCount
  return session.itemCount ?? 0
}
const _WEEK = ['日', '月', '火', '水', '木', '金', '土']
function _hm(iso) {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
function _mdw(d) { return `${d.getMonth() + 1}/${d.getDate()}（${_WEEK[d.getDay()]}）` }

// （今日のやることは出さない・User決定 2026-10-01）

// ── 前回の棚卸（開始シート）─────────────────────────────────
const lastStock = computed(() => {
  let best = null
  for (const s of completedSessions.value) {
    const t = new Date(launcher.stockAt(s))
    if (!Number.isNaN(t.getTime()) && (!best || t > best)) best = t
  }
  return best ? _mdw(best) : null
})
// トップのショートカット: 今日が発注日か・いちばん早い締切
const todayOrder = computed(() => {
  const dow = new Date().getDay()
  const list = (config.orderSchedules ?? []).filter(s => hasSchedule(s) && s.days.includes(dow))
  const deadlines = list.map(s => s.deadline).filter(Boolean).sort()
  return { isDay: list.length > 0, deadline: deadlines[0] || '' }
})
const todaySchedules = computed(() => {
  const dow = new Date().getDay()
  return (config.orderSchedules ?? []).map((s, i) => ({ s, i }))
    .filter(({ s }) => hasSchedule(s) && s.days.includes(dow))
    .map(({ s, i }) => `${scheduleName(s, i)}${s.deadline ? `（${s.deadline}締切）` : ''}`)
})

// ── シート ───────────────────────────────────────────────
// null | 'stock' | 'order' | { discard: session }
const sheet = ref(null)
const sameDay = ref(null)     // 同じ日の2回目のとき、今日の棚卸
function closeSheet() { sheet.value = null; sameDay.value = null }

const hasOwnList = computed(() => config.isCustom && itemCount.value > 0)

// できない操作は押した時点で止めて理由を出す（段 2-3。サーバーでも同じ表で止める）
const denyNote = ref('')
let _denyT = null
function _allowed(perm) {
  if (can(perm)) return true
  denyNote.value = denyMessage(perm)
  clearTimeout(_denyT); _denyT = setTimeout(() => { denyNote.value = '' }, 3200)
  return false
}
function openStockSheet()  { if (!_allowed('stock.start')) return; sameDay.value = null; sheet.value = 'stock' }
function openOrderSheet()  { if (!_allowed('order.start')) return; sheet.value = 'order' }

async function startStock({ room = false, force = false } = {}) {
  const r = await launcher.startStock({ force })
  if (r?.sameDay) { sameDay.value = r.sameDay; return }
  if (r?.session) { closeSheet(); emit('startSession', r.session, 'stock', { room }) }
}
async function startStockEmpty() {
  // 品目が無い（またはサンプル）→ 空のリストで始めて、数えながら登録する
  setEmptyList()
  await startStock({ force: true })
}
function resumeSameDay() { const s = sameDay.value; closeSheet(); emit('resumeSession', s) }

async function startOrder({ room = false } = {}) {
  const s = await launcher.startOrder()
  if (s) { closeSheet(); emit('startSession', s, 'order', { room }) }
}

function resume(session) {
  if (!_allowed(session?.type === 'order' ? 'order.start' : 'stock.start')) return
  closeSheet(); emit('resumeSession', session)
}
function askDiscard(session) { if (!_allowed('stock.discard')) return; sheet.value = { discard: session } }
async function confirmDiscard() {
  const s = sheet.value?.discard
  if (!s) return
  // 中断中の破棄。消す直前にサーバーを読み直し、完了済みなら消さない（launcher.remove）
  if (await launcher.remove(s, { confirmed: true })) emit('deleteSession', s.id)
  closeSheet()
}
// 破棄して24時間以内のもの（元に戻せる）。残り時間は在庫の帯と同じ間隔で更新される launcher.now で数える
function discardRemain(d) {
  const ms = Date.parse(d.restorableUntil) - launcher.now.value
  if (!(ms > 0)) return 'まもなく'
  const h = Math.floor(ms / 3600_000), m = Math.floor((ms % 3600_000) / 60_000)
  return h > 0 ? `あと${h}時間` : `あと${Math.max(1, m)}分`
}
// 破棄したものを元に戻して、そのまま続きから始める（開始シートから）
const discardedStock = computed(() => discarded.value.filter(d => (d.type ?? 'stock') !== 'order'))
const discardedOrder = computed(() => discarded.value.filter(d => d.type === 'order'))
async function restoreAndResume(d) {
  if (!_allowed('stock.discard')) return
  const s = await launcher.restore(d)
  if (s) resume(s)
}
// 品目マスタの一括削除。先に完了していない棚卸・発注をサーバーで消し、消せたときだけ品目を消す
// （品目だけ消えて、古い数量のまま再開・取り戻しができる状態を作らない）
async function onClearMaster(p) {
  if (!_allowed('item.admin')) return
  const ids = await launcher.purgeUnfinished()
  if (!ids) {
    window.alert(`中断中・破棄した棚卸と発注を消せなかったため、品目マスタの削除をやめました。\n通信を確認して、もう一度お試しください。（${launcher.error.value}）`)
    return
  }
  emit('clearMaster', { ...p, purgedIds: ids })
}
const discardTarget = computed(() => (sheet.value && typeof sheet.value === 'object' ? sheet.value.discard : null))
const discardKind   = computed(() => (discardTarget.value?.type === 'order' ? '発注' : '棚卸'))

// ── 管理タブ ─────────────────────────────────────────────
// 発注の設定（以前は「仕入れ」ページの中。入出庫の画面を記録だけにしたため管理タブへ）
const { allItems, baseOf, unitOf, reorderHorizon } = useStockView()
const { setReorderPoint, setOrderAssumptions } = useConfig()
const showOrderBase = ref(false)
const showStaff = ref(false)   // スタッフの管理（段 2-1・管理者だけ）
const orderBaseRows = computed(() => allItems.value.map(item => ({
  item, category: config.categories?.[item] ?? '', ...baseOf(item),
})))
function openSchedule() {
  if (!_allowed('orderSettings')) return
  orderScheduleFocusId.value = null; showOrderSchedule.value = true
}
const historyTick = ref(0)
const dashboardSnapshots = computed(() => { void historyTick.value; return getSnapshots() })

// レポート：分析の月の棚卸から、その棚卸の詳細（品目一覧・参加者・変更履歴・レポート）へ
function openSnapshot(snap) {
  const id = snap?.sessionId
  if (!id) return
  const sess = launcher.sessions.value.find(x => x.id === id)
  emit('viewSession', sess ?? { id, status: 'completed', type: 'stock', startedAt: snap.date, endedAt: snap.savedAt ?? null })
}
function onDeleteOrphan(snap) {
  const key = snap?.sessionId
  if (!key) return
  deleteSnapshotLocal(key)
  deleteSnapshotFromD1(key)
  historyTick.value++
}
async function onLogout() {
  if (!confirm('ログアウトしますか？')) return
  await logout()
  emit('back')
}

// 端末の戻る操作は、ページを閉じる前にシートから閉じる
onUnmounted(registerInnerLayerCloser(() => {
  if (showOrderBase.value) { showOrderBase.value = false; return true }
  if (sheet.value) { closeSheet(); return true }
  if (todoOpen.value) { todoOpen.value = false; return true }
  if (tab.value !== 'home') { goTab('home'); return true }
  return false
}))
</script>

<template>
  <div class="home">
    <header v-if="tab !== 'home'" class="home-head">
      <span class="home-logo"><AppMark :size="26" />{{ APP_NAME }}</span>
      <span class="home-store">{{ storeName || '' }}<small v-if="shopCode"> {{ shopCode }}</small></span>
    </header>

    <LoadingSpinner v-if="loading" />

    <div
      class="home-panels"
      @touchstart.passive="tabSwipe.onTouchStart"
      @touchmove.passive="tabSwipe.onTouchMove"
      @touchend.passive="tabSwipe.onTouchEnd"
      @touchcancel.passive="tabSwipe.onTouchCancel"
    >
    <!-- ── トップ（ホーム）とやること（User決定 2026-10-07）── -->
    <div v-if="!loading && tab === 'home'" :class="['home-panel', 'top-panel', slideDir && `slide-${slideDir}`]">
      <TodoPage v-if="todoOpen" @close="todoOpen = false" />
      <HomeTop
        v-else
        :active-session="activeSession"
        :active-order-session="activeOrderSession"
        :stock-count="_itemCount(activeSession)"
        :order-count="_itemCount(activeOrderSession)"
        :is-order-day="todayOrder.isDay"
        :order-deadline="todayOrder.deadline"
        :reorder-count="stockRef?.reorderCount ?? 0"
        :starting-kind="startingKind"
        @go="goTab"
        @stock="openStockSheet"
        @order="openOrderSheet"
        @resume="resume"
        @open-todo="todoOpen = true"
      />
    </div>

    <!-- ── 在庫 ── -->
    <StockPage
      v-show="!loading && tab === 'sessions'"
      :class="['home-panel', slideDir && `slide-${slideDir}`]"
      ref="stockRef"
      embedded
      :stocktake-open="!!activeSession"
      @open-master="emit('openMaster')"
      @start-session="startStockEmpty"
    >
      <template #top="{ empty }">
        <div class="home-top">
          <div v-if="error" class="home-err">{{ error }}</div>

          <!-- 操作ボタン -->
          <div v-if="!empty" class="acts">
            <!-- 中断中があれば、ボタンそのものが「再開」になる（ホームの上に帯を出さない・User決定 2026-10-04）。
                 やめるときは棚卸・発注の画面の ☰ から破棄する -->
            <button v-if="activeSession" class="act stock resume" type="button" @click="resume(activeSession)">
              <b>▶︎</b>棚卸を再開<small>{{ _itemCount(activeSession) }}品目 ・ {{ _hm(activeSession.startedAt) }}〜</small>
            </button>
            <button v-else class="act stock" type="button" :disabled="startingKind === 'stock'" @click="openStockSheet">
              <b>👥</b>{{ startingKind === 'stock' ? '開始中…' : '棚卸' }}
            </button>
            <button v-if="activeOrderSession" class="act order resume" type="button" @click="resume(activeOrderSession)">
              <b>▶︎</b>発注を再開<small>{{ _itemCount(activeOrderSession) }}品目 ・ {{ _hm(activeOrderSession.startedAt) }}〜</small>
            </button>
            <button v-else class="act order" type="button" :disabled="startingKind === 'order'" @click="openOrderSheet">
              <b>🧾</b>{{ startingKind === 'order' ? '開始中…' : '発注' }}
            </button>
            <SortTile :disabled="completionBusy" />
          </div>
        </div>
      </template>
    </StockPage>

    <!-- ── カレンダー（予定・やること・記録）── -->
    <HistoryCalendarPage
      v-if="!loading && tab === 'calendar'"
      :class="['home-panel', slideDir && `slide-${slideDir}`]"
      embedded
      @view-session="s => emit('viewSession', s)"
      @open-upgrade="r => emit('openUpgrade', r)"
    />

    <!-- ── レポート（在庫分析）── -->
    <div v-if="!loading && tab === 'report'" :class="['report-tab', 'home-panel', slideDir && `slide-${slideDir}`]">
      <ManagerDashboard
        embedded :snapshots="dashboardSnapshots"
        :sessions="loading || error ? null : launcher.sessions.value"
        @delete-orphan="onDeleteOrphan"
        @view-snapshot="openSnapshot"
      />
    </div>

    <!-- ── 管理（データ管理を統合）── -->
    <MasterManagePage
      v-if="!loading && tab === 'dashboard'"
      :class="['home-panel', slideDir && `slide-${slideDir}`]"
      embedded
      :unfinished-count="launcher.inProgressSessions.value.length + discarded.length"
      @clear-master="onClearMaster"
    >
      <template #extra>
        <div class="manage">
          <template v-if="can('orderSettings')">
            <div class="m-h">発注の設定</div>
            <button class="m-card" type="button" @click="openSchedule">🗓<span>発注日・締切<small>発注する曜日と締切の時刻（今日の帯・発注の開始に出ます）</small></span><i>›</i></button>
            <button class="m-card" type="button" @click="_allowed('orderSettings') && (showOrderBase = true)">🎯<span>発注点<small>品目ごとの発注点（この数以下で「要補充」）</small></span><i>›</i></button>
          </template>
          <template v-if="isAuthenticated && isAdmin">
            <div class="m-h">スタッフ</div>
            <button class="m-card" type="button" @click="showStaff = true">👥<span>スタッフ<small>招待・承認・役割・停止・個別の許可（スタッフは自分の名前と暗証番号でログイン）</small></span><i>›</i></button>
          </template>
          <div class="m-h">その他</div>
          <button class="m-card" type="button" @click="settingsSection = 'general'">⚙️<span>各種設定<small>端末名・通知・アプリ情報</small></span><i>›</i></button>
          <button class="m-card" type="button" @click="emit('openFeedback')">💬<span>フィードバックを送る<small>不具合・要望を開発者へ</small></span><i>›</i></button>
          <template v-if="otherActiveSessions.length">
            <div class="m-h">その他の未完了（古い）</div>
            <div v-for="s in otherActiveSessions" :key="s.id" class="m-old">
              <span>{{ _hm(s.startedAt) }} 開始 ・ {{ _itemCount(s) }}品目</span>
              <button type="button" class="m-old-btn" @click="resume(s)">再開</button>
              <button type="button" class="m-old-btn ng" :disabled="deletingId === s.id" @click="askDiscard(s)">破棄</button>
            </div>
          </template>
          <p v-if="isAuthenticated" class="m-who">ログイン中：{{ currentStaff ? `${currentStaff.name}（${ROLE_LABELS[currentStaff.role]}）` : 'オーナー' }}</p>
          <p v-if="isAuthenticated && currentStaff" class="m-who-note">アプリを開いている時間は、管理者から見えます</p>
          <button v-if="isAuthenticated" class="m-logout" type="button" @click="onLogout">ログアウト</button>
        </div>
      </template>
    </MasterManagePage>
    <StaffPage v-if="showStaff" @close="showStaff = false" />
    <Teleport to="body">
      <Transition name="toast">
        <div v-if="denyNote" class="toast" data-type="warning" role="status">{{ denyNote }}</div>
      </Transition>
    </Teleport>

    </div><!-- /.home-panels -->

    <!-- ── 下部ナビ（全画面共通の部品）── -->
    <HomeFooterNav :active="tab" @go="goTab" />

    <OrderScheduleModal v-if="showOrderSchedule" @close="showOrderSchedule = false" />
    <OrderBaseModal
      v-if="showOrderBase"
      :rows="orderBaseRows"
      :unit-of="unitOf"
      :assumptions="config.orderAssumptions ?? null"
      :interval-days="reorderHorizon"
      @save-assumptions="setOrderAssumptions"
      @set-reorder="(item, v) => setReorderPoint(item, v)"
      @close="showOrderBase = false"
    />


    <!-- ── 棚卸の開始シート ── -->
    <div v-if="sheet === 'stock'" class="sh-bg" @click.self="closeSheet">
      <div class="sh" role="dialog" aria-modal="true" aria-label="棚卸を始める">
        <div class="sh-handle"></div>
        <!-- 中断中の棚卸がある：新しく始めずに再開を勧める（同時に1つ） -->
        <template v-if="activeSession">
          <div class="sh-t">中断中の棚卸があります</div>
          <div class="sh-s">{{ _hm(activeSession.startedAt) }} 開始 ・ {{ _itemCount(activeSession) }}品目入力済み</div>
          <button class="bb stock" type="button" @click="resume(activeSession)">▶︎<span>続きから再開</span></button>
          <div class="note">やめる場合は、棚卸の画面の ☰ から破棄できます。</div>
        </template>
        <!-- 同じ日の2回目 -->
        <template v-else-if="sameDay">
          <div class="sh-t">今日はもう棚卸をしています</div>
          <div class="sh-s">{{ _hm(sameDay.startedAt) }} 開始 ・ 完了済み</div>
          <div class="note blue">たいていは続きか数え直しです。続きから開くと、数量・変更履歴・時間がそのまま残ります。</div>
          <button class="bb stock" type="button" @click="resumeSameDay">↩︎<span>続きから開く<small>今日の棚卸を直す</small></span></button>
          <button class="bb" type="button" :disabled="startingKind === 'stock'" @click="startStock({ force: true })">＋<span>別の棚卸として新しく始める<small>本当に2回数える日だけ</small></span></button>
        </template>
        <!-- 品目がまだ無い（サンプルのまま） -->
        <template v-else-if="!hasOwnList">
          <div class="sh-t">品目がまだありません</div>
          <div class="sh-s">数えながら、その場で品目を登録できます。</div>
          <button class="bb stock" type="button" :disabled="startingKind === 'stock'" @click="startStockEmpty">👥<span>数えながら登録して始める</span></button>
          <button class="bb" type="button" @click="closeSheet(); emit('openMaster')">📄<span>ファイルから品目を取り込む</span></button>
        </template>
        <template v-else>
          <div class="sh-t">棚卸を始める</div>
          <div class="sh-s">数えた数が、今の在庫として確定します。</div>
          <div class="info"><div>前回<b>{{ lastStock || 'まだありません' }}</b></div><div>数える品目<b>{{ itemCount }}</b></div></div>
          <button class="bb stock" type="button" :disabled="startingKind === 'stock'" @click="startStock()">👤<span>ひとりで始める<small>この端末だけで数える</small></span></button>
          <button class="bb stock-soft" type="button" :disabled="startingKind === 'stock'" @click="startStock({ room: true })">👥<span>みんなで始める<small>QRを出して、スタッフのスマホをつなぐ</small></span></button>
          <!-- 破棄して24時間以内の棚卸は、ここから元に戻して続きから始める（ホームの上に帯を出さない・User決定 2026-10-04） -->
          <button
            v-for="d in discardedStock" :key="d.id" class="bb restore" type="button"
            :disabled="restoringId === d.id" @click="restoreAndResume(d)"
          >↩︎<span>{{ restoringId === d.id ? '戻しています…' : `破棄した棚卸を元に戻して始める（${discardRemain(d)}）` }}<small>{{ d.itemCount }}品目 ・ {{ _hm(d.startedAt) }} 開始</small></span></button>
        </template>
        <div v-if="error" class="home-err">{{ error }}</div>
      </div>
    </div>

    <!-- ── 発注の開始シート ── -->
    <div v-if="sheet === 'order'" class="sh-bg" @click.self="closeSheet">
      <div class="sh" role="dialog" aria-modal="true" aria-label="発注を始める">
        <div class="sh-handle"></div>
        <template v-if="activeOrderSession">
          <div class="sh-t">中断中の発注があります</div>
          <div class="sh-s">{{ _hm(activeOrderSession.startedAt) }} 開始 ・ {{ _itemCount(activeOrderSession) }}品目</div>
          <button class="bb order" type="button" @click="resume(activeOrderSession)">▶︎<span>続きから再開</span></button>
          <div class="note">やめる場合は、発注の画面の ☰ から破棄できます。</div>
        </template>
        <template v-else>
          <div class="sh-t">発注を始める</div>
          <!-- 発注は確認・記録まで（仕入先へ送らない）。誤解すると実害が出るので、ここで1回はっきり言う -->
          <div class="note orange">📝 <b>このアプリは発注内容の確認と記録までです。</b>仕入先へは送信されません。完了後に CSV やコピーで共有できます。</div>
          <div class="info">
            <div>要補充<b class="warn">{{ stockRef?.reorderCount ?? 0 }}品目</b></div>
            <div>今日の発注日<b>{{ todaySchedules.length ? todaySchedules.join('・') : 'なし' }}</b></div>
          </div>
          <button class="bb order" type="button" :disabled="startingKind === 'order'" @click="startOrder()">🧾<span>ひとりで始める</span></button>
          <button class="bb order-soft" type="button" :disabled="startingKind === 'order'" @click="startOrder({ room: true })">👥<span>みんなで発注する<small>QRを出して、スタッフのスマホをつなぐ</small></span></button>
          <button
            v-for="d in discardedOrder" :key="d.id" class="bb restore" type="button"
            :disabled="restoringId === d.id" @click="restoreAndResume(d)"
          >↩︎<span>{{ restoringId === d.id ? '戻しています…' : `破棄した発注を元に戻して始める（${discardRemain(d)}）` }}<small>{{ d.itemCount }}品目 ・ {{ _hm(d.startedAt) }} 開始</small></span></button>
        </template>
        <div v-if="error" class="home-err">{{ error }}</div>
      </div>
    </div>

    <!-- ── 破棄の確認 ── -->
    <div v-if="discardTarget" class="sh-bg" @click.self="closeSheet">
      <div class="sh" role="alertdialog" aria-modal="true" :aria-label="`${discardKind}を破棄`">
        <div class="sh-handle"></div>
        <div class="sh-t ng">この{{ discardKind }}を破棄しますか？</div>
        <div class="note red">
          <b>入力済みの {{ _itemCount(discardTarget) }}品目</b>と変更履歴を破棄します。履歴カレンダーには残りません。<br>
          <b>24時間以内なら、ホームの「{{ discardKind }}」のボタンから元に戻して始められます。</b>過ぎると完全に消えます。
        </div>
        <div class="note blue">あとで続けるだけなら、破棄せずにそのまま置いておけます（「再開」で続きから）。</div>
        <div class="two">
          <button class="btn" type="button" @click="closeSheet">やめる</button>
          <button class="btn ng" type="button" :disabled="deletingId === discardTarget.id" @click="confirmDiscard">破棄する</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ホームは画面の高さぴったりの枠（ページそのものはスクロールしない・User 2026-10-04）。
   見出しと下部ナビの間（.home-panels）だけが、中身が収まらないときにスクロールする。
   以前は各タブが下に大きめの余白を持ち、中身が収まっていても少しだけスクロールして上が見切れた */
.home {
  height: 100vh; height: 100dvh; display: flex; flex-direction: column; overflow: hidden;
  background: var(--bg, #edf5f7); --bnav-h: calc(58px + env(safe-area-inset-bottom));
}
/* 横スワイプでタブを移る面。縦スクロールはブラウザに任せ、横だけこちらで受ける */
.home-panels {
  flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; touch-action: pan-y;
  display: flex; flex-direction: column; padding-bottom: var(--bnav-h);
}
.home-panels > .home-panel { flex: 1 0 auto; }
.home-panel.slide-l { animation: home-slide-l .22s ease-out; }
.home-panel.slide-r { animation: home-slide-r .22s ease-out; }
@keyframes home-slide-l { from { transform: translateX(24px); opacity: .4; } to { transform: none; opacity: 1; } }
@keyframes home-slide-r { from { transform: translateX(-24px); opacity: .4; } to { transform: none; opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .home-panel.slide-l, .home-panel.slide-r { animation: none; } }
.home-head {
  flex: none; z-index: 3; display: flex; align-items: center; gap: 8px;
  padding: 12px 14px; background: #fff; border-bottom: 1px solid #d6e6ea;
}
.home-logo { display: inline-flex; align-items: center; gap: 6px; font-size: 16px; font-weight: 800; letter-spacing: .08em; color: #12303a; }
.home-store { font-size: 12px; font-weight: 700; color: #4c6a72; }
.home-store small { font-weight: 600; color: #7d969c; letter-spacing: .5px; margin-left: 6px; }
.home-top { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px 0; }
.home-err { font-size: 12.5px; color: #b91c1c; background: #fef2f2; border: 1px solid #fecaca; border-radius: 10px; padding: 8px 10px; }

/* 棚卸と発注を色で見分ける（ホームのボタンと同じ 青／オレンジ） */

.acts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.act {
  position: relative; background: #fff; border: 1.5px solid #d6e6ea; border-radius: 14px;
  padding: 9px 0 8px; font-size: 12.5px; font-weight: 800; color: #1f3d45; cursor: pointer; font-family: inherit;
}
.act b { display: block; font-size: 22px; margin-bottom: 2px; }
.act.stock { border-color: #67e8f9; color: #155e75; background: #ecfeff; }
.act.order { border-color: #fdba74; color: #c2410c; background: #fff7ed; }
.act:disabled { opacity: .6; cursor: default; }
/* 中断中：ボタンそのものが「再開」 */
.act.resume small { display: block; font-size: 10px; font-weight: 700; opacity: .85; margin-top: 1px; }
.act.resume.stock { background: #cffafe; border-color: #22d3ee; }
.act.resume.order { background: #ffedd5; border-color: #fb923c; }
.act-badge { position: absolute; top: 5px; right: 8px; background: #059669; color: #fff; border-radius: 999px; font-size: 10.5px; padding: 1px 6px; }
.act-dot { position: absolute; top: 8px; right: 12px; width: 8px; height: 8px; border-radius: 50%; background: #f59e0b; }

.manage { padding: 0 0 12px; }
.m-h { font-size: 12px; font-weight: 800; color: #4c6a72; margin: 14px 2px 6px; }
.m-card {
  display: flex; align-items: center; gap: 12px; width: 100%; text-align: left; font-family: inherit;
  background: #fff; border: 1px solid #d6e6ea; border-radius: 12px; padding: 12px 14px; margin-bottom: 8px;
  font-size: 20px; cursor: pointer;
}
.m-card span { flex: 1; font-size: 14.5px; font-weight: 800; color: #12303a; display: flex; flex-direction: column; gap: 2px; }
.m-card small { font-size: 11.5px; font-weight: 600; color: #4c6a72; }
.m-card i { font-style: normal; color: #7d969c; font-size: 18px; }
.m-old { display: flex; align-items: center; gap: 8px; background: #fff; border: 1px solid #d6e6ea; border-radius: 12px; padding: 10px 12px; margin-bottom: 8px; font-size: 12.5px; color: #1f3d45; }
.m-old span { flex: 1; }
.m-old-btn { border: 1.5px solid #bfd6dc; background: #fff; border-radius: 8px; padding: 5px 10px; font-weight: 800; font-size: 12px; cursor: pointer; }
.m-old-btn.ng { border-color: #fca5a5; color: #b91c1c; }
.m-who-note { margin: 4px 0 0; text-align: center; font-size: 11.5px; color: #7d969c; }
.m-who { margin: 20px 0 0; text-align: center; font-size: 12.5px; color: #4c6a72; }
.m-logout { display: block; margin: 24px auto 0; border: none; background: none; color: #dc2626; font-weight: 700; font-size: 14px; cursor: pointer; }

/* レポートタブ */
.report-tab { padding: 4px 6px 8px; }

.sh-bg { position: fixed; inset: 0; z-index: 50; background: rgba(15, 23, 42, .45); display: flex; align-items: flex-end; justify-content: center; }
.sh { width: 100%; max-width: 600px; background: #fff; border-radius: 18px 18px 0 0; padding: 12px 16px calc(18px + env(safe-area-inset-bottom)); max-height: 90vh; overflow-y: auto; }
.sh-handle { width: 40px; height: 4px; border-radius: 2px; background: #bfd6dc; margin: 0 auto 12px; }
.sh-t { font-size: 18px; font-weight: 800; color: #12303a; }
.sh-t.ng { color: #b91c1c; }
.sh-s { font-size: 12.5px; color: #4c6a72; margin: 4px 0 12px; line-height: 1.5; }
.info { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px; }
.info div { background: #f6fafb; border: 1px solid #d6e6ea; border-radius: 10px; padding: 8px 10px; font-size: 11.5px; color: #4c6a72; font-weight: 700; }
.info b { display: block; font-size: 15px; color: #0b2229; margin-top: 2px; }
.info b.warn { color: #c2410c; }
.bb {
  display: flex; align-items: center; gap: 12px; width: 100%; text-align: left; font-family: inherit;
  border-radius: 13px; padding: 13px 14px; margin-bottom: 9px; font-size: 22px; cursor: pointer;
  background: #fff; color: #1f3d45; border: 1.5px solid #bfd6dc;
}
.bb span { flex: 1; font-size: 15px; font-weight: 800; display: flex; flex-direction: column; gap: 2px; }
.bb small { font-size: 11.5px; font-weight: 600; opacity: .85; }
.bb:disabled { opacity: .6; cursor: default; }
.bb.stock { background: #0e7490; color: #fff; border-color: #0e7490; }
.bb.restore { border: 1.5px dashed #7d969c; background: #fff; color: #1f3d45; }
.bb.stock-soft { background: #ecfeff; color: #155e75; border-color: #67e8f9; }
.bb.order { background: #ea580c; color: #fff; border-color: #ea580c; }
.bb.order-soft { background: #fff7ed; color: #c2410c; border-color: #fdba74; }
.bb.ng { color: #b91c1c; border-color: #fca5a5; }
.sh-link { display: block; margin: 4px auto 0; border: none; background: none; color: #4c6a72; font-size: 12.5px; font-weight: 700; cursor: pointer; }
.note { border-radius: 10px; padding: 9px 11px; font-size: 12.5px; line-height: 1.6; margin-bottom: 12px; }
.note.orange { background: #fff7ed; border: 1px solid #fdba74; color: #9a3412; }
.note.blue { background: #ecfeff; border: 1px solid #67e8f9; color: #164e63; }
.note.red { background: #fef2f2; border: 1px solid #fca5a5; color: #7f1d1d; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.btn { border: 1.5px solid #bfd6dc; background: #edf5f7; color: #1f3d45; border-radius: 11px; padding: 13px 0; font-weight: 800; font-size: 15px; cursor: pointer; font-family: inherit; }
.btn.ng { background: #b91c1c; color: #fff; border-color: #b91c1c; }
</style>
