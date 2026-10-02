<script>
import { ref, watch } from 'vue'
// App から参照する（戻る操作・ホームへ戻るときのリセット）。
// _persistedTab: 'sessions' = 在庫（ホーム） / 'report' = レポート / 'dashboard' = 管理（履歴は独立した画面）
// 再読み込みしても同じタブに留まる（履歴を見ていて再読み込みしたら履歴のまま）。タブ内だけ（sessionStorage）
const _TAB_KEY = 'tanaoro_home_tab'
function _readTab() {
  try { const t = sessionStorage.getItem(_TAB_KEY); return ['sessions', 'report', 'dashboard'].includes(t) ? t : 'sessions' } catch (_) { return 'sessions' }
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
import { isAuthenticated, storeName, logout } from '../composables/useAuth.js'
import { useSessionLauncher } from '../composables/useSessionLauncher.js'
import { shopCode, deleteSnapshotFromD1 } from '../composables/useStore.js'
import { useConfig } from '../composables/useConfig.js'
import { useHistory } from '../composables/useHistory.js'
import { useMovementDraft } from '../composables/useMovementDraft.js'
import { useMovements, unreflectedOrders } from '../composables/useMovements.js'
import { useOrders } from '../composables/useOrders.js'
import { settingsSection, registerInnerLayerCloser, showOrderSchedule, orderScheduleFocusId, pendingDiscardId } from '../composables/appMenuState.js'
import OrderScheduleModal from './OrderScheduleModal.vue'
import OrderBaseModal from './OrderBaseModal.vue'
import { useStockView } from '../composables/useStockView.js'
import { hasSchedule, scheduleName } from '../services/orderScheduleUtil.js'
import StockPage from './StockPage.vue'
import { useHorizontalSwipe } from '../composables/useSwipe.js'
import ManagerDashboard from './ManagerDashboard.vue'
import LoadingSpinner from './LoadingSpinner.vue'
import DataInspector from './DataInspector.vue'
import HomeFooterNav from './HomeFooterNav.vue'
import MasterManagePage from './MasterManagePage.vue'

const props = defineProps({
  liveItemCount:  { type: Number, default: null },
  liveSessionId:  { type: String, default: null },
  newSessionId:   { type: String, default: null },
})
const emit = defineEmits(['startSession', 'resumeSession', 'openHistory', 'viewSession', 'back', 'deleteSession', 'openSettings', 'openMaster', 'openUpgrade', 'startPractice', 'openMovement', 'openFeedback', 'clearMaster'])

const { config, itemCount, setEmptyList } = useConfig()
const { getSnapshots, deleteSnapshotLocal } = useHistory()
const { hasDraft: hasMovementDraft } = useMovementDraft()
const { getMovements } = useMovements()
const { getOrders } = useOrders()

const tab = _persistedTab

// ── 下部ナビのタブ（在庫 → 履歴 → レポート → 管理）。左右のスワイプでも移る ──
// 履歴は以前は別ページで、開くと下部ナビが消えた（User 2026-09-30）。ホームのタブにした。
// レポート（在庫分析）と、データ管理を統合した管理を加えた（User決定 2026-10-01）。
// 履歴カレンダーは下部ナビから外し、レポートの一番上から開く独立した画面にした。タブ送りのスワイプと
// カレンダーの月送りのスワイプが重なって使いにくかった（User 2026-10-01）
const TABS = ['sessions', 'report', 'dashboard']
const slideDir = ref('')                       // 'l' | 'r'（切り替えの動きの向き）
function goTab(next) {
  if (!TABS.includes(next) || next === tab.value) return
  slideDir.value = TABS.indexOf(next) > TABS.indexOf(tab.value) ? 'l' : 'r'
  tab.value = next
}
const tabSwipe = useHorizontalSwipe({
  onLeft:  () => goTab(TABS[TABS.indexOf(tab.value) + 1]),
  onRight: () => goTab(TABS[TABS.indexOf(tab.value) - 1]),
})

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
const todaySchedules = computed(() => {
  const dow = new Date().getDay()
  return (config.orderSchedules ?? []).map((s, i) => ({ s, i }))
    .filter(({ s }) => hasSchedule(s) && s.days.includes(dow))
    .map(({ s, i }) => `${scheduleName(s, i)}${s.deadline ? `（${s.deadline}締切）` : ''}`)
})

// 入出庫ボタンのしるし（未記録の入力・入庫として未反映の発注）
const unreflectedCount = computed(() => unreflectedOrders(getOrders(), getMovements(), 30).length)

// ── シート ───────────────────────────────────────────────
// null | 'stock' | 'order' | { discard: session }
const sheet = ref(null)
const sameDay = ref(null)     // 同じ日の2回目のとき、今日の棚卸
function closeSheet() { sheet.value = null; sameDay.value = null }

const hasOwnList = computed(() => config.isCustom && itemCount.value > 0)

function openStockSheet()  { sameDay.value = null; sheet.value = 'stock' }
function openOrderSheet()  { sheet.value = 'order' }

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
function startPractice() { closeSheet(); emit('startPractice') }

async function startOrder({ room = false } = {}) {
  const s = await launcher.startOrder()
  if (s) { closeSheet(); emit('startSession', s, 'order', { room }) }
}

function resume(session) { closeSheet(); emit('resumeSession', session) }
function askDiscard(session) { sheet.value = { discard: session } }
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
async function restoreDiscarded(d) { await launcher.restore(d) }
const discardOpen = ref(false)
const discardTarget = computed(() => (sheet.value && typeof sheet.value === 'object' ? sheet.value.discard : null))
const discardKind   = computed(() => (discardTarget.value?.type === 'order' ? '発注' : '棚卸'))

// ── 管理タブ ─────────────────────────────────────────────
// 発注の設定（以前は「仕入れ」ページの中。入出庫の画面を記録だけにしたため管理タブへ）
const { allItems, baseOf, unitOf, reorderHorizon } = useStockView()
const { setReorderPoint, setOrderAssumptions } = useConfig()
const showOrderBase = ref(false)
const orderBaseRows = computed(() => allItems.value.map(item => ({
  item, category: config.categories?.[item] ?? '', ...baseOf(item),
})))
function openSchedule() { orderScheduleFocusId.value = null; showOrderSchedule.value = true }
const showInspector = ref(false)   // 記録の確認（サーバーと端末の記録を並べる）
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
  if (showInspector.value) { showInspector.value = false; return true }
  if (showOrderBase.value) { showOrderBase.value = false; return true }
  if (sheet.value) { closeSheet(); return true }
  if (tab.value !== 'sessions') { goTab('sessions'); return true }
  return false
}))
</script>

