<script setup>
import { ref, computed, reactive, onMounted, watch } from 'vue'
import { useHistory } from '../composables/useHistory.js'
import { useOrders } from '../composables/useOrders.js'
import { useMovements } from '../composables/useMovements.js'
import { useConfig } from '../composables/useConfig.js'
import { useDayNotes } from '../composables/useDayNotes.js'
import { useHorizontalSwipe } from '../composables/useSwipe.js'
import { dayFactors, isOffDay, consecutiveOffLength } from '../services/demandFactors.js'

// 日付ベースの履歴カレンダー。棚卸(🔵)と発注(🟠)を同じ月グリッドに並べ、
// 日を選ぶ → その日の履歴（種類別）を見る。
// weather プロップは将来の天気表示用スロット。{ 'YYYY-MM-DD': { icon, label, tempHi, tempLo } }
const props = defineProps({
  sessions: { type: Array, default: () => [] }, // 完了済み棚卸セッション
  weather:  { type: Object, default: () => ({}) },
})
const emit = defineEmits(['view-session', 'delete-session'])

const { getSnapshotBySessionId } = useHistory()
const { getOrders, deleteOrder } = useOrders()
const { getMovements, deleteMovement } = useMovements()
const { config } = useConfig()

const WEEK = ['日', '月', '火', '水', '木', '金', '土']

function _key(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}
function _keyOf(iso) {
  return (iso || '').slice(0, 10)
}

const _now = new Date()
const todayKey = _key(_now.getFullYear(), _now.getMonth(), _now.getDate())

const viewYear  = ref(_now.getFullYear())
const viewMonth = ref(_now.getMonth())

const filter = ref('all')  // 'all' | 'stock' | 'order' | 'move'
const showFactors = ref(true)  // 暦の需要要因（帯・マーカー）の表示ON/OFF

// セル背景の帯（優先: スパン＞祝日＞長期休暇＞連休）。要因表示OFFなら空。
function cellBand(cell) {
  if (!showFactors.value || !cell) return ''
  const f = cell.factors
  if (f.span) return 'span'            // お盆・年末年始（短期・強い）
  if (f.holiday) return 'holiday'      // 祝日・振替・国民の休日
  if (f.seasonBreak) return 'season'   // 夏/冬/春休み（広い）
  if (f.longWeekend) return 'long'     // 3連休以上
  return ''
}
const showStock = computed(() => filter.value === 'all' || filter.value === 'stock')
const showOrder = computed(() => filter.value === 'all' || filter.value === 'order')
const showMove  = computed(() => filter.value === 'all' || filter.value === 'move')

// 日付キー → 棚卸セッション配列
const stockByDate = computed(() => {
  const map = {}
  for (const s of props.sessions) {
    const k = _keyOf(s.endedAt ?? s.startedAt)
    if (!k) continue
    ;(map[k] ||= []).push(s)
  }
  return map
})

// 日付キー → 発注レコード配列
const orderByDate = computed(() => {
  const map = {}
  for (const o of getOrders()) {
    const k = o.date
    if (!k) continue
    ;(map[k] ||= []).push(o)
  }
  return map
})

// 日付キー → 入出庫レコード配列
const moveByDate = computed(() => {
  const map = {}
  for (const m of getMovements()) {
    const k = m.date
    if (!k) continue
    ;(map[k] ||= []).push(m)
  }
  return map
})

const monthLabel = computed(() => `${viewYear.value}年${viewMonth.value + 1}月`)

// 連休（週末＋祝日が3日以上連続）の連結情報。連休でなければ null。
// capL/capR = 連休の端（または週の行端）で、アンダーラインの丸め位置に使う。
function _runInfo(y, m, d) {
  const dt = new Date(y, m, d)
  if (!isOffDay(dt) || consecutiveOffLength(dt) < 3) return null
  const dow = dt.getDay()
  const prevOff = isOffDay(new Date(y, m, d - 1))
  const nextOff = isOffDay(new Date(y, m, d + 1))
  return {
    len:    consecutiveOffLength(dt),
    capL:   !prevOff || dow === 0,   // 連休の開始 or 日曜（行頭）
    capR:   !nextOff || dow === 6,   // 連休の終了 or 土曜（行末）
    start:  !prevOff,                // 連休の初日（件数ラベル表示用）
  }
}

const weeks = computed(() => {
  const y = viewYear.value, m = viewMonth.value
  const firstDow = new Date(y, m, 1).getDay()
  const days = new Date(y, m + 1, 0).getDate()
  const cells = []
  for (let i = 0; i < firstDow; i++) cells.push(null)
  for (let d = 1; d <= days; d++) {
    const key = _key(y, m, d)
    cells.push({
      d,
      key,
      dow: new Date(y, m, d).getDay(),
      isToday: key === todayKey,
      stock: stockByDate.value[key] || [],
      orders: orderByDate.value[key] || [],
      moves: moveByDate.value[key] || [],
      wx: props.weather[key] || null,
      factors: dayFactors(key),   // 暦の需要要因（祝日・祝前日・給料日・連休・スパン…）
      run: _runInfo(y, m, d),     // 連休（3連休以上）の連結情報
    })
  }
  while (cells.length % 7 !== 0) cells.push(null)
  const out = []
  for (let i = 0; i < cells.length; i += 7) out.push(cells.slice(i, i + 7))
  return out
})

