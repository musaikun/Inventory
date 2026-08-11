<script setup>
import { ref, computed, reactive } from 'vue'
import { useConfig } from '../composables/useConfig.js'
import { useHistory } from '../composables/useHistory.js'
import { useMovements, deliveryLinesFromOrder, unreflectedOrders } from '../composables/useMovements.js'
import { useMovementDraft } from '../composables/useMovementDraft.js'
import { useOrders } from '../composables/useOrders.js'
import { saveMovementToD1 } from '../composables/useStore.js'
import { theoreticalStock } from '../services/theoreticalStock.js'
import { avgDailyConsumption } from '../services/impliedConsumption.js'
import { itemConsumptionAvailability, storeConsumptionReadiness } from '../services/analysisCapability.js'
import { parseLot } from '../services/lot.js'
import { useHorizontalSwipe } from '../composables/useSwipe.js'
import { useDataImport } from '../composables/useDataImport.js'
import DeliveryImportModal from './DeliveryImportModal.vue'
import PastStocktakeImportModal from './PastStocktakeImportModal.vue'

const emit = defineEmits(['back', 'saved'])

const { config, setReorderPoint } = useConfig()
const { getSnapshots } = useHistory()
const { saveMovement, getMovements } = useMovements()
const { getOrders } = useOrders()
const { draft, clearMode } = useMovementDraft()

// 画面モード: 在庫（読み取り）/ 入庫（記録）/ 出庫（記録）
const TAB_ORDER = ['view', 'in', 'out']
const mode = ref('view')  // 'view' | 'in' | 'out'
const isRecord = computed(() => mode.value !== 'view')
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
const filteredItems = computed(() => {
  const q = search.value.trim()
  let list = q ? allItems.value.filter(n => n.includes(q)) : allItems.value
  if (mode.value === 'view' && stockFilter.value !== 'all') {
    list = list.filter(n => {
      const t = theoOf(n)
      if (t == null) return false            // 理論在庫なし（—）は絞り込み対象外
      return stockFilter.value === 'has' ? t > 0 : needsReorder(n)
    })
  }
  return list
})
// 要補充の件数 — フィルタチップのバッジ用
const reorderCount = computed(() => allItems.value.reduce((n, item) => n + (needsReorder(item) ? 1 : 0), 0))

// ── 品目詳細（在庫タブでタップ展開）─────────────────────────
const openDetail = ref(null)   // 展開中の品目名（1つずつ）
function toggleDetail(item) { openDetail.value = openDetail.value === item ? null : item }
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
function onReorderInput(item, e) { setReorderPoint(item, e.target.value) }

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
function hasLot(item) { return (lotOf(item) ?? 1) > 1 }

// ── 入力量の操作（現在の記録モード）─────────────────────────
function _q(item) {
  if (!isRecord.value) return 0
  const v = Number(draft[mode.value][item])
  return Number.isFinite(v) && v > 0 ? v : 0
}
function _set(item, v) {
  draft[mode.value][item] = Math.max(0, Math.round(v * 1000) / 1000)
}
function step(item, d) { _set(item, _q(item) + d) }
function stepCase(item) {           // 入庫のみ: 入数ぶんのバラを足す
  const lot = lotOf(item)
  if (lot) step(item, lot)
}
function onInput(item, e) {
  const v = e.target.value
  _set(item, v === '' ? 0 : Number(v))
}
// バラ数 → ケース内訳（入庫でのみ表示）
function caseBreakdown(item) {
  const lot = lotOf(item)
  const q = _q(item)
  if (!lot || q === 0) return ''
  const cases = Math.floor(q / lot)
  const rem = Math.round((q - cases * lot) * 1000) / 1000
  if (cases === 0) return ''
  return `${cases}ケース${rem ? ` +${rem}` : ''}`
}
// 記録後の理論在庫プレビュー
function afterQty(item) {
  const t = theoOf(item)
  if (t == null) return null
  return Math.round((t + (mode.value === 'out' ? -_q(item) : _q(item))) * 1000) / 1000
}

