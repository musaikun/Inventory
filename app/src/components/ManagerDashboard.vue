<script setup>
import { ref, computed, watch } from 'vue'

const props = defineProps({
  snapshots: { type: Array, default: () => [] },
})
const emit = defineEmits(['close'])

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

// 新しい順（getSnapshots は既に新しい順だが防御的に整列）
const sorted = computed(() =>
  [...props.snapshots].sort((a, b) => (b.date || '').localeCompare(a.date || ''))
)
const hasData = computed(() => sorted.value.length > 0)

// ── どの棚卸を分析するか ────────────────────────────
const selectedDate = ref(null)
watch(sorted, (arr) => {
  if (!selectedDate.value || !arr.some(s => s.date === selectedDate.value)) {
    selectedDate.value = arr[0]?.date ?? null
  }
}, { immediate: true })

const currentIdx = computed(() => sorted.value.findIndex(s => s.date === selectedDate.value))
const current = computed(() => sorted.value[currentIdx.value] ?? null)
// 選択した棚卸の「1つ前」= より古い直近のスナップショット
const prevSnap = computed(() => {
  const i = currentIdx.value
  return i >= 0 ? (sorted.value[i + 1] ?? null) : null
})

function _hasPrices(snap) {
  return !!snap && snap.items.some(it => it.unitPrice != null)
}
const curHasPrices  = computed(() => _hasPrices(current.value))
const prevHasPrices = computed(() => _hasPrices(prevSnap.value))
const canValue = computed(() => curHasPrices.value && prevHasPrices.value)

function _yen(v) {
  if (v == null) return '—'
  return '¥' + Math.round(v).toLocaleString('ja-JP')
}
function _weekday(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  if (isNaN(d.getTime())) return ''
  return WEEKDAYS[d.getDay()]
}
function _fmtDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  if (isNaN(d.getTime())) return dateStr
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
}
function _optionLabel(s) {
  return `${_fmtDate(s.date)}（${_weekday(s.date)}）${s.totalValue != null ? ' ' + _yen(s.totalValue) : ''}`
}
function _fmtDuration(ms) {
  if (typeof ms !== 'number' || ms <= 0) return null
  const min = Math.round(ms / 60000)
  if (min < 1)  return '1分未満'
  if (min < 60) return `${min}分`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m > 0 ? `${h}時間${m}分` : `${h}時間`
}

// ── 選択した棚卸のサマリー ──────────────────────────
const summary = computed(() => {
  const s = current.value
  if (!s) return null
  const entered = s.items.filter(it => it.qty !== null).length
  const totalValue = curHasPrices.value ? s.totalValue : null
  const prevTotal  = prevHasPrices.value ? (prevSnap.value?.totalValue ?? null) : null
  let diffValue = null, diffPct = null
  if (totalValue != null && prevTotal != null && prevTotal > 0) {
    diffValue = totalValue - prevTotal
    diffPct   = Math.round((totalValue / prevTotal - 1) * 100)
  }
  return {
    date:        s.date,
    weekday:     _weekday(s.date),
    hasPrices:   curHasPrices.value,
    totalValue,
    duration:    _fmtDuration(s.activeMs),
    headcount:   s.participants?.length ?? null,
    entered,
    diffValue,
    diffPct,
  }
})

// ── 在庫金額推移（古い→新しい、最大12件）────────────
const trend = computed(() => {
  const arr = [...sorted.value]
    .filter(s => s.totalValue != null)
    .reverse()
    .slice(-12)
  const max = Math.max(1, ...arr.map(s => s.totalValue))
  return arr.map(s => ({
    date:  s.date,
    label: `${new Date(s.date + 'T00:00:00').getMonth() + 1}/${new Date(s.date + 'T00:00:00').getDate()}`,
    value: s.totalValue,
    pct:   Math.round((s.totalValue / max) * 100),
    sel:   s.date === selectedDate.value,
  }))
})