// セルに出る実績ドット数（棚卸/発注/入庫/出庫）。4つのとき 2×2 折り返しにする。
function dotCount(cell) {
  if (!cell) return 0
  let n = 0
  if (showStock.value && cell.stock.length) n++
  if (showOrder.value && cell.orders.length) n++
  if (showMove.value && cell.moves.some(m => m.type === 'in')) n++
  if (showMove.value && cell.moves.some(m => m.type === 'out')) n++
  return n
}

const slideDir = ref('next')  // 月移動のスライド方向（コミット後のアニメ用）
function prevMonth() {
  slideDir.value = 'prev'
  if (viewMonth.value === 0) { viewMonth.value = 11; viewYear.value-- }
  else viewMonth.value--
}
function nextMonth() {
  slideDir.value = 'next'
  if (viewMonth.value === 11) { viewMonth.value = 0; viewYear.value++ }
  else viewMonth.value++
}

// ── 指追従スワイプ ───────────────────────────────
// ドラッグ中は指の移動量だけグリッドを動かし、離したらしきい値超で月移動・未満でスナップバック。
const dragX = ref(0)
const dragging = ref(false)
let _committed = false
const dragStyle = computed(() => ({
  transform: dragX.value ? `translateX(${dragX.value}px)` : '',
  transition: dragging.value ? 'none' : 'transform 0.2s ease',
}))
const calSwipe = useHorizontalSwipe({
  threshold: 55,
  onDrag: (dx) => {
    if (dx === 0) {
      // 指を離した瞬間。onLeft/onRight（コミット）が続けて呼ばれるかを microtask で確認。
      dragging.value = false
      _committed = false
      queueMicrotask(() => { if (!_committed) dragX.value = 0 })  // 未コミットはスナップバック
    } else {
      dragging.value = true
      dragX.value = dx
    }
  },
  onLeft:  () => { _committed = true; dragX.value = 0; nextMonth() },
  onRight: () => { _committed = true; dragX.value = 0; prevMonth() },
})
function goToday() {
  viewYear.value = _now.getFullYear()
  viewMonth.value = _now.getMonth()
  selectedKey.value = todayKey
}

// フィルタ考慮で最も新しいデータのある日付
const recentKey = computed(() => {
  const keys = new Set()
  if (showStock.value) for (const k of Object.keys(stockByDate.value)) keys.add(k)
  if (showOrder.value) for (const k of Object.keys(orderByDate.value)) keys.add(k)
  if (showMove.value)  for (const k of Object.keys(moveByDate.value)) keys.add(k)
  const sorted = [...keys].sort((a, b) => b.localeCompare(a))
  return sorted[0] || null
})

function goRecent() {
  const k = recentKey.value
  if (!k) return
  viewYear.value = Number(k.slice(0, 4))
  viewMonth.value = Number(k.slice(5, 7)) - 1
  selectedKey.value = k
}

// ── 選択日 ─────────────────────────────────
const selectedKey = ref(null)
function onCellTap(cell) {
  // 記録の有無に関わらず、どの日でも詳細を開ける（暦・比較を確認するため）
  selectedKey.value = cell.key === selectedKey.value ? null : cell.key
}

const selectedStock  = computed(() => (selectedKey.value ? stockByDate.value[selectedKey.value] || [] : []))
const selectedOrders = computed(() => (selectedKey.value ? orderByDate.value[selectedKey.value] || [] : []))

const selectedStockRows = computed(() => selectedStock.value.map(s => ({ s, ..._stockValue(s) })))
const selectedOrderRows = computed(() => selectedOrders.value.map(o => ({ o, ..._orderValue(o) })))
// 入庫として取り込み済みの発注 id（納品済みバッジ用）
const importedOrderIds = computed(() => new Set(getMovements().map(m => m.orderId).filter(Boolean)))
function _sumRows(rows) {
  let t = 0
  let has = false
  for (const r of rows) if (r.amount != null) { t += r.amount; has = true }
  return has ? t : null
}
const selStockTotal = computed(() => _sumRows(selectedStockRows.value))
const selOrderTotal = computed(() => _sumRows(selectedOrderRows.value))

const selectedMoves = computed(() => (selectedKey.value ? moveByDate.value[selectedKey.value] || [] : []))
// 入庫/出庫のセクション定義（rows: 金額付き、_orderValue は lines を持つレコード共通で使える）
const moveSections = computed(() => {
  const mk = (type, label, icon, dot) => {
    const rows = selectedMoves.value.filter(m => m.type === type).map(m => ({ m, ..._orderValue(m) }))
    return { type, label, icon, dot, rows, total: _sumRows(rows) }
  }
  return [
    mk('in', '入庫', '📥', 'dot-in'),
    mk('out', '出庫', '📤', 'dot-out'),
  ].filter(s => s.rows.length)
})
const anyEstimated = computed(() => selOrderTotal.value != null || moveSections.value.some(s => s.total != null))
const selectedWeather = computed(() => (selectedKey.value ? props.weather[selectedKey.value] || null : null))

