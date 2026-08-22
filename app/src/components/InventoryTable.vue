<script setup>
import { ref, computed, reactive } from 'vue'
import { useConfig } from '../composables/useConfig.js'
import { isSupplyItem } from '../utils/itemMatcher.js'
import { showAxisAssign, axisAssignInitial } from '../composables/appMenuState.js'

const { config: liveConfig, setAxisName } = useConfig()

const props = defineProps({
  inventory:        { type: Object,  required: true },
  filledCount:      { type: Number,  required: true },
  readOnly:         { type: Boolean, default: false },
  recountFlags:     { type: Object,  default: null },
  categoryScope:    { type: String,  default: 'all' },
  typingMap:        { type: Object,  default: null },
  conflictLocked:   { type: Object,  default: null },
  configSource:     { type: Object,  default: null },
  manualItems:      { type: Array,   default: () => [] },
  usageMap:         { type: Object,  default: null }, // { 品目: 直近N回で入力された回数 }
  hiddenItems:      { type: Array,   default: () => [] }, // 手動で非表示にした品目名
  canManageList:    { type: Boolean, default: true },  // 並び替え/非表示/絞り込みの操作可否（ゲストは false）
  tapContinuous:    { type: Boolean, default: false },
  preview:          { type: Boolean, default: false }, // 品目マスタ確認用: 数量欄に振り分け先を表示・入力/進捗なし
  orderMap:         { type: Object,  default: null },  // 発注セッション: { 品目: { orderQty, by } } を行に表示
  orderMode:        { type: Boolean, default: false }, // 発注セッションか（発注チップ表示の切替）
  // ── 入出庫（棚卸・発注と同じ一覧を使うための調整。既定はすべて従来動作 ──
  noteMap:          { type: Object,  default: null },  // { 品目: 補足文字列 } を行のヒント欄へ出す（理論在庫など）
  hideAmount:       { type: Boolean, default: false }, // 金額列を出さない（在庫金額ではない画面用）
  hideTapContinuous:{ type: Boolean, default: false }, // 「連続入力」トグルを出さない（未対応の画面用）
  searchTerm:       { type: String,  default: '' },    // 品目名の絞り込み（空=絞り込みなし）
})

const emit = defineEmits(['update', 'remove', 'tap', 'edit-item', 'delete-item', 'update:tapContinuous', 'hide-item', 'unhide-item'])

const manualSet = computed(() => new Set(props.manualItems))
const hiddenSet = computed(() => new Set(props.hiddenItems))
// リスト操作（並び替え・非表示・絞り込み）ができるか。ゲスト/読み取り専用は不可。
const canManage = computed(() => props.canManageList && !props.readOnly)

// 完了済み詳細では凍結スナップショットの config を使い、通常はライブ config を使う
const config = computed(() => props.configSource ?? liveConfig)

function _isSupply(item) {
  return isSupplyItem(item, config.value.categories)
}

// ── よく使う品目に絞る（履歴ベース・表示のみ／マスタは不変）─────────────────────
// 直近N回で一度も入力されていない品目を隠し、よく使う順に並べる。
// 検索は常に全品目対象、今回入力済みの品目は必ず表示、いつでも全表示に戻せる。
const usage        = computed(() => props.usageMap ?? {})
const hasUsageData = computed(() => !props.readOnly && Object.keys(usage.value).length > 0)
const usedOnly     = ref(false)
try { usedOnly.value = localStorage.getItem('inv_used_only') === '1' } catch (_) {}
function toggleUsedOnly() {
  usedOnly.value = !usedOnly.value
  try { localStorage.setItem('inv_used_only', usedOnly.value ? '1' : '0') } catch (_) {}
}
const _usedActive = computed(() => usedOnly.value && hasUsageData.value && props.canManageList)
// 表示対象か: 今回入力済み / カスタム品目 / 直近N回で1回でも入力あり
function _isUsed(row) {
  return row.custom || row.entry !== null || (usage.value[row.item] ?? 0) >= 1
}
// 名前ベースの「使う品目」判定（進捗集計用・filterMode非依存）
function _isUsedName(item) {
  return props.inventory[item] != null || (usage.value[item] ?? 0) >= 1
}
// グループ内をよく使う順に並べ替え（絞り込みON時のみ・元の順は安定ソートで保持）
function _sortByUsage(arr) {
  if (!_usedActive.value) return arr
  return [...arr].sort((a, b) => (usage.value[b.item] ?? 0) - (usage.value[a.item] ?? 0))
}

// ── 並べ替え / フィルター ─────────────────────────────────────────────────────
const sortMode     = ref('category')  // 'category' | 'alpha' | 'axisA' | 'axisB'
const filterMode   = ref('all')       // 'all' | 'filled' | 'empty'

// 並べ替え軸の選択肢（軸名が設定されている汎用軸のみ追加）
const sortOpts = computed(() => {
  const opts = [
    { value: 'category', label: 'ジャンル' },
  ]
  const names = config.value.axisNames ?? ['', '']
  if (names[0]) opts.push({ value: 'axisA', label: names[0] })
  if (names[1]) opts.push({ value: 'axisB', label: names[1] })
  return opts
})