// ── ジャンル別在庫金額（選択した棚卸）────────────────
const genreBreakdown = computed(() => {
  const s = current.value
  if (!s || !curHasPrices.value) return []
  const map = new Map()
  for (const it of s.items) {
    if (it.subtotal == null) continue
    const g = it.category || '未分類'
    map.set(g, (map.get(g) || 0) + it.subtotal)
  }
  const rows = [...map.entries()].map(([genre, value]) => ({ genre, value }))
  rows.sort((a, b) => b.value - a.value)
  const total = rows.reduce((sum, r) => sum + r.value, 0)
  const max = Math.max(1, ...rows.map(r => r.value))
  return rows.map(r => ({
    ...r,
    pctOfTotal: total > 0 ? Math.round((r.value / total) * 100) : 0,
    barPct:     Math.round((r.value / max) * 100),
  }))
})

// ── 前回差アラート ────────────────────────────────
const alertMode = ref('value')      // 'value' | 'qty'
const effectiveMode = computed(() => canValue.value ? alertMode.value : 'qty')
const threshold = ref(200)          // 増加率 %（150〜500）
const floorValue = ref(1000)        // 金額の下限（円）
const floorQty   = ref(3)           // 数量の下限

const diffRows = computed(() => {
  const cur = current.value
  const pv  = prevSnap.value
  const empty = { increases: [], decreases: [], appeared: [], gone: [] }
  if (!cur || !pv) return empty

  const prevMap = new Map()
  for (const it of pv.items) prevMap.set(it.item, it)

  const isValue = effectiveMode.value === 'value'
  const floor = isValue ? floorValue.value : floorQty.value
  const th = threshold.value / 100

  const increases = [], decreases = [], appeared = [], gone = []

  for (const it of cur.items) {
    if (it.qty === null) continue
    const p = prevMap.get(it.item)
    const curVal = isValue ? (it.subtotal ?? 0) : it.qty
    const prevVal = p && p.qty !== null ? (isValue ? (p.subtotal ?? 0) : p.qty) : null

    if (prevVal === null || prevVal === 0) {
      if (curVal >= floor) {
        appeared.push({ item: it.item, curVal, unit: it.unit })
      }
      continue
    }
    const ratio = curVal / prevVal
    const absDiff = Math.abs(curVal - prevVal)
    if (absDiff < floor) continue
    const row = { item: it.item, curVal, prevVal, ratio, unit: it.unit }
    if (ratio >= th) increases.push(row)
    else if (ratio <= 1 / th) decreases.push(row)
  }

  const curMap = new Map()
  for (const it of cur.items) if (it.qty !== null) curMap.set(it.item, it)
  for (const it of pv.items) {
    if (it.qty === null) continue
    if (curMap.has(it.item)) continue
    const prevVal = isValue ? (it.subtotal ?? 0) : it.qty
    if (prevVal >= floor) gone.push({ item: it.item, prevVal, unit: it.unit })
  }

  increases.sort((a, b) => b.ratio - a.ratio)
  decreases.sort((a, b) => a.ratio - b.ratio)
  appeared.sort((a, b) => b.curVal - a.curVal)
  gone.sort((a, b) => b.prevVal - a.prevVal)
  return { increases, decreases, appeared, gone }
})

function _fmtVal(v) {
  return effectiveMode.value === 'value' ? _yen(v) : `${v}`
}
function _fmtUnit(unit) {
  return effectiveMode.value === 'qty' && unit ? unit : ''
}

// ── ABC分析（選択した棚卸・在庫金額）──────────────
const abc = computed(() => {
  const s = current.value
  if (!s || !curHasPrices.value) return null
  const rows = s.items
    .filter(it => it.subtotal != null && it.subtotal > 0)
    .map(it => ({ item: it.item, value: it.subtotal }))
    .sort((a, b) => b.value - a.value)
  const total = rows.reduce((sum, r) => sum + r.value, 0)
  if (total <= 0) return null

  let cum = 0
  const classified = rows.map(r => {
    cum += r.value
    const cumPct = (cum / total) * 100
    let cls = 'C'
    if (cumPct <= 70) cls = 'A'
    else if (cumPct <= 90) cls = 'B'
    return { ...r, cls }
  })

  const summarize = (cls) => {
    const items = classified.filter(r => r.cls === cls)
    const value = items.reduce((sum, r) => sum + r.value, 0)
    return {
      cls,
      count: items.length,
      value,
      pctOfCount: rows.length ? Math.round((items.length / rows.length) * 100) : 0,
      pctOfValue: Math.round((value / total) * 100),
      items: items.slice(0, 10),
    }
  }
  return { total, A: summarize('A'), B: summarize('B'), C: summarize('C') }
})

