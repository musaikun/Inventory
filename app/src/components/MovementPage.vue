<script setup>
import { ref, computed, onMounted } from 'vue'
import { useConfig } from '../composables/useConfig.js'
import { useHistory } from '../composables/useHistory.js'
import { useMovements, deliveryLinesFromOrder, unreflectedOrders } from '../composables/useMovements.js'
import { useMovementDraft } from '../composables/useMovementDraft.js'
import { useOrders } from '../composables/useOrders.js'
import { getSessions, createSession } from '../composables/useAuth.js'
import { hasSchedule, scheduleSummary, todayOrderContext, deadlineStatus } from '../services/orderScheduleUtil.js'
import { showOrderSchedule } from '../composables/appMenuState.js'
import OrderScheduleModal from './OrderScheduleModal.vue'
import { saveMovementToD1 } from '../composables/useStore.js'
import { theoreticalStock } from '../services/theoreticalStock.js'
import { avgDailyConsumption } from '../services/impliedConsumption.js'
import { itemConsumptionAvailability, storeConsumptionReadiness } from '../services/analysisCapability.js'
import { parseLot } from '../services/lot.js'
import { useHorizontalSwipe } from '../composables/useSwipe.js'
import { useDataImport } from '../composables/useDataImport.js'
import DeliveryImportModal from './DeliveryImportModal.vue'
import PastStocktakeImportModal from './PastStocktakeImportModal.vue'
import RowMapperModal from './RowMapperModal.vue'
import MovementQtyModal from './MovementQtyModal.vue'
import InventoryTable from './InventoryTable.vue'
import StockDetailModal from './StockDetailModal.vue'

const emit = defineEmits(['back', 'saved', 'startSession', 'resumeSession'])

const { config, itemCount, setReorderPoint } = useConfig()
const { getSnapshots } = useHistory()
const { saveMovement, getMovements } = useMovements()
const { getOrders } = useOrders()
const { draft, clearMode } = useMovementDraft()

// 画面モード: 在庫（読み取り）/ 入庫（記録）/ 出庫（記録）
// 在庫 → 発注 → 入庫 → 出庫（仕入れの流れ順）。既定は在庫（出庫を主導線に上げない）。
const TAB_ORDER = ['view', 'order', 'in', 'out']
const mode = ref('view')  // 'view' | 'order' | 'in' | 'out'
// 記録タブ＝数量を入力して保存する2つ。発注はセッション（別画面）へ渡す入口なので含めない。
const isRecord = computed(() => mode.value === 'in' || mode.value === 'out')
const isOrderTab = computed(() => mode.value === 'order')
const slideDir = ref('fwd')  // タブ切替時のスライド方向（アニメーション用）
const tabIndex = computed(() => TAB_ORDER.indexOf(mode.value))  // スライド下線の位置
// メモはモード別（入庫/出庫で混ざらない）
const noteModel = computed({
  get: () => (mode.value === 'out' ? draft.noteOut : draft.noteIn),
  set: (v) => { if (mode.value === 'out') draft.noteOut = v; else draft.noteIn = v },
})

const search = ref('')
// 日付・メモ・発注紐付け・入力量は draft（localStorage 保持）に持つ。
// 未記録のままホームへ戻っても入力が残り、ホームカードに「未記録の入力あり」を出せる。

const hiddenSet = computed(() => new Set(config.hiddenItems || []))
const allItems = computed(() => (config.order || []).filter(n => !hiddenSet.value.has(n)))

// 発注点（手動設定）。未設定は null。
function reorderOf(item) {
  const v = Number(config.reorderPoints?.[item])
  return Number.isFinite(v) && v >= 0 ? v : null
}
// 要補充判定: 発注点が設定されていれば「理論在庫 ≤ 発注点」、無ければ「0以下」
function needsReorder(item) {
  const t = theoOf(item)
  if (t == null) return false
  const rp = reorderOf(item)
  return rp != null ? t <= rp : t <= 0
}

// 在庫タブ専用の状態フィルタ: 'all' | 'has'（在庫あり>0） | 'reorder'（要補充）
const stockFilter = ref('all')
// 在庫タブの絞り込みは表へ述語として渡す（品目名の検索は表の searchTerm 側が担う）
function stockItemFilter(item) {
  if (stockFilter.value === 'all') return true
  const t = theoOf(item)
  if (t == null) return false                // 理論在庫なし（—）は絞り込み対象外
  return stockFilter.value === 'has' ? t > 0 : needsReorder(item)
}
// 要補充の件数 — フィルタチップのバッジ用
const reorderCount = computed(() => allItems.value.reduce((n, item) => n + (needsReorder(item) ? 1 : 0), 0))

// ── 品目詳細（在庫タブ・行タップでシート）───────────────────
// 行アコーディオンからモーダルへ移した。3タブとも「行タップ → シート」に統一し、
// 一覧そのものは棚卸・発注と同じ見え方（行に内訳を出さない）を保つ。
const detailTarget = ref(null)   // null | 品目名
function closeDetail() { detailTarget.value = null }
// その品目に関わる直近の入出庫（新しい順・最大6件）
function itemMovements(item) {
  const out = []
  for (const mv of getMovements()) {   // 既に date 降順
    const line = (mv.lines || []).find(l => l.item === item)
    if (line) out.push({ id: mv.id, date: mv.date, type: mv.type, qty: line.qty, unit: line.unit, note: mv.note })
    if (out.length >= 6) break
  }
  return out
}