// 「並び替えを追加」ボタン（空きスロットがあり、編集可能なときだけ）
const canAddAxis = computed(() => {
  if (props.readOnly) return false
  const names = config.value.axisNames ?? ['', '']
  return !names[0] || !names[1]
})
function onAddAxis() {
  const names = config.value.axisNames ?? ['', '']
  const idx = !names[0] ? 0 : (!names[1] ? 1 : -1)
  if (idx < 0) return
  const name = (window.prompt('並び替えの名前を入力（例：場所・仕入先）') || '').trim()
  if (!name) return
  setAxisName(idx, name)
  sortMode.value = idx === 0 ? 'axisA' : 'axisB'  // 追加した並び替えに切替
  axisAssignInitial.value = idx
  showAxisAssign.value = true                      // 振り分けページへ
}
// アクティブな自作並び替えタブの ✎ から振り分けページへ
function openAxisEdit(value) {
  axisAssignInitial.value = value === 'axisA' ? 0 : 1
  showAxisAssign.value = true
}

// 未設定の軸を選んだ状態でも壊れないよう、実効モードにフォールバック
const _effectiveSort = computed(() => {
  const m = sortMode.value
  const names = config.value.axisNames ?? ['', '']
  if (m === 'axisA' && !names[0]) return 'order'
  if (m === 'axisB' && !names[1]) return 'order'
  return m
})
const _isGroupedMode = computed(() => ['category', 'alpha', 'axisA', 'axisB'].includes(_effectiveSort.value))

// アコーディオン展開状態は「モード + ラベル」でキー化し、軸切替時の同名グループ混線を防ぐ
const expandedGroups = reactive({})
const SEP = '\u0000'
function _gkey(label) { return _effectiveSort.value + SEP + label }

function toggleGroup(row) {
  const k = _gkey(row.label)
  if (expandedGroups[k]) delete expandedGroups[k]
  else expandedGroups[k] = true
}
function isGroupExpanded(row) { return !!expandedGroups[_gkey(row.label)] }

function collapseAll() {
  const prefix = _effectiveSort.value + SEP
  Object.keys(expandedGroups).forEach(k => { if (k.startsWith(prefix)) delete expandedGroups[k] })
}

function expandAll() {
  for (const row of rows.value.filter(r => r.type === 'group-header')) {
    expandedGroups[_gkey(row.label)] = true
  }
}

const hasExpanded = computed(() => {
  if (!_isGroupedMode.value) return false
  const prefix = _effectiveSort.value + SEP
  return Object.keys(expandedGroups).some(k => k.startsWith(prefix))
})

const hasAllExpanded = computed(() => {
  const groups = rows.value.filter(r => r.type === 'group-header')
  if (groups.length === 0) return true
  return groups.every(r => isGroupExpanded(r))
})

