<script setup>
import { ref, computed, reactive } from 'vue'
import { useConfig } from '../composables/useConfig.js'

const { config } = useConfig()

const props = defineProps({
  inventory:        { type: Object,  required: true },
  filledCount:      { type: Number,  required: true },
  readOnly:         { type: Boolean, default: false },
  learnedOrder:     { type: Array,   default: null },
  lateRecountItems: { type: Object,  default: null },  // Set<string>
  recountFlags:     { type: Object,  default: null },  // { [item]: {by,at} }「あとで数える」
  categoryScope:    { type: String,  default: 'all' }, // 'all' | 'food' | 'supply'
})

const emit = defineEmits(['update', 'remove', 'tap'])

// ── 食材 / 資材・備品 判定 ─────────────────────────────────────────────────────
function _isSupply(item) {
  const cat = config.categories?.[item]
  if (!cat) return false
  return cat.includes('資材') || cat.includes('備品') || cat.includes('その他')
}

// ── 並べ替え / フィルター ─────────────────────────────────────────────────────
const sortMode     = ref('category')  // 'category' | 'alpha' | 'learned'
const filterMode   = ref('all')       // 'all' | 'filled' | 'empty'
const expandedCats = reactive({})     // ジャンル別アコーディオン
const expandedKana = reactive({})     // 五十音アコーディオン

function toggleCat(label)  { if (expandedCats[label]) delete expandedCats[label]; else expandedCats[label] = true }
function toggleKana(label) { if (expandedKana[label]) delete expandedKana[label]; else expandedKana[label] = true }

function toggleGroup(row)      { row.isKana ? toggleKana(row.label) : toggleCat(row.label) }
function isGroupExpanded(row)  { return row.isKana ? !!expandedKana[row.label] : !!expandedCats[row.label] }

function collapseAll() {
  Object.keys(expandedCats).forEach(k => delete expandedCats[k])
  Object.keys(expandedKana).forEach(k => delete expandedKana[k])
}

const hasExpanded = computed(() => {
  if (sortMode.value === 'category') return Object.keys(expandedCats).length > 0
  if (sortMode.value === 'alpha')    return Object.keys(expandedKana).length > 0
  return false
})

const sortOpts = [
  { value: 'category', label: 'ジャンル' },
  { value: 'learned',  label: '学習順' },
  { value: 'alpha',    label: '五十音' },
]

// ── カテゴリごとの実際の進捗（フィルターに依存しない・スコープ反映）──────────
const catRealStats = computed(() => {
  const map = {}
  const all = [
    ...config.order,
    ...Object.keys(props.inventory).filter(k => !config.order.includes(k)),
  ]
  for (const item of all) {
    if (props.categoryScope === 'food'   && _isSupply(item)) continue
    if (props.categoryScope === 'supply' && !_isSupply(item)) continue
    const cat = config.categories?.[item] ?? 'その他'
    if (!map[cat]) map[cat] = { total: 0, filled: 0 }
    map[cat].total++
    if (props.inventory[item] != null) map[cat].filled++
  }
  return map
})

