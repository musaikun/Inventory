<script setup>
import { ref, computed, reactive } from 'vue'
import { useConfig } from '../composables/useConfig.js'
import { useInventory } from '../composables/useInventory.js'

const { config } = useConfig()
const { entryLog, getHistoricalLogs } = useInventory()

const props = defineProps({
  inventory:   { type: Object,  required: true },
  filledCount: { type: Number,  required: true },
  readOnly:    { type: Boolean, default: false },
})

const emit = defineEmits(['update', 'remove', 'reset', 'tap', 'zero'])

// ── 並べ替え / フィルター ─────────────────────────────────────────────────────
const sortMode      = ref('category')  // 'default' | 'alpha' | 'category'
const filterMode    = ref('all')       // 'all' | 'filled' | 'empty'
const typeFilter    = ref('all')       // 'all' | 'supplies' | 'food'
const expandedCats = reactive({})      // { カテゴリ名: true } = 展開中（デフォルト閉じ）

function toggleCat(label) {
  if (expandedCats[label]) delete expandedCats[label]
  else expandedCats[label] = true
}

function collapseAll() {
  Object.keys(expandedCats).forEach(k => delete expandedCats[k])
}

const sortOpts = [
  { value: 'category', label: 'ジャンル' },
  { value: 'alpha',    label: '五十音' },
  { value: 'learned',  label: '学習順' },
]

// ── 学習順スコア（過去3回の入力順から算出）──────────────────────────────────
// 現在セッションも含め重み付けでスコアを計算
// weights: 最新0.6, 1回前0.3, 2回前0.1
const LOG_WEIGHTS = [0.6, 0.3, 0.1]

const learnedScores = computed(() => {
  // 現在セッション（entryLog）+ 過去履歴を結合
  const historical = getHistoricalLogs()
  const today      = new Date().toISOString().slice(0, 10)
  const allLogs    = [
    ...(entryLog.length > 0 ? [{ date: today, log: [...entryLog] }] : []),
    ...historical,
  ].slice(0, 3)

  const scores = {}
  for (let i = 0; i < allLogs.length; i++) {
    const { log } = allLogs[i]
    const n = log.length
    if (n === 0) continue
    const weight = LOG_WEIGHTS[i]
    log.forEach((item, pos) => {
      const posScore = n > 1 ? 1 - pos / (n - 1) : 1.0
      scores[item] = (scores[item] ?? 0) + posScore * weight
    })
  }
  return scores
})

// ── カテゴリごとの実際の進捗（フィルターに依存しない）──────────────────────
const catRealStats = computed(() => {
  const map = {}
  for (const item of config.order) {
    const cat = config.categories?.[item] ?? 'その他'
    if (!map[cat]) map[cat] = { total: 0, filled: 0 }
    map[cat].total++
    if (props.inventory[item] != null) map[cat].filled++
  }
  for (const item of Object.keys(props.inventory)) {
    if (!config.order.includes(item)) {
      const cat = config.categories?.[item] ?? 'その他'
      if (!map[cat]) map[cat] = { total: 0, filled: 0 }
      map[cat].total++
      map[cat].filled++
    }
  }
  return map
})

const filterOpts = [
  { value: 'all',    label: 'すべて' },
  { value: 'filled', label: '入力済み' },
  { value: 'empty',  label: '未入力' },
]

const typeOpts = [
  { value: 'all',      label: '全品目' },
  { value: 'supplies', label: '資材・備品' },
  { value: 'food',     label: '食材のみ' },
]

/** カテゴリが「資材・備品・その他」系かを判定 */
function isSupplyCategory(cat) {
  if (!cat || cat === 'その他') return true
  return cat.includes('資材') || cat.includes('備品') || cat.includes('その他')
}

/** 資材・備品系品目が存在する場合のみタイプフィルターを表示 */
const hasSupplyItems = computed(() =>
  config.order.some(item => {
    const cat = config.categories?.[item] ?? null
    return cat && (cat.includes('資材') || cat.includes('備品') || cat.includes('その他'))
  })
)