// 選択日の暦の需要要因 → 詳細パネルのチップ用（該当するものだけ）
const selectedFactors = computed(() => {
  if (!selectedKey.value) return []
  const f = dayFactors(selectedKey.value)
  const runLen = consecutiveOffLength(selectedKey.value)
  const chips = []
  if (f.holidayName) chips.push({ cls: 'holiday', label: `🎌 ${f.holidayName}` })
  if (f.holidayEve)  chips.push({ cls: 'eve',     label: f.holidayEveKind === 'weekday' ? '🎏 祝前日（平日）' : '🎏 祝前日（休日）' })
  if (f.span)        chips.push({ cls: 'span',    label: f.span })
  else if (f.seasonBreak) chips.push({ cls: 'season', label: f.seasonBreak })
  else if (runLen >= 3)   chips.push({ cls: 'long', label: `${runLen}連休` })
  if (f.payday)      chips.push({ cls: 'pay',     label: `💰 ${f.paydayLabel}給料日` })
  if (f.pension)     chips.push({ cls: 'pension', label: '👛 年金支給日' })
  if (f.gotobi)      chips.push({ cls: 'gotobi',  label: '五十日' })
  if (f.monthEnd)    chips.push({ cls: 'pay',     label: '月末' })
  if (!chips.length) chips.push({ cls: 'weekday', label: '平日' })
  return chips
})

// ── 日別メモ（内部イベント要因＋学習除外）───────────────────
const { getNote, hasNote, setNote } = useDayNotes()
const MEMO_TAGS = ['貸切', 'イベント', 'メニュー変更', '悪天候', '仕込み過多']
const memoText = ref('')
const memoTags = ref([])
const memoExcluded = ref(false)
watch(selectedKey, (k) => {
  const n = k ? getNote(k) : null
  memoText.value = n?.text || ''
  memoTags.value = n?.tags ? [...n.tags] : []
  memoExcluded.value = !!n?.excluded
}, { immediate: true })
function toggleMemoTag(t) {
  const i = memoTags.value.indexOf(t)
  if (i >= 0) memoTags.value.splice(i, 1)
  else memoTags.value.push(t)
}
function saveMemo() {
  if (!selectedKey.value) return
  setNote(selectedKey.value, { text: memoText.value, tags: memoTags.value, excluded: memoExcluded.value })
}

const selDate = computed(() => (selectedKey.value ? new Date(selectedKey.value + 'T12:00:00') : null))

// 曜日・週の情報（第N週・第N○曜日）
const selWeekInfo = computed(() => {
  const d = selDate.value
  if (!d) return null
  const day = d.getDate()
  return { weekday: d.getDay(), weekOfMonth: Math.ceil(day / 7), nth: Math.ceil(day / 7) }
})

// 直近の棚卸から選択日までの経過日数
const selDaysSinceStock = computed(() => {
  if (!selectedKey.value) return null
  let best = null
  for (const s of props.sessions) {
    const k = _keyOf(s.endedAt ?? s.startedAt)
    if (k && k <= selectedKey.value && (!best || k > best)) best = k
  }
  if (!best) return null
  const days = Math.round((new Date(selectedKey.value) - new Date(best)) / 86400000)
  return { date: best, days }
})

const selectedLabel = computed(() => {
  const k = selectedKey.value
  if (!k) return ''
  const dt = new Date(k + 'T00:00:00')
  return `${dt.getMonth() + 1}月${dt.getDate()}日（${WEEK[dt.getDay()]}）`
})

function _stockItemCount(s) {
  const snap = getSnapshotBySessionId(s.id)
  if (snap) return snap.items.filter(i => i.qty != null).length
  return s.itemCount ?? 0
}

// ── 金額 ─────────────────────────────────
// 棚卸 = スナップショットの totalValue（保存時単価）。
// 発注 = レコードに単価が無いため、品目マスタの現在単価 × 数量で概算。
function _stockValue(s) {
  const snap = getSnapshotBySessionId(s.id)
  if (!snap) return { amount: null, noData: true, unpriced: [] }
  const unpriced = snap.items.filter(i => i.qty != null && i.unitPrice == null).map(i => i.item)
  return { amount: snap.totalValue ?? null, noData: false, unpriced }
}

function _orderValue(o) {
  let total = 0
  let has = false
  const unpriced = []
  for (const l of o.lines) {
    const p = Number(config.prices?.[l.item])
    if (Number.isFinite(p) && p > 0) { total += Math.round(l.qty * p); has = true }
    else unpriced.push(l.item)
  }
  return { amount: has ? total : null, noData: false, unpriced }
}

function fmtYen(v) {
  return v == null ? '' : `¥${v.toLocaleString()}`
}

// セル用の短縮表記（例: 12,400 → 1.2万）
function fmtYenShort(v) {
  if (v == null) return ''
  if (v >= 1e8) return `${(v / 1e8).toFixed(v < 1e9 ? 1 : 0).replace(/\.0$/, '')}億`
  if (v >= 1e4) return `${(v / 1e4).toFixed(v < 1e5 ? 1 : 0).replace(/\.0$/, '')}万`
  return `¥${v.toLocaleString()}`
}

const UNPRICED_MAX = 8
function _fmtUnpriced(list) {
  if (list.length <= UNPRICED_MAX) return list.join('、')
  return `${list.slice(0, UNPRICED_MAX).join('、')} 他${list.length - UNPRICED_MAX}品目`
}