// ── 推奨発注点の目安（暫定ヒューリスティック）───────────────
// 手動発注点＝人間が決める床。ここは「データから出す目安」を横に添えるだけ（自動上書きしない）。
// 将来は曜日別・外的/内的要因の予測モデルに置き換える。
// 目安 = 推定日消費 × 発注間隔（発注曜日の最大ギャップ、未設定は7日）。
// 消費は「論理出庫」＝在庫観測（棚卸・発注時在庫）＋入庫から逆算（出庫を記録しない飲食店でも出る）。
function dailyConsumption(item) {
  return avgDailyConsumption(item, { windowDays: 30, snapshots: _snaps.value, orders: getOrders(), movements: _moves.value })
}
// ゲート表示: 算出に必要なデータが揃わない場合のヒント（過去棚卸の取込を促す）
function consumptionHintOf(item) {
  return itemConsumptionAvailability(item, { snapshots: _snaps.value, orders: getOrders() }).hint
}
const storeReadiness = computed(() => storeConsumptionReadiness({ snapshots: _snaps.value }))
const reorderHorizon = computed(() => {
  const days = [...new Set((config.orderSchedule?.days || []).map(Number))].sort((a, b) => a - b)
  if (days.length < 2) return 7
  let maxGap = 0
  for (let i = 0; i < days.length; i++) {
    const gap = (days[(i + 1) % days.length] - days[i] + 7) % 7 || 7
    maxGap = Math.max(maxGap, gap)
  }
  return maxGap
})
// 目安の根拠（推定消費 × 発注間隔）。算出できないときは空文字。
function suggestBasisLabel(item) {
  const avg = dailyConsumption(item)
  if (avg == null || avg <= 0) return ''
  return `推定消費 ${avg.toFixed(1)}/日 × ${reorderHorizon.value}日`
}
function suggestedReorder(item) {
  const avg = dailyConsumption(item)
  if (avg == null || avg <= 0) return null
  return Math.max(1, Math.ceil(avg * reorderHorizon.value))
}

// ── 理論在庫（全品目を一括算出）─────────────────────────────
const _snaps = computed(() => getSnapshots())
const _moves = computed(() => getMovements())
const stockMap = computed(() => {
  const snaps = _snaps.value, moves = _moves.value
  const m = {}
  for (const item of allItems.value) m[item] = theoreticalStock(item, snaps, moves)
  return m
})
function theoOf(item) { return stockMap.value[item]?.qty ?? null }
function unitOf(item) { return config.units?.[item] ?? '' }
function _md(d) {
  const [, mo, dd] = String(d || '').split('-').map(Number)
  return mo && dd ? `${mo}/${dd}` : ''
}
function basisLabel(item) {
  const t = stockMap.value[item]
  if (!t) return '記録なし'
  const parts = [t.baseDate ? `${_md(t.baseDate)}棚卸 ${t.baseQty}` : '棚卸なし']
  if (t.inQty)  parts.push(`＋入庫${t.inQty}`)
  if (t.outQty) parts.push(`−出庫${t.outQty}`)
  return parts.join(' ')
}

// ── 入数（ケース）─────────────────────────────
function lotOf(item) { return parseLot(config.lotSizes?.[item]) }

// ── 入力量の操作（現在の記録モード）─────────────────────────
function _q(item) {
  if (!isRecord.value) return 0
  const v = Number(draft[mode.value][item])
  return Number.isFinite(v) && v > 0 ? v : 0
}
function _set(item, v) {
  draft[mode.value][item] = Math.max(0, Math.round(v * 1000) / 1000)
}
// 記録タブの一覧は棚卸・発注と同じ InventoryTable を使う。
// あちらは { 品目: { qty, unit } } を「入力済みの行」として描くので、今回の入力量を
// その形へ写す（0 は未入力＝null）。保存に使うのは従来どおり draft のほうで、
// ここで作るのは表示用の射影。
const draftInventory = computed(() => {
  const inv = {}
  if (!isRecord.value) return inv
  for (const item of allItems.value) {
    const q = _q(item)
    if (q > 0) inv[item] = { qty: q, unit: unitOf(item) }
  }
  return inv
})

// 行のヒント欄に出す理論在庫（記録後の値も添える）。出庫で在庫を割り込む入力に気づけるようにする。
const theoNoteMap = computed(() => {
  const map = {}
  if (!isRecord.value) return map
  for (const item of allItems.value) {
    const t = theoOf(item)
    if (t == null) continue
    const q = _q(item)
    map[item] = q > 0 ? `理論: ${t}${unitOf(item)} → ${afterQty(item)}${unitOf(item)}` : `理論: ${t}${unitOf(item)}`
  }
  return map
})

// 数量入力は棚卸・発注と同じ NumPad シートで行う（打鍵感をそろえ、OSキーボードを出さない）。
// 行内の −/＋/＋箱 は連打用に残す。数量チップをタップするとここが開く。
const qtyTarget = ref(null)   // null | 品目名
function openQty(item) { if (isRecord.value) qtyTarget.value = item }
// 行タップの先はタブで変わる（在庫=詳細シート / 入庫・出庫=数量シート）
function onRowTap(item) {
  if (isRecord.value) openQty(item)
  else detailTarget.value = item
}
function closeQty()    { qtyTarget.value = null }
function onQtyConfirm(v) {
  if (qtyTarget.value) _set(qtyTarget.value, Number(v) || 0)
  closeQty()
}
// 記録後の理論在庫プレビュー
function afterQty(item) {
  const t = theoOf(item)
  if (t == null) return null
  return Math.round((t + (mode.value === 'out' ? -_q(item) : _q(item))) * 1000) / 1000
}