// ── 行データ生成 ──────────────────────────────────────────────────────────────
const rows = computed(() => {
  // 1. config.order 順の行（すべて、entry=null もあり）
  const ordered = config.order.map((item, i) => ({
    type:      'item',
    item,
    index:     i + 1,
    entry:     props.inventory[item] ?? null,
    custom:    false,
    unitPrice: config.prices?.[item]      ?? null,
    category:  config.categories?.[item]  ?? null,
    code:      config.codes?.[item]       ?? null,
    prevMonth: config.prevMonths?.[item]  ?? null,
    lotSize:   config.lotSizes?.[item]    ?? null,
  }))

  // 2. config.order に含まれないカスタム品目
  const customs = Object.keys(props.inventory)
    .filter(k => !config.order.includes(k))
    .map(item => ({
      type:      'item',
      item,
      index:     '*',
      entry:     props.inventory[item],
      custom:    true,
      unitPrice: config.prices?.[item]      ?? null,
      category:  config.categories?.[item]  ?? null,
      code:      config.codes?.[item]       ?? null,
      prevMonth: config.prevMonths?.[item]  ?? null,
      lotSize:   config.lotSizes?.[item]    ?? null,
    }))

  // 3. フィルター適用
  let items
  if (filterMode.value === 'filled') {
    items = [...ordered, ...customs].filter(r => r.entry !== null)
  } else if (filterMode.value === 'empty') {
    // 未入力は config.order 内のみ（カスタム品目は常に入力済みなので対象外）
    items = ordered.filter(r => r.entry === null)
  } else {
    items = [...ordered, ...customs]
  }

  // 3b. タイプフィルター（資材・備品 / 食材）適用
  if (typeFilter.value === 'supplies') {
    items = items.filter(r => isSupplyCategory(r.category))
  } else if (typeFilter.value === 'food') {
    items = items.filter(r => !isSupplyCategory(r.category))
  }

  // 4. 並べ替え適用
  if (sortMode.value === 'alpha') {
    return [...items].sort((a, b) => a.item.localeCompare(b.item, 'ja'))
  }

  if (sortMode.value === 'learned') {
    const scores = learnedScores.value
    return [...items].sort((a, b) => {
      const sa = scores[a.item] ?? -1
      const sb = scores[b.item] ?? -1
      if (sa !== sb) return sb - sa  // スコア高い順（早く入力した品目が上）
      // スコア同点は元の config.order 順
      const ia = a.index === '*' ? Infinity : a.index
      const ib = b.index === '*' ? Infinity : b.index
      return ia - ib
    })
  }

  if (sortMode.value === 'category') {
    // カテゴリ別グループ化
    const groupMap = new Map()
    for (const row of items) {
      const cat = row.category ?? 'その他'
      if (!groupMap.has(cat)) groupMap.set(cat, [])
      groupMap.get(cat).push(row)
    }
    // 分類コード順ソート（コード未設定は五十音順で末尾）
    const sorted = [...groupMap.entries()].sort(([a], [b]) => {
      if (a === 'その他') return 1
      if (b === 'その他') return -1
      const codeA = config.categoryCodes?.[a]
      const codeB = config.categoryCodes?.[b]
      if (codeA != null && codeB != null) return codeA - codeB
      if (codeA != null) return -1
      if (codeB != null) return  1
      return a.localeCompare(b, 'ja')
    })
    // グループヘッダー行を挿入（進捗はフィルター非依存の実数値を使用）
    const result = []
    for (const [cat, groupRows] of sorted) {
      const real = catRealStats.value[cat] ?? { total: groupRows.length, filled: 0 }
      result.push({ type: 'group-header', label: cat, count: real.total, filled: real.filled })
      result.push(...groupRows)
    }
    return result
  }

  // その他（フォールバック）: config.order 順のまま
  return items
})

// フィルター後の実際の品目数（グループヘッダーを除く）
const visibleItemCount = computed(() =>
  rows.value.filter(r => r.type === 'item').length
)

// ── 価格・金額 ────────────────────────────────────────────────────────────────
const hasPrices = computed(() =>
  config.prices && Object.keys(config.prices).length > 0
)

const hasCodes = computed(() =>
  config.codes && Object.keys(config.codes).length > 0
)

// 列数（商品コード列 + 品目列 + 数量列 [+ 金額列]）
const totalCols = computed(() => {
  let n = 2 // 品目 + 数量
  if (hasCodes.value)  n++
  if (hasPrices.value) n++
  return n
})

// 合計は常に全在庫ベース（フィルターに関係なく表示）
const grandTotal = computed(() => {
  if (!hasPrices.value) return null
  let total = 0
  let has   = false
  for (const [item, entry] of Object.entries(props.inventory)) {
    const price = config.prices?.[item]
    if (price == null) continue
    total += entry.qty * price
    has = true
  }
  return has ? Math.round(total) : null
})