// 単一フィルタ時のみ: 日付キー → { count, amount }。count は「件数」ではなく
// その日に扱った品目数（棚卸=入力済み品目・発注/入出庫=行数の合計）。
// 入出庫は方向別の品目数（inCount/outCount）を出す（合算金額は意味が無いためセルでは出さない）。
const cellInfo = computed(() => {
  if (filter.value === 'all') return null
  if (filter.value === 'move') {
    const map = {}
    for (const [k, arr] of Object.entries(moveByDate.value)) {
      let inCount = 0
      let outCount = 0
      for (const m of arr) {
        const n = (m.lines || []).length
        if (m.type === 'out') outCount += n
        else inCount += n
      }
      map[k] = { count: inCount + outCount, inCount, outCount, amount: null }
    }
    return map
  }
  const src = filter.value === 'stock' ? stockByDate.value : orderByDate.value
  const calc = filter.value === 'stock' ? _stockValue : _orderValue
  const countItems = filter.value === 'stock'
    ? (rec) => _stockItemCount(rec)
    : (rec) => (rec.lines || []).length
  const map = {}
  for (const [k, arr] of Object.entries(src)) {
    let total = 0
    let has = false
    let items = 0
    for (const rec of arr) {
      const v = calc(rec)
      if (v.amount != null) { total += v.amount; has = true }
      items += countItems(rec)
    }
    map[k] = { count: items, amount: has ? total : null }
  }
  return map
})
function _timeLabel(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
}

onMounted(() => {
  selectedKey.value = todayKey
})

const expanded = reactive({})
function toggleOrder(id) { expanded[id] = !expanded[id] }
function onDeleteOrder(id) {
  if (!confirm('この発注記録を削除しますか？')) return
  deleteOrder(id)
}
function onDeleteMove(id) {
  if (!confirm('この入出庫記録を削除しますか？')) return
  deleteMovement(id)
}
</script>