// ── カテゴリごとの実際の進捗（フィルターに依存しない・スコープ反映）──────────
const catRealStats = computed(() => {
  const map = {}
  const all = [
    ...config.value.order,
    ...Object.keys(props.inventory).filter(k => !config.value.order.includes(k)),
  ]
  for (const item of all) {
    if (!props.readOnly && hiddenSet.value.has(item)) continue
    if (props.categoryScope === 'food'   && _isSupply(item)) continue
    if (props.categoryScope === 'supply' && !_isSupply(item)) continue
    if (_usedActive.value && !_isUsedName(item)) continue
    const cat = config.value.categories?.[item] ?? 'その他'
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
  // 1. config.value.order 順の行（すべて、entry=null もあり）
  const ordered = config.value.order.map((item, i) => ({
    type:      'item',
    item,
    index:     i + 1,
    entry:     props.inventory[item] ?? null,
    custom:    false,
    unitPrice: config.value.prices?.[item]      ?? null,
    category:  config.value.categories?.[item]  ?? null,
    code:      config.value.codes?.[item]       ?? null,
    prevMonth: config.value.prevMonths?.[item]  ?? null,
    lotSize:   config.value.lotSizes?.[item]    ?? null,
    tagA:      config.value.tagsA?.[item]       ?? [],
    tagB:      config.value.tagsB?.[item]       ?? [],
  }))

  // 2. config.value.order に含まれないカスタム品目
  const customs = Object.keys(props.inventory)
    .filter(k => !config.value.order.includes(k))
    .map(item => ({
      type:      'item',
      item,
      index:     '*',
      entry:     props.inventory[item],
      custom:    true,
      unitPrice: config.value.prices?.[item]      ?? null,
      category:  config.value.categories?.[item]  ?? null,
      code:      config.value.codes?.[item]       ?? null,
      prevMonth: config.value.prevMonths?.[item]  ?? null,
      lotSize:   config.value.lotSizes?.[item]    ?? null,
      tagA:      config.value.tagsA?.[item]       ?? [],
      tagB:      config.value.tagsB?.[item]       ?? [],
    }))

  // 3. カテゴリスコープフィルター（食材 / 資材・備品）
  let all = [...ordered, ...customs]
  // 3.0 手動非表示（読み取り専用＝完了済み詳細では隠さない）
  if (!props.readOnly && hiddenSet.value.size) {
    all = all.filter(r => !hiddenSet.value.has(r.item))
  }
  if (props.categoryScope === 'food') {
    all = all.filter(r => !_isSupply(r.item))
  } else if (props.categoryScope === 'supply') {
    all = all.filter(r => _isSupply(r.item))
  }
  // 3.2 品目名の絞り込み（呼び出し元が検索欄を持つ画面のみ。既定は空＝素通り）
  const _term = props.searchTerm.trim()
  if (_term) {
    all = all.filter(r => r.item.includes(_term))
  }

  // 3.5 よく使う品目のみ（ON時のみ・履歴で未使用の品目を隠す）
  if (_usedActive.value) {
    all = all.filter(_isUsed)
  }

  // 4. 入力済み/未入力フィルター適用
  let items
  if (filterMode.value === 'filled') {
    items = all.filter(r => r.entry !== null)
  } else if (filterMode.value === 'empty') {
    // 未入力は config.value.order 内のみ（カスタム品目は常に入力済みなので対象外）
    items = all.filter(r => !r.custom && r.entry === null)
  } else {
    items = all
  }

  // 5. 並べ替え適用
  const mode = _effectiveSort.value

  if (mode === 'alpha') {
    // 五十音アコーディオン
    const groupMap = new Map()
    for (const row of items) {
      const grp = _kanaGroup(row.item)
      if (!groupMap.has(grp)) groupMap.set(grp, [])
      groupMap.get(grp).push({ ...row, _grp: grp })
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
      result.push(..._sortByUsage(groupRows))
    }
    return result
  }

  if (mode === 'category' || mode === 'axisA' || mode === 'axisB') {
    // ジャンル / 汎用軸によるグループ化（共通ロジック）
    // 軸は多ロケーション対応: 1品目が複数グループに属する場合、各グループに複製して出す
    const emptyLabel = 'その他'
    const groupsOf = (row) => {
      if (mode === 'category') return [row.category ?? 'その他']
      const arr = mode === 'axisA' ? row.tagA : row.tagB
      return (Array.isArray(arr) && arr.length) ? arr : ['その他']
    }
    const statsMap = mode === 'category' ? catRealStats.value
      : mode === 'axisA' ? axisAStats.value
      :                    axisBStats.value

    const groupMap = new Map()
    for (const row of items) {
      for (const k of groupsOf(row)) {
        if (!groupMap.has(k)) groupMap.set(k, [])
        groupMap.get(k).push({ ...row, _grp: k })
      }
    }
    // ジャンルは分類コード順（未設定は末尾）、軸は五十音順（未設定は末尾）
    // 軸は「振り分けページで定義したグループ順」を優先（未定義グループは末尾）
    const axisOrder = mode === 'axisA' ? (config.value.axisGroupsA ?? [])
      : mode === 'axisB' ? (config.value.axisGroupsB ?? [])
      : []
    const sorted = [...groupMap.entries()].sort(([a], [b]) => {
      if (a === emptyLabel) return 1
      if (b === emptyLabel) return -1
      if (mode === 'category') {
        const codeA = config.value.categoryCodes?.[a]
        const codeB = config.value.categoryCodes?.[b]
        if (codeA != null && codeB != null) return codeA - codeB
        if (codeA != null) return -1
        if (codeB != null) return  1
      } else {
        const ia = axisOrder.indexOf(a), ib = axisOrder.indexOf(b)
        if (ia !== -1 || ib !== -1) {
          if (ia === -1) return 1
          if (ib === -1) return -1
          return ia - ib
        }
      }
      return a.localeCompare(b, 'ja')
    })
    const result = []
    for (const [key, groupRows] of sorted) {
      const real = statsMap[key] ?? { total: groupRows.length, filled: 0 }
      result.push({ type: 'group-header', label: key, count: real.total, filled: real.filled, isKana: false })
      result.push(..._sortByUsage(groupRows))
    }
    return result
  }

  // その他（フォールバック）: config.value.order 順のまま
  return items
})

// フィルター後の実際の品目数（グループヘッダーを除く）
const visibleItemCount = computed(() =>
  rows.value.filter(r => r.type === 'item').length
)

// よく使う絞り込みで隠れている品目数（スコープ適用後・filterMode非依存）
const hiddenCount = computed(() => {
  if (!_usedActive.value) return 0
  let hidden = 0
  const all = [
    ...config.value.order.map(item => ({ item, entry: props.inventory[item] ?? null, custom: false })),
    ...Object.keys(props.inventory).filter(k => !config.value.order.includes(k))
      .map(item => ({ item, entry: props.inventory[item], custom: true })),
  ]
  for (const r of all) {
    if (props.categoryScope === 'food'   && _isSupply(r.item)) continue
    if (props.categoryScope === 'supply' && !_isSupply(r.item)) continue
    if (!_isUsed(r)) hidden++
  }
  return hidden
})

// ── 価格・金額 ────────────────────────────────────────────────────────────────
const hasPrices = computed(() =>
  config.value.prices && Object.keys(config.value.prices).length > 0
)

// 商品コードは棚卸・発注どちらでも一覧に表示しない（視覚ノイズ）。
// データ自体は保持（バーコード照合／将来の発注送信で商品コードが必要になるため）。
const hasCodes = computed(() => false)

// preview では金額列は出さない（数値なしの確認用途）
const showAmount = computed(() => hasPrices.value && !props.preview && !props.hideAmount)

// 列数（商品コード列 + 品目列 + 数量列 [+ 金額列]）
const totalCols = computed(() => {
  let n = 2 // 品目 + 数量
  if (hasCodes.value)   n++
  if (showAmount.value) n++
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
    const price = config.value.prices?.[item]
    if (price == null) continue
    total += entry.qty * price
    has = true
  }
  return has ? Math.round(total) : null
})