// ── 分析できる項目（データに応じて増える）──────────
const showCapabilities = ref(false)
const capabilities = computed(() => {
  const s = current.value
  if (!s) return []
  const withPrice = s.items.filter(it => it.unitPrice != null).length
  const withCat   = s.items.filter(it => it.category).length
  const withPrev  = s.items.filter(it => it.prevMonth !== '' && it.prevMonth != null).length
  return [
    {
      name: '在庫金額・推移・ABC分析',
      ok: withPrice > 0,
      detail: withPrice > 0 ? `${withPrice}品目に単価あり` : '単価データなし',
      need: '各品目の単価',
      hint: '設定 › 品目リストで単価を入力（またはCSVで取込）すると、在庫金額の合計・推移・ABC分析が使えます',
    },
    {
      name: 'ジャンル別在庫金額',
      ok: withCat > 0 && withPrice > 0,
      detail: withCat > 0 ? `${withCat}品目にジャンルあり` : 'ジャンル未設定',
      need: '品目のジャンル＋単価',
      hint: '入力モーダルやCSVで品目にジャンルを設定すると、ジャンル別の在庫金額が集計されます',
    },
    {
      name: '前回差アラート',
      ok: !!prevSnap.value,
      detail: prevSnap.value ? '前回の棚卸データあり' : '前回データなし',
      need: '2回以上の棚卸',
      hint: '棚卸を2回以上完了すると、前回との差（急増・急減・新規・未入力）が表示されます',
    },
    {
      name: '前月実績との比較',
      ok: withPrev > 0,
      future: true,
      detail: withPrev > 0 ? `${withPrev}品目に前月実績あり` : '前月実績なし',
      need: '前月実績（CSV）',
      hint: 'CSVで「前月実績」列を取り込むと、前月比の分析に対応予定です',
    },
    {
      name: '原価率・廃棄率・在庫回転率',
      ok: false,
      future: true,
      detail: '仕入・出庫・廃棄が未記録',
      need: '仕入・出庫・廃棄の記録',
      hint: '月次の在庫だけでは在庫の増減しか分かりません。仕入合計などを記録すると、概算の原価率が算出できるよう対応予定です',
    },
  ]
})
</script>