// ── グループ化（ジャンル＝取込由来 / 軸＝自作）──────────────
const groupMode = ref('category')
const groupOpts = computed(() => {
  const opts = [{ value: 'category', label: 'ジャンル' }]
  const names = config.axisNames ?? ['', '']
  if (names[0]) opts.push({ value: 'axisA', label: names[0] })
  if (names[1]) opts.push({ value: 'axisB', label: names[1] })
  return opts
})
const effectiveGroup = computed(() => {
  const names = config.axisNames ?? ['', '']
  if (groupMode.value === 'axisA' && !names[0]) return 'category'
  if (groupMode.value === 'axisB' && !names[1]) return 'category'
  return groupMode.value
})
const UNGROUPED = '未分類'
function _groupsOf(item) {
  if (effectiveGroup.value === 'category') {
    const c = (config.categories?.[item] || '').trim()
    return [c || UNGROUPED]
  }
  const src = effectiveGroup.value === 'axisA' ? config.tagsA : config.tagsB
  const raw = src?.[item]
  const arr = Array.isArray(raw) ? raw.filter(Boolean) : (raw ? [raw] : [])
  return arr.length ? arr : [UNGROUPED]
}
const groups = computed(() => {
  const map = new Map()
  for (const item of filteredItems.value) {
    for (const g of _groupsOf(item)) {
      if (!map.has(g)) map.set(g, [])
      map.get(g).push(item)
    }
  }
  const entries = [...map.entries()].sort(([a], [b]) => {
    if (a === UNGROUPED) return 1
    if (b === UNGROUPED) return -1
    return a.localeCompare(b, 'ja')
  })
  return entries.map(([label, items]) => ({
    label,
    items,
    changedCount: isRecord.value ? items.filter(n => _q(n) > 0).length : 0,
  }))
})

const expanded = reactive({})
function _gkey(label) { return effectiveGroup.value + '::' + label }
function isOpen(label) { return !!search.value.trim() || !!expanded[_gkey(label)] }
function toggleGroup(label) {
  const k = _gkey(label)
  if (expanded[k]) delete expanded[k]
  else expanded[k] = true
}
function collapseAll() { for (const k of Object.keys(expanded)) delete expanded[k] }
function expandAll() { for (const g of groups.value) expanded[_gkey(g.label)] = true }
const anyOpen = computed(() => groups.value.some(g => expanded[_gkey(g.label)]))

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