// ── 記録対象の行 ─────────────────────────────
const changed = computed(() => (isRecord.value ? allItems.value.filter(n => _q(n) > 0) : []))
const recordLines = computed(() => changed.value.map(n => ({ item: n, qty: _q(n), unit: unitOf(n) })))
const canSave = computed(() => recordLines.value.length > 0)

// ── 発注→入庫の一括プリフィル（入庫モードのみ）─────────────
// 未反映の発注（直近30日で入庫が未記録のもの）。ホームカードのバッジと共通の純関数を使う。
const pendingOrders = computed(() => unreflectedOrders(getOrders(), _moves.value, 30).slice(0, 5))
function importOrder(o) {
  const dl = deliveryLinesFromOrder(o)
  if (dl.length === 0) return
  for (const l of dl) _set(l.item, _q(l.item) + l.qty)
  draft.orderId = o.id
  draft.orderLabel = `${_md(o.date)} ${o.supplier || '（未分類）'}`
  if (!draft.noteIn) draft.noteIn = `${_md(o.date)}発注分の納品`
}
function unlinkOrder() { draft.orderId = null; draft.orderLabel = '' }

// ── モード切替・保存 ─────────────────────────────
// 発注紐付けは入庫の保存でのみ使う。モード切替では消さない（在庫を見て戻っても保持）。
function setMode(m) {
  if (m === mode.value) return
  slideDir.value = TAB_ORDER.indexOf(m) > TAB_ORDER.indexOf(mode.value) ? 'fwd' : 'back'
  mode.value = m
}
// 左右スワイプで在庫→入庫→出庫を切り替え
const swipe = useHorizontalSwipe({
  onLeft:  () => { const i = TAB_ORDER.indexOf(mode.value); if (i < TAB_ORDER.length - 1) setMode(TAB_ORDER[i + 1]) },
  onRight: () => { const i = TAB_ORDER.indexOf(mode.value); if (i > 0) setMode(TAB_ORDER[i - 1]) },
})
function onSave() {
  if (!canSave.value) return
  const m = mode.value
  const rec = saveMovement({
    type: m === 'out' ? 'out' : 'in',
    date: draft.date,
    note: m === 'out' ? draft.noteOut : draft.noteIn,
    orderId: m === 'in' ? draft.orderId : null,
    lines: recordLines.value,
  })
  if (rec) saveMovementToD1(rec)   // D1 にも永続化（端末間共有・キャッシュ削除からの復旧）
  // 保存したモードのドラフトをクリアし、在庫（確認）に戻って結果を見せる
  clearMode(m)
  emit('saved')
  mode.value = 'view'
}

// ── 発注（既存の発注セッションへの入口）───────────────────────
// 発注はルーム同期・完了確定を持つセッションなので、このページでは開始・再開だけを扱う。
// カード内に別の発注記録を作ると「どちらが正か分からない」2経路になるため作らない。
const orderSessions = ref([])
const orderLoading  = ref(true)
const orderError    = ref('')
const startingOrder = ref(false)

onMounted(async () => {
  try {
    const list = await getSessions()
    orderSessions.value = Array.isArray(list) ? list : []
  } catch (e) {
    orderError.value = e?.message || '発注の状態を取得できませんでした'
  } finally {
    orderLoading.value = false
  }
})

const activeOrderSession = computed(() =>
  orderSessions.value
    .filter(s => s.status !== 'completed' && s.type === 'order')
    .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))[0] || null)

const orderSchedule = computed(() => config.orderSchedule ?? { days: [], deadline: '' })
const hasSched      = computed(() => hasSchedule(orderSchedule.value))
const schedSummary  = computed(() => scheduleSummary(orderSchedule.value))
const schedTodayCtx = computed(() => todayOrderContext(orderSchedule.value, new Date()))
const schedDeadline = computed(() => deadlineStatus(orderSchedule.value, new Date()))

// 発注タブから「入庫へ」= 入庫タブへ移動して、その発注をプリフィルする。
// 発注（LOT数）→ 入庫（バラ）の換算は deliveryLinesFromOrder が持つ既存の契約をそのまま使う。
function applyOrderToInbound(o) {
  setMode('in')
  importOrder(o)
}

function _formatDate(iso) {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' })
}

async function onStartOrder() {
  if (itemCount.value === 0) { orderError.value = '先に品目マスタを登録してください'; return }
  startingOrder.value = true
  orderError.value = ''
  try {
    const session = await createSession('order')
    emit('startSession', session, 'order')
  } catch (e) {
    orderError.value = e?.message || '発注を開始できませんでした'
  } finally {
    startingOrder.value = false
  }
}