<template>
  <div class="hc">
    <!-- 月ナビ -->
    <div class="hc-nav">
      <button class="hc-nav-btn" @click="prevMonth">‹</button>
      <span class="hc-month">{{ monthLabel }}</span>
      <button class="hc-nav-btn" @click="nextMonth">›</button>
      <button class="hc-today" @click="goToday">今日</button>
    </div>

    <!-- 凡例＝フィルタ -->
    <div class="hc-legend">
      <button :class="['hc-leg', { on: filter === 'all' }]" @click="filter = 'all'">すべて</button>
      <button :class="['hc-leg', { on: filter === 'stock' }]" @click="filter = 'stock'"><span class="dot dot-stock"></span>棚卸</button>
      <button :class="['hc-leg', { on: filter === 'order' }]" @click="filter = 'order'"><span class="dot dot-order"></span>発注</button>
      <button :class="['hc-leg', { on: filter === 'move' }]" @click="filter = 'move'"><span class="dot dot-in"></span><span class="dot dot-out"></span>入出庫</button>
      <button :class="['hc-leg', 'hc-factor-toggle', { on: showFactors }]" @click="showFactors = !showFactors" title="祝日・連休・給料日などの表示切替">🗓 条件</button>
      <button v-if="recentKey" class="hc-recent" @click="goRecent">最近 ›</button>
    </div>

    <!-- カレンダー（内スワイプで月移動・親のタブ切替へは伝播させない）-->
    <div
      class="hc-cal"
      @touchstart.stop.passive="calSwipe.onTouchStart"
      @touchmove.stop.passive="calSwipe.onTouchMove"
      @touchend.stop.passive="calSwipe.onTouchEnd"
    >
      <div class="hc-dow-row">
        <span v-for="(w, i) in WEEK" :key="w" :class="['hc-dow', { sun: i === 0, sat: i === 6 }]">{{ w }}</span>
      </div>
      <div class="hc-weeks" :key="viewYear + '-' + viewMonth" :class="'anim-' + slideDir" :style="dragStyle">
      <div v-for="(week, wi) in weeks" :key="wi" class="hc-week">
        <div
          v-for="(cell, ci) in week"
          :key="ci"
          :class="['hc-cell', cell && cellBand(cell) ? 'band-' + cellBand(cell) : '', {
            empty: !cell,
            today: cell && cell.isToday,
            selected: cell && cell.key === selectedKey,
            tappable: !!cell,
            'eve-weekday': cell && showFactors && !cell.run && cell.factors.holidayEveKind === 'weekday',
            'eve-weekend': cell && showFactors && !cell.run && cell.factors.holidayEveKind === 'weekend',
          }]"
          @click="cell && onCellTap(cell)"
        >
          <template v-if="cell">
            <span :class="['hc-day', { sun: cell.dow === 0, sat: cell.dow === 6, hol: showFactors && cell.factors.holiday }]">{{ cell.d }}</span>
            <span v-if="showFactors && cell.factors.payday" class="hc-pay-mark" title="給料日">💰</span>
            <span v-if="hasNote(cell.key)" class="hc-note-mark" title="メモあり">📝</span>
            <span v-if="showFactors && cell.factors.gotobi" class="hc-gotobi-mark" title="五十日"></span>
            <span v-if="showFactors && cell.run" class="hc-run" :class="{ capL: cell.run.capL, capR: cell.run.capR }" :title="`${cell.run.len}連休`"></span>
            <span v-if="cell.wx" class="hc-wx">{{ cell.wx.icon }}</span>
            <span v-if="!cellInfo" :class="['hc-dots', { 'dots-grid': dotCount(cell) === 4 }]">
              <span v-if="showStock && cell.stock.length" class="dot dot-stock"></span>
              <span v-if="showOrder && cell.orders.length" class="dot dot-order"></span>
              <span v-if="showMove && cell.moves.some(m => m.type === 'in')" class="dot dot-in"></span>
              <span v-if="showMove && cell.moves.some(m => m.type === 'out')" class="dot dot-out"></span>
            </span>
            <span v-else-if="cellInfo[cell.key]" :class="['hc-cell-info', filter]">
              <template v-if="filter === 'move'">
                <span v-if="cellInfo[cell.key].inCount" class="hc-ci-count ci-in">入{{ cellInfo[cell.key].inCount }}</span>
                <span v-if="cellInfo[cell.key].outCount" class="hc-ci-count ci-out">出{{ cellInfo[cell.key].outCount }}</span>
              </template>
              <template v-else>
                <span class="hc-ci-count">{{ cellInfo[cell.key].count }}品目</span>
                <span v-if="cellInfo[cell.key].amount != null" class="hc-ci-amt">{{ fmtYenShort(cellInfo[cell.key].amount) }}</span>
              </template>
            </span>
          </template>
        </div>
      </div>
      </div>
    </div>

    <!-- 選択日の履歴 -->
    <div v-if="selectedKey" class="hc-sheet">
      <div class="hc-sheet-head">
        <span class="hc-sheet-date">{{ selectedLabel }}</span>
        <span v-if="selectedWeather" class="hc-sheet-wx">
          {{ selectedWeather.icon }} {{ selectedWeather.label }}
          <template v-if="selectedWeather.tempHi != null">{{ selectedWeather.tempHi }}° / {{ selectedWeather.tempLo }}°</template>
          <template v-if="selectedWeather.pop != null"> ☔{{ selectedWeather.pop }}%</template>
        </span>
        <button class="hc-sheet-close" @click="selectedKey = null">✕</button>
      </div>
      <div v-if="selectedFactors.length" class="hc-sheet-factors">
        <span v-for="(c, i) in selectedFactors" :key="i" :class="['hc-fchip', 'f-' + c.cls]">{{ c.label }}</span>
      </div>

      <!-- この日の基本情報 -->
      <div v-if="selWeekInfo" class="hc-facts">
        <div class="hc-fact"><span class="hc-fact-k">週</span><span class="hc-fact-v">第{{ selWeekInfo.weekOfMonth }}週 ・ 第{{ selWeekInfo.nth }}{{ WEEK[selWeekInfo.weekday] }}曜</span></div>
        <div v-if="selectedWeather && selectedWeather.tempHi != null" class="hc-fact"><span class="hc-fact-k">気温</span><span class="hc-fact-v">{{ selectedWeather.tempHi }}° / {{ selectedWeather.tempLo }}°</span></div>
        <div v-if="selectedWeather && selectedWeather.pop != null" class="hc-fact"><span class="hc-fact-k">降水</span><span class="hc-fact-v">{{ selectedWeather.pop }}%</span></div>
        <div v-if="selDaysSinceStock" class="hc-fact"><span class="hc-fact-k">前回棚卸</span><span class="hc-fact-v">{{ selDaysSinceStock.days === 0 ? 'この日' : `${selDaysSinceStock.days}日前` }}</span></div>
      </div>

      <!-- 日別メモ（内部イベント要因＋学習除外）-->
      <div class="hc-memo">
        <div class="hc-memo-tags">
          <button v-for="t in MEMO_TAGS" :key="t" type="button" :class="['hc-memo-tag', { on: memoTags.includes(t) }]" @click="toggleMemoTag(t)">{{ t }}</button>
        </div>
        <textarea v-model="memoText" class="hc-memo-text" rows="2" placeholder="この日のメモ（貸切・近隣イベント・メニュー変更 など）"></textarea>
        <label class="hc-memo-excl">
          <input type="checkbox" v-model="memoExcluded" />
          この日を発注学習から除外（貸切・イベント等の異常日）
        </label>
        <button class="hc-memo-save" type="button" @click="saveMemo">メモを保存</button>
      </div>

      <!-- 棚卸 -->
      <template v-if="showStock && selectedStock.length">
        <div class="hc-sec-title">
          <span class="dot dot-stock"></span>棚卸（{{ selectedStock.length }}件）
          <span v-if="selStockTotal != null" class="hc-sec-total">{{ fmtYen(selStockTotal) }}</span>
        </div>
        <div
          v-for="r in selectedStockRows"
          :key="r.s.id"
          class="hc-entry hc-entry-stock"
          @click="emit('view-session', r.s)"
        >
          <div class="hc-entry-main">
            <span class="hc-entry-time">{{ _timeLabel(r.s.endedAt ?? r.s.startedAt) }}</span>
            <span class="hc-entry-info">📦 {{ _stockItemCount(r.s) }}品目</span>
            <span :class="['hc-entry-amt', { none: r.amount == null }]">{{ r.amount != null ? fmtYen(r.amount) : '金額なし' }}</span>
            <button class="hc-entry-del" @click.stop="emit('delete-session', r.s)" title="削除">🗑</button>
            <span class="hc-entry-arrow">詳細 ›</span>
          </div>
          <div v-if="r.noData" class="hc-entry-warn">この端末に明細データが無いため、金額を計算できません</div>
          <div v-else-if="r.amount == null" class="hc-entry-warn">単価が未登録のため、金額はありません</div>
          <div v-else-if="r.unpriced.length" class="hc-entry-warn">単価未登録で金額に含まれない品目: {{ _fmtUnpriced(r.unpriced) }}</div>
        </div>
      </template>

      <!-- 入庫 / 出庫 -->
      <template v-if="showMove">
        <template v-for="sec in moveSections" :key="sec.type">
          <div class="hc-sec-title">
            <span :class="['dot', sec.dot]"></span>{{ sec.label }}（{{ sec.rows.length }}件）
            <span v-if="sec.total != null" class="hc-sec-total">{{ fmtYen(sec.total) }}</span>
          </div>
          <div v-for="r in sec.rows" :key="r.m.id" class="hc-entry hc-entry-move">
            <div class="hc-entry-main" @click="toggleOrder(r.m.id)">
              <span class="hc-entry-time">{{ _timeLabel(r.m.savedAt) }}</span>
              <span class="hc-entry-info">{{ sec.icon }} {{ r.m.lines.length }}品目</span>
              <span v-if="r.m.note" class="hc-move-note">{{ r.m.note }}</span>
              <span :class="['hc-entry-amt', { none: r.amount == null }]">{{ r.amount != null ? fmtYen(r.amount) : '金額なし' }}</span>
              <button class="hc-entry-del" @click.stop="onDeleteMove(r.m.id)" title="削除">🗑</button>
              <span class="hc-entry-arrow">{{ expanded[r.m.id] ? '▲' : '▼' }}</span>
            </div>
            <div v-if="r.amount == null" class="hc-entry-warn">単価が未登録のため、金額はありません</div>
            <div v-else-if="r.unpriced.length" class="hc-entry-warn">単価未登録で金額に含まれない品目: {{ _fmtUnpriced(r.unpriced) }}</div>
            <div v-if="expanded[r.m.id]" class="hc-order-lines">
              <div v-for="l in r.m.lines" :key="l.item" class="hc-order-line">
                <span>{{ l.item }}</span><span>{{ l.qty }}{{ l.unit }}</span>
              </div>
            </div>
          </div>
        </template>
      </template>

      <!-- 発注 -->
      <template v-if="showOrder && selectedOrders.length">
        <div class="hc-sec-title">
          <span class="dot dot-order"></span>発注（{{ selectedOrders.length }}件）
          <span v-if="selOrderTotal != null" class="hc-sec-total">{{ fmtYen(selOrderTotal) }}</span>
        </div>
        <div v-for="r in selectedOrderRows" :key="r.o.id" class="hc-entry hc-entry-order">
          <div class="hc-entry-main" @click="toggleOrder(r.o.id)">
            <span class="hc-order-sup">{{ r.o.supplier || '（未分類）' }}</span>
            <span class="hc-entry-info">🧾 {{ r.o.lines.length }}品目</span>
            <span v-if="importedOrderIds.has(r.o.id)" class="hc-ord-done">入庫済み</span>
            <span :class="['hc-entry-amt', { none: r.amount == null }]">{{ r.amount != null ? fmtYen(r.amount) : '金額なし' }}</span>
            <button class="hc-entry-del" @click.stop="onDeleteOrder(r.o.id)" title="削除">🗑</button>
            <span class="hc-entry-arrow">{{ expanded[r.o.id] ? '▲' : '▼' }}</span>
          </div>
          <div v-if="r.amount == null" class="hc-entry-warn">単価が未登録のため、金額はありません</div>
          <div v-else-if="r.unpriced.length" class="hc-entry-warn">単価未登録で金額に含まれない品目: {{ _fmtUnpriced(r.unpriced) }}</div>
          <div v-if="expanded[r.o.id]" class="hc-order-lines">
            <div v-for="l in r.o.lines" :key="l.item" class="hc-order-line">
              <span>{{ l.item }}</span><span>{{ l.qty }}{{ l.unit }}</span>
            </div>
          </div>
        </div>
      </template>

      <div v-if="anyEstimated" class="hc-est-note">※ 発注・入出庫の金額は品目マスタの現在の単価による概算です</div>

      <div
        v-if="!(showStock && selectedStock.length) && !(showOrder && selectedOrders.length) && !(showMove && selectedMoves.length)"
        class="hc-empty"
      >
        この日はアプリの記録はありません
      </div>
    </div>
  </div>