// preview: 現在の並び替え軸で、その品目が振り分けられているグループ名（多ロケーションは複数）
function previewGroups(row) {
  const m = _effectiveSort.value
  if (m === 'axisA') return Array.isArray(row.tagA) ? row.tagA : []
  if (m === 'axisB') return Array.isArray(row.tagB) ? row.tagB : []
  if (m === 'category') return row.category ? [row.category] : []
  return []
}

function rowClick(item) {
  if (props.preview) return
  if (swipeItem.value === item && swipeDx.value < 0) { _resetSwipe(); return }  // 開いている→タップで閉じる
  if (_suppressClick) { _suppressClick = false; return }                        // 直前がスワイプ操作
  if (props.conflictLocked?.has(item)) return
  emit('tap', item)
}

// ── キーボードナビゲーション ──────────────────────────────────────────────────
function _isRowVisible(row) {
  if (!_isGroupedMode.value) return true   // 非グループ表示は常に可視
  if (row._grp == null) return true
  return !!expandedGroups[_gkey(row._grp)]
}

function _getVisibleItems() {
  // 多ロケーションで同一品目が複数回出るため、品目名で重複排除
  const seen = new Set()
  const out = []
  for (const r of rows.value) {
    if (r.type !== 'item' || !_isRowVisible(r)) continue
    if (seen.has(r.item)) continue
    seen.add(r.item)
    out.push(r.item)
  }
  return out
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

defineExpose({ getNextVisibleItem, getPrevVisibleItem })

const pendingDelete = ref(null)  // 削除確認中の品目名

function requestDelete(item) { pendingDelete.value = item }
function cancelDelete()      { pendingDelete.value = null }
function confirmDelete(item) {
  pendingDelete.value = null
  emit('delete-item', item)
}

// ── 手動非表示（左スワイプでカードが追従 → 非表示アクション → 確認ダイアログ）──────
const ACTION_W  = 96   // 非表示アクションの幅(px)
const REVEAL_AT = 40   // これ以上引いたらアクションを表示
const OPEN_SNAP = 56   // これ以上で離すとスナップして開いたまま

const swipeItem     = ref(null)   // ドラッグ/オープン中の品目名
const swipeDx       = ref(0)      // 現在の移動量（<=0）
const swipeDragging = ref(false)  // 指が触れている間（transition を切る）
const hideDialogItem = ref(null)  // 確認ダイアログ対象
let _sx = 0, _sy = 0, _dir = null, _baseDx = 0, _suppressClick = false

function _resetSwipe() { swipeItem.value = null; swipeDx.value = 0; swipeDragging.value = false }

function onRowTouchStart(e, item) {
  if (!canManage.value) return   // ゲスト/読み取り専用は非表示スワイプ不可
  if (swipeItem.value && swipeItem.value !== item) _resetSwipe()  // 別行に触れたら閉じる
  const t = e.changedTouches[0]
  _sx = t.clientX; _sy = t.clientY; _dir = null
  _baseDx = (swipeItem.value === item) ? swipeDx.value : 0
  swipeItem.value = item
  swipeDragging.value = true
}
function onRowTouchMove(e) {
  if (!swipeDragging.value) return
  const t  = e.changedTouches[0]
  const dx = t.clientX - _sx
  const dy = t.clientY - _sy
  if (_dir === null) {
    if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return
    _dir = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v'
  }
  if (_dir !== 'h') return   // 縦スクロールは妨げない
  let nx = _baseDx + dx
  if (nx > 0) nx = 0
  if (nx < -ACTION_W) nx = -ACTION_W - (-ACTION_W - nx) * 0.3  // 端で抵抗
  swipeDx.value = nx
}
function onRowTouchEnd() {
  if (!swipeDragging.value) return
  swipeDragging.value = false
  if (_dir === 'h') {
    _suppressClick = true
    swipeDx.value = (-swipeDx.value >= OPEN_SNAP) ? -ACTION_W : 0   // スナップ開/閉
    if (swipeDx.value === 0) swipeItem.value = null
  }
}

function openHideDialog(item) { hideDialogItem.value = item }
function confirmHideDialog() {
  const it = hideDialogItem.value
  hideDialogItem.value = null
  _resetSwipe()
  if (it) emit('hide-item', it)
}
function cancelHideDialog() { hideDialogItem.value = null; _resetSwipe() }  // カードは滑らかに戻る

const manageHiddenOpen = ref(false)

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
    ...config.value.order,
    ...Object.keys(props.inventory).filter(k => !config.value.order.includes(k)),
  ]
  for (const item of all) {
    if (!props.readOnly && hiddenSet.value.has(item)) continue
    if (props.categoryScope === 'food'   && _isSupply(item)) continue
    if (props.categoryScope === 'supply' && !_isSupply(item)) continue
    if (_usedActive.value && !_isUsedName(item)) continue
    const grp = _kanaGroup(item)
    if (!map[grp]) map[grp] = { total: 0, filled: 0 }
    map[grp].total++
    if (props.inventory[item] != null) map[grp].filled++
  }
  return map
})

