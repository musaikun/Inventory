<script setup>
import { ref, computed, reactive, onMounted } from 'vue'
import { useHistory } from '../composables/useHistory.js'
import { useOrders } from '../composables/useOrders.js'

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

const filter = ref('all')  // 'all' | 'stock' | 'order'
const showStock = computed(() => filter.value !== 'order')
const showOrder = computed(() => filter.value !== 'stock')

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

const monthLabel = computed(() => `${viewYear.value}年${viewMonth.value + 1}月`)

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
      wx: props.weather[key] || null,
    })
  }
  while (cells.length % 7 !== 0) cells.push(null)
  const out = []
  for (let i = 0; i < cells.length; i += 7) out.push(cells.slice(i, i + 7))
  return out
})

function _hasVisible(cell) {
  if (!cell) return false
  return (showStock.value && cell.stock.length > 0) || (showOrder.value && cell.orders.length > 0)
}

function prevMonth() {
  if (viewMonth.value === 0) { viewMonth.value = 11; viewYear.value-- }
  else viewMonth.value--
}
function nextMonth() {
  if (viewMonth.value === 11) { viewMonth.value = 0; viewYear.value++ }
  else viewMonth.value++
}
function goToday() {
  viewYear.value = _now.getFullYear()
  viewMonth.value = _now.getMonth()
  selectedKey.value = _hasAny(todayKey) ? todayKey : null
}

// フィルタ考慮で最も新しいデータのある日付
const recentKey = computed(() => {
  const keys = new Set()
  if (showStock.value) for (const k of Object.keys(stockByDate.value)) keys.add(k)
  if (showOrder.value) for (const k of Object.keys(orderByDate.value)) keys.add(k)
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
  if (!_hasVisible(cell)) return
  selectedKey.value = cell.key === selectedKey.value ? null : cell.key
}
function _hasAny(key) {
  return (stockByDate.value[key]?.length || 0) > 0 || (orderByDate.value[key]?.length || 0) > 0
}

const selectedStock  = computed(() => (selectedKey.value ? stockByDate.value[selectedKey.value] || [] : []))
const selectedOrders = computed(() => (selectedKey.value ? orderByDate.value[selectedKey.value] || [] : []))
const selectedWeather = computed(() => (selectedKey.value ? props.weather[selectedKey.value] || null : null))

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
function _timeLabel(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
}

onMounted(() => {
  if (_hasAny(todayKey)) selectedKey.value = todayKey
})

const expanded = reactive({})
function toggleOrder(id) { expanded[id] = !expanded[id] }
function onDeleteOrder(id) {
  if (!confirm('この発注記録を削除しますか？')) return
  deleteOrder(id)
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
      <button v-if="recentKey" class="hc-recent" @click="goRecent">最近 ›</button>
    </div>

    <!-- カレンダー -->
    <div class="hc-cal">
      <div class="hc-dow-row">
        <span v-for="(w, i) in WEEK" :key="w" :class="['hc-dow', { sun: i === 0, sat: i === 6 }]">{{ w }}</span>
      </div>
      <div v-for="(week, wi) in weeks" :key="wi" class="hc-week">
        <div
          v-for="(cell, ci) in week"
          :key="ci"
          :class="['hc-cell', {
            empty: !cell,
            today: cell && cell.isToday,
            selected: cell && cell.key === selectedKey,
            tappable: _hasVisible(cell),
          }]"
          @click="cell && onCellTap(cell)"
        >
          <template v-if="cell">
            <span :class="['hc-day', { sun: cell.dow === 0, sat: cell.dow === 6 }]">{{ cell.d }}</span>
            <span v-if="cell.wx" class="hc-wx">{{ cell.wx.icon }}</span>
            <span class="hc-dots">
              <span v-if="showStock && cell.stock.length" class="dot dot-stock"></span>
              <span v-if="showOrder && cell.orders.length" class="dot dot-order"></span>
            </span>
          </template>
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
        </span>
        <button class="hc-sheet-close" @click="selectedKey = null">✕</button>
      </div>

      <!-- 棚卸 -->
      <template v-if="showStock && selectedStock.length">
        <div class="hc-sec-title"><span class="dot dot-stock"></span>棚卸（{{ selectedStock.length }}件）</div>
        <div
          v-for="s in selectedStock"
          :key="s.id"
          class="hc-entry hc-entry-stock"
          @click="emit('view-session', s)"
        >
          <div class="hc-entry-main">
            <span class="hc-entry-time">{{ _timeLabel(s.endedAt ?? s.startedAt) }}</span>
            <span class="hc-entry-info">📦 {{ _stockItemCount(s) }}品目</span>
            <button class="hc-entry-del" @click.stop="emit('delete-session', s)" title="削除">🗑</button>
            <span class="hc-entry-arrow">詳細 ›</span>
          </div>
        </div>
      </template>

      <!-- 発注 -->
      <template v-if="showOrder && selectedOrders.length">
        <div class="hc-sec-title"><span class="dot dot-order"></span>発注（{{ selectedOrders.length }}件）</div>
        <div v-for="o in selectedOrders" :key="o.id" class="hc-entry hc-entry-order">
          <div class="hc-entry-main" @click="toggleOrder(o.id)">
            <span class="hc-order-sup">{{ o.supplier || '（未分類）' }}</span>
            <span class="hc-entry-info">🧾 {{ o.lines.length }}品目</span>
            <button class="hc-entry-del" @click.stop="onDeleteOrder(o.id)" title="削除">🗑</button>
            <span class="hc-entry-arrow">{{ expanded[o.id] ? '▲' : '▼' }}</span>
          </div>
          <div v-if="expanded[o.id]" class="hc-order-lines">
            <div v-for="l in o.lines" :key="l.item" class="hc-order-line">
              <span>{{ l.item }}</span><span>{{ l.qty }}{{ l.unit }}</span>
            </div>
          </div>
        </div>
      </template>

      <div v-if="!(showStock && selectedStock.length) && !(showOrder && selectedOrders.length)" class="hc-empty">
        この日の履歴はありません
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