// ── スワイプジェスチャー ──────────────────────────────────────────────────────
// 左スワイプ → 0で確定（amber）  右スワイプ → 削除（red）
const swipe = reactive({ item: null, dx: 0, live: false })
const SWIPE_TRIGGER = 80   // アクション発火までの最小距離(px)
const SWIPE_MAX     = 110  // 最大スライド量(px)
let _sx = 0, _sy = 0

function swipeStart(e, item) {
  if (props.readOnly) return
  _sx = e.touches[0].clientX
  _sy = e.touches[0].clientY
  swipe.item = item
  swipe.dx   = 0
  swipe.live = false
}

function swipeMove(e, item) {
  if (swipe.item !== item) return
  const dx = e.touches[0].clientX - _sx
  const dy = e.touches[0].clientY - _sy
  // 縦スクロールが支配的なら無視
  if (!swipe.live && Math.abs(dy) > Math.abs(dx) + 4) { swipe.item = null; return }
  if (Math.abs(dx) > 8) swipe.live = true
  if (swipe.live) swipe.dx = Math.max(-SWIPE_MAX, Math.min(SWIPE_MAX, dx))
}

function swipeEnd(e, item) {
  if (swipe.item !== item || !swipe.live) { _resetSwipe(); return }
  const dx = swipe.dx
  _resetSwipe()
  if      (dx < -SWIPE_TRIGGER) emit('zero',   item)
  else if (dx >  SWIPE_TRIGGER) emit('remove', item)
}

function _resetSwipe() {
  swipe.item = null
  swipe.dx   = 0
  swipe.live = false
}

function swipeStyle(item) {
  if (swipe.item !== item || !swipe.live) return {}
  const t = Math.min(Math.abs(swipe.dx) / SWIPE_TRIGGER, 1)
  const bg = swipe.dx < 0
    ? `rgba(251,146,60,${t * 0.45})`   // 左: amber (0確定)
    : `rgba(239,68,68,${t * 0.38})`    // 右: red   (削除)
  return { background: bg, transform: `translateX(${swipe.dx * 0.25}px)`, transition: 'none' }
}

function rowClick(item) {
  if (swipe.live) return   // スワイプ中はタップ無効
  emit('tap', item)
}

// ── キーボードナビゲーション ──────────────────────────────────────────────────
function _isRowVisible(row) {
  if (sortMode.value !== 'category') return true
  return !!expandedCats[row.category ?? 'その他']
}

function _getVisibleItems() {
  return rows.value
    .filter(r => r.type === 'item' && _isRowVisible(r))
    .map(r => r.item)
}

function getNextVisibleItem(currentItem) {
  const list = _getVisibleItems()
  const idx  = list.indexOf(currentItem)
  return (idx >= 0 && idx < list.length - 1) ? list[idx + 1] : null
}

function getPrevVisibleItem(currentItem) {
  const list = _getVisibleItems()
  const idx  = list.indexOf(currentItem)
  return (idx > 0) ? list[idx - 1] : null
}

function _focusRow(item) {
  const els = document.querySelectorAll('.item-row[tabindex="0"]')
  for (const el of els) {
    if (el.dataset.item === item) {
      el.focus()
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      return
    }
  }
}

function onRowKeydown(e, item) {
  if (props.readOnly) return
  switch (e.key) {
    case 'Enter':
    case ' ':
      e.preventDefault()
      rowClick(item)
      break
    case 'ArrowDown':
      e.preventDefault()
      { const next = getNextVisibleItem(item); if (next) _focusRow(next) }
      break
    case 'ArrowUp':
      e.preventDefault()
      { const prev = getPrevVisibleItem(item); if (prev) _focusRow(prev) }
      break
    case 'Tab':
      e.preventDefault()
      if (e.shiftKey) {
        const prev = getPrevVisibleItem(item); if (prev) _focusRow(prev)
      } else {
        const next = getNextVisibleItem(item); if (next) _focusRow(next)
      }
      break
  }
}

defineExpose({ getNextVisibleItem })

function subtotal(row) {
  if (!row.entry || row.unitPrice == null) return null
  return Math.round(row.entry.qty * row.unitPrice)
}

function fmtYen(n) {
  return '¥' + Math.round(n).toLocaleString('ja-JP')
}

</script>