// 汎用軸ごとの進捗（catRealStats と同じくフィルター非依存・スコープ反映）
function _axisStats(tagMap) {
  const map = {}
  const all = [
    ...config.value.order,
    ...Object.keys(props.inventory).filter(k => !config.value.order.includes(k)),
  ]
  for (const item of all) {
    if (!props.readOnly && hiddenSet.value.has(item)) continue
    if (props.categoryScope === 'food'   && _isSupply(item)) continue
    if (props.categoryScope === 'supply' && !_isSupply(item)) continue
    if (_usedActive.value && !_isUsedName(item)) continue
    const arr = tagMap?.[item]
    const groups = (Array.isArray(arr) && arr.length) ? arr : ['その他']
    for (const grp of groups) {
      if (!map[grp]) map[grp] = { total: 0, filled: 0 }
      map[grp].total++
      if (props.inventory[item] != null) map[grp].filled++
    }
  }
  return map
}
const axisAStats = computed(() => _axisStats(config.value.tagsA))
const axisBStats = computed(() => _axisStats(config.value.tagsB))

// スコープ対応の品目数（ヘッダー表示用・絞り込み中は使う品目のみ）
const scopedTotal = computed(() => {
  const inScope = props.categoryScope === 'all'
    ? config.value.order
    : config.value.order.filter(item => props.categoryScope === 'food' ? !_isSupply(item) : _isSupply(item))
  return _usedActive.value ? inScope.filter(_isUsedName).length : inScope.length
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
  <section class="inventory-section" :class="{ 'inv-preview': preview }">
    <!-- ヘッダー行 -->
    <div class="section-header">
      <button
        v-if="!readOnly && !hideTapContinuous"
        :class="['tap-continuous-toggle', { active: tapContinuous }]"
        @click="emit('update:tapContinuous', !tapContinuous)"
        title="ONにすると、品目をタップして入力した後、自動で次の品目の入力画面が開きます（音声・文字検索は対象外）"
      >
        <span class="tc-track"><span class="tc-knob"></span></span>
        連続入力
      </button>
      <div v-else></div>
      <div class="header-right">
        <span v-if="!preview" class="progress">
          <strong>{{ scopedFilled }}</strong> / {{ scopedTotal }} 件入力済み
        </span>
        <button
          v-if="!hasAllExpanded"
          class="btn-expand-all"
          @click="expandAll"
        >全て開く</button>
        <button
          v-if="hasExpanded"
          class="btn-collapse-all"
          @click="collapseAll"
        >すべて閉じる</button>
      </div>
    </div>

    <!-- 並べ替え / フィルター ツールバー -->
    <div class="toolbar">
      <!-- 並べ替え（軸の切替はゲストも可。作成・編集＝✎/＋ はホストのみ） -->
      <div class="seg-group">
        <button
          v-for="opt in sortOpts"
          :key="opt.value"
          :class="['seg-btn', { active: sortMode === opt.value }]"
          @click="sortMode = opt.value"
        >{{ opt.label }}<span
            v-if="sortMode === opt.value && (opt.value === 'axisA' || opt.value === 'axisB') && canManage"
            class="seg-edit"
            title="この並び替えのグループを編集"
            @click.stop="openAxisEdit(opt.value)"
          >✎</span></button>
        <button
          v-if="canAddAxis && canManage"
          class="seg-btn seg-add"
          title="場所・仕入先など、並び替えを追加"
          @click="onAddAxis"
        >＋</button>
      </div>
      <div v-if="!preview" class="seg-group">
        <button
          v-for="opt in filterOpts"
          :key="opt.value"
          :class="['seg-btn', { active: filterMode === opt.value }]"
          @click="filterMode = opt.value"
        >{{ opt.label }}</button>
      </div>
      <button
        v-if="hasUsageData && canManage && !preview"
        :class="['used-toggle', { active: usedOnly }]"
        @click="toggleUsedOnly"
        title="直近3回の棚卸で入力があった品目だけを表示（検索は全品目対象）"
      >{{ usedOnly ? '✓ ' : '' }}前回までに入力した品目のみ表示</button>
    </div>

    <!-- 絞り込み中インジケータ（いつでも全表示に戻せる） -->
    <div v-if="_usedActive && hiddenCount > 0" class="used-notice" @click="toggleUsedOnly">
      前回まで入力の無い {{ hiddenCount }}件を非表示中 ・ <strong>タップで全表示</strong>（検索は全品目が対象）
    </div>

    <!-- 手動非表示の管理（左スワイプで隠した品目。ゲストは操作不可） -->
    <div v-if="canManage && hiddenSet.size > 0" class="hidden-notice" @click="manageHiddenOpen = true">
      手動非表示 {{ hiddenSet.size }}件 ・ <strong>タップで管理</strong>
    </div>

    <!-- テーブル -->
    <table class="inv-table">
      <thead>
        <tr>
          <th v-if="hasCodes" class="th-code">商品コード</th>
          <th>品目</th>
          <th class="th-qty">{{ preview ? '振り分け' : '数量' }}</th>
          <th v-if="showAmount" class="th-amount">金額</th>
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
                  <template v-if="preview">{{ row.count }}</template>
                  <template v-else>{{ row.filled }}<span class="cat-badge-sep">/</span>{{ row.count }}</template>
                </span>
              </div>
              <div v-if="!preview" class="cat-progress-track">
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
              :class="{ filled: row.entry !== null, 'read-only': readOnly, typing: typingMap?.[row.item], conflict: conflictLocked?.has(row.item), 'swipe-dragging': swipeDragging && swipeItem === row.item }"
              :style="swipeItem === row.item ? { transform: `translateX(${swipeDx}px)` } : null"
              :tabindex="readOnly ? undefined : 0"
              :data-item="row.item"
              class="item-row"
              @click="rowClick(row.item)"
              @keydown="onRowKeydown($event, row.item)"
              @touchstart.passive="onRowTouchStart($event, row.item)"
              @touchmove.passive="onRowTouchMove"
              @touchend="onRowTouchEnd">
            <td v-if="hasCodes" class="td-code">{{ row.code ?? '' }}</td>
            <td class="td-name">
              <!-- 左スワイプで現れる非表示アクション（右端に固定表示） -->
              <button
                v-if="swipeItem === row.item && -swipeDx >= REVEAL_AT"
                class="row-action"
                :style="{ transform: `translateX(${-swipeDx}px)` }"
                @click.stop="openHideDialog(row.item)"
              >非表示</button>
              <div class="name-main">
                {{ row.item }}
                <span v-if="row.custom" class="badge">追加</span>
                <span v-if="preview && hiddenSet.has(row.item)" class="badge badge-hidden">非表示</span>
                <span
                  v-if="recountFlags?.[row.item]"
                  class="recount-flag-badge"
                  title="あとで数えるフラグが立っています"
                >🔖</span>
                <span
                  v-if="orderMode && orderMap?.[row.item]?.orderQty > 0"
                  class="order-chip"
                  :title="orderMap[row.item].by ? `${orderMap[row.item].by} が発注` : '発注済み'"
                >🧾 発注 {{ orderMap[row.item].orderQty }}<span
                  v-if="orderMap[row.item].by" class="order-chip-by">・{{ orderMap[row.item].by }}</span></span>
                <span v-if="!readOnly && manualSet.has(row.item)" class="manual-actions" @click.stop>
                  <button class="manual-btn-edit" @click="emit('edit-item', row.item)">編集</button>
                  <button class="manual-btn-delete" @click="requestDelete(row.item)">削除</button>
                </span>
              </div>
              <div v-if="pendingDelete === row.item" class="delete-confirm" @click.stop>
                <span class="delete-confirm-msg">「{{ row.item }}」を削除しますか？</span>
                <button class="delete-confirm-yes" @click="confirmDelete(row.item)">削除</button>
                <button class="delete-confirm-no"  @click="cancelDelete">キャンセル</button>
              </div>
              <div v-else-if="conflictLocked?.has(row.item)" class="conflict-indicator">
                ⚡ 競合中 — ホストが解決中
              </div>
              <div v-else-if="typingMap?.[row.item]" class="typing-indicator">
                ✏️ {{ typingMap[row.item].name }}が入力中…
              </div>
              <div v-else-if="row.lotSize || row.prevMonth || noteMap?.[row.item]" class="hints-row">
                <span v-if="noteMap?.[row.item]" class="prev-hint note-hint">{{ noteMap[row.item] }}</span>
                <span v-if="row.lotSize"   class="prev-hint lot-hint">入数: {{ row.lotSize }}</span>
                <span v-if="row.prevMonth" class="prev-hint">前月: {{ row.prevMonth }}</span>
              </div>
            </td>
            <td class="td-qty">
              <div v-if="preview" class="preview-groups">
                <span v-for="g in previewGroups(row)" :key="g" class="preview-group-chip">{{ g }}</span>
                <span v-if="previewGroups(row).length === 0" class="preview-group-none">未振り分け</span>
              </div>
              <div v-else :class="['qty-display', { filled: row.entry !== null }]">
                <template v-if="row.entry !== null">
                  {{ row.entry.qty }}<span v-if="row.entry.unit" class="qty-unit">{{ row.entry.unit }}</span>
                </template>
                <template v-else>—</template>
              </div>
            </td>
            <td v-if="showAmount" class="td-amount">
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
            <template v-if="config.order.length === 0">上のフォームから品目を追加してください</template>
            <template v-else-if="filterMode === 'filled'">入力済みの品目がありません</template>
            <template v-else-if="filterMode === 'empty'">すべての品目が入力済みです 🎉</template>
            <template v-else>品目がありません</template>
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

    <!-- 非表示の確認ダイアログ（小さめ・中央） -->
    <div v-if="hideDialogItem" class="hide-dialog-overlay" @click.self="cancelHideDialog">
      <div class="hide-dialog">
        <div class="hide-dialog-title">この品目を非表示にしますか？</div>
        <div class="hide-dialog-name">{{ hideDialogItem }}</div>
        <div class="hide-dialog-actions">
          <button class="hide-dialog-cancel" @click="cancelHideDialog">キャンセル</button>
          <button class="hide-dialog-ok" @click="confirmHideDialog">非表示にする</button>
        </div>
      </div>
    </div>

    <!-- 手動非表示の管理シート -->
    <div v-if="manageHiddenOpen" class="hidden-overlay" @click.self="manageHiddenOpen = false">
      <div class="hidden-sheet">
        <div class="hidden-sheet-head">
          <span class="hidden-sheet-title">手動非表示の品目（{{ hiddenSet.size }}）</span>
          <button class="hidden-sheet-close" @click="manageHiddenOpen = false">閉じる</button>
        </div>
        <p class="hidden-sheet-sub">戻すと一覧・進捗に再び含まれます。</p>
        <div class="hidden-list">
          <div v-for="name in hiddenItems" :key="name" class="hidden-row">
            <span class="hidden-row-name">{{ name }}</span>
            <button class="hidden-row-restore" @click="emit('unhide-item', name)">戻す</button>
          </div>
          <div v-if="hiddenSet.size === 0" class="hidden-empty">非表示の品目はありません</div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.inventory-section { padding: 0 16px; overflow-x: clip; }
.inventory-section.inv-preview { padding: 0; }

/* ── セクションヘッダー ── */
.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 4px 10px;
}

.tap-continuous-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: none;
  background: transparent;
  padding: 4px 2px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  cursor: pointer;
}
.tap-continuous-toggle.active { color: var(--primary); }
.tc-track {
  width: 34px;
  height: 20px;
  border-radius: 10px;
  background: #cbd5e1;
  position: relative;
  transition: background 0.18s;
  flex-shrink: 0;
}
.tap-continuous-toggle.active .tc-track { background: var(--primary); }
.tc-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 2px rgba(0,0,0,0.25);
  transition: transform 0.18s;
}
.tap-continuous-toggle.active .tc-knob { transform: translateX(14px); }

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
  flex-wrap: wrap;
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