// ── 過去データの一括取込（納品・棚卸）は composable に集約 ─────────
// 導線はこの画面とデータ管理画面の2箇所だが、実装は useDataImport 1つ。
const {
  showDeliveryModal, deliveryCsv, deliveryFilename, importCtx, existingMovements,
  openDeliveryFromFile, closeDelivery, onDeliveryImported: commitDelivery, downloadDeliveryTemplate,
  showStocktakeModal, stocktakePlan, stocktakeFilename,
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
      <span class="mv-title">📦 在庫・入出庫</span>
      <span v-if="isRecord && changed.length" class="mv-count">{{ changed.length }}品目</span>
    </header>

    <!-- モードタブ（スライド下線で切替可能を示す）-->
    <div class="mv-tabs">
      <button :class="['mv-tab', { on: mode === 'view' }]" @click="setMode('view')">在庫</button>
      <button :class="['mv-tab', 'in', { on: mode === 'in' }]" @click="setMode('in')">📥 入庫</button>
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

      <!-- 品目検索 -->
      <input v-model="search" type="text" class="mv-search" placeholder="品目名で絞り込み" />

      <!-- グループ切替 -->
      <div class="mv-groupbar">
        <div class="mv-seg">
          <button
            v-for="o in groupOpts" :key="o.value"
            :class="['mv-seg-btn', { on: effectiveGroup === o.value }]"
            @click="groupMode = o.value"
          >{{ o.label }}</button>
        </div>
        <button v-if="!search.trim()" class="mv-toggle-all" @click="anyOpen ? collapseAll() : expandAll()">
          {{ anyOpen ? 'すべて閉じる' : 'すべて開く' }}
        </button>
      </div>

      <!-- 在庫タブ: 状態フィルタ -->
      <div v-if="mode === 'view'" class="mv-stockfilter">
        <button :class="['mv-sf', { on: stockFilter === 'all' }]" @click="stockFilter = 'all'">すべて</button>
        <button :class="['mv-sf', { on: stockFilter === 'has' }]" @click="stockFilter = 'has'">在庫あり</button>
        <button :class="['mv-sf', 'reorder', { on: stockFilter === 'reorder' }]" @click="stockFilter = 'reorder'">
          要補充<span v-if="reorderCount" class="mv-sf-badge">{{ reorderCount }}</span>
        </button>
      </div>

      <div v-if="mode === 'in'" class="mv-hint">納品分を入力。入数がある品目は「＋箱」でケース単位（バラに換算）。</div>
      <div v-else-if="mode === 'out'" class="mv-hint">使用・廃棄した数を個（バラ）で入力。</div>
      <div v-else class="mv-hint">
        直近の棚卸を基準に、入出庫を加減算した理論在庫です。0以下は要補充。<br>
        <span class="mv-hint-caveat">記録していない使用・ロス・納品の分だけ実際とずれます。正確な数は棚卸で確定します。</span>
      </div>

      <!-- ゲート案内: 消費・理論値の算出下地が無いとき、過去棚卸の取込を促す -->
      <div v-if="mode === 'view' && !storeReadiness.ready" class="mv-unlock">
        <span class="mv-unlock-txt">💡 {{ storeReadiness.hint }}</span>
        <button class="mv-unlock-btn" @click="pickStocktake">取り込む</button>
      </div>

      <!-- グループ（アコーディオン） -->
      <div v-if="groups.length" class="mv-groups">
        <div v-for="g in groups" :key="g.label" class="mv-group">
          <button class="mv-group-head" @click="toggleGroup(g.label)">
            <span class="mv-group-arrow">{{ isOpen(g.label) ? '▾' : '▸' }}</span>
            <span class="mv-group-name">{{ g.label }}</span>
            <span class="mv-group-count">{{ g.items.length }}</span>
            <span v-if="g.changedCount" class="mv-group-badge">{{ g.changedCount }}</span>
          </button>
          <div v-if="isOpen(g.label)" class="mv-list">
            <!-- 在庫（読み取り）: 行タップで詳細を展開 -->
            <template v-if="!isRecord">
              <div v-for="item in g.items" :key="item" class="mv-detail-wrap">
                <div :class="['mv-item', 'tappable', { reorder: needsReorder(item), open: openDetail === item }]" @click="toggleDetail(item)">
                  <div class="mv-item-info">
                    <span class="mv-item-name">{{ item }}</span>
                    <span class="mv-item-basis">{{ basisLabel(item) }}</span>
                  </div>
                  <div class="mv-stock">
                    <template v-if="theoOf(item) != null">
                      <span :class="['mv-stock-qty', { low: needsReorder(item) }]">{{ theoOf(item) }}<span class="mv-stock-unit">{{ unitOf(item) }}</span></span>
                      <span v-if="needsReorder(item)" class="mv-reorder-badge">要補充</span>
                    </template>
                    <span v-else class="mv-stock-none">—</span>
                  </div>
                  <span class="mv-detail-arrow">{{ openDetail === item ? '▲' : '▼' }}</span>
                </div>

                <!-- 詳細パネル -->
                <div v-if="openDetail === item" class="mv-detail">
                  <!-- 内訳 -->
                  <div class="mv-d-basis">{{ basisLabel(item) }} → 理論 <b>{{ theoOf(item) != null ? theoOf(item) : '—' }}</b>{{ unitOf(item) }}</div>

                  <!-- 発注点（手動＝床）-->
                  <div class="mv-d-reorder">
                    <label class="mv-d-label">発注点</label>
                    <input
                      class="mv-d-rp-input" type="number" inputmode="numeric" min="0" placeholder="未設定"
                      :value="reorderOf(item) != null ? reorderOf(item) : ''"
                      @click.stop @input="onReorderInput(item, $event)"
                    />
                    <span class="mv-d-rp-unit">{{ unitOf(item) || '個' }}以下で要補充</span>
                  </div>

                  <!-- 推奨（目安・データから算出。タップで採用・上書きしない）-->
                  <div v-if="suggestedReorder(item) != null" class="mv-d-suggest">
                    <button class="mv-d-suggest-btn" @click.stop="setReorderPoint(item, suggestedReorder(item))">目安 {{ suggestedReorder(item) }} を採用</button>
                    <span class="mv-d-suggest-basis">推定消費 {{ dailyConsumption(item).toFixed(1) }}/日 × {{ reorderHorizon }}日</span>
                  </div>
                  <div v-else class="mv-d-suggest-none">{{ consumptionHintOf(item) }}</div>

                  <!-- マスタ情報 -->
                  <div class="mv-d-meta">
                    <span v-if="hasLot(item)">入数{{ lotOf(item) }}</span>
                    <span v-if="config.prices?.[item]">単価¥{{ config.prices[item] }}</span>
                    <span v-if="config.categories?.[item]">{{ config.categories[item] }}</span>
                  </div>

                  <!-- 直近の入出庫 -->
                  <div class="mv-d-mv-title">直近の入出庫</div>
                  <div v-if="itemMovements(item).length" class="mv-d-mv-list">
                    <div v-for="mv in itemMovements(item)" :key="mv.id" class="mv-d-mv">
                      <span class="mv-d-mv-date">{{ _md(mv.date) }}</span>
                      <span :class="['mv-d-mv-type', mv.type]">{{ mv.type === 'out' ? '出庫' : '入庫' }}</span>
                      <span class="mv-d-mv-qty">{{ mv.qty }}{{ mv.unit }}</span>
                      <span v-if="mv.note" class="mv-d-mv-note">{{ mv.note }}</span>
                    </div>
                  </div>
                  <div v-else class="mv-d-mv-empty">入出庫の記録はまだありません</div>
                </div>
              </div>
            </template>
            <!-- 入庫 / 出庫（記録） -->
            <template v-else>
              <div v-for="item in g.items" :key="item" :class="['mv-item', { changed: _q(item) > 0 }]">
                <div class="mv-item-info">
                  <span class="mv-item-name">{{ item }}</span>
                  <span class="mv-item-theo">
                    理論 {{ theoOf(item) != null ? theoOf(item) : '—' }}{{ unitOf(item)
                    }}<template v-if="_q(item) > 0 && theoOf(item) != null"> → <b :class="mode === 'in' ? 'up' : 'down'">{{ afterQty(item) }}</b></template>
                    <span v-if="hasLot(item)" class="mv-lot">入数{{ lotOf(item) }}</span>
                    <span v-if="mode === 'in' && caseBreakdown(item)" class="mv-cases">{{ caseBreakdown(item) }}</span>
                  </span>
                </div>
                <div class="mv-row-ctl">
                  <button v-if="mode === 'in' && hasLot(item)" class="mv-case-btn" @click="stepCase(item)" type="button" title="1ケース分">＋箱</button>
                  <div class="mv-stepper">
                    <button class="mv-step" @click="step(item, -1)" type="button" :disabled="_q(item) <= 0">−</button>
                    <input
                      class="mv-step-val"
                      :class="{ active: _q(item) > 0 }"
                      type="number" inputmode="numeric" min="0"
                      :value="_q(item) || ''"
                      placeholder="0"
                      @input="onInput(item, $event)"
                    />
                    <button class="mv-step" @click="step(item, 1)" type="button">＋</button>
                  </div>
                </div>
              </div>
            </template>
          </div>
        </div>
      </div>
      <div v-else class="mv-empty">
        <template v-if="allItems.length === 0">表示中の品目がありません。品目マスタを登録してください。</template>
        <template v-else-if="mode === 'view' && stockFilter === 'reorder'">要補充（在庫0以下）の品目はありません。</template>
        <template v-else-if="mode === 'view' && stockFilter === 'has'">在庫あり（0より多い）の品目はありません。</template>
        <template v-else-if="search.trim()">「{{ search }}」に一致する品目がありません。</template>
        <template v-else>該当する品目がありません。</template>
      </div>
     </div>
    </div>

    <!-- 保存バー（記録モードのみ）-->
    <div v-if="isRecord" class="mv-savebar">
      <div class="mv-save-summary">
        <span v-if="changed.length" :class="['mv-sum', mode]">{{ mode === 'in' ? '入庫' : '出庫' }} {{ changed.length }}品目</span>
        <span v-else class="mv-sum none">数量を入力してください</span>
      </div>
      <button :class="['mv-save', mode]" :disabled="!canSave" @click="onSave">
        {{ mode === 'in' ? '入庫を記録' : '出庫を記録' }}
      </button>
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
      @close="closeDelivery"
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
.mv-tab-ind { position: absolute; bottom: -1px; left: 8px; width: calc((100% - 16px) / 3); height: 3px; border-radius: 3px 3px 0 0; background: #334155; transition: transform 0.24s cubic-bezier(0.4,0,0.2,1), background-color 0.18s; }
.mv-tab-ind.in  { background: #10b981; }
.mv-tab-ind.out { background: #ef4444; }
.mv-swipe-hint { text-align: center; font-size: 10.5px; font-weight: 700; color: #cbd5e1; letter-spacing: 0.08em; padding: 5px 0 0; background: #f8fafc; }

.mv-scroll { flex: 1; padding: 14px; max-width: 620px; margin: 0 auto; width: 100%; overflow-y: auto; overflow-x: hidden; }
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

.mv-groupbar { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.mv-seg { display: inline-flex; background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 10px; padding: 2px; gap: 2px; }
.mv-seg-btn { border: none; background: none; border-radius: 8px; padding: 6px 12px; font-size: 12.5px; font-weight: 700; color: #64748b; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.mv-seg-btn.on { background: #334155; color: #fff; }
.mv-toggle-all { margin-left: auto; border: none; background: none; color: #64748b; font-size: 12px; font-weight: 700; cursor: pointer; padding: 4px; flex-shrink: 0; }

.mv-groups { display: flex; flex-direction: column; gap: 8px; }
.mv-group { background: #fff; border: 1.5px solid #e2e8f0; border-radius: 12px; overflow: hidden; }
.mv-group-head { width: 100%; display: flex; align-items: center; gap: 8px; padding: 12px 14px; background: none; border: none; cursor: pointer; text-align: left; -webkit-tap-highlight-color: transparent; }
.mv-group-head:active { background: #f8fafc; }
.mv-group-arrow { font-size: 12px; color: #94a3b8; width: 12px; flex-shrink: 0; }
.mv-group-name { font-size: 14px; font-weight: 800; color: #334155; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mv-group-count { font-size: 12px; font-weight: 700; color: #94a3b8; }
.mv-group-badge { margin-left: auto; font-size: 11px; font-weight: 800; color: #fff; border-radius: 10px; padding: 1px 8px; flex-shrink: 0; }
.mv.in .mv-group-badge { background: #10b981; }
.mv.out .mv-group-badge { background: #ef4444; }

.mv-list { display: flex; flex-direction: column; }
.mv-item { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-top: 1px solid #f1f5f9; }
.mv-item.changed { background: #f0fdf9; }
.mv.out .mv-item.changed { background: #fef2f2; }
.mv-item-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.mv-item-name { font-size: 14px; font-weight: 700; color: #334155; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mv-item-basis { font-size: 11px; color: #94a3b8; }
.mv-item-theo { font-size: 11.5px; color: #94a3b8; }
.mv-item-theo b.up { color: #059669; }
.mv-item-theo b.down { color: #dc2626; }
.mv-lot { margin-left: 6px; font-size: 10.5px; font-weight: 700; color: #64748b; background: #f1f5f9; border-radius: 8px; padding: 1px 6px; }
.mv-cases { margin-left: 6px; font-size: 10.5px; font-weight: 700; color: #059669; }

.mv-stockfilter { display: flex; gap: 6px; margin-bottom: 8px; }
.mv-sf { border: 1.5px solid #e2e8f0; background: #fff; border-radius: 16px; padding: 5px 12px; font-size: 12.5px; font-weight: 700; color: #64748b; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; -webkit-tap-highlight-color: transparent; }
.mv-sf.on { border-color: #334155; color: #1e293b; background: #f1f5f9; }
.mv-sf.reorder.on { border-color: #ef4444; color: #b91c1c; background: #fef2f2; }
.mv-sf-badge { font-size: 10px; font-weight: 800; color: #fff; background: #ef4444; border-radius: 9px; padding: 0 6px; }

.mv-stock { flex-shrink: 0; display: flex; align-items: center; gap: 8px; text-align: right; }
.mv-stock-qty { font-size: 17px; font-weight: 800; color: #1e293b; }
.mv-stock-qty.low { color: #dc2626; }
.mv-stock-unit { font-size: 11px; font-weight: 700; color: #94a3b8; margin-left: 2px; }
.mv-stock-none { font-size: 15px; color: #cbd5e1; }
.mv-item.reorder { background: #fef2f2; }
.mv-reorder-badge { font-size: 10px; font-weight: 800; color: #b91c1c; background: #fee2e2; border: 1px solid #fecaca; border-radius: 9px; padding: 1px 7px; flex-shrink: 0; }

/* 品目詳細（在庫タブ・タップ展開） */
.mv-detail-wrap { border-top: 1px solid #f1f5f9; }
.mv-detail-wrap .mv-item { border-top: none; }
.mv-item.tappable { cursor: pointer; -webkit-tap-highlight-color: transparent; }
.mv-item.tappable:active { background: #f8fafc; }
.mv-item.open { background: #f0fdf9; }
.mv-detail-arrow { font-size: 11px; color: #cbd5e1; flex-shrink: 0; margin-left: 2px; }
.mv-detail { padding: 10px 14px 14px; background: #f8fafc; display: flex; flex-direction: column; gap: 10px; }
.mv-d-basis { font-size: 12px; color: #475569; }
.mv-d-basis b { color: #059669; }
.mv-d-reorder { display: flex; align-items: center; gap: 8px; }
.mv-d-label { font-size: 12px; font-weight: 800; color: #b91c1c; flex-shrink: 0; }
.mv-d-rp-input { width: 72px; border: 1.5px solid #fecaca; border-radius: 8px; padding: 6px 8px; font-size: 14px; font-weight: 700; text-align: right; color: #b91c1c; background: #fff; }
.mv-d-rp-input:focus { outline: none; border-color: #ef4444; }
.mv-d-rp-unit { font-size: 11px; color: #94a3b8; }
.mv-d-suggest { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.mv-d-suggest-btn { border: 1px solid var(--primary-border, #bfdbfe); background: var(--primary-weak, #eff6ff); color: var(--primary, #2563eb); border-radius: 16px; padding: 4px 12px; font-size: 12px; font-weight: 700; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.mv-d-suggest-btn:active { transform: scale(0.96); }
.mv-d-suggest-basis { font-size: 10.5px; color: #94a3b8; }
.mv-d-suggest-none { font-size: 10.5px; color: #cbd5e1; }
.mv-d-meta { display: flex; flex-wrap: wrap; gap: 6px; }
.mv-d-meta span { font-size: 10.5px; font-weight: 700; color: #64748b; background: #eef2f6; border-radius: 8px; padding: 1px 7px; }
.mv-d-mv-title { font-size: 11px; font-weight: 800; color: #94a3b8; }
.mv-d-mv-list { display: flex; flex-direction: column; gap: 4px; }
.mv-d-mv { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.mv-d-mv-date { color: #94a3b8; flex-shrink: 0; width: 40px; }
.mv-d-mv-type { font-weight: 800; flex-shrink: 0; }
.mv-d-mv-type.in { color: #059669; }
.mv-d-mv-type.out { color: #dc2626; }
.mv-d-mv-qty { font-weight: 700; color: #334155; flex-shrink: 0; }
.mv-d-mv-note { color: #94a3b8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mv-d-mv-empty { font-size: 12px; color: #cbd5e1; }

.mv-row-ctl { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.mv-case-btn { border: 1.5px solid #a7f3d0; background: #ecfdf5; color: #059669; border-radius: 8px; padding: 6px 8px; font-size: 12px; font-weight: 800; cursor: pointer; line-height: 1; white-space: nowrap; -webkit-tap-highlight-color: transparent; }
.mv-case-btn:active { transform: scale(0.94); }

.mv-stepper { display: flex; align-items: center; gap: 6px; }
.mv-step { width: 34px; height: 34px; border-radius: 9px; border: 1.5px solid #e2e8f0; background: #fff; font-size: 18px; font-weight: 700; cursor: pointer; line-height: 1; color: #475569; -webkit-tap-highlight-color: transparent; }
.mv-step:disabled { opacity: 0.35; cursor: default; }
.mv-step:active:not(:disabled) { transform: scale(0.94); }
.mv-step-val { width: 52px; height: 34px; border: 1.5px solid #e2e8f0; border-radius: 8px; text-align: center; font-size: 15px; font-weight: 700; color: #64748b; }
.mv.in .mv-step-val.active  { color: #059669; border-color: #a7f3d0; }
.mv.out .mv-step-val.active { color: #dc2626; border-color: #fecaca; }

.mv-empty { padding: 30px 16px; text-align: center; color: #94a3b8; font-size: 13px; line-height: 1.6; }

.mv-savebar {
  position: sticky; bottom: 0;
  display: flex; align-items: center; gap: 12px;
  padding: 10px 14px calc(10px + env(safe-area-inset-bottom));
  background: #fff; border-top: 1px solid #e2e8f0;
  max-width: 620px; margin: 0 auto; width: 100%;
}
.mv-save-summary { flex: 1; font-size: 13px; font-weight: 700; }
.mv-sum.in { color: #059669; }
.mv-sum.out { color: #dc2626; }
.mv-sum.none { color: #94a3b8; }
.mv-save { border: none; border-radius: 12px; padding: 12px 24px; font-size: 15px; font-weight: 800; color: #fff; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.mv-save.in  { background: linear-gradient(135deg, #34d399 0%, #059669 100%); }
.mv-save.out { background: linear-gradient(135deg, #f87171 0%, #dc2626 100%); }
.mv-save:disabled { opacity: 0.4; cursor: not-allowed; }
.mv-save:active:not(:disabled) { transform: scale(0.98); }
</style>