.hc-legend { display: flex; align-items: center; gap: 6px; }
.hc-leg { display: inline-flex; align-items: center; gap: 5px; border: 1.5px solid #d1d5db; background: #fff; border-radius: 20px; padding: 5px 12px; font-size: 12px; font-weight: 700; color: #6b7280; cursor: pointer; }
.hc-leg.on { border-color: var(--primary); color: var(--primary); background: var(--primary-weak); }
.hc-recent { margin-left: auto; border: none; background: none; color: var(--primary); font-size: 12px; font-weight: 700; cursor: pointer; padding: 5px 4px; }

.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; }
.dot-stock { background: #3b82f6; }
.dot-order { background: #f59e0b; }

.hc-cal { background: #fff; border-radius: 12px; padding: 8px; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
.hc-dow-row { display: grid; grid-template-columns: repeat(7, 1fr); margin-bottom: 4px; }
.hc-dow { text-align: center; font-size: 11px; font-weight: 700; color: #9ca3af; padding: 4px 0; }
.hc-dow.sun { color: #ef4444; }
.hc-dow.sat { color: #3b82f6; }

.hc-week { display: grid; grid-template-columns: repeat(7, 1fr); }
.hc-cell { position: relative; aspect-ratio: 1 / 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; padding-top: 5px; border-radius: 8px; }
.hc-cell.empty { visibility: hidden; }
.hc-cell.tappable { cursor: pointer; }
.hc-cell.tappable:active { background: #f0f9ff; }
.hc-cell.today { background: #eff6ff; }
.hc-cell.selected { background: var(--primary-weak); box-shadow: inset 0 0 0 2px var(--primary); }
.hc-day { font-size: 13px; color: #374151; line-height: 1; }
.hc-day.sun { color: #ef4444; }
.hc-day.sat { color: #3b82f6; }
.hc-wx { position: absolute; top: 3px; right: 4px; font-size: 11px; line-height: 1; }
.hc-dots { position: absolute; bottom: 6px; display: flex; gap: 3px; }

.hc-sheet { background: #fff; border-radius: 12px; padding: 12px 14px; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
.hc-sheet-head { display: flex; align-items: center; gap: 8px; padding-bottom: 8px; border-bottom: 1px solid #eef0f2; margin-bottom: 8px; }
.hc-sheet-date { font-weight: 700; font-size: 15px; color: #1f2937; }
.hc-sheet-wx { font-size: 12px; color: #6b7280; }
.hc-sheet-close { margin-left: auto; border: none; background: none; font-size: 15px; color: #9ca3af; cursor: pointer; padding: 2px 6px; }

.hc-sec-title { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 700; color: #6b7280; margin: 10px 0 6px; }
.hc-sec-title:first-of-type { margin-top: 2px; }

.hc-entry { border: 1px solid #eef0f2; border-radius: 10px; margin-bottom: 6px; overflow: hidden; }
.hc-entry-stock { cursor: pointer; }
.hc-entry-stock:active { background: #f0f9ff; }
.hc-entry-main { display: flex; align-items: center; gap: 8px; padding: 10px 12px; }
.hc-entry-time { font-size: 12px; color: #6b7280; flex-shrink: 0; }
.hc-order-sup { font-size: 14px; font-weight: 700; color: #374151; }
.hc-entry-info { font-size: 13px; color: #4b5563; }
.hc-entry-del { border: none; background: none; cursor: pointer; font-size: 14px; margin-left: auto; }
.hc-entry-arrow { font-size: 12px; color: #9ca3af; flex-shrink: 0; }
.hc-entry-order .hc-entry-main { cursor: pointer; }

.hc-order-lines { border-top: 1px solid #f3f4f6; }
.hc-order-line { display: flex; justify-content: space-between; padding: 6px 12px; font-size: 13px; color: #4b5563; border-top: 1px solid #f8fafc; }

.hc-empty { padding: 20px; text-align: center; color: #9ca3af; font-size: 13px; }
</style>