const filterOpts = [
  { value: 'all',    label: 'すべて' },
  { value: 'filled', label: '入力済み' },
  { value: 'empty',  label: '未入力' },
]

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

  // 3. カテゴリスコープフィルター（食材 / 資材・備品）
  let all = [...ordered, ...customs]
  if (props.categoryScope === 'food') {
    all = all.filter(r => !_isSupply(r.item))
  } else if (props.categoryScope === 'supply') {
    all = all.filter(r => _isSupply(r.item))
  }

  // 4. 入力済み/未入力フィルター適用
  let items
  if (filterMode.value === 'filled') {
    items = all.filter(r => r.entry !== null)
  } else if (filterMode.value === 'empty') {
    // 未入力は config.order 内のみ（カスタム品目は常に入力済みなので対象外）
    items = all.filter(r => !r.custom && r.entry === null)
  } else {
    items = all
  }

  // 5. 並べ替え適用
  if (sortMode.value === 'alpha') {
    // 五十音アコーディオン
    const groupMap = new Map()
    for (const row of items) {
      const grp = _kanaGroup(row.item)
      if (!groupMap.has(grp)) groupMap.set(grp, [])
      groupMap.get(grp).push(row)
    }
    // グループ内は五十音順にソート
    for (const arr of groupMap.values()) {
      arr.sort((a, b) => a.item.localeCompare(b.item, 'ja'))
    }
    // 行順序でソート
    const sorted = [...groupMap.entries()].sort(([a], [b]) =>
      KANA_ORDER.indexOf(a) - KANA_ORDER.indexOf(b)
    )
    const result = []
    for (const [grp, groupRows] of sorted) {
      const real = kanaRealStats.value[grp] ?? { total: groupRows.length, filled: 0 }
      result.push({ type: 'group-header', label: grp, count: real.total, filled: real.filled, isKana: true })
      result.push(...groupRows)
    }
    return result
  }

  if (sortMode.value === 'learned') {
    // 学習データがある場合はその順、なければ config.order 順のまま（フラットリスト）
    if (props.learnedOrder) {
      const orderMap = new Map(props.learnedOrder.map((item, i) => [item, i]))
      return [...items].sort((a, b) => {
        const ia = orderMap.get(a.item) ?? Infinity
        const ib = orderMap.get(b.item) ?? Infinity
        return ia - ib
      })
    }
    // まだ履歴なし → config.order 順のフラットリスト
    return items
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
      result.push({ type: 'group-header', label: cat, count: real.total, filled: real.filled, isKana: false })
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

// 合計はスコープ対応（食材/資材・備品選択時はその範囲のみ集計）
const grandTotal = computed(() => {
  if (!hasPrices.value) return null
  let total = 0
  let has   = false
  for (const [item, entry] of Object.entries(props.inventory)) {
    if (props.categoryScope === 'food'   && _isSupply(item)) continue
    if (props.categoryScope === 'supply' && !_isSupply(item)) continue
    const price = config.prices?.[item]
    if (price == null) continue
    total += entry.qty * price
    has = true
  }
  return has ? Math.round(total) : null
})

function rowClick(item) {
  emit('tap', item)
}

// ── キーボードナビゲーション ──────────────────────────────────────────────────
function _isRowVisible(row) {
  if (sortMode.value === 'category') return !!expandedCats[row.category ?? 'その他']
  if (sortMode.value === 'alpha')    return !!expandedKana[_kanaGroup(row.item)]
  return true
}

const hasLearningData = computed(() => !!props.learnedOrder)

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

// ── 五十音グループ ─────────────────────────────────────────────────────────────
const KANA_ROWS = [
  { label: 'あ行', chars: 'あいうえお' },
  { label: 'か行', chars: 'かきくけこがぎぐげご' },
  { label: 'さ行', chars: 'さしすせそざじずぜぞ' },
  { label: 'た行', chars: 'たちつてとだぢづでど' },
  { label: 'な行', chars: 'なにぬねの' },
  { label: 'は行', chars: 'はひふへほばびぶべぼぱぴぷぺぽ' },
  { label: 'ま行', chars: 'まみむめも' },
  { label: 'や行', chars: 'やゆよ' },
  { label: 'ら行', chars: 'らりるれろ' },
  { label: 'わ行', chars: 'わをん' },
]
const KANA_ORDER = [...KANA_ROWS.map(r => r.label), '漢字', '英字', '数字', '記号']

function _toHira(str) {
  return str
    .normalize('NFKC')
    .replace(/[\u30A1-\u30F6]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60))
}

function _kanaGroup(item) {
  const first = _toHira(item.trim())[0] ?? ''
  for (const row of KANA_ROWS) {
    if (row.chars.includes(first)) return row.label
  }
  if (/[一-鿿㐀-䶿]/.test(first)) return '漢字'
  if (/[A-Za-z]/.test(first)) return '英字'
  if (/[0-9]/.test(first)) return '数字'
  return '記号'
}