<template>
  <section class="inventory-section">
    <!-- ヘッダー行 -->
    <div class="section-header">
      <h2>棚卸一覧</h2>
      <div class="header-right">
        <span class="progress">
          <strong>{{ filledCount }}</strong> / {{ config.order.length }} 件入力済み
        </span>
        <button
          v-if="sortMode === 'category' && Object.keys(expandedCats).length > 0"
          class="btn-collapse-all"
          @click="collapseAll"
        >すべて閉じる</button>
        <button v-if="!readOnly" class="btn-danger-sm" @click="$emit('reset')">リセット</button>
      </div>
    </div>

    <!-- 並べ替え / フィルター ツールバー -->
    <div class="toolbar">
      <div class="seg-group">
        <button
          v-for="opt in sortOpts"
          :key="opt.value"
          :class="['seg-btn', { active: sortMode === opt.value }]"
          @click="sortMode = opt.value"
        >{{ opt.label }}</button>
      </div>
      <div class="seg-group">
        <button
          v-for="opt in filterOpts"
          :key="opt.value"
          :class="['seg-btn', { active: filterMode === opt.value }]"
          @click="filterMode = opt.value"
        >{{ opt.label }}</button>
      </div>
    </div>

    <!-- タイプフィルター（資材・備品系品目がある場合のみ表示） -->
    <div v-if="hasSupplyItems" class="toolbar toolbar-type">
      <div class="seg-group seg-full">
        <button
          v-for="opt in typeOpts"
          :key="opt.value"
          :class="['seg-btn', { active: typeFilter === opt.value }]"
          @click="typeFilter = opt.value"
        >{{ opt.label }}</button>
      </div>
    </div>

    <!-- 学習順：データなし案内 -->
    <div v-if="sortMode === 'learned' && Object.keys(learnedScores).length === 0" class="learned-empty">
      📊 棚卸を数回完了するとここに学習した順番で並びます
    </div>

    <!-- テーブル -->
    <table class="inv-table">
      <thead>
        <tr>
          <th v-if="hasCodes" class="th-code">商品コード</th>
          <th>品目</th>
          <th class="th-qty">数量</th>
          <th v-if="hasPrices" class="th-amount">金額</th>
        </tr>
      </thead>
      <tbody>
        <template v-for="(row, rowIdx) in rows" :key="row.type === 'group-header' ? `__g__${row.label}` : `${rowIdx}_${row.item}`">

          <!-- ジャンルヘッダー行（クリックでアコーディオン開閉） -->
          <tr v-if="row.type === 'group-header'" class="group-header-row" @click="toggleCat(row.label)">
            <td :colspan="totalCols" class="group-header-cell">
              <div class="cat-info-row">
                <span class="cat-arrow">{{ expandedCats[row.label] ? '▼' : '▶' }}</span>
                <span class="cat-label">{{ row.label }}</span>
                <span class="cat-badge">
                  {{ row.filled }}<span class="cat-badge-sep">/</span>{{ row.count }}
                </span>
              </div>
              <div class="cat-progress-track">
                <div
                  class="cat-progress-fill"
                  :style="{ width: (row.count > 0 ? row.filled / row.count * 100 : 0) + '%' }"
                  :class="{ complete: row.filled === row.count && row.count > 0 }"
                ></div>
              </div>
            </td>
          </tr>

          <!-- 品目行（展開中のみ表示） -->
          <tr v-else
              v-show="sortMode !== 'category' || expandedCats[row.category ?? 'その他']"
              :class="{ filled: row.entry !== null, 'read-only': readOnly }"
              :style="swipeStyle(row.item)"
              :tabindex="readOnly ? undefined : 0"
              :data-item="row.item"
              class="item-row"
              @click="rowClick(row.item)"
              @keydown="onRowKeydown($event, row.item)"
              @touchstart.passive="swipeStart($event, row.item)"
              @touchmove.passive="swipeMove($event, row.item)"
              @touchend.passive="swipeEnd($event, row.item)">
            <td v-if="hasCodes" class="td-code">{{ row.code ?? '' }}</td>
            <td class="td-name">
              <div class="name-main">
                {{ row.item }}
                <span v-if="row.custom" class="badge">追加</span>
              </div>
              <div v-if="row.lotSize || row.prevMonth" class="hints-row">
                <span v-if="row.lotSize"   class="prev-hint lot-hint">入数: {{ row.lotSize }}</span>
                <span v-if="row.prevMonth" class="prev-hint">前月: {{ row.prevMonth }}</span>
              </div>
            </td>
            <td class="td-qty">
              <!-- スワイプ中のアクションヒント -->
              <template v-if="swipe.item === row.item && swipe.live">
                <div v-if="swipe.dx < -20" class="swipe-hint swipe-hint-zero">← 0</div>
                <div v-else-if="swipe.dx > 20" class="swipe-hint swipe-hint-del">削除 →</div>
              </template>
              <div v-else :class="['qty-display', { filled: row.entry !== null }]">
                <template v-if="row.entry !== null">
                  {{ row.entry.qty }}<span v-if="row.entry.unit" class="qty-unit">{{ row.entry.unit }}</span>
                </template>
                <template v-else>—</template>
              </div>
            </td>
            <td v-if="hasPrices" class="td-amount">
              <span v-if="subtotal(row) != null" class="amount-value">
                {{ fmtYen(subtotal(row)) }}
              </span>
              <span v-else class="amount-na">—</span>
            </td>
          </tr>

        </template>

        <!-- フィルター結果が0件のとき -->
        <tr v-if="visibleItemCount === 0" class="empty-row">
          <td :colspan="totalCols" class="empty-cell">
            {{ filterMode === 'filled' ? '入力済みの品目がありません' : 'すべての品目が入力済みです 🎉' }}
          </td>
        </tr>
      </tbody>

      <!-- 合計行（価格設定済みかつ在庫あり） -->
      <tfoot v-if="grandTotal != null">
        <tr class="total-row">
          <td :colspan="totalCols - 1" class="td-total-label">在庫合計</td>
          <td class="td-total-value">{{ fmtYen(grandTotal) }}</td>
        </tr>
      </tfoot>
    </table>
  </section>