.seg-add {
  flex: 0 0 auto;
  color: var(--primary);
  font-weight: 800;
}

.seg-edit {
  display: inline-block;
  margin-left: 5px;
  padding: 0 4px;
  font-size: 12px;
  border-radius: 5px;
  background: rgba(37, 99, 235, 0.12);
}

/* ── よく使う品目トグル ── */
.used-toggle {
  flex: 1 0 100%;
  padding: 8px;
  font-size: 12px;
  font-weight: 700;
  border: 1.5px solid var(--border);
  background: #fff;
  border-radius: 10px;
  color: var(--text-muted);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.used-toggle.active {
  border-color: var(--primary);
  background: var(--primary-weak);
  color: var(--primary);
}
.used-notice {
  font-size: 12px;
  color: #92400e;
  background: #fffbeb;
  border: 1.5px solid #fde68a;
  border-radius: 8px;
  padding: 7px 12px;
  margin-bottom: 8px;
  cursor: pointer;
  line-height: 1.5;
}
.used-notice strong { color: #b45309; }

.hidden-notice {
  font-size: 12px;
  color: #475569;
  background: #f1f5f9;
  border: 1.5px solid #cbd5e1;
  border-radius: 8px;
  padding: 7px 12px;
  margin-bottom: 8px;
  cursor: pointer;
  line-height: 1.5;
}
.hidden-notice strong { color: #334155; }

/* 非表示の確認ダイアログ（小さめ・中央） */
.hide-dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 70;
  padding: 24px;
}
.hide-dialog {
  width: 100%;
  max-width: 320px;
  background: #fff;
  border-radius: 16px;
  padding: 20px 18px 16px;
  box-shadow: 0 12px 40px rgba(0,0,0,0.25);
  text-align: center;
}
.hide-dialog-title { font-size: 15px; font-weight: 800; color: #1e293b; }
.hide-dialog-name {
  font-size: 14px; font-weight: 700; color: #475569;
  background: #f1f5f9; border-radius: 8px; padding: 8px 12px; margin: 12px 0 16px;
  word-break: break-all;
}
.hide-dialog-actions { display: flex; gap: 10px; }
.hide-dialog-cancel, .hide-dialog-ok {
  flex: 1; border-radius: 10px; font-size: 14px; font-weight: 700; padding: 11px; cursor: pointer;
}
.hide-dialog-cancel { border: 1px solid #e2e8f0; background: #fff; color: #64748b; }
.hide-dialog-ok { border: none; background: #64748b; color: #fff; }
.hide-dialog-ok:active { background: #475569; }

/* 管理シート */
.hidden-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.4);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  z-index: 60;
}
.hidden-sheet {
  width: 100%;
  max-width: 520px;
  max-height: 70vh;
  background: #fff;
  border-radius: 18px 18px 0 0;
  padding: 16px 18px 24px;
  display: flex;
  flex-direction: column;
}
.hidden-sheet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}
.hidden-sheet-title { font-size: 15px; font-weight: 800; color: #1e293b; }
.hidden-sheet-close {
  border: none; background: none; color: #64748b;
  font-size: 13px; font-weight: 700; cursor: pointer; padding: 4px 6px;
}
.hidden-sheet-sub { font-size: 12px; color: #94a3b8; margin: 0 0 10px; }
.hidden-list { overflow-y: auto; }
.hidden-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 4px;
  border-bottom: 1px solid #f1f5f9;
}
.hidden-row-name { font-size: 14px; color: #334155; }
.hidden-row-restore {
  border: 1px solid var(--primary-border, #bfdbfe);
  background: #fff;
  color: var(--primary, #2563eb);
  border-radius: 8px;
  font-size: 12px;
  font-weight: 700;
  padding: 5px 14px;
  cursor: pointer;
}
.hidden-empty { font-size: 13px; color: #94a3b8; text-align: center; padding: 20px 0; }

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
  background: var(--primary-deep);
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
.group-header-row:hover { background: var(--primary-weak) !important; }

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
  background: var(--primary-soft);
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
  position: relative;
  transition: transform 0.28s cubic-bezier(0.22, 0.61, 0.36, 1);
}
.item-row.swipe-dragging { transition: none; }   /* ドラッグ中は指に即追従 */

/* 左スワイプで現れる非表示アクション（行の右端に固定） */
.row-action {
  position: absolute;
  top: 0;
  bottom: 0;
  right: 0;
  width: 96px;
  border: none;
  background: #64748b;
  color: #fff;
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.04em;
  cursor: pointer;
  z-index: 3;
  -webkit-tap-highlight-color: transparent;
}
.row-action:active { background: #475569; }
.item-row:active             { background: var(--primary-weak) !important; }
.item-row:focus              { outline: 2px solid var(--primary); outline-offset: -2px; background: var(--primary-weak) !important; }
.item-row:focus:not(:focus-visible) { outline: none; }
.item-row.read-only          { cursor: default; }
.item-row.read-only:active   { background: inherit !important; }
.item-row.typing             { background: #fefce8 !important; }
.item-row.typing .td-name    { border-left: 2px solid #f59e0b; }
.item-row.conflict           { background: #fef2f2 !important; cursor: default; }
.item-row.conflict .td-name  { border-left: 2px solid #ef4444; }

.typing-indicator {
  font-size: 10px;
  color: #92400e;
  margin-top: 2px;
  font-style: italic;
}

.conflict-indicator {
  font-size: 10px;
  color: #dc2626;
  margin-top: 2px;
  font-style: italic;
}

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

/* 呼び出し元が渡す補足（入出庫の理論在庫など）。入数・前月より先に出す */
.note-hint {
  color: #0f766e;
  font-weight: 700;
}

.badge {
  font-size: 10px;
  background: var(--primary-soft);
  color: var(--primary);
  border-radius: 4px;
  padding: 1px 5px;
  vertical-align: middle;
}
.badge-hidden { background: #fef2f2; color: #dc2626; }

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

/* ── preview: 数量欄に振り分け先グループを表示 ── */
.inv-preview .th-qty { width: 132px; text-align: left; padding-left: 10px; }
.inv-preview .td-qty { text-align: left; padding: 7px 8px; }
.preview-groups { display: flex; flex-wrap: wrap; gap: 4px; }
.preview-group-chip {
  font-size: 10px; font-weight: 700; color: var(--primary);
  background: var(--primary-weak); border: 1px solid var(--primary-border);
  border-radius: 6px; padding: 2px 7px; white-space: nowrap;
}
.preview-group-none { font-size: 11px; color: var(--text-muted); }

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

.recount-flag-badge {
  font-size: 12px;
  flex-shrink: 0;
}

/* 発注セッション: 品目ごとの発注数チップ（誰が発注したかを一覧で可視化） */
.order-chip {
  display: inline-flex;
  align-items: center;
  font-size: 11px;
  font-weight: 700;
  color: #047857;
  background: #ecfdf5;
  border: 1px solid #a7f3d0;
  border-radius: 10px;
  padding: 1px 8px;
  margin-left: 4px;
  flex-shrink: 0;
  white-space: nowrap;
}
.order-chip-by { font-weight: 600; color: #059669; opacity: 0.85; }

/* ── 手動品目 編集・削除ボタン ── */
.manual-actions {
  margin-left: auto;
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}

.manual-btn-edit,
.manual-btn-delete {
  padding: 2px 7px;
  border: 1px solid;
  cursor: pointer;
  font-size: 11px;
  font-weight: 600;
  border-radius: 4px;
  line-height: 1.6;
  white-space: nowrap;
}

.manual-btn-edit {
  background: var(--primary-weak);
  color: var(--primary);
  border-color: var(--primary-border);
}

.manual-btn-delete {
  background: #fef2f2;
  color: #dc2626;
  border-color: #fecaca;
}

.manual-btn-edit:active   { background: var(--primary-soft); }
.manual-btn-delete:active { background: #fee2e2; }

/* ── 削除インライン確認 ── */
.delete-confirm {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
  padding: 6px 8px;
  background: #fff7ed;
  border: 1px solid #fed7aa;
  border-radius: 6px;
  font-size: 12px;
}

.delete-confirm-msg { flex: 1; color: #92400e; font-weight: 500; min-width: 0; }

.delete-confirm-yes {
  padding: 4px 10px;
  background: #dc2626;
  color: white;
  border: none;
  border-radius: 5px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  flex-shrink: 0;
}

.delete-confirm-no {
  padding: 4px 10px;
  background: #f1f5f9;
  color: #475569;
  border: none;
  border-radius: 5px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  flex-shrink: 0;
}
</style>