<template>
  <div class="dash-overlay">
    <div class="dash-header">
      <button class="dash-back" @click="emit('close')">‹ 戻る</button>
      <div class="dash-title">📊 店長ダッシュボード</div>
      <div class="dash-header-spacer"></div>
    </div>

    <div class="dash-body">
      <div v-if="!hasData" class="dash-empty">
        <div class="dash-empty-icon">📊</div>
        <div class="dash-empty-title">分析できるデータがありません</div>
        <div class="dash-empty-desc">棚卸を完了すると在庫金額・差異が表示されます</div>
      </div>

      <template v-else>
        <!-- 棚卸の選択 -->
        <div class="dash-picker">
          <label class="dash-picker-label">分析する棚卸</label>
          <select v-model="selectedDate" class="dash-picker-select">
            <option v-for="s in sorted" :key="s.date" :value="s.date">{{ _optionLabel(s) }}</option>
          </select>
        </div>

        <!-- 金額データなしの注意 -->
        <div v-if="!curHasPrices" class="dash-warn">
          <span class="dash-warn-icon">⚠️</span>
          <div>
            <div class="dash-warn-title">この棚卸データには金額（単価）が含まれていません</div>
            <div class="dash-warn-desc">数量ベースの分析のみ表示します。単価を設定すると在庫金額・ABC分析が使えます。</div>
          </div>
        </div>

        <!-- サマリー -->
        <div class="dash-section">
          <div class="dash-summary-head">
            <span class="dash-summary-date">{{ _fmtDate(summary.date) }}</span>
            <span class="dash-weekday" :class="{ sat: summary.weekday === '土', sun: summary.weekday === '日' }">
              {{ summary.weekday }}曜日
            </span>
          </div>
          <template v-if="summary.hasPrices">
            <div class="dash-total">{{ _yen(summary.totalValue) }}</div>
            <div class="dash-total-label">在庫金額</div>
            <div
              v-if="summary.diffValue != null"
              class="dash-diff"
              :class="summary.diffValue >= 0 ? 'up' : 'down'"
            >
              前回比 {{ summary.diffValue >= 0 ? '+' : '−' }}{{ _yen(Math.abs(summary.diffValue)).slice(1) }}
              （{{ summary.diffPct >= 0 ? '+' : '' }}{{ summary.diffPct }}%）
            </div>
          </template>
          <template v-else>
            <div class="dash-total dash-total-muted">金額データなし</div>
            <div class="dash-total-label">単価が未設定です</div>
          </template>
          <div class="dash-meta">
            <div class="dash-meta-item" v-if="summary.duration">
              <span class="dash-meta-icon">⏱</span>{{ summary.duration }}
            </div>
            <div class="dash-meta-item" v-if="summary.headcount">
              <span class="dash-meta-icon">👥</span>{{ summary.headcount }}人
            </div>
            <div class="dash-meta-item">
              <span class="dash-meta-icon">📦</span>{{ summary.entered }}品目
            </div>
          </div>
        </div>

        <!-- 在庫金額推移 -->
        <div class="dash-section" v-if="trend.length >= 2">
          <div class="dash-section-title">在庫金額の推移</div>
          <div class="dash-trend">
            <div v-for="t in trend" :key="t.date" class="dash-trend-col">
              <div class="dash-trend-bar-wrap">
                <div class="dash-trend-bar" :class="{ sel: t.sel }" :style="{ height: Math.max(4, t.pct) + '%' }"></div>
              </div>
              <div class="dash-trend-label" :class="{ sel: t.sel }">{{ t.label }}</div>
            </div>
          </div>
          <div class="dash-trend-note">直近{{ trend.length }}回・選択中はハイライト</div>
        </div>

        <!-- ジャンル別在庫金額 -->
        <div class="dash-section" v-if="genreBreakdown.length">
          <div class="dash-section-title">ジャンル別在庫金額</div>
          <div v-for="g in genreBreakdown" :key="g.genre" class="dash-genre-row">
            <div class="dash-genre-head">
              <span class="dash-genre-name">{{ g.genre }}</span>
              <span class="dash-genre-val">{{ _yen(g.value) }} <span class="dash-genre-pct">{{ g.pctOfTotal }}%</span></span>
            </div>
            <div class="dash-genre-bar-wrap">
              <div class="dash-genre-bar" :style="{ width: g.barPct + '%' }"></div>
            </div>
          </div>
        </div>

        <!-- 前回差アラート -->
        <div class="dash-section" v-if="prevSnap">
          <div class="dash-section-title">前回差アラート</div>
          <div class="dash-controls">
            <div class="dash-toggle">
              <button :class="{ on: effectiveMode === 'value' }" :disabled="!canValue" @click="alertMode = 'value'">金額</button>
              <button :class="{ on: effectiveMode === 'qty' }" @click="alertMode = 'qty'">数量</button>
            </div>
            <span v-if="!canValue" class="dash-toggle-note">金額データがないため数量で比較</span>
          </div>
          <div class="dash-slider-row">
            <label class="dash-slider-label">増加率しきい値<span class="dash-slider-val">{{ threshold }}%以上</span></label>
            <input type="range" min="150" max="500" step="10" v-model.number="threshold" class="dash-slider" />
          </div>
          <div class="dash-slider-row">
            <label class="dash-slider-label">
              最小差
              <span class="dash-slider-val" v-if="effectiveMode === 'value'">{{ _yen(floorValue) }}以上</span>
              <span class="dash-slider-val" v-else>{{ floorQty }}以上</span>
            </label>
            <input v-if="effectiveMode === 'value'" type="range" min="0" max="10000" step="500" v-model.number="floorValue" class="dash-slider" />
            <input v-else type="range" min="0" max="30" step="1" v-model.number="floorQty" class="dash-slider" />
          </div>
          <div class="dash-slider-hint">小さな増減を隠して、本当に増えた／減った品目だけを表示します</div>

          <div class="dash-alert-group" v-if="diffRows.increases.length">
            <div class="dash-alert-head up">📈 急増 {{ diffRows.increases.length }}件</div>
            <div v-for="r in diffRows.increases" :key="'inc' + r.item" class="dash-alert-row">
              <span class="dash-alert-item">{{ r.item }}</span>
              <span class="dash-alert-change up">
                {{ _fmtVal(r.prevVal) }} → {{ _fmtVal(r.curVal) }}{{ _fmtUnit(r.unit) }}
                <span class="dash-alert-ratio">×{{ r.ratio.toFixed(1) }}</span>
              </span>
            </div>
          </div>

          <div class="dash-alert-group" v-if="diffRows.decreases.length">
            <div class="dash-alert-head down">📉 急減 {{ diffRows.decreases.length }}件</div>
            <div v-for="r in diffRows.decreases" :key="'dec' + r.item" class="dash-alert-row">
              <span class="dash-alert-item">{{ r.item }}</span>
              <span class="dash-alert-change down">
                {{ _fmtVal(r.prevVal) }} → {{ _fmtVal(r.curVal) }}{{ _fmtUnit(r.unit) }}
                <span class="dash-alert-ratio">×{{ r.ratio.toFixed(1) }}</span>
              </span>
            </div>
          </div>

          <div class="dash-alert-group" v-if="diffRows.appeared.length">
            <div class="dash-alert-head new">🆕 新規・復活 {{ diffRows.appeared.length }}件</div>
            <div v-for="r in diffRows.appeared" :key="'app' + r.item" class="dash-alert-row">
              <span class="dash-alert-item">{{ r.item }}</span>
              <span class="dash-alert-change new">前回0 → {{ _fmtVal(r.curVal) }}{{ _fmtUnit(r.unit) }}</span>
            </div>
          </div>

          <div class="dash-alert-group" v-if="diffRows.gone.length">
            <div class="dash-alert-head gone">⚠️ 今回未入力 {{ diffRows.gone.length }}件</div>
            <div v-for="r in diffRows.gone" :key="'gone' + r.item" class="dash-alert-row">
              <span class="dash-alert-item">{{ r.item }}</span>
              <span class="dash-alert-change gone">前回 {{ _fmtVal(r.prevVal) }}{{ _fmtUnit(r.unit) }} → 未入力</span>
            </div>
          </div>

          <div
            class="dash-alert-empty"
            v-if="!diffRows.increases.length && !diffRows.decreases.length && !diffRows.appeared.length && !diffRows.gone.length"
          >
            しきい値を超える差はありません
          </div>
        </div>
        <div class="dash-section dash-note" v-else>
          この棚卸より前のデータがないため、差異アラートは表示できません
        </div>

        <!-- ABC分析 -->
        <div class="dash-section" v-if="abc">
          <div class="dash-section-title">在庫金額ABC分析</div>
          <div class="dash-abc-desc">
            在庫金額の大きい順に A（上位70%）／B（〜90%）／C（残り）に分類。
            <b>A品目は少数でも金額の大半を占める重点管理対象</b>です。
          </div>
          <div class="dash-abc-bars">
            <div class="dash-abc-bar a" :style="{ flex: abc.A.pctOfValue || 0.5 }" v-if="abc.A.count">A {{ abc.A.pctOfValue }}%</div>
            <div class="dash-abc-bar b" :style="{ flex: abc.B.pctOfValue || 0.5 }" v-if="abc.B.count">B {{ abc.B.pctOfValue }}%</div>
            <div class="dash-abc-bar c" :style="{ flex: abc.C.pctOfValue || 0.5 }" v-if="abc.C.count">C {{ abc.C.pctOfValue }}%</div>
          </div>
          <div class="dash-abc-legend">
            <div class="dash-abc-leg"><span class="dot a"></span>A: {{ abc.A.count }}品目（{{ abc.A.pctOfCount }}%）→ {{ _yen(abc.A.value) }}</div>
            <div class="dash-abc-leg"><span class="dot b"></span>B: {{ abc.B.count }}品目（{{ abc.B.pctOfCount }}%）→ {{ _yen(abc.B.value) }}</div>
            <div class="dash-abc-leg"><span class="dot c"></span>C: {{ abc.C.count }}品目（{{ abc.C.pctOfCount }}%）→ {{ _yen(abc.C.value) }}</div>
          </div>
          <div class="dash-abc-list" v-if="abc.A.items.length">
            <div class="dash-abc-list-title">A品目（重点管理・上位{{ abc.A.items.length }}件）</div>
            <div v-for="r in abc.A.items" :key="'abc' + r.item" class="dash-abc-item">
              <span class="dash-abc-rank a">A</span>
              <span class="dash-abc-name">{{ r.item }}</span>
              <span class="dash-abc-val">{{ _yen(r.value) }}</span>
            </div>
          </div>
        </div>

        <!-- 分析できる項目（データに応じて増える） -->
        <div class="dash-section">
          <button class="dash-cap-toggle" @click="showCapabilities = !showCapabilities">
            <span>📋 分析できる項目・これがあればもっと出せます</span>
            <span class="dash-cap-caret">{{ showCapabilities ? '▲' : '▼' }}</span>
          </button>
          <div v-if="showCapabilities" class="dash-cap-list">
            <div v-for="c in capabilities" :key="c.name" class="dash-cap-row" :class="{ off: !c.ok }">
              <div class="dash-cap-status" :class="c.ok ? 'ok' : (c.future ? 'future' : 'wait')">
                {{ c.ok ? '✓' : (c.future ? '今後' : '🔒') }}
              </div>
              <div class="dash-cap-body">
                <div class="dash-cap-name">
                  {{ c.name }}
                  <span class="dash-cap-badge" v-if="c.ok">利用可能</span>
                  <span class="dash-cap-badge future" v-else-if="c.future">今後対応</span>
                  <span class="dash-cap-badge wait" v-else>データ待ち</span>
                </div>
                <div class="dash-cap-detail">{{ c.detail }}</div>
                <div class="dash-cap-hint" v-if="!c.ok">必要データ: {{ c.need }}<br>{{ c.hint }}</div>
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.dash-overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  background: #f5f6f8;
  display: flex;
  flex-direction: column;
}
.dash-header {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  background: #fff;
  border-bottom: 1px solid #e5e7eb;
  flex-shrink: 0;
}
.dash-back {
  background: none;
  border: none;
  color: #2563eb;
  font-size: 16px;
  cursor: pointer;
  padding: 4px 8px;
}
.dash-title { font-weight: 700; font-size: 16px; flex: 1; text-align: center; }
.dash-header-spacer { width: 56px; }
.dash-body { flex: 1; overflow-y: auto; padding: 16px; -webkit-overflow-scrolling: touch; }