</template>

<style scoped>
.hc { display: flex; flex-direction: column; gap: 10px; }

.hc-nav { display: flex; align-items: center; gap: 8px; }
.hc-nav-btn { border: 1.5px solid #d1d5db; background: #fff; border-radius: 8px; width: 34px; height: 34px; font-size: 18px; color: #4b5563; cursor: pointer; flex-shrink: 0; }
.hc-nav-btn:active { background: #f0f9ff; }
.hc-month { flex: 1; text-align: center; font-weight: 700; font-size: 16px; color: #1f2937; }
.hc-today { border: 1.5px solid #d1d5db; background: #fff; border-radius: 8px; padding: 6px 12px; font-size: 12px; font-weight: 700; color: #4b5563; cursor: pointer; flex-shrink: 0; }
.hc-today:active { background: #f0f9ff; }

.hc-legend { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.hc-leg { display: inline-flex; align-items: center; gap: 5px; border: 1.5px solid #d1d5db; background: #fff; border-radius: 20px; padding: 5px 12px; font-size: 12px; font-weight: 700; color: #6b7280; cursor: pointer; }
.hc-leg.on { border-color: var(--primary); color: var(--primary); background: var(--primary-weak); }
.hc-recent { margin-left: auto; border: none; background: none; color: var(--primary); font-size: 12px; font-weight: 700; cursor: pointer; padding: 5px 4px; }

.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; }
.dot-stock { background: #3b82f6; }
.dot-order { background: #f59e0b; }
.dot-in    { background: #10b981; }
.dot-out   { background: #ef4444; }

.hc-cal { background: #fff; border-radius: 12px; padding: 8px; border: 1.5px solid #cbd5e1; box-shadow: 0 2px 6px rgba(15,23,42,0.08); overflow: hidden; }
.hc-dow-row { display: grid; grid-template-columns: repeat(7, 1fr); margin-bottom: 4px; }

/* 月移動のスライドアニメーション（キー変更で再マウント → 再生）*/
.hc-weeks { border-top: 1px solid #dfe4ea; border-left: 1px solid #dfe4ea; border-radius: 8px; overflow: hidden; animation-duration: 0.22s; animation-timing-function: ease-out; }
.hc-weeks.anim-next { animation-name: hcSlideNext; }
.hc-weeks.anim-prev { animation-name: hcSlidePrev; }
@keyframes hcSlideNext { from { transform: translateX(26%); opacity: 0.25; } to { transform: none; opacity: 1; } }
@keyframes hcSlidePrev { from { transform: translateX(-26%); opacity: 0.25; } to { transform: none; opacity: 1; } }
.hc-dow { text-align: center; font-size: 11px; font-weight: 700; color: #9ca3af; padding: 4px 0; }
.hc-dow.sun { color: #ef4444; }
.hc-dow.sat { color: #3b82f6; }

.hc-week { display: grid; grid-template-columns: repeat(7, 1fr); }
.hc-cell { position: relative; aspect-ratio: 1 / 1.28; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; padding-top: 6px; border-right: 1px solid #dfe4ea; border-bottom: 1px solid #dfe4ea; }
.hc-cell.empty { background: #fafbfc; }
.hc-cell.tappable { cursor: pointer; }
.hc-cell.tappable:active { background: #f0f9ff; }
.hc-cell.today { box-shadow: inset 0 0 0 2px #111827; }        /* 今日＝黒枠 */
.hc-cell.selected { background: var(--primary-weak); box-shadow: inset 0 0 0 2px var(--primary); }  /* 選択中＝青枠（今日より優先）*/
.hc-day { font-size: 14px; font-weight: 600; color: #374151; line-height: 1; }
.hc-day.sun { color: #ef4444; }
.hc-day.sat { color: #3b82f6; }
.hc-wx { position: absolute; top: 3px; right: 4px; font-size: 11px; line-height: 1; }
.hc-dots { position: absolute; bottom: 6px; display: flex; gap: 3px; justify-content: center; }
/* 4つのときだけ 2×2 に折り返す（3つまでは横並び）*/
.hc-dots.dots-grid { display: grid; grid-template-columns: repeat(2, auto); gap: 3px; }
/* 実施済みの実績ドットをゆっくり点滅 */
.hc-dots .dot { animation: hcDotPulse 2s ease-in-out infinite; }
@keyframes hcDotPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }

.hc-cell-info { position: absolute; bottom: 4px; left: 0; right: 0; display: flex; flex-direction: column; align-items: center; gap: 2px; pointer-events: none; }
.hc-cell-info.stock { color: #2563eb; }
.hc-cell-info.order { color: #d97706; }
.hc-ci-count { font-size: 9px; font-weight: 700; line-height: 1; }
.hc-ci-amt { font-size: 9px; font-weight: 800; line-height: 1; white-space: nowrap; }
.hc-ci-count.ci-in  { color: #059669; }
.hc-ci-count.ci-out { color: #dc2626; }

/* 暦の需要要因レイヤー（帯＝背景・祝前日＝下線・給料日＝マーカー） */
.hc-cell.band-holiday:not(.today):not(.selected) { background: #fef2f2; }  /* 祝日 薄赤 */
.hc-cell.band-span:not(.today):not(.selected)    { background: #f5f3ff; }  /* お盆・年末年始 薄紫 */
.hc-cell.band-season:not(.today):not(.selected)  { background: #effdfa; }  /* 長期休暇 薄ティール */
.hc-cell.band-long:not(.today):not(.selected)    { background: #fffbeb; }  /* 連休 薄アンバー */
/* 祝前日: 平日は濃い下線（需要インパクト大）、休日(週末)は淡い下線 */
.hc-cell.eve-weekday:not(.today):not(.selected) { box-shadow: inset 0 -3px 0 #f59e0b; }
.hc-cell.eve-weekend:not(.today):not(.selected) { box-shadow: inset 0 -2px 0 #fde68a; }
/* 連休（3連休以上）の連結アンダーライン。隣接セルと繋がり、連休の端を丸める */
.hc-run { position: absolute; left: 0; right: 0; bottom: 1px; height: 4px; background: #ec4899; z-index: 1; }
.hc-run.capL { left: 3px; border-top-left-radius: 3px; border-bottom-left-radius: 3px; }
.hc-run.capR { right: 3px; border-top-right-radius: 3px; border-bottom-right-radius: 3px; }
.hc-day.hol { color: #dc2626; font-weight: 700; }
.hc-pay-mark { position: absolute; top: 3px; left: 4px; font-size: 10px; line-height: 1; }
.hc-note-mark { position: absolute; bottom: 2px; right: 3px; font-size: 9px; line-height: 1; }
.hc-gotobi-mark { position: absolute; bottom: 3px; left: 3px; width: 5px; height: 5px; border-radius: 50%; background: #0891b2; }
.hc-factor-toggle.on { border-color: #ea580c; color: #c2410c; background: #fff7ed; }

.hc-sheet-factors { display: flex; flex-wrap: wrap; gap: 6px; margin: -2px 0 8px; }
.hc-fchip { font-size: 11px; font-weight: 700; border-radius: 20px; padding: 2px 9px; }
.hc-fchip.f-holiday { background: #fef2f2; color: #dc2626; }
.hc-fchip.f-eve     { background: #fffbeb; color: #b45309; }
.hc-fchip.f-span    { background: #f5f3ff; color: #7c3aed; }
.hc-fchip.f-season  { background: #effdfa; color: #0f766e; }
.hc-fchip.f-long    { background: #fffbeb; color: #b45309; }
.hc-fchip.f-pay     { background: #ecfdf5; color: #047857; }
.hc-fchip.f-pension { background: #eff6ff; color: #1d4ed8; }
.hc-fchip.f-gotobi  { background: #ecfeff; color: #0e7490; }
.hc-fchip.f-weekday { background: #f1f5f9; color: #475569; }

/* この日の基本情報・比較 */
.hc-facts { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 12px; margin-bottom: 10px; }
.hc-fact { display: flex; align-items: baseline; gap: 6px; font-size: 12px; }
.hc-fact-k { color: #94a3b8; font-weight: 700; flex-shrink: 0; min-width: 48px; }
.hc-fact-v { color: #334155; font-weight: 600; }

/* 日別メモ */
.hc-memo { background: #fafaf9; border: 1px solid #eef0f2; border-radius: 10px; padding: 10px; margin-bottom: 10px; }
.hc-memo-tags { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 7px; }
.hc-memo-tag { border: 1px solid #e2e8f0; background: #fff; color: #64748b; border-radius: 14px; padding: 3px 10px; font-size: 11px; font-weight: 700; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.hc-memo-tag.on { border-color: #f59e0b; background: #fffbeb; color: #b45309; }
.hc-memo-text { width: 100%; box-sizing: border-box; border: 1px solid #e2e8f0; border-radius: 8px; padding: 7px 9px; font-size: 13px; resize: vertical; font-family: inherit; }
.hc-memo-excl { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #475569; margin: 7px 0; cursor: pointer; }
.hc-memo-excl input { width: 16px; height: 16px; }
.hc-memo-save { border: none; background: var(--primary); color: #fff; border-radius: 8px; padding: 7px 16px; font-size: 13px; font-weight: 800; cursor: pointer; }

.hc-sheet { background: #fff; border-radius: 12px; padding: 12px 14px; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
.hc-sheet-head { display: flex; align-items: center; gap: 8px; padding-bottom: 8px; border-bottom: 1px solid #eef0f2; margin-bottom: 8px; }
.hc-sheet-date { font-weight: 700; font-size: 15px; color: #1f2937; }
.hc-sheet-wx { font-size: 12px; color: #6b7280; }
.hc-sheet-close { margin-left: auto; border: none; background: none; font-size: 15px; color: #9ca3af; cursor: pointer; padding: 2px 6px; }

.hc-sec-title { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 700; color: #6b7280; margin: 10px 0 6px; }
.hc-sec-title:first-of-type { margin-top: 2px; }
.hc-sec-total { margin-left: auto; font-size: 13px; font-weight: 800; color: #1f2937; }

.hc-entry { border: 1px solid #eef0f2; border-radius: 10px; margin-bottom: 6px; overflow: hidden; }
.hc-entry-stock { cursor: pointer; }
.hc-entry-stock:active { background: #f0f9ff; }
.hc-entry-main { display: flex; align-items: center; gap: 8px; padding: 10px 12px; }
.hc-entry-time { font-size: 12px; color: #6b7280; flex-shrink: 0; }
.hc-order-sup { font-size: 14px; font-weight: 700; color: #374151; }
.hc-entry-info { font-size: 13px; color: #4b5563; }
.hc-entry-amt { margin-left: auto; font-size: 13px; font-weight: 700; color: #1f2937; flex-shrink: 0; white-space: nowrap; }
.hc-entry-amt.none { font-size: 11px; font-weight: 600; color: #9ca3af; }
.hc-entry-del { border: none; background: none; cursor: pointer; font-size: 14px; }
.hc-entry-arrow { font-size: 12px; color: #9ca3af; flex-shrink: 0; }
.hc-entry-order .hc-entry-main,
.hc-entry-move .hc-entry-main { cursor: pointer; }
.hc-move-note { flex: 1; min-width: 0; font-size: 11px; color: #6b7280; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hc-ord-done { font-size: 10px; font-weight: 700; color: #047857; background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 10px; padding: 1px 7px; flex-shrink: 0; }
.hc-entry-warn { font-size: 11px; color: #b45309; background: #fffbeb; border-top: 1px solid #fde68a; padding: 6px 12px; line-height: 1.5; }
.hc-est-note { font-size: 10.5px; color: #9ca3af; margin: 2px 0 4px; }

.hc-order-lines { border-top: 1px solid #f3f4f6; }
.hc-order-line { display: flex; justify-content: space-between; padding: 6px 12px; font-size: 13px; color: #4b5563; border-top: 1px solid #f8fafc; }

.hc-empty { padding: 20px; text-align: center; color: #9ca3af; font-size: 13px; }
</style>