<template>
  <div class="home">
    <header class="home-head">
      <span class="home-logo">🧮 タナオロ</span>
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
    <!-- ── 在庫（ホーム）── -->
    <StockPage
      v-show="!loading && tab === 'sessions'"
      :class="['home-panel', slideDir && `slide-${slideDir}`]"
      ref="stockRef"
      embedded
      @open-master="emit('openMaster')"
      @start-session="startStockEmpty"
    >
      <template #top="{ empty }">
        <div class="home-top">
          <div v-if="error" class="home-err">{{ error }}</div>

          <!-- 中断中のセッション（今日のやることより先） -->
          <div v-if="activeSession" class="strip pause stock">
            <span class="strip-t">⏸ 棚卸（中断中）<small>{{ _itemCount(activeSession) }}品目 ・ {{ _hm(activeSession.startedAt) }}〜</small></span>
            <button class="strip-go" type="button" @click="resume(activeSession)">再開</button>
            <button class="strip-more" type="button" aria-label="棚卸を破棄" :disabled="deletingId === activeSession.id" @click="askDiscard(activeSession)">⋯</button>
          </div>
          <div v-if="activeOrderSession" class="strip pause order">
            <span class="strip-t">⏸ 発注（中断中）<small>{{ _itemCount(activeOrderSession) }}品目 ・ {{ _hm(activeOrderSession.startedAt) }}〜</small></span>
            <button class="strip-go" type="button" @click="resume(activeOrderSession)">再開</button>
            <button class="strip-more" type="button" aria-label="発注を破棄" :disabled="deletingId === activeOrderSession.id" @click="askDiscard(activeOrderSession)">⋯</button>
          </div>
          <!-- 破棄して24時間以内（元に戻せる）。過ぎるとサーバーが完全に消す。
               2件以上は1行にまとめ、開くと一覧（User決定 2026-10-01） -->
          <button v-if="discarded.length >= 2" class="strip discard fold" type="button" :aria-expanded="String(discardOpen)" @click="discardOpen = !discardOpen">
            <span class="strip-t">🗑 破棄したセッション {{ discarded.length }}件<small>24時間以内なら元に戻せます</small></span>
            <span class="strip-arrow">{{ discardOpen ? '▲' : '▼' }}</span>
          </button>
          <template v-if="discarded.length === 1 || discardOpen">
            <div v-for="d in discarded" :key="d.id" :class="['strip', 'discard', { inner: discarded.length >= 2 }]">
              <span class="strip-t">🗑 破棄した<span :class="['strip-kind', d.type === 'order' ? 'k-order' : 'k-stock']">{{ d.type === 'order' ? '発注' : '棚卸' }}</span><small>{{ d.itemCount }}品目 ・ {{ _hm(d.startedAt) }}〜 ・ {{ discardRemain(d) }}で完全に消えます</small></span>
              <button class="strip-go" type="button" :disabled="restoringId === d.id" @click="restoreDiscarded(d)">{{ restoringId === d.id ? '戻しています…' : '元に戻す' }}</button>
            </div>
          </template>

          <!-- 操作ボタン -->
          <div v-if="!empty" class="acts">
            <button class="act stock" type="button" :disabled="startingKind === 'stock'" @click="openStockSheet">
              <b>👥</b>{{ startingKind === 'stock' ? '開始中…' : '棚卸' }}
            </button>
            <button class="act order" type="button" :disabled="startingKind === 'order'" @click="openOrderSheet">
              <b>🧾</b>{{ startingKind === 'order' ? '開始中…' : '発注' }}
            </button>
            <button class="act" type="button" @click="emit('openMovement', 'in')">
              <b>📥</b>入出庫
              <span v-if="unreflectedCount > 0" class="act-badge" :title="`入庫として未反映の発注 ${unreflectedCount}件`">{{ unreflectedCount }}</span>
              <span v-else-if="hasMovementDraft" class="act-dot" title="記録していない入力があります"></span>
            </button>
          </div>
        </div>
      </template>
    </StockPage>

    <!-- ── レポート（在庫分析）── -->
    <div v-if="!loading && tab === 'report'" :class="['report-tab', 'home-panel', slideDir && `slide-${slideDir}`]">
      <button class="m-card rt-hist" type="button" @click="emit('openHistory')">📅<span>履歴カレンダー<small>棚卸・発注・入出庫の記録を日付から開く</small></span><i>›</i></button>
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
      @clear-master="p => emit('clearMaster', p)"
    >
      <template #extra>
        <div class="manage">
          <div class="m-h">発注の設定</div>
          <button class="m-card" type="button" @click="openSchedule">🗓<span>発注日・締切<small>発注する曜日と締切の時刻（今日の帯・発注の開始に出ます）</small></span><i>›</i></button>
          <button class="m-card" type="button" @click="showOrderBase = true">🎯<span>発注基準<small>要補充の判定に使う発注点・補充の目安</small></span><i>›</i></button>
          <div class="m-h">その他</div>
          <button class="m-card" type="button" @click="settingsSection = 'general'">⚙️<span>各種設定<small>端末名・通知・アプリ情報</small></span><i>›</i></button>
          <button class="m-card" type="button" @click="showInspector = true">🔎<span>記録の確認<small>サーバーと端末に残っている棚卸・発注の記録を一覧</small></span><i>›</i></button>
          <button class="m-card" type="button" @click="emit('openFeedback')">💬<span>フィードバックを送る<small>不具合・要望を開発者へ</small></span><i>›</i></button>
          <template v-if="otherActiveSessions.length">
            <div class="m-h">その他の未完了（古い）</div>
            <div v-for="s in otherActiveSessions" :key="s.id" class="m-old">
              <span>{{ _hm(s.startedAt) }} 開始 ・ {{ _itemCount(s) }}品目</span>
              <button type="button" class="m-old-btn" @click="resume(s)">再開</button>
              <button type="button" class="m-old-btn ng" :disabled="deletingId === s.id" @click="askDiscard(s)">破棄</button>
            </div>
          </template>
          <button v-if="isAuthenticated" class="m-logout" type="button" @click="onLogout">ログアウト</button>
        </div>
      </template>
    </MasterManagePage>

    </div><!-- /.home-panels -->

    <!-- ── 下部ナビ（全画面共通の部品）── -->
    <HomeFooterNav :active="tab" @go="goTab" />

    <DataInspector v-if="showInspector" @close="showInspector = false" />
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
          <div class="note">やめる場合は、ホームの「中断中」の帯の ⋯ か、棚卸の画面の ☰ から破棄できます。</div>
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
        </template>
        <button class="sh-link" type="button" @click="startPractice">練習してみる（履歴に残りません） ›</button>
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
          <div class="note">やめる場合は、ホームの「中断中」の帯の ⋯ か、発注の画面の ☰ から破棄できます。</div>
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
          <b>24時間以内なら、ホームの「破棄した{{ discardKind }}」から元に戻せます。</b>過ぎると完全に消えます。
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
.home { min-height: 100vh; min-height: 100dvh; background: var(--bg, #f1f5f9); --home-chrome: calc(112px + env(safe-area-inset-bottom)); }
/* 横スワイプでタブを移る面。縦スクロールはブラウザに任せ、横だけこちらで受ける */
.home-panels { touch-action: pan-y; }
.home-panel.slide-l { animation: home-slide-l .22s ease-out; }
.home-panel.slide-r { animation: home-slide-r .22s ease-out; }
@keyframes home-slide-l { from { transform: translateX(24px); opacity: .4; } to { transform: none; opacity: 1; } }
@keyframes home-slide-r { from { transform: translateX(-24px); opacity: .4; } to { transform: none; opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .home-panel.slide-l, .home-panel.slide-r { animation: none; } }
.home-head {
  position: sticky; top: 0; z-index: 3; display: flex; align-items: baseline; gap: 8px;
  padding: 12px 14px; background: #fff; border-bottom: 1px solid #e2e8f0;
}
.home-logo { font-size: 16px; font-weight: 800; color: #1e293b; }
.home-store { font-size: 12px; font-weight: 700; color: #64748b; }
.home-store small { font-weight: 600; color: #94a3b8; letter-spacing: .5px; margin-left: 6px; }
.home-top { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px 0; }
.home-err { font-size: 12.5px; color: #b91c1c; background: #fef2f2; border: 1px solid #fecaca; border-radius: 10px; padding: 8px 10px; }

.strip { display: flex; align-items: center; gap: 8px; border-radius: 12px; padding: 8px 10px; font-size: 13px; font-weight: 700; border: none; text-align: left; font-family: inherit; cursor: pointer; }
.strip-t { flex: 1; min-width: 0; }
.strip-t small { font-weight: 600; opacity: .85; margin-left: 4px; }
.strip.today { background: #fff; border: 1px solid #e2e8f0; color: #334155; }
.strip.today b { color: #c2410c; }
.strip-arrow { color: #94a3b8; font-size: 18px; }
.strip.pause.stock { background: #dbeafe; color: #1d4ed8; cursor: default; }
.strip.pause.order { background: #ffedd5; color: #c2410c; cursor: default; }
.strip.discard { background: #f1f5f9; color: #475569; cursor: default; border: 1px dashed #cbd5e1; }
.strip.discard.fold { cursor: pointer; }
/* 棚卸と発注を色で見分ける（ホームのボタンと同じ 青／オレンジ） */
.strip-kind { font-weight: 800; }
.strip-kind.k-stock { color: #2563eb; }
.strip-kind.k-order { color: #ea580c; }
.strip.discard.inner { margin-left: 14px; }
.strip.discard .strip-go { background: #fff; color: #334155; border: 1.5px solid #94a3b8; }
.strip-go { border: none; border-radius: 9px; padding: 6px 14px; font-weight: 800; font-size: 13px; color: #fff; cursor: pointer; }
.stock .strip-go { background: #2563eb; }
.order .strip-go { background: #ea580c; }
.strip-more { border: none; background: none; font-size: 20px; font-weight: 800; color: inherit; padding: 0 4px; cursor: pointer; }

.acts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.act {
  position: relative; background: #fff; border: 1.5px solid #e2e8f0; border-radius: 14px;
  padding: 9px 0 8px; font-size: 12.5px; font-weight: 800; color: #334155; cursor: pointer; font-family: inherit;
}
.act b { display: block; font-size: 22px; margin-bottom: 2px; }
.act.stock { border-color: #93c5fd; color: #1d4ed8; background: #eff6ff; }
.act.order { border-color: #fdba74; color: #c2410c; background: #fff7ed; }
.act:disabled { opacity: .6; cursor: default; }
.act-badge { position: absolute; top: 5px; right: 8px; background: #059669; color: #fff; border-radius: 999px; font-size: 10.5px; padding: 1px 6px; }
.act-dot { position: absolute; top: 8px; right: 12px; width: 8px; height: 8px; border-radius: 50%; background: #f59e0b; }

.manage { padding: 0 0 12px; }
.m-h { font-size: 12px; font-weight: 800; color: #64748b; margin: 14px 2px 6px; }
.m-card {
  display: flex; align-items: center; gap: 12px; width: 100%; text-align: left; font-family: inherit;
  background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px 14px; margin-bottom: 8px;
  font-size: 20px; cursor: pointer;
}
.m-card span { flex: 1; font-size: 14.5px; font-weight: 800; color: #1e293b; display: flex; flex-direction: column; gap: 2px; }
.m-card small { font-size: 11.5px; font-weight: 600; color: #64748b; }
.m-card i { font-style: normal; color: #94a3b8; font-size: 18px; }
.m-old { display: flex; align-items: center; gap: 8px; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 10px 12px; margin-bottom: 8px; font-size: 12.5px; color: #334155; }
.m-old span { flex: 1; }
.m-old-btn { border: 1.5px solid #cbd5e1; background: #fff; border-radius: 8px; padding: 5px 10px; font-weight: 800; font-size: 12px; cursor: pointer; }
.m-old-btn.ng { border-color: #fca5a5; color: #b91c1c; }
.m-logout { display: block; margin: 24px auto 0; border: none; background: none; color: #dc2626; font-weight: 700; font-size: 14px; cursor: pointer; }

/* レポートタブ */
.report-tab { padding: 4px 6px calc(80px + env(safe-area-inset-bottom)); }

.sh-bg { position: fixed; inset: 0; z-index: 50; background: rgba(15, 23, 42, .45); display: flex; align-items: flex-end; justify-content: center; }
.sh { width: 100%; max-width: 600px; background: #fff; border-radius: 18px 18px 0 0; padding: 12px 16px calc(18px + env(safe-area-inset-bottom)); max-height: 90vh; overflow-y: auto; }
.sh-handle { width: 40px; height: 4px; border-radius: 2px; background: #cbd5e1; margin: 0 auto 12px; }
.sh-t { font-size: 18px; font-weight: 800; color: #1e293b; }
.sh-t.ng { color: #b91c1c; }
.sh-s { font-size: 12.5px; color: #64748b; margin: 4px 0 12px; line-height: 1.5; }
.info { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px; }
.info div { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 8px 10px; font-size: 11.5px; color: #64748b; font-weight: 700; }
.info b { display: block; font-size: 15px; color: #0f172a; margin-top: 2px; }
.info b.warn { color: #c2410c; }
.bb {
  display: flex; align-items: center; gap: 12px; width: 100%; text-align: left; font-family: inherit;
  border-radius: 13px; padding: 13px 14px; margin-bottom: 9px; font-size: 22px; cursor: pointer;
  background: #fff; color: #334155; border: 1.5px solid #cbd5e1;
}
.bb span { flex: 1; font-size: 15px; font-weight: 800; display: flex; flex-direction: column; gap: 2px; }
.bb small { font-size: 11.5px; font-weight: 600; opacity: .85; }
.bb:disabled { opacity: .6; cursor: default; }
.bb.stock { background: #2563eb; color: #fff; border-color: #2563eb; }
.bb.stock-soft { background: #eff6ff; color: #1d4ed8; border-color: #93c5fd; }
.bb.order { background: #ea580c; color: #fff; border-color: #ea580c; }
.bb.order-soft { background: #fff7ed; color: #c2410c; border-color: #fdba74; }
.bb.ng { color: #b91c1c; border-color: #fca5a5; }
.sh-link { display: block; margin: 4px auto 0; border: none; background: none; color: #64748b; font-size: 12.5px; font-weight: 700; cursor: pointer; }
.note { border-radius: 10px; padding: 9px 11px; font-size: 12.5px; line-height: 1.6; margin-bottom: 12px; }
.note.orange { background: #fff7ed; border: 1px solid #fdba74; color: #9a3412; }
.note.blue { background: #eff6ff; border: 1px solid #93c5fd; color: #1e3a8a; }
.note.red { background: #fef2f2; border: 1px solid #fca5a5; color: #7f1d1d; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.btn { border: 1.5px solid #cbd5e1; background: #f1f5f9; color: #334155; border-radius: 11px; padding: 13px 0; font-weight: 800; font-size: 15px; cursor: pointer; font-family: inherit; }
.btn.ng { background: #b91c1c; color: #fff; border-color: #b91c1c; }
</style>