// 五十音ごとの進捗（フィルターに依存しない実数値・スコープ反映）
const kanaRealStats = computed(() => {
  const map = {}
  const all = [
    ...config.order,
    ...Object.keys(props.inventory).filter(k => !config.order.includes(k)),
  ]
  for (const item of all) {
    if (props.categoryScope === 'food'   && _isSupply(item)) continue
    if (props.categoryScope === 'supply' && !_isSupply(item)) continue
    const grp = _kanaGroup(item)
    if (!map[grp]) map[grp] = { total: 0, filled: 0 }
    map[grp].total++
    if (props.inventory[item] != null) map[grp].filled++
  }
  return map
})

// スコープ対応の品目数（ヘッダー表示用）
const scopedTotal = computed(() => {
  if (props.categoryScope === 'all') return config.order.length
  return config.order.filter(item =>
    props.categoryScope === 'food' ? !_isSupply(item) : _isSupply(item)
  ).length
})

const scopedFilled = computed(() => {
  return Object.entries(props.inventory).filter(([item]) => {
    if (props.categoryScope === 'food')   return !_isSupply(item)
    if (props.categoryScope === 'supply') return _isSupply(item)
    return true
  }).length
})

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
          <strong>{{ scopedFilled }}</strong> / {{ scopedTotal }} 件入力済み
        </span>
        <button
          v-if="hasExpanded"
          class="btn-collapse-all"
          @click="collapseAll"
        >すべて閉じる</button>
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

    <!-- 学習順：データなし時のヒント -->
    <div v-if="sortMode === 'learned' && !hasLearningData" class="learned-hint">
      棚卸を完了すると入力順が記録され、次回から自動で並び替えられます
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

          <!-- グループヘッダー行（クリックでアコーディオン開閉・ジャンル/五十音共通） -->
          <tr v-if="row.type === 'group-header'" class="group-header-row" @click="toggleGroup(row)">
            <td :colspan="totalCols" class="group-header-cell">
              <div class="cat-info-row">
                <span class="cat-arrow">{{ isGroupExpanded(row) ? '▼' : '▶' }}</span>
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
              v-show="_isRowVisible(row)"
              :class="{ filled: row.entry !== null, 'read-only': readOnly }"
              :tabindex="readOnly ? undefined : 0"
              :data-item="row.item"
              class="item-row"
              @click="rowClick(row.item)"
              @keydown="onRowKeydown($event, row.item)">
            <td v-if="hasCodes" class="td-code">{{ row.code ?? '' }}</td>
            <td class="td-name">
              <div class="name-main">
                {{ row.item }}
                <span v-if="row.custom" class="badge">追加</span>
                <span
                  v-if="recountFlags?.[row.item]"
                  class="recount-flag-badge"
                  title="あとで数えるフラグが立っています"
                >🔖</span>
                <span
                  v-if="sortMode === 'learned' && lateRecountItems?.has(row.item)"
                  class="late-recount-badge"
                  title="この品目は最初の入力から15分以上後に再入力されています"
                >⚠</span>
              </div>
              <div v-if="row.lotSize || row.prevMonth" class="hints-row">
                <span v-if="row.lotSize"   class="prev-hint lot-hint">入数: {{ row.lotSize }}</span>
                <span v-if="row.prevMonth" class="prev-hint">前月: {{ row.prevMonth }}</span>
              </div>
            </td>
            <td class="td-qty">
              <div :class="['qty-display', { filled: row.entry !== null }]">
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

/* ── 学習順 ── */
.late-recount-badge {
  font-size: 11px;
  color: #d97706;
  flex-shrink: 0;
}

.recount-flag-badge {
  font-size: 12px;
  flex-shrink: 0;
}

.learned-hint {
  margin: 0 0 6px;
  padding: 7px 12px;
  font-size: 11px;
  color: #78350f;
  background: #fef3c7;
  border-radius: 8px;
  border: 1px solid #fde68a;
  line-height: 1.5;
}
</style>