</template>

<style scoped>
.inventory-section { padding: 0 16px; }

/* ── セクションヘッダー ── */
.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 4px 10px;
}

.section-header h2 {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.progress {
  font-size: 12px;
  color: var(--text-muted);
}

.progress strong {
  color: var(--primary);
  font-weight: 700;
}

/* ── ツールバー ── */
.toolbar {
  display: flex;
  gap: 8px;
  margin-bottom: 6px;
}

.toolbar-type {
  margin-bottom: 10px;
}

.seg-full {
  flex: 1;
}

.seg-group {
  display: flex;
  flex: 1;
  background: #f1f5f9;
  border-radius: 10px;
  padding: 3px;
  gap: 2px;
}

.seg-btn {
  flex: 1;
  padding: 6px 2px;
  font-size: 11px;
  font-weight: 600;
  border: none;
  background: transparent;
  border-radius: 8px;
  cursor: pointer;
  color: var(--text-muted);
  transition: background 0.15s, color 0.15s;
  white-space: nowrap;
  line-height: 1.3;
}

.seg-btn.active {
  background: white;
  color: var(--primary);
  box-shadow: 0 1px 3px rgba(0,0,0,0.12);
}

/* ── テーブル ── */
.inv-table {
  width: 100%;
  border-collapse: collapse;
  background: var(--surface);
  border-radius: 14px;
  overflow: hidden;
  box-shadow: var(--shadow);
}

.inv-table thead tr {
  background: #1e3a8a;
  color: white;
}

.inv-table th {
  padding: 11px 14px;
  text-align: left;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.th-code   { width: 76px; white-space: nowrap; }
.th-qty    { text-align: center; width: 86px; }
.th-amount { text-align: right;  width: 76px; padding-right: 12px; }

.inv-table tbody tr {
  border-bottom: 1px solid var(--border);
  transition: background 0.15s;
}

.inv-table tbody tr:last-child { border-bottom: none; }
.inv-table tbody tr.filled     { background: #f0fdf4; }

/* ── ジャンルヘッダー行 ── */
.group-header-row {
  background: #f8fafc !important;
  cursor: pointer;
  user-select: none;
}
.group-header-row:hover { background: #eff6ff !important; }

.group-header-cell {
  padding: 8px 14px 0;
  border-left: 3px solid var(--primary);
}

.cat-info-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 700;
  color: var(--primary);
  letter-spacing: 0.04em;
  white-space: nowrap;
  overflow: hidden;
  padding-bottom: 6px;
}

.cat-arrow {
  font-size: 10px;
  width: 12px;
  flex-shrink: 0;
}

.cat-label {
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}

.cat-badge {
  margin-left: auto;
  font-size: 11px;
  font-weight: 600;
  background: #dbeafe;
  color: var(--primary);
  border-radius: 20px;
  padding: 1px 8px;
  white-space: nowrap;
}
.cat-badge-sep { opacity: 0.5; margin: 0 1px; }

/* プログレスバー */
.cat-progress-track {
  height: 5px;
  background: #dcfce7;
  border-radius: 0 0 2px 2px;
  overflow: hidden;
  margin: 0 -14px;
}

.cat-progress-fill {
  height: 100%;
  background: var(--success);
  border-radius: 2px;
  transition: width 0.4s ease;
}

.cat-progress-fill.complete {
  background: #16a34a;
  box-shadow: 0 0 4px rgba(22,163,74,0.5);
}

/* ── 品目行タップ ── */
.item-row {
  cursor: pointer;
  -webkit-tap-highlight-color: rgba(59,130,246,0.1);
}
.item-row:active             { background: #eff6ff !important; }
.item-row:focus              { outline: 2px solid var(--primary); outline-offset: -2px; background: #eff6ff !important; }
.item-row:focus:not(:focus-visible) { outline: none; }
.item-row.read-only          { cursor: default; }
.item-row.read-only:active   { background: inherit !important; }

/* ── スワイプヒント ── */
.swipe-hint {
  font-size: 13px;
  font-weight: 800;
  border-radius: 8px;
  padding: 5px 8px;
  white-space: nowrap;
  display: inline-block;
}
.swipe-hint-zero { color: #c2410c; background: #fff7ed; }
.swipe-hint-del  { color: #b91c1c; background: #fef2f2; }

/* ── 品目セル ── */
.td-name {
  padding: 9px 14px;
  font-size: 13px;
  line-height: 1.4;
  word-break: keep-all;
  overflow-wrap: break-word;
}

.name-main {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
}

.hints-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 2px;
}

.prev-hint {
  font-size: 11px;
  color: var(--text-muted);
}

.lot-hint {
  color: #7c3aed;  /* 紫: 入数は前月と区別 */
}

.badge {
  font-size: 10px;
  background: #dbeafe;
  color: var(--primary);
  border-radius: 4px;
  padding: 1px 5px;
  vertical-align: middle;
}

/* ── 商品コードセル ── */
.td-code {
  padding: 11px 8px 11px 14px;
  font-size: 11px;
  font-family: monospace;
  color: var(--text-muted);
  white-space: nowrap;
  vertical-align: middle;
}


/* ── 数量セル ── */
.td-qty {
  padding: 7px 10px;
  text-align: center;
  white-space: nowrap;
}

.qty-display {
  display: inline-flex;
  align-items: baseline;
  gap: 2px;
  min-width: 54px;
  border: 1.5px solid var(--border);
  border-radius: 8px;
  padding: 6px 8px;
  font-size: 16px;
  font-weight: 700;
  color: var(--text-muted);
  background: #f8fafc;
  justify-content: center;
}

.qty-display.filled {
  color: var(--success);
  border-color: #86efac;
  background: #f0fdf4;
}

.qty-unit {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-muted);
  margin-left: 1px;
}

/* ── 金額セル ── */
.td-amount {
  padding: 7px 12px 7px 4px;
  text-align: right;
  white-space: nowrap;
}

.amount-value {
  font-size: 12px;
  font-weight: 700;
  color: var(--text);
}

.amount-na {
  font-size: 12px;
  color: var(--text-muted);
}

/* ── 空メッセージ ── */
/* ── 学習順：データなし案内 ── */
.learned-empty {
  font-size: 12px;
  color: var(--text-muted);
  background: #f8fafc;
  border: 1px dashed var(--border);
  border-radius: 10px;
  padding: 10px 14px;
  margin-bottom: 8px;
  text-align: center;
}

.empty-row { background: white !important; }

.empty-cell {
  padding: 28px 20px;
  text-align: center;
  font-size: 14px;
  color: var(--text-muted);
}

/* ── 合計行 ── */
.total-row {
  background: #f0fdf4;
  border-top: 2px solid #86efac;
}

.td-total-label {
  padding: 10px 14px;
  font-size: 13px;
  font-weight: 700;
  color: var(--text-muted);
}

.td-total-value {
  padding: 10px 12px;
  font-size: 14px;
  font-weight: 700;
  color: var(--success);
  text-align: right;
}
</style>