// ── 過去データの一括取込（納品・棚卸）は composable に集約 ─────────
// 導線はこの画面とデータ管理画面の2箇所だが、実装は useDataImport 1つ。
const {
  showDeliveryModal, deliveryCsv, deliveryFilename, importCtx, existingMovements,
  openDeliveryFromFile, closeDelivery, onDeliveryImported: commitDelivery, downloadDeliveryTemplate,
  showStocktakeModal, stocktakePlan, stocktakeFilename,
  rowMapper, closeRowMapper, applyRowMapping, mapDeliveryColumns,
  openStocktakeFromFile, closeStocktake, setStocktakeResolution,
  confirmStocktakeImport, undoStocktakeImport,
} = useDataImport()

const deliveryFileInput  = ref(null)
const stocktakeFileInput = ref(null)
function pickDelivery()  { deliveryFileInput.value?.click() }
function pickStocktake() { stocktakeFileInput.value?.click() }
function onDeliveryFile(e)  { const f = e.target.files?.[0]; e.target.value = ''; openDeliveryFromFile(f) }
function onStocktakeFile(e) { const f = e.target.files?.[0]; e.target.value = ''; openStocktakeFromFile(f) }
function onDeliveryImported(payload) { const n = commitDelivery(payload); if (n > 0) emit('saved') }
</script>