.dash-empty { text-align: center; padding: 64px 24px; color: #6b7280; }
.dash-empty-icon { font-size: 48px; margin-bottom: 12px; }
.dash-empty-title { font-weight: 700; margin-bottom: 6px; color: #374151; }
.dash-empty-desc { font-size: 13px; }

.dash-picker { margin-bottom: 14px; }
.dash-picker-label { display: block; font-size: 12px; color: #6b7280; margin-bottom: 4px; }
.dash-picker-select {
  width: 100%; padding: 10px 12px; font-size: 14px; border: 1px solid #d1d5db;
  border-radius: 10px; background: #fff; color: #111827; appearance: none;
}

.dash-warn {
  display: flex; gap: 10px; background: #fffbeb; border: 1px solid #fde68a;
  border-radius: 12px; padding: 12px 14px; margin-bottom: 14px;
}
.dash-warn-icon { font-size: 18px; flex-shrink: 0; }
.dash-warn-title { font-size: 13px; font-weight: 700; color: #92400e; }
.dash-warn-desc { font-size: 12px; color: #b45309; margin-top: 2px; line-height: 1.5; }

.dash-section {
  background: #fff;
  border-radius: 14px;
  padding: 16px;
  margin-bottom: 14px;
  box-shadow: 0 1px 2px rgba(0,0,0,0.04);
}
.dash-section-title { font-weight: 700; font-size: 14px; margin-bottom: 12px; color: #374151; }

.dash-summary-head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.dash-summary-date { font-size: 13px; color: #6b7280; }
.dash-weekday {
  font-size: 12px; font-weight: 700; padding: 1px 8px; border-radius: 10px;
  background: #eef2ff; color: #4338ca;
}
.dash-weekday.sat { background: #eff6ff; color: #2563eb; }
.dash-weekday.sun { background: #fef2f2; color: #dc2626; }
.dash-total { font-size: 30px; font-weight: 800; color: #111827; letter-spacing: -0.5px; }
.dash-total-muted { font-size: 20px; color: #9ca3af; }
.dash-total-label { font-size: 12px; color: #9ca3af; margin-top: 2px; }
.dash-diff { font-size: 13px; font-weight: 700; margin-top: 8px; }
.dash-diff.up { color: #dc2626; }
.dash-diff.down { color: #2563eb; }
.dash-meta { display: flex; gap: 16px; margin-top: 12px; padding-top: 12px; border-top: 1px solid #f3f4f6; }
.dash-meta-item { font-size: 13px; color: #4b5563; }
.dash-meta-icon { margin-right: 4px; }

.dash-trend { display: flex; align-items: flex-end; gap: 6px; height: 120px; }
.dash-trend-col { flex: 1; display: flex; flex-direction: column; align-items: center; height: 100%; }
.dash-trend-bar-wrap { flex: 1; width: 100%; display: flex; align-items: flex-end; }
.dash-trend-bar { width: 100%; background: linear-gradient(180deg, #93c5fd, #bfdbfe); border-radius: 4px 4px 0 0; min-height: 4px; }
.dash-trend-bar.sel { background: linear-gradient(180deg, #60a5fa, #2563eb); }
.dash-trend-label { font-size: 10px; color: #9ca3af; margin-top: 4px; }
.dash-trend-label.sel { color: #2563eb; font-weight: 700; }
.dash-trend-note { text-align: right; font-size: 11px; color: #9ca3af; margin-top: 6px; }

.dash-genre-row { margin-bottom: 10px; }
.dash-genre-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 3px; }
.dash-genre-name { font-size: 13px; color: #374151; }
.dash-genre-val { font-size: 13px; font-weight: 700; color: #111827; }
.dash-genre-pct { font-size: 11px; color: #9ca3af; font-weight: 400; }
.dash-genre-bar-wrap { height: 8px; background: #f3f4f6; border-radius: 4px; overflow: hidden; }
.dash-genre-bar { height: 100%; background: linear-gradient(90deg, #34d399, #059669); border-radius: 4px; }

.dash-controls { margin-bottom: 12px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.dash-toggle { display: inline-flex; background: #f3f4f6; border-radius: 8px; padding: 2px; }
.dash-toggle button { border: none; background: none; padding: 6px 18px; font-size: 13px; border-radius: 6px; cursor: pointer; color: #6b7280; }
.dash-toggle button.on { background: #fff; color: #111827; font-weight: 700; box-shadow: 0 1px 2px rgba(0,0,0,0.08); }
.dash-toggle button:disabled { opacity: 0.4; cursor: not-allowed; }
.dash-toggle-note { font-size: 11px; color: #9ca3af; }
.dash-slider-row { margin-bottom: 10px; }
.dash-slider-label { display: flex; justify-content: space-between; font-size: 12px; color: #6b7280; margin-bottom: 4px; }
.dash-slider-val { font-weight: 700; color: #374151; }
.dash-slider { width: 100%; accent-color: #2563eb; }
.dash-slider-hint { font-size: 11px; color: #9ca3af; margin: 4px 0 12px; }

.dash-alert-group { margin-top: 12px; }
.dash-alert-head { font-size: 13px; font-weight: 700; margin-bottom: 6px; }
.dash-alert-head.up { color: #dc2626; }
.dash-alert-head.down { color: #2563eb; }
.dash-alert-head.new { color: #059669; }
.dash-alert-head.gone { color: #d97706; }
.dash-alert-row { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; padding: 6px 0; border-bottom: 1px solid #f6f7f9; }
.dash-alert-item { font-size: 13px; color: #374151; flex-shrink: 1; word-break: break-all; }
.dash-alert-change { font-size: 12px; white-space: nowrap; text-align: right; color: #6b7280; }
.dash-alert-change.up { color: #b91c1c; }
.dash-alert-change.down { color: #1d4ed8; }
.dash-alert-change.new { color: #047857; }
.dash-alert-change.gone { color: #b45309; }
.dash-alert-ratio { font-weight: 700; margin-left: 4px; }
.dash-alert-empty { font-size: 13px; color: #9ca3af; text-align: center; padding: 16px 0; }

.dash-note { font-size: 13px; color: #6b7280; text-align: center; }

.dash-abc-desc { font-size: 12px; color: #6b7280; line-height: 1.6; margin-bottom: 12px; }
.dash-abc-bars { display: flex; height: 28px; border-radius: 8px; overflow: hidden; margin-bottom: 12px; }
.dash-abc-bar { display: flex; align-items: center; justify-content: center; color: #fff; font-size: 12px; font-weight: 700; min-width: 0; }
.dash-abc-bar.a { background: #dc2626; }
.dash-abc-bar.b { background: #f59e0b; }
.dash-abc-bar.c { background: #9ca3af; }
.dash-abc-legend { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
.dash-abc-leg { font-size: 12px; color: #4b5563; display: flex; align-items: center; }
.dash-abc-leg .dot { width: 10px; height: 10px; border-radius: 3px; margin-right: 6px; }
.dash-abc-leg .dot.a { background: #dc2626; }
.dash-abc-leg .dot.b { background: #f59e0b; }
.dash-abc-leg .dot.c { background: #9ca3af; }
.dash-abc-list-title { font-size: 12px; font-weight: 700; color: #6b7280; margin: 8px 0 6px; }
.dash-abc-item { display: flex; align-items: center; gap: 8px; padding: 5px 0; border-bottom: 1px solid #f6f7f9; }
.dash-abc-rank { font-size: 11px; font-weight: 800; color: #fff; border-radius: 4px; padding: 1px 6px; }
.dash-abc-rank.a { background: #dc2626; }
.dash-abc-name { flex: 1; font-size: 13px; color: #374151; word-break: break-all; }
.dash-abc-val { font-size: 13px; font-weight: 700; color: #111827; }

.dash-cap-toggle {
  width: 100%; display: flex; justify-content: space-between; align-items: center;
  background: none; border: none; padding: 0; font-size: 14px; font-weight: 700;
  color: #374151; cursor: pointer; text-align: left;
}
.dash-cap-caret { font-size: 11px; color: #9ca3af; }
.dash-cap-list { margin-top: 12px; display: flex; flex-direction: column; gap: 10px; }
.dash-cap-row { display: flex; gap: 10px; align-items: flex-start; }
.dash-cap-status {
  flex-shrink: 0; width: 30px; height: 24px; border-radius: 6px; font-size: 12px; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
}
.dash-cap-status.ok { background: #dcfce7; color: #16a34a; }
.dash-cap-status.wait { background: #f3f4f6; }
.dash-cap-status.future { background: #ede9fe; color: #7c3aed; font-size: 10px; }
.dash-cap-body { flex: 1; }
.dash-cap-name { font-size: 13px; font-weight: 600; color: #374151; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.dash-cap-badge { font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 8px; background: #dcfce7; color: #16a34a; }
.dash-cap-badge.wait { background: #f3f4f6; color: #6b7280; }
.dash-cap-badge.future { background: #ede9fe; color: #7c3aed; }
.dash-cap-detail { font-size: 12px; color: #9ca3af; margin-top: 2px; }
.dash-cap-hint { font-size: 11px; color: #6b7280; margin-top: 4px; line-height: 1.5; background: #f9fafb; padding: 6px 8px; border-radius: 6px; }
</style>