<template>
  <div :class="['mv', mode]">
    <header class="mv-header">
      <button class="mv-back" @click="emit('back')">‹ 戻る</button>
      <span class="mv-title">🛒 仕入れ</span>
      <span v-if="isRecord && changed.length" class="mv-count">{{ changed.length }}品目</span>
      <button class="mv-gear" :class="{ alone: !(isRecord && changed.length) }" title="発注日・締切の設定" @click="showOrderSchedule = true">⚙</button>
    </header>

    <!-- モードタブ（スライド下線で切替可能を示す）-->
    <div class="mv-tabs">
      <button :class="['mv-tab', { on: mode === 'view' }]" @click="setMode('view')">在庫</button>
      <button :class="['mv-tab', 'order', { on: mode === 'order' }]" @click="setMode('order')">
        🧾 発注<span v-if="activeOrderSession" class="mv-tab-dot" title="進行中の発注があります"></span>
      </button>
      <button :class="['mv-tab', 'in', { on: mode === 'in' }]" @click="setMode('in')">
        📥 入庫<span v-if="pendingOrders.length" class="mv-tab-badge">{{ pendingOrders.length }}</span>
      </button>
      <button :class="['mv-tab', 'out', { on: mode === 'out' }]" @click="setMode('out')">📤 出庫</button>
      <div class="mv-tab-ind" :class="mode" :style="{ transform: `translateX(${tabIndex * 100}%)` }"></div>
    </div>
    <div class="mv-swipe-hint">‹ スワイプで切替 ›</div>

    <div
      class="mv-scroll"
      @touchstart.passive="swipe.onTouchStart"
      @touchmove.passive="swipe.onTouchMove"
      @touchend.passive="swipe.onTouchEnd"
    >
     <div class="mv-page" :key="mode" :class="slideDir">
      <!-- 表の外側（日付・メモ・検索・案内）。表そのものは全幅で置き、棚卸と同じ地続きにする -->
      <div class="mv-controls-wrap">
      <!-- 記録モード: 日付・メモ・発注取込 -->
      <template v-if="isRecord">
        <div class="mv-controls">
          <div class="mv-ctl-row">
            <label class="mv-ctl-label">日付</label>
            <input v-model="draft.date" type="date" class="mv-date" />
          </div>
          <input v-model="noteModel" type="text" class="mv-note" placeholder="メモ（任意）例: 火曜納品分 / まかない使用" />
        </div>

        <div v-if="mode === 'in' && draft.orderId" class="mv-linked">
          🧾 {{ draft.orderLabel }} の発注を入庫にプリフィル済み
          <button class="mv-linked-clear" @click="unlinkOrder">解除</button>
        </div>
        <div v-else-if="mode === 'in' && pendingOrders.length" class="mv-orders">
          <div class="mv-orders-title">🧾 入庫として未反映の発注があります</div>
          <div class="mv-orders-list">
            <div v-for="o in pendingOrders" :key="o.id" class="mv-order-row">
              <div class="mv-order-info">
                <span class="mv-order-when">{{ _md(o.date) }} {{ o.supplier || '（未分類）' }}</span>
                <span class="mv-order-meta">{{ o.lines.length }}品目の発注が未反映です</span>
              </div>
              <button class="mv-order-apply" @click="importOrder(o)">反映する</button>
            </div>
          </div>
          <div class="mv-orders-note">※ 実際に届いた数に直してから保存できます（分納・欠品に対応）</div>
        </div>

        <!-- 過去データの一括取込（入庫モードのみ）-->
        <div v-if="mode === 'in'" class="mv-import-bar">
          <button class="mv-import-btn" @click="pickDelivery">📥 過去の納品を取り込む（CSV/Excel）</button>
          <button class="mv-import-tmpl" @click="downloadDeliveryTemplate">テンプレ</button>
          <input ref="deliveryFileInput" type="file" accept=".csv,.xlsx,.xls,text/csv" class="mv-hidden-file" @change="onDeliveryFile" />
        </div>
        <div v-if="mode === 'in'" class="mv-import-sub">
          <button class="mv-import-sub-btn" @click="pickStocktake">🧮 過去の棚卸を取り込む（消費・理論値の算出に必要）</button>
        </div>
      </template>

      <!-- 発注タブ: 既存の発注セッションへの入口。ここでは表を出さない -->
      <template v-if="isOrderTab">
        <div class="mv-hint">
          仕入先ごとに、発注する数をまとめて確認・記録します<span class="mv-beta">β</span><br>
          <span class="mv-hint-caveat">記録するだけで、仕入先へは自動送信されません。複数人で同時に入力できます。</span>
        </div>

        <div v-if="orderError" class="mv-order-err">{{ orderError }}</div>

        <!-- 発注スケジュール（⚙ から設定） -->
        <button class="mv-sched" type="button" @click="showOrderSchedule = true">
          <span class="mv-sched-ico">🗓</span>
          <span class="mv-sched-text">
            <template v-if="hasSched">
              <span class="mv-sched-sum">
                {{ schedSummary }}
                <span v-if="schedDeadline.has" :class="['mv-sched-dl', { past: schedDeadline.past }]">・{{ schedDeadline.label }}</span>
              </span>
              <span v-if="schedTodayCtx" class="mv-sched-ctx">{{ schedTodayCtx }}</span>
            </template>
            <template v-else>
              <span class="mv-sched-sum">発注スケジュールを設定</span>
              <span class="mv-sched-ctx">発注する曜日・締切を登録（任意）</span>
            </template>
          </span>
          <span class="mv-sched-edit">{{ hasSched ? '変更' : '設定' }}</span>
        </button>

        <div v-if="orderLoading" class="mv-order-loading">読み込み中...</div>
        <template v-else>
          <button v-if="activeOrderSession" class="mv-order-resume" @click="emit('resumeSession', activeOrderSession)">
            <span class="mv-order-resume-title">🧾 進行中の発注があります</span>
            <span class="mv-order-resume-sub">開始 {{ _formatDate(activeOrderSession.startedAt) }}</span>
            <span class="mv-order-resume-go">記録を再開する →</span>
          </button>
          <button
            v-else
            class="mv-order-start"
            :disabled="startingOrder || itemCount === 0"
            @click="onStartOrder"
          >
            <span class="mv-order-start-title">{{ startingOrder ? '開始中...' : '＋ 発注を開始' }}</span>
            <span class="mv-order-start-sub">{{ itemCount === 0 ? '先に品目マスタを登録してください' : '在庫を見ながら、発注数を決めます' }}</span>
          </button>
        </template>

        <!-- 未反映の発注（届いたら入庫へ）-->
        <div v-if="pendingOrders.length" class="mv-orders">
          <div class="mv-orders-title">入庫として未反映の発注</div>
          <div class="mv-orders-list">
            <div v-for="o in pendingOrders" :key="o.id" class="mv-order-row">
              <div class="mv-order-info">
                <span class="mv-order-when">{{ _md(o.date) }} {{ o.supplier || '（未分類）' }}</span>
                <span class="mv-order-meta">{{ (o.lines || []).length }}品目</span>
              </div>
              <button class="mv-order-apply" @click="applyOrderToInbound(o)">入庫へ →</button>
            </div>
          </div>
          <p class="mv-orders-note">届いた分を入庫として記録すると、理論在庫に反映されます。</p>
        </div>
      </template>

      <!-- 品目検索。表の絞り込みへ渡す -->
      <input v-if="!isOrderTab" v-model="search" type="text" class="mv-search" placeholder="品目名で絞り込み" />

      <div v-if="mode === 'in'" class="mv-hint">納品分を入力。入数がある品目は「＋箱」でケース単位（バラに換算）。</div>
      <div v-else-if="mode === 'out'" class="mv-hint">使用・廃棄した数を個（バラ）で入力。</div>
      <div v-else-if="mode === 'view'" class="mv-hint">
        直近の棚卸を基準に、入出庫を加減算した理論在庫です。0以下は要補充。<br>
        <span class="mv-hint-caveat">記録していない使用・ロス・納品の分だけ実際とずれます。正確な数は棚卸で確定します。</span>
      </div>

      <!-- ゲート案内: 消費・理論値の算出下地が無いとき、過去棚卸の取込を促す -->
      <div v-if="mode === 'view' && !storeReadiness.ready" class="mv-unlock">
        <span class="mv-unlock-txt">💡 {{ storeReadiness.hint }}</span>
        <button class="mv-unlock-btn" @click="pickStocktake">取り込む</button>
      </div>
      </div><!-- /.mv-controls-wrap -->

      <!-- 品目一覧。棚卸・発注とまったく同じ表を使い、タブで数量セル・絞り込み・進捗だけを
           差し替える。行タップの先も3タブで統一する（在庫=詳細シート / 入出庫=数量シート）。 -->
      <InventoryTable
        v-if="!isOrderTab"
        :inventory="isRecord ? draftInventory : {}"
        :filled-count="changed.length"
        :note-map="isRecord ? theoNoteMap : null"
        :search-term="search"
        :item-filter="isRecord ? null : stockItemFilter"
        :can-manage-list="false"
        hide-amount
        hide-tap-continuous
        @tap="onRowTap"
      >
        <!-- 在庫タブ: 数量セルは理論在庫、絞り込みと進捗も在庫の意味に差し替える -->
        <template v-if="!isRecord" #qty="{ row }">
          <div :class="['qty-display', 'mv-theo-cell', { filled: theoOf(row.item) != null, low: needsReorder(row.item) }]">
            <template v-if="theoOf(row.item) != null">
              {{ theoOf(row.item) }}<span class="qty-unit">{{ unitOf(row.item) }}</span>
            </template>
            <template v-else>—</template>
          </div>
        </template>
        <template v-if="!isRecord" #filters>
          <div class="seg-group">
            <button :class="['seg-btn', { active: stockFilter === 'all' }]" @click="stockFilter = 'all'">すべて</button>
            <button :class="['seg-btn', { active: stockFilter === 'has' }]" @click="stockFilter = 'has'">在庫あり</button>
            <button :class="['seg-btn', { active: stockFilter === 'reorder' }]" @click="stockFilter = 'reorder'">
              要補充<span v-if="reorderCount" class="mv-sf-badge">{{ reorderCount }}</span>
            </button>
          </div>
        </template>
        <template v-if="!isRecord" #progress>
          <span class="progress">
            要補充 <strong>{{ reorderCount }}</strong> 件
          </span>
        </template>
      </InventoryTable>
     </div>
    </div>

    <!-- 保存バー（記録モードのみ）-->
    <div v-if="isRecord" class="mv-savebar">
      <div class="mv-save-summary">
        <span v-if="changed.length" :class="['mv-sum', mode]">{{ mode === 'in' ? '入庫' : '出庫' }} {{ changed.length }}品目</span>
        <span v-else class="mv-sum none">数量を入力してください</span>
      </div>
      <div class="mv-save-actions">
        <button :class="['mv-save', mode]" :disabled="!canSave" @click="onSave">
          {{ mode === 'in' ? '入庫を記録' : '出庫を記録' }}
        </button>
      </div>
    </div>

    <!-- 過去棚卸の取込ファイル入力（モード非依存で常設）-->
    <input ref="stocktakeFileInput" type="file" accept=".csv,.xlsx,.xls,text/csv" class="mv-hidden-file" @change="onStocktakeFile" />

    <PastStocktakeImportModal
      v-if="showStocktakeModal && stocktakePlan"
      :plan="stocktakePlan"
      :filename="stocktakeFilename"
      :confirm-import="confirmStocktakeImport"
      :undo-import="undoStocktakeImport"
      @resolve="({ date, resolution }) => setStocktakeResolution(date, resolution)"
      @imported="emit('saved')"
      @close="closeStocktake"
    />

    <DeliveryImportModal
      v-if="showDeliveryModal"
      :csv-text="deliveryCsv"
      :filename="deliveryFilename"
      :ctx="importCtx"
      :existing-movements="existingMovements()"
      @imported="onDeliveryImported"
      @map-columns="mapDeliveryColumns"
      @close="closeDelivery"
    />

    <!-- 自動で読み取れなかったファイルの受け皿（納品・棚卸で共通）-->
    <RowMapperModal
      v-if="rowMapper"
      :csv-text="rowMapper.csvText"
      :filename="rowMapper.filename"
      :title="rowMapper.title"
      :message="rowMapper.message"
      :fields="rowMapper.fields"
      @apply="applyRowMapping"
      @close="closeRowMapper"
    />

    <!-- 数量入力（棚卸・発注と同じ NumPad）-->
    <!-- 在庫の詳細（内訳・発注点・目安・直近の入出庫）-->
    <StockDetailModal
      v-if="detailTarget"
      :item="detailTarget"
      :unit="unitOf(detailTarget)"
      :theo="theoOf(detailTarget)"
      :basis="basisLabel(detailTarget)"
      :reorder="reorderOf(detailTarget)"
      :suggested="suggestedReorder(detailTarget)"
      :suggest-basis="suggestBasisLabel(detailTarget)"
      :hint="consumptionHintOf(detailTarget)"
      :lot="lotOf(detailTarget)"
      :price="config.prices?.[detailTarget] ?? null"
      :category="config.categories?.[detailTarget] ?? ''"
      :movements="itemMovements(detailTarget)"
      @update-reorder="v => setReorderPoint(detailTarget, v)"
      @close="closeDetail"
    />

    <!-- 発注日・締切（ヘッダーの ⚙ から）。開閉stateは App の戻る制御に載っている共有ref -->
    <OrderScheduleModal v-if="showOrderSchedule" @close="showOrderSchedule = false" />

    <MovementQtyModal
      v-if="qtyTarget"
      :item="qtyTarget"
      :mode="mode"
      :qty="_q(qtyTarget)"
      :unit="unitOf(qtyTarget)"
      :lot="lotOf(qtyTarget)"
      :theo="theoOf(qtyTarget)"
      @confirm="onQtyConfirm"
      @cancel="closeQty"
    />
  </div>
</template>

<style scoped>
.mv { min-height: 100dvh; background: #f8fafc; display: flex; flex-direction: column; }

/* 過去納品の一括取込バー */
.mv-import-bar { display: flex; gap: 8px; margin: 8px 0 4px; }
.mv-import-btn {
  flex: 1; padding: 9px 12px; border: 1.5px dashed #10b981; border-radius: 10px;
  background: #ecfdf5; color: #047857; font-size: 13px; font-weight: 700; cursor: pointer;
}
.mv-import-btn:active { background: #d1fae5; }
.mv-import-tmpl {
  padding: 9px 12px; border: 1px solid #cbd5e1; border-radius: 10px;
  background: #fff; color: #475569; font-size: 12px; font-weight: 700; cursor: pointer; white-space: nowrap;
}
.mv-hidden-file { display: none; }
.mv-import-sub { margin: 0 0 8px; }
.mv-import-sub-btn {
  width: 100%; padding: 8px 12px; border: 1px dashed #cbd5e1; border-radius: 10px;
  background: #f8fafc; color: #64748b; font-size: 12px; font-weight: 700; cursor: pointer;
}
.mv-import-sub-btn:active { background: #f1f5f9; }

/* ゲート案内（消費・理論値のアンロック） */
.mv-unlock {
  display: flex; align-items: center; gap: 10px;
  margin: 4px 0 8px; padding: 10px 12px;
  background: #fffbeb; border: 1px solid #fde68a; border-radius: 10px;
}
.mv-unlock-txt { flex: 1; font-size: 12px; color: #92400e; line-height: 1.4; }
.mv-unlock-btn {
  flex-shrink: 0; padding: 6px 12px; border: none; border-radius: 8px;
  background: #f59e0b; color: #fff; font-size: 12px; font-weight: 700; cursor: pointer;
}
.mv-unlock-btn:active { background: #d97706; }
.mv-header {
  position: sticky; top: 0; z-index: 2;
  display: flex; align-items: center; gap: 10px;
  padding: 12px 14px; background: #fff; border-bottom: 1px solid #e2e8f0;
}
.mv-back { border: none; background: none; color: #059669; font-size: 14px; font-weight: 700; cursor: pointer; padding: 4px 2px; }
.mv-title { font-size: 16px; font-weight: 800; color: #065f46; }
.mv-count { margin-left: auto; font-size: 13px; font-weight: 800; color: #059669; }
.mv.out .mv-back, .mv.out .mv-count { color: #dc2626; }
.mv.out .mv-title { color: #991b1b; }

.mv-tabs { position: sticky; top: 49px; z-index: 2; display: flex; padding: 0 8px; background: #fff; border-bottom: 1px solid #e2e8f0; }
.mv-tab { flex: 1; border: none; background: none; padding: 13px 4px; font-size: 14px; font-weight: 800; color: #94a3b8; cursor: pointer; -webkit-tap-highlight-color: transparent; transition: color 0.18s; }
.mv-tab.on { color: #334155; }
.mv-tab.in.on  { color: #047857; }
.mv-tab.out.on { color: #b91c1c; }
.mv-tab.order.on { color: #b45309; }
.mv-tab-ind { position: absolute; bottom: -1px; left: 8px; width: calc((100% - 16px) / 4); height: 3px; border-radius: 3px 3px 0 0; background: #334155; transition: transform 0.24s cubic-bezier(0.4,0,0.2,1), background-color 0.18s; }
.mv-tab-ind.order { background: #f59e0b; }
.mv-tab-ind.in  { background: #10b981; }
.mv-tab-ind.out { background: #ef4444; }
.mv-swipe-hint { text-align: center; font-size: 10.5px; font-weight: 700; color: #cbd5e1; letter-spacing: 0.08em; padding: 5px 0 0; background: #f8fafc; }

.mv-gear { border: none; background: none; font-size: 18px; color: #64748b; cursor: pointer; padding: 4px 2px; -webkit-tap-highlight-color: transparent; }
.mv-gear.alone { margin-left: auto; }
.mv-tab-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #f59e0b; margin-left: 4px; vertical-align: middle; }
.mv-tab-badge { display: inline-block; font-size: 10px; font-weight: 800; color: #fff; background: #f59e0b; border-radius: 9px; padding: 0 5px; margin-left: 4px; vertical-align: middle; }
.mv-beta { margin-left: 6px; font-size: 10px; font-weight: 800; color: #b45309; background: #fffbeb; border: 1px solid #fde68a; border-radius: 7px; padding: 1px 5px; }

/* 発注タブ（既存の発注セッションへの入口） */
.mv-order-err { background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c; border-radius: 10px; padding: 9px 12px; font-size: 13px; margin-bottom: 10px; }
.mv-order-loading { padding: 20px 0; text-align: center; color: #94a3b8; font-size: 13px; font-weight: 600; }
.mv-sched { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 56px; padding: 10px 12px; margin-bottom: 10px; border: 1.5px solid #e2e8f0; border-radius: 12px; background: #fff; cursor: pointer; text-align: left; -webkit-tap-highlight-color: transparent; }
.mv-sched-ico { flex-shrink: 0; font-size: 18px; }
.mv-sched-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.mv-sched-sum { font-size: 13.5px; font-weight: 700; color: #334155; }
.mv-sched-dl { color: #b45309; font-weight: 800; }
.mv-sched-dl.past { color: #b91c1c; }
.mv-sched-ctx { font-size: 11.5px; color: #94a3b8; }
.mv-sched-edit { flex-shrink: 0; font-size: 12px; font-weight: 800; color: #2563eb; }

.mv-order-start, .mv-order-resume {
  display: flex; flex-direction: column; gap: 3px; width: 100%;
  padding: 14px; margin-bottom: 12px; border-radius: 12px; border: none;
  cursor: pointer; text-align: left; -webkit-tap-highlight-color: transparent;
}
.mv-order-start { background: #fff7ed; border: 1.5px solid #fed7aa; }
.mv-order-start:disabled { opacity: 0.5; cursor: not-allowed; }
.mv-order-start-title { font-size: 15px; font-weight: 800; color: #c2410c; }
.mv-order-start-sub { font-size: 12px; color: #b45309; }
.mv-order-resume { background: linear-gradient(135deg, #fb923c 0%, #ea580c 100%); }
.mv-order-resume-title { font-size: 14px; font-weight: 800; color: #fff; }
.mv-order-resume-sub { font-size: 11.5px; color: #ffedd5; }
.mv-order-resume-go { font-size: 13px; font-weight: 800; color: #fff; margin-top: 4px; }

/* 表はページ直下に置く（棚卸・発注と同じ地続きの見え方）。
   以前は padding + max-width + 独自スクロールの3重の入れ子で、表が「箱の中の小さい表」に見えていた。
   左右の余白は表自身（.inventory-section の 16px）とコントロール群の wrapper が持つ。 */
.mv-scroll { flex: 1; width: 100%; overflow-x: hidden; }
.mv-controls-wrap { padding: 14px 16px 0; }
.mv-page { animation: mv-slide-fwd 0.22s ease; }
.mv-page.back { animation: mv-slide-back 0.22s ease; }
@keyframes mv-slide-fwd  { from { opacity: 0; transform: translateX(26px); } to { opacity: 1; transform: none; } }
@keyframes mv-slide-back { from { opacity: 0; transform: translateX(-26px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .mv-page, .mv-page.back { animation: none; } }

.mv-controls { display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px; }
.mv-ctl-row { display: flex; align-items: center; gap: 10px; }
.mv-ctl-label { font-size: 13px; font-weight: 700; color: #64748b; flex-shrink: 0; }
.mv-date { flex: 1; border: 1.5px solid #e2e8f0; border-radius: 10px; padding: 8px 10px; font-size: 14px; color: #1e293b; background: #fff; }
.mv-note { border: 1.5px solid #e2e8f0; border-radius: 10px; padding: 10px 12px; font-size: 14px; }

.mv-orders { margin-bottom: 10px; background: #fff7ed; border: 1px solid #fed7aa; border-radius: 12px; padding: 10px 12px; }
.mv-orders-title { font-size: 13px; font-weight: 800; color: #9a3412; margin-bottom: 8px; }
.mv-orders-list { display: flex; flex-direction: column; gap: 6px; }
.mv-order-row { display: flex; align-items: center; gap: 8px; background: #fff; border: 1px solid #fed7aa; border-radius: 10px; padding: 8px 10px; }
.mv-order-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.mv-order-when { font-size: 13px; font-weight: 700; color: #c2410c; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mv-order-meta { font-size: 11px; color: #b45309; }
.mv-order-apply { flex-shrink: 0; border: none; background: linear-gradient(135deg, #fb923c 0%, #ea580c 100%); color: #fff; border-radius: 9px; padding: 8px 14px; font-size: 13px; font-weight: 800; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.mv-order-apply:active { transform: scale(0.97); }
.mv-orders-note { font-size: 10.5px; color: #b45309; margin-top: 7px; line-height: 1.5; }
.mv-linked { font-size: 12px; font-weight: 600; color: #9a3412; background: #fff7ed; border: 1px solid #fed7aa; border-radius: 10px; padding: 8px 10px; display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.mv-linked-clear { margin-left: auto; border: none; background: none; color: #ea580c; font-size: 12px; font-weight: 700; cursor: pointer; flex-shrink: 0; }

.mv-search { width: 100%; border: 1.5px solid #e2e8f0; border-radius: 10px; padding: 10px 12px; font-size: 14px; margin-bottom: 8px; }
.mv-search:focus { outline: none; border-color: #94a3b8; }
.mv-hint { font-size: 11.5px; color: #94a3b8; margin-bottom: 10px; line-height: 1.6; }
/* 理論在庫の誤差要因は隠さない（甘い数字を出さない） */
.mv-hint-caveat { color: #b45309; }


.mv.in .mv.out 
.mv.out 
.mv-sf-badge { font-size: 10px; font-weight: 800; color: #fff; background: #ef4444; border-radius: 9px; padding: 0 6px; }

/* 在庫タブの数量セル。表の qty-display と同じ形で、要補充だけ色を変える */
.mv-theo-cell.low { color: #b91c1c; }


/* 品目詳細（在庫タブ・タップ展開） */




/* 保存バー。棚卸の完了バー（.app-footer + .btn-complete）と同じ構成:
   件数を1行目に中央寄せ、2行目に幅いっぱいの主ボタン。
   ラベルは「記録」のまま（「完了」は確定・ロックを意味するので使わない）。 */
.mv-savebar {
  position: sticky; bottom: 0;
  padding: 10px 16px calc(10px + env(safe-area-inset-bottom));
  background: #fff; border-top: 1px solid #e2e8f0;
  max-width: 620px; margin: 0 auto; width: 100%; box-sizing: border-box;
}
.mv-save-summary { text-align: center; font-size: 13px; font-weight: 700; margin-bottom: 8px; }
.mv-sum.in { color: #059669; }
.mv-sum.out { color: #dc2626; }
.mv-sum.none { color: #94a3b8; }
.mv-save-actions { display: flex; gap: 10px; }
.mv-save {
  flex: 1; border: none; border-radius: 12px; padding: 14px;
  font-size: 15px; font-weight: 700; color: #fff; cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.mv-save.in  { background: #16a34a; }
.mv-save.out { background: #dc2626; }
.mv-save:disabled { opacity: 0.4; cursor: not-allowed; }
.mv-save:active:not(:disabled) { opacity: 0.85; }
</style>
