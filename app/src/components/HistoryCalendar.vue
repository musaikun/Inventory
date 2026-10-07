<script setup>
import DayTasks from './DayTasks.vue'
import OrderExportSheet from './OrderExportSheet.vue'
import { canSeeMoney } from '../composables/useAuth.js'
import { openTaskCounts } from '../composables/useTasks.js'
import { isQuickMovement } from '../services/itemDayLog.js'
import { ref, computed, reactive, onMounted, onUnmounted, watch, nextTick } from 'vue'
import DismissibleHint from './DismissibleHint.vue'
import { useHistory } from '../composables/useHistory.js'
import { useOrders } from '../composables/useOrders.js'
import { useMovements } from '../composables/useMovements.js'
import { useConfig } from '../composables/useConfig.js'
import { useDayNotes } from '../composables/useDayNotes.js'
import { useVerticalSwipe } from '../composables/useSwipe.js'
import { registerInnerLayerCloser } from '../composables/appMenuState.js'
import { dayFactors, isOffDay, consecutiveOffLength } from '../services/demandFactors.js'

// 日付ベースの履歴カレンダー。棚卸(🔵)と発注(🟠)を同じ月グリッドに並べ、
// **実際に起きたことだけを出す**（発注スケジュールの「予定」は出さない ── 予定は
// 後から変えられるので、過去のマスに今の設定を重ねると「その日が発注日だった」という
// 嘘になる。これから何をするかは仕入れ管理の画面の仕事）。
// 日を選ぶ → その日の履歴（種類別）を見る。
// 上に「今日のやること」（記録から自動で出す分だけ・今日の話だけ）を置き、マスには載せない。
// 業務ごとに日付を探すのは「一覧」表示の仕事。カレンダー自体は暦として読む形のまま、フィルタを持たない
// （2026-09-08 に種別フィルタを外した理由＝読むのに操作が要る、を崩さないため）。
// weather プロップは将来の天気表示用スロット。{ 'YYYY-MM-DD': { icon, label, tempHi, tempLo } }
const props = defineProps({
  sessions: { type: Array, default: () => [] }, // 完了済み棚卸セッション
  weather:  { type: Object, default: () => ({}) },
})
const emit = defineEmits(['view-session'])
const exportOrder = ref(null)   // 書き出しを開いている発注

const { getSnapshotBySessionId } = useHistory()
const { getOrders } = useOrders()
const { getMovements } = useMovements()
const { config } = useConfig()

const WEEK = ['日', '月', '火', '水', '木', '金', '土']

function _key(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}
// endedAt / startedAt はUTCのISO文字列。先頭10文字はUTCの日付なので、そのまま束ねると
// JSTの00:00〜09:00に終えた棚卸が前日のマスへ入る（閉店後・開店前の作業がまさにこの時間）。
// このカレンダーは今日・表示月・選択日をすべてローカル日付で数えているので、ここも
// ローカルへそろえる。時刻を持たない日付だけの値は、解釈し直さずそのまま使う。
function _keyOf(iso) {
  const s = String(iso || '')
  if (!s) return ''
  if (!s.includes('T')) return s.slice(0, 10)
  const t = new Date(s)
  return Number.isNaN(t.getTime()) ? s.slice(0, 10) : _key(t.getFullYear(), t.getMonth(), t.getDate())
}

const _now = new Date()
const todayKey = _key(_now.getFullYear(), _now.getMonth(), _now.getDate())

const viewYear  = ref(_now.getFullYear())
const viewMonth = ref(_now.getMonth())

// セル背景の帯（優先: スパン＞祝日＞長期休暇＞連休）
function cellBand(cell) {
  if (!cell) return ''
  const f = cell.factors
  if (f.span) return 'span'            // お盆・年末年始（短期・強い）
  if (f.holiday) return 'holiday'      // 祝日・振替・国民の休日
  if (f.seasonBreak) return 'season'   // 夏/冬/春休み（広い）
  if (f.longWeekend) return 'long'     // 3連休以上
  return ''
}

// 取込で作った棚卸か。サーバーは importBatchId を返し、端末のスナップショットは
// source='import' を持つ。片方しか無い端末（取込直後・別端末での取込）でも判るよう両方見る。
function _isImported(s) {
  if (!s) return false
  if (s.importBatchId) return true
  const snap = getSnapshotBySessionId(s.id)
  return snap?.source === 'import' || !!snap?.importBatchId
}

// 棚卸セッションが載る日。通常は endedAt（深夜に終えた棚卸を作業日のマスへ寄せるため）。
// ただし取込は endedAt が「取り込んだ日時」なので、そのまま束ねると星が取込日に出て、
// 入れたはずの実施日のマスは空のまま見える。取込は startedAt に実施日を持つのでそれを使う。
// _keyOf を通さないのは、実施日が `YYYY-MM-DDT00:00:00.000Z` で入っており、
// UTCより西の端末ではローカルへ読み替えると前日へずれるため（日付だけを取る）。
function _stockKey(s) {
  if (_isImported(s)) {
    const d = String(s.startedAt || '').slice(0, 10) || getSnapshotBySessionId(s.id)?.date || ''
    if (d) return d
  }
  return _keyOf(s.endedAt ?? s.startedAt)
}

// 日付キー → 棚卸セッション配列
const stockByDate = computed(() => {
  const map = {}
  for (const s of props.sessions) {
    const k = _stockKey(s)
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

// マスに出る星の数（棚卸/発注/入庫/出庫）。4つのとき 2×2 に折り返す。
function dotCount(cell) {
  if (!cell) return 0
  let n = 0
  if (cell.stock.length) n++
  if (cell.orders.length) n++
  if (cell.moves.some(m => m.type === 'in')) n++
  if (cell.moves.some(m => m.type === 'out')) n++
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

// ── 指追従スワイプ（縦）───────────────────────────
// 月は縦に送る（上へ払う＝次の月、下へ払う＝前の月）。左右のスワイプはタブの切り替えに残す
// （カレンダーをタブにしたら、左右の月送りとタブ送りが重なった・User決定 2026-10-04）。
// 縦に送れることは説明文ではなく見た目で示す: マスの上下に前後の月をのぞかせ、
// ドラッグ中は指に合わせてグリッドが動き、引いた側の月が濃くなる。
const dragY = ref(0)
const dragging = ref(false)
let _committed = false
const dragStyle = computed(() => ({
  transform: dragY.value ? `translateY(${dragY.value * 0.6}px)` : '',
  transition: dragging.value ? 'none' : 'transform 0.2s ease',
}))
// のぞかせる月の濃さ（0〜1）。引いた側だけ濃くなる
const peekPrev = computed(() => Math.min(1, Math.max(0, dragY.value / 60)))
const peekNext = computed(() => Math.min(1, Math.max(0, -dragY.value / 60)))
const calSwipe = useVerticalSwipe({
  threshold: 50,
  onDrag: (dy) => {
    if (dy === 0) {
      // 指を離した瞬間。onUp/onDown（コミット）が続けて呼ばれるかを microtask で確認。
      dragging.value = false
      _committed = false
      queueMicrotask(() => { if (!_committed) dragY.value = 0 })  // 未コミットはスナップバック
    } else {
      dragging.value = true
      dragY.value = dy
    }
  },
  onUp:   () => { _committed = true; dragY.value = 0; nextMonth() },
  onDown: () => { _committed = true; dragY.value = 0; prevMonth() },
})
const prevMonthLabel = computed(() => `${viewMonth.value === 0 ? 12 : viewMonth.value}月`)
const nextMonthLabel = computed(() => `${viewMonth.value === 11 ? 1 : viewMonth.value + 2}月`)
// ── 選択日 ─────────────────────────────────
// 日をタップ → その日の詳細をモーダルで開く。カレンダーの下に敷くと、月のマスを
// 見ながらでは読めず、スクロールすると選んだ日が画面の外へ出てしまう。
const selectedKey = ref(null)
const dayOpen = ref(false)
function onCellTap(cell) {
  // 記録の有無に関わらず、どの日でも詳細を開ける（暦・比較を確認するため）
  selectedKey.value = cell.key
  dayOpen.value = true
}
function closeDay() { dayOpen.value = false }

// 端末の戻るは「開いている最上位を1枚だけ閉じる」。App の _closeTopLayer より先にここが見る
// （登録しないと、モーダルを開いたまま戻ったとき履歴カレンダー画面ごと閉じてしまう）。
onUnmounted(registerInnerLayerCloser(() => {
  if (!dayOpen.value) return false
  closeDay()
  return true
}))

// 棚卸の確認ページへ移る。モーダルは畳んでから渡す（戻ったときに開いたままにしない）
function onViewSession(s) {
  closeDay()
  emit('view-session', s)
}

// 今日のやること（自動）は出さない（User決定 2026-10-01。ホームも履歴も）。services/calendarTodos は残す

// ── 一覧（業務ごとに日付を探す）────────────────
const viewMode = ref('cal')              // 'cal' | 'list'
const KINDS = [
  { key: 'all',   label: 'すべて' },
  { key: 'stock', label: '棚卸', dot: 'dot-stock' },
  { key: 'order', label: '発注', dot: 'dot-order' },
  { key: 'in',    label: '入庫', dot: 'dot-in' },
  { key: 'out',   label: '出庫', dot: 'dot-out' },
  { key: 'memo',  label: 'メモ' },
]
const listKind = ref('all')
const listRows = computed(() => {
  const rows = []
  const want = k => listKind.value === 'all' || listKind.value === k
  if (want('stock')) for (const [k, arr] of Object.entries(stockByDate.value)) for (const x of arr) {
    const v = _stockValue(x)
    rows.push({ id: 's:' + x.id, key: k, kind: 'stock', s: x, info: `${_stockItemCount(x)}品目${_isImported(x) ? `・${_importedMd(x)}に取込` : ''}`, amount: v.amount })
  }
  if (want('order')) for (const [k, arr] of Object.entries(orderByDate.value)) for (const o of arr) {
    rows.push({ id: 'o:' + o.id, key: k, kind: 'order', recId: o.id, info: `${o.supplier ? o.supplier + '・' : ''}${o.lines.length}品目`, amount: _orderValue(o).amount })
  }
  for (const [k, arr] of Object.entries(moveByDate.value)) for (const m of arr) {
    if (!want(m.type)) continue
    rows.push({ id: 'm:' + m.id, key: k, kind: m.type, recId: m.id, info: `${m.lines.length}品目${m.note ? '・' + m.note : ''}`, amount: _orderValue(m).amount })
  }
  if (want('memo')) for (const k of noteDates()) {
    const n = getNote(k)
    rows.push({ id: 'n:' + k, key: k, kind: 'memo', info: n?.text || (n?.excluded ? '発注学習から除外' : 'メモ'), amount: null })
  }
  const ORDER = { stock: 0, order: 1, in: 2, out: 3, memo: 4 }
  rows.sort((a, b) => b.key.localeCompare(a.key) || ORDER[a.kind] - ORDER[b.kind])
  // 月ごとの見出し
  const out = []
  let month = ''
  for (const r of rows) {
    const m = r.key.slice(0, 7)
    if (m !== month) { month = m; out.push({ id: 'h:' + m, head: `${Number(m.slice(0, 4))}年${Number(m.slice(5, 7))}月` }) }
    out.push(r)
  }
  return out
})
const KIND_META = Object.fromEntries(KINDS.map(k => [k.key, k]))
function listDateLabel(k) {
  const dt = new Date(k + 'T00:00:00')
  return `${dt.getMonth() + 1}/${dt.getDate()}（${WEEK[dt.getDay()]}）`
}
function onListTap(r) {
  if (r.kind === 'stock') { emit('view-session', r.s); return }
  openDay(r.key, r.kind, r.recId)
}

// その日のシートを開き、該当の記録まで送る（発注・入出庫は専用ページが無いのでここが詳細）
const sheetEl = ref(null)
// 外（カレンダータブの「今日」）からも日の詳細を開く
defineExpose({ openDay: key => openDay(key) })
function openDay(key, focus = '', recId = '') {
  if (!key) return
  viewYear.value = Number(key.slice(0, 4))
  viewMonth.value = Number(key.slice(5, 7)) - 1
  selectedKey.value = key
  dayOpen.value = true
  if (recId) expanded[recId] = true
  if (!focus) return
  nextTick(() => {
    const el = sheetEl.value?.querySelector(recId ? `[data-rec="${recId}"]` : `[data-sec="${focus}"]`)
      || sheetEl.value?.querySelector(`[data-sec="${focus}"]`)
    el?.scrollIntoView?.({ block: 'start' })
  })
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

// 品目シートでその場で登録した入出庫（1品目ずつの記録）は、同じ日・同じ種別なら1つにまとめ、
// 品目ごとに数量を足して見せる（User決定 2026-10-03：同日に何度登録しても統合して表示）。
// 納品取込・入出庫ページでまとめて入れた記録（複数品目・発注紐付け・取込）はそのまま。
const _isQuick = isQuickMovement
function _mergeQuick(list, type) {
  const quick = list.filter(_isQuick)
  if (quick.length < 2) return list
  const byItem = new Map()
  for (const m of quick) {
    const l = m.lines[0]
    const cur = byItem.get(l.item)
    if (cur) cur.qty = Math.round((cur.qty + Number(l.qty)) * 1000) / 1000
    else byItem.set(l.item, { item: l.item, qty: Number(l.qty), unit: l.unit || '' })
  }
  const merged = {
    id: `quick-${type}-${quick[0].date}`, date: quick[0].date, type, note: '', merged: quick.length,
    savedAt: quick.map(m => m.savedAt || '').sort().pop(), lines: [...byItem.values()],
  }
  return [merged, ...list.filter(m => !_isQuick(m))]
}
const selectedMoves = computed(() => (selectedKey.value ? moveByDate.value[selectedKey.value] || [] : []))
// 入庫/出庫のセクション定義（rows: 金額付き、_orderValue は lines を持つレコード共通で使える）
const moveSections = computed(() => {
  const mk = (type, label, icon, dot) => {
    const rows = _mergeQuick(selectedMoves.value.filter(m => m.type === type), type).map(m => ({ m, ..._orderValue(m) }))
    return { type, label, icon, dot, rows, total: _sumRows(rows) }
  }
  return [
    mk('in', '入庫', '📥', 'dot-in'),
    mk('out', '出庫', '📤', 'dot-out'),
  ].filter(s => s.rows.length)
})
const anyEstimated = computed(() => selOrderTotal.value != null || moveSections.value.some(s => s.total != null))
const selectedWeather = computed(() => (selectedKey.value ? props.weather[selectedKey.value] || null : null))

// 選択日の暦の需要要因 → 詳細パネルのチップ用（該当するものだけ）。
// 祝前日・給料日・五十日は出さない（User 2026-10-05。カレンダーの印と合わせて外した）
const selectedFactors = computed(() => {
  if (!selectedKey.value) return []
  const f = dayFactors(selectedKey.value)
  const runLen = consecutiveOffLength(selectedKey.value)
  const chips = []
  if (f.holidayName) chips.push({ cls: 'holiday', label: `🎌 ${f.holidayName}` })
  if (f.span)        chips.push({ cls: 'span',    label: f.span })
  else if (f.seasonBreak) chips.push({ cls: 'season', label: f.seasonBreak })
  else if (runLen >= 3)   chips.push({ cls: 'long', label: `${runLen}連休` })
  if (f.pension)     chips.push({ cls: 'pension', label: '👛 年金支給日' })
  if (f.monthEnd)    chips.push({ cls: 'pay',     label: '月末' })
  if (!chips.length) chips.push({ cls: 'weekday', label: '平日' })
  return chips
})

// ── 日別メモ（内部イベント要因＋学習除外）───────────────────
// 記録するのは自由記述と学習除外の2つだけ。定型チップ（貸切・イベント…）は置かない。
// 選べる言葉を先に並べると、その日に実際に起きたことではなく**用意された言葉のどれか**を
// 選ぶ記録になる。読み返して意味があるのは店の言葉で書いた1行のほう。
const { getNote, hasNote, setNote, noteDates } = useDayNotes()
const memoText = ref('')
// 決め打ちのチップ（貸切・イベント等）は廃止した。以前のメモに保存されている tags は
// 上書き保存で消さないよう、読んだものをそのまま持ち回るだけにする。
const memoTags = ref([])
const memoExcluded = ref(false)
watch(selectedKey, (k) => {
  const n = k ? getNote(k) : null
  memoText.value = n?.text || ''
  memoTags.value = n?.tags ? [...n.tags] : []
  memoExcluded.value = !!n?.excluded
}, { immediate: true })
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
    const k = _stockKey(s)
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

// 取り込んだ日（M/D）。取込の endedAt は「取り込んだ時刻」
function _importedMd(s) {
  const t = new Date(s?.endedAt || getSnapshotBySessionId(s?.id)?.savedAt || '')
  return Number.isNaN(t.getTime()) ? '' : `${t.getMonth() + 1}/${t.getDate()}`
}

function fmtYen(v) {
  return v == null ? '' : `¥${v.toLocaleString()}`
}

const UNPRICED_MAX = 8
function _fmtUnpriced(list) {
  if (list.length <= UNPRICED_MAX) return list.join('、')
  return `${list.slice(0, UNPRICED_MAX).join('、')} 他${list.length - UNPRICED_MAX}品目`
}

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
// 記録（棚卸・入出庫・発注）はここから消さない。完了した棚卸が誤操作で丸ごと消えた（User報告 2026-09-30）
</script>

<template>
  <div class="hc">
    <div class="hc-mode" role="tablist" aria-label="表示の切り替え">
      <button type="button" role="tab" :aria-selected="viewMode === 'cal'" :class="['hc-mode-btn', { on: viewMode === 'cal' }]" @click="viewMode = 'cal'">カレンダー</button>
      <button type="button" role="tab" :aria-selected="viewMode === 'list'" :class="['hc-mode-btn', { on: viewMode === 'list' }]" @click="viewMode = 'list'">一覧</button>
    </div>

    <!-- 一覧: 業務ごとに日付を探し、詳細へ飛ぶ -->
    <template v-if="viewMode === 'list'">
      <div class="hc-kinds">
        <button
          v-for="k in KINDS" :key="k.key" type="button"
          :class="['hc-kind', { on: listKind === k.key }]" @click="listKind = k.key"
        ><span v-if="k.dot" :class="['dot', k.dot]"></span>{{ k.label }}</button>
      </div>
      <div class="hc-list">
        <div v-if="!listRows.length" class="hc-empty">記録はありません</div>
        <template v-for="r in listRows" :key="r.id">
          <div v-if="r.head" class="hc-list-month">{{ r.head }}</div>
          <button v-else type="button" class="hc-list-row" @click="onListTap(r)">
            <span class="hc-list-date">{{ listDateLabel(r.key) }}</span>
            <span class="hc-list-kind"><span v-if="KIND_META[r.kind].dot" :class="['dot', KIND_META[r.kind].dot]"></span>{{ r.kind === 'memo' ? '📝 メモ' : KIND_META[r.kind].label }}</span>
            <span class="hc-list-info">{{ r.info }}</span>
            <span v-if="canSeeMoney && r.amount != null" class="hc-list-amt">{{ fmtYen(r.amount) }}</span>
            <span class="hc-list-arrow">›</span>
          </button>
        </template>
      </div>
    </template>

    <template v-else>
    <div class="hc-nav">
      <button class="hc-nav-btn" type="button" aria-label="前の月" @click="prevMonth"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg></button>
      <span class="hc-month">{{ monthLabel }}</span>
      <button class="hc-nav-btn" type="button" aria-label="次の月" @click="nextMonth"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>
    </div>

    <!-- 星の読み方。切替ボタンではなく説明なので、押せる見た目にしない -->
    <div class="hc-key">
      <span class="hc-key-i"><span class="dot dot-stock"></span>棚卸</span>
      <span class="hc-key-i"><span class="dot dot-order"></span>発注</span>
      <span class="hc-key-i"><span class="dot dot-in"></span>入庫</span>
      <span class="hc-key-i"><span class="dot dot-out"></span>出庫</span>
      <span class="hc-key-i"><span class="hc-task-key">1</span>やること</span>
      <DismissibleHint id="calendar-tap" tag="span" class="hc-key-hint">日付をタップで詳細</DismissibleHint>
    </div>

    <!-- カレンダー（縦のスワイプで月送り。左右はタブの切り替えへそのまま伝える）-->
    <div
      class="hc-cal"
      @touchstart.passive="calSwipe.onTouchStart"
      @touchmove.passive="calSwipe.onTouchMove"
      @touchend.passive="calSwipe.onTouchEnd"
      @touchcancel.passive="calSwipe.onTouchCancel"
    >
      <!-- 前の月をのぞかせる（縦に送れることを見た目で示す。押しても前の月へ）-->
      <button type="button" class="hc-peek top" :style="{ '--peek': peekPrev }" :aria-label="`前の月（${prevMonthLabel}）`" @click="prevMonth"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg><span>{{ prevMonthLabel }}</span></button>
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
          }]"
          @click="cell && onCellTap(cell)"
        >
          <template v-if="cell">
            <span :class="['hc-day', { sun: cell.dow === 0, sat: cell.dow === 6, hol: cell.factors.holiday }]">{{ cell.d }}</span>
            <span v-if="openTaskCounts.get(cell.key)" class="hc-task-mark" :title="`やること ${openTaskCounts.get(cell.key)}件`">{{ openTaskCounts.get(cell.key) }}</span>
            <span v-if="hasNote(cell.key)" class="hc-note-mark" title="メモあり">📝</span>
            <span v-if="cell.run" class="hc-run" :class="{ capL: cell.run.capL, capR: cell.run.capR }" :title="`${cell.run.len}連休`"></span>
            <span v-if="cell.wx" class="hc-wx">{{ cell.wx.icon }}</span>
            <span v-if="cell.factors.holidayName" class="hc-hol-name">{{ cell.factors.holidayName }}</span>
            <span v-if="dotCount(cell)" :class="['hc-dots', { 'dots-4': dotCount(cell) === 4 }]">
              <span v-if="cell.stock.length" class="dot dot-stock" title="棚卸"></span>
              <span v-if="cell.orders.length" class="dot dot-order" title="発注"></span>
              <span v-if="cell.moves.some(m => m.type === 'in')" class="dot dot-in" title="入庫"></span>
              <span v-if="cell.moves.some(m => m.type === 'out')" class="dot dot-out" title="出庫"></span>
            </span>
          </template>
        </div>
      </div>
      </div>
      <!-- 次の月をのぞかせる -->
      <button type="button" class="hc-peek bottom" :style="{ '--peek': peekNext }" :aria-label="`次の月（${nextMonthLabel}）`" @click="nextMonth"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg><span>{{ nextMonthLabel }}</span></button>
    </div>

    </template>

    <!-- 選択日の詳細。日付をタップしたときだけ開く（カレンダーの下には敷かない）-->
    <div v-if="dayOpen && selectedKey" class="modal-overlay" @click.self="closeDay">
    <div ref="sheetEl" class="modal-sheet hc-day-sheet">
      <div class="sheet-handle"></div>
      <div class="hc-sheet-head">
        <span class="hc-sheet-date">{{ selectedLabel }}</span>
        <span v-if="selectedWeather" class="hc-sheet-wx">
          {{ selectedWeather.icon }} {{ selectedWeather.label }}
          <template v-if="selectedWeather.tempHi != null">{{ selectedWeather.tempHi }}° / {{ selectedWeather.tempLo }}°</template>
          <template v-if="selectedWeather.pop != null"> ☔{{ selectedWeather.pop }}%</template>
        </span>
        <button class="hc-sheet-close" @click="closeDay">✕</button>
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

      <!-- 予定（発注日・締切）とやること（店で共有）-->
      <DayTasks :date="selectedKey" />

      <!-- 日別メモ（内部イベント要因＋学習除外）-->
      <div class="hc-memo" data-sec="memo">
        <textarea v-model="memoText" class="hc-memo-text" rows="2" placeholder="この日のメモ（貸切・近隣イベント・メニュー変更 など）"></textarea>
        <label class="hc-memo-excl">
          <input type="checkbox" v-model="memoExcluded" />
          この日を発注学習から除外（貸切・イベント等の異常日）
        </label>
        <button class="hc-memo-save" type="button" @click="saveMemo">メモを保存</button>
      </div>

      <!-- 棚卸 -->
      <template v-if="selectedStock.length">
        <div class="hc-sec-title" data-sec="stock">
          <span class="dot dot-stock"></span>棚卸（{{ selectedStock.length }}件）
          <span v-if="canSeeMoney && selStockTotal != null" class="hc-sec-total">{{ fmtYen(selStockTotal) }}</span>
        </div>
        <div
          v-for="r in selectedStockRows"
          :key="r.s.id"
          class="hc-entry hc-entry-stock"
          @click="onViewSession(r.s)"
        >
          <div class="hc-entry-main">
            <span v-if="_isImported(r.s)" class="hc-entry-imported" title="取り込んだ記録">取込 {{ _importedMd(r.s) }}</span>
            <span v-else class="hc-entry-time">{{ _timeLabel(r.s.endedAt ?? r.s.startedAt) }}</span>
            <span class="hc-entry-info">📦 {{ _stockItemCount(r.s) }}品目</span>
            <span v-if="canSeeMoney" :class="['hc-entry-amt', { none: r.amount == null }]">{{ r.amount != null ? fmtYen(r.amount) : '金額なし' }}</span>
            <span class="hc-entry-arrow">詳細 ›</span>
          </div>
          <div v-if="r.noData" class="hc-entry-warn">この端末に明細データが無いため、金額を計算できません</div>
          <div v-else-if="canSeeMoney && r.amount == null" class="hc-entry-warn">単価が未登録のため、金額はありません</div>
          <div v-else-if="canSeeMoney && r.unpriced.length" class="hc-entry-warn">単価未登録で金額に含まれない品目: {{ _fmtUnpriced(r.unpriced) }}</div>
        </div>
      </template>

      <!-- 入庫 / 出庫 -->
      <template v-if="moveSections.length">
        <template v-for="sec in moveSections" :key="sec.type">
          <div class="hc-sec-title" :data-sec="sec.type">
            <span :class="['dot', sec.dot]"></span>{{ sec.label }}（{{ sec.rows.length }}件）
            <span v-if="canSeeMoney && sec.total != null" class="hc-sec-total">{{ fmtYen(sec.total) }}</span>
          </div>
          <div v-for="r in sec.rows" :key="r.m.id" class="hc-entry hc-entry-move" :data-rec="r.m.id">
            <div class="hc-entry-main" @click="toggleOrder(r.m.id)">
              <span v-if="r.m.source === 'import'" class="hc-entry-imported" title="取り込んだ記録">取込</span>
              <span v-else class="hc-entry-time">{{ _timeLabel(r.m.savedAt) }}</span>
              <span class="hc-entry-info">{{ sec.icon }} {{ r.m.lines.length }}品目<template v-if="r.m.merged">（{{ r.m.merged }}回の登録）</template></span>
              <span v-if="r.m.note" class="hc-move-note">{{ r.m.note }}</span>
              <span v-if="canSeeMoney" :class="['hc-entry-amt', { none: r.amount == null }]">{{ r.amount != null ? fmtYen(r.amount) : '金額なし' }}</span>
              <span class="hc-entry-arrow">{{ expanded[r.m.id] ? '▲' : '▼' }}</span>
            </div>
            <div v-if="canSeeMoney && r.amount == null" class="hc-entry-warn">単価が未登録のため、金額はありません</div>
            <div v-else-if="canSeeMoney && r.unpriced.length" class="hc-entry-warn">単価未登録で金額に含まれない品目: {{ _fmtUnpriced(r.unpriced) }}</div>
            <div v-if="expanded[r.m.id]" class="hc-order-lines">
              <div v-for="l in r.m.lines" :key="l.item" class="hc-order-line">
                <span>{{ l.item }}</span><span>{{ l.qty }}{{ l.unit }}</span>
              </div>
            </div>
          </div>
        </template>
      </template>

      <!-- 発注 -->
      <template v-if="selectedOrders.length">
        <div class="hc-sec-title" data-sec="order">
          <span class="dot dot-order"></span>発注（{{ selectedOrders.length }}件）
          <span v-if="canSeeMoney && selOrderTotal != null" class="hc-sec-total">{{ fmtYen(selOrderTotal) }}</span>
        </div>
        <div v-for="r in selectedOrderRows" :key="r.o.id" class="hc-entry hc-entry-order" :data-rec="r.o.id">
          <div class="hc-entry-main" @click="toggleOrder(r.o.id)">
            <span class="hc-order-sup">{{ r.o.supplier || '（未分類）' }}</span>
            <span class="hc-entry-info">🧾 {{ r.o.lines.length }}品目</span>
            <span v-if="importedOrderIds.has(r.o.id)" class="hc-ord-done">入庫済み</span>
            <span v-if="canSeeMoney" :class="['hc-entry-amt', { none: r.amount == null }]">{{ r.amount != null ? fmtYen(r.amount) : '金額なし' }}</span>
            <span class="hc-entry-arrow">{{ expanded[r.o.id] ? '▲' : '▼' }}</span>
          </div>
          <div v-if="canSeeMoney && r.amount == null" class="hc-entry-warn">単価が未登録のため、金額はありません</div>
          <div v-else-if="canSeeMoney && r.unpriced.length" class="hc-entry-warn">単価未登録で金額に含まれない品目: {{ _fmtUnpriced(r.unpriced) }}</div>
          <div v-if="expanded[r.o.id]" class="hc-order-lines">
            <div v-for="l in r.o.lines" :key="l.item" class="hc-order-line">
              <span>{{ l.item }}</span><span>{{ l.qty }}{{ l.unit }}</span>
            </div>
            <button type="button" class="hc-order-export" @click.stop="exportOrder = r.o">📤 業者へ送る（品目名と数量を書き出す）</button>
          </div>
        </div>
      </template>

      <OrderExportSheet v-if="exportOrder" :order="exportOrder" @close="exportOrder = null" />

      <div v-if="canSeeMoney && anyEstimated" class="hc-est-note">※ 発注・入出庫の金額は品目マスタの現在の単価による概算です</div>

      <div
        v-if="!selectedStock.length && !selectedOrders.length && !selectedMoves.length"
        class="hc-empty"
      >
        この日はアプリの記録はありません
      </div>

      <button class="btn btn-secondary hc-day-close" @click="closeDay">閉じる</button>
    </div>
    </div>
  </div>
</template>

<style scoped>
/* 1画面で完結させるため、カレンダーが縦の余りを吸う（下に余白を残さない）。
   親が高さを決めていない場所に置いても、マスの min-height で潰れずに出る */
.hc { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 10px; }

.hc-todo { flex-shrink: 0; background: #fff; border: 1px solid #d6e6ea; border-radius: 12px; padding: 8px 10px; }
.hc-todo-title { font-size: 12px; font-weight: 800; color: #3d5a62; margin-bottom: 4px; }
.hc-todo-row {
  width: 100%; display: flex; align-items: center; gap: 8px; min-height: 44px; padding: 6px 2px;
  border: none; border-top: 1px solid #edf5f7; background: none; text-align: left; cursor: pointer; font: inherit;
  -webkit-tap-highlight-color: transparent;
}
.hc-todo-row:first-of-type { border-top: none; }
.hc-todo-check {
  flex-shrink: 0; width: 20px; height: 20px; border-radius: 6px; border: 2px solid #bfd6dc;
  display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 900; color: #fff;
}
.hc-todo-row.done .hc-todo-check { background: #10b981; border-color: #10b981; }
.hc-todo-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.hc-todo-label { font-size: 13.5px; font-weight: 800; color: #12303a; }
.hc-todo-row.k-delivery .hc-todo-label { color: #b45309; }
.hc-todo-row.done .hc-todo-label { color: #7d969c; text-decoration: line-through; }
.hc-todo-sub { font-size: 11px; color: #4c6a72; }
.hc-todo-arrow { flex-shrink: 0; color: #bfd6dc; font-size: 16px; }

.hc-mode { flex-shrink: 0; display: flex; background: #edf5f7; border-radius: 10px; padding: 3px; gap: 2px; }
.hc-mode-btn { flex: 1; min-height: 36px; border: none; background: transparent; border-radius: 8px; font-size: 12.5px; font-weight: 700; color: #4c6a72; cursor: pointer; }
.hc-mode-btn.on { background: #fff; color: var(--primary, #0e7490); box-shadow: 0 1px 3px rgba(0,0,0,0.12); }

.hc-kinds { flex-shrink: 0; display: flex; gap: 5px; }
.hc-kind {
  flex: 1 1 0; min-width: 0; justify-content: center; white-space: nowrap;
  display: inline-flex; align-items: center; gap: 2px; min-height: 36px; padding: 4px 2px;
  border: 1.5px solid #bfd6dc; border-radius: 16px; background: #fff; color: #3d5a62;
  font-size: 12px; font-weight: 700; cursor: pointer; -webkit-tap-highlight-color: transparent;
}
.hc-kind.on { border-color: var(--primary, #0e7490); background: #ecfeff; color: var(--primary, #0e7490); }
.hc-list { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; }
.hc-list-month { font-size: 11.5px; font-weight: 800; color: #4c6a72; padding: 10px 2px 4px; }
.hc-list-row {
  display: flex; align-items: center; gap: 8px; min-height: 48px; padding: 6px 10px; margin-bottom: 6px;
  border: 1px solid #d6e6ea; border-radius: 10px; background: #fff; text-align: left; cursor: pointer; font: inherit;
  -webkit-tap-highlight-color: transparent;
}
.hc-list-date { flex-shrink: 0; width: 76px; white-space: nowrap; font-size: 13px; font-weight: 800; color: #12303a; }
.hc-list-kind { flex-shrink: 0; display: inline-flex; align-items: center; gap: 3px; font-size: 12px; font-weight: 700; color: #3d5a62; }
.hc-list-info { flex: 1; min-width: 0; font-size: 12px; color: #4c6a72; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hc-list-amt { flex-shrink: 0; font-size: 12px; font-weight: 700; color: #1f3d45; }
.hc-list-arrow { flex-shrink: 0; color: #bfd6dc; font-size: 16px; }

.hc-nav { flex-shrink: 0; display: flex; align-items: center; gap: 8px; }
.hc-nav-btn { border: 1.5px solid #d1d5db; background: #fff; border-radius: 8px; width: 34px; height: 34px; font-size: 18px; color: #4b5563; cursor: pointer; flex-shrink: 0; display: grid; place-items: center; padding: 0; }
.hc-nav-btn:active { background: #ecfeff; }
.hc-month { flex: 1; text-align: center; font-weight: 700; font-size: 16px; color: #1f2937; }


/* 星の凡例。マスの星は色だけで種別を表すので、その対応をここで一度だけ示す */
.hc-key { flex-shrink: 0; display: flex; align-items: center; flex-wrap: wrap; gap: 4px 12px; margin: -2px 0 -2px; }
.hc-key-i { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 700; color: #4c6a72; }
.hc-key-hint { margin-left: auto; font-size: 11px; font-weight: 600; color: #7d969c; }

/* 実績マーカーは★（星）。glyphで描画（Safariの clip-path+transform 不具合を回避）。色は種別ごと */
.dot { display: inline-block; font-size: 10px; line-height: 1; color: #7d969c; }
.dot::before { content: '★'; display: block; }
.dot-stock { color: #0891b2; }
.dot-order { color: #f59e0b; }
.dot-in    { color: #10b981; }
.dot-out   { color: #ef4444; }
/* やることのある日（未完了）：マスの左上に件数の小さな印（User 2026-10-05。以前は下の短い線） */
.hc-task-mark, .hc-task-key {
  min-width: 12px; height: 12px; padding: 0 2px; border-radius: 6px; box-sizing: border-box;
  background: #d97706; color: #fff; font-size: 8.5px; font-weight: 800; line-height: 12px; text-align: center;
}
/* 2桁の日付に重ならないよう、角に寄せて小さく */
.hc-task-mark { position: absolute; top: 2px; left: 1px; }
.hc-task-key { display: inline-block; }

/* 横スワイプはこの要素が受け持つ（pan-y = 縦だけブラウザに任せる）。
   宣言しないと Android Chrome が同じ指の動きを『進む・戻る』のエッジ操作として
   一緒に処理し、履歴が1つ余分に進む。この画面は戻るを履歴で受けているので、
   受け皿を横取りされてアプリごと閉じる。overscroll-behavior-x でも同じ操作を止める。 */
.hc-cal { flex: 1; min-height: 0; display: flex; flex-direction: column; background: #fff; border-radius: 12px; padding: 8px; border: 1.5px solid #bfd6dc; box-shadow: 0 2px 6px rgba(15,23,42,0.08); overflow: hidden; touch-action: none; overscroll-behavior: contain; }
.hc-dow-row { flex-shrink: 0; display: grid; grid-template-columns: repeat(7, 1fr); margin-bottom: 4px; }

/* 月移動のスライドアニメーション（キー変更で再マウント → 再生）*/
.hc-weeks { flex: 1; min-height: 0; display: flex; flex-direction: column; border-top: 1px solid #dfe4ea; border-left: 1px solid #dfe4ea; border-radius: 8px; overflow: hidden; animation-duration: 0.22s; animation-timing-function: ease-out; }
.hc-weeks.anim-next { animation-name: hcSlideNext; }
.hc-weeks.anim-prev { animation-name: hcSlidePrev; }
/* 月は縦に送る：次の月は下から、前の月は上から入る */
@keyframes hcSlideNext { from { transform: translateY(22%); opacity: 0.25; } to { transform: none; opacity: 1; } }
@keyframes hcSlidePrev { from { transform: translateY(-22%); opacity: 0.25; } to { transform: none; opacity: 1; } }
/* 前後の月のぞかせ：ふだんは薄く、その向きに引くと濃く大きくなる（--peek: 0〜1） */
.hc-peek {
  flex-shrink: 0; display: flex; align-items: center; justify-content: center; gap: 4px; width: 100%;
  height: calc(18px + var(--peek, 0) * 14px); border: none; background: none; cursor: pointer; font: inherit;
  font-size: 11px; font-weight: 800; color: var(--primary); opacity: calc(0.38 + var(--peek, 0) * 0.62);
  transition: height .2s ease, opacity .2s ease;
}
.hc-peek.top { margin: -4px 0 2px; }
.hc-peek.bottom { margin: 2px 0 -4px; }
.hc-dow { text-align: center; font-size: 11px; font-weight: 700; color: #9ca3af; padding: 4px 0; }
.hc-dow.sun { color: #ef4444; }
.hc-dow.sat { color: #0891b2; }

/* 週の行は残りの高さを等分する。min-height はタップ領域（44px）の下限、
   max-height は縦に長いPC窓でマスが間延びしないための上限 */
.hc-week { flex: 1; min-height: 44px; max-height: 110px; display: grid; grid-template-columns: repeat(7, 1fr); }
/* 高さは週の行から受け取る（aspect-ratio で決めると画面の高さに合わせられない）。
   overflow: hidden = 祝日名が狭いマスに収まらないとき隣へはみ出させずに切る。
   マス内の目印（天気・やること・メモ・連休の下線）はすべてこの枠の内側にある */
.hc-cell { position: relative; overflow: hidden; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; padding: 6px 1px 5px; border-right: 1px solid #dfe4ea; border-bottom: 1px solid #dfe4ea; }
.hc-cell.empty { background: #fafbfc; }
.hc-cell.tappable { cursor: pointer; }
.hc-cell.tappable:active { background: #ecfeff; }
.hc-cell.today { box-shadow: inset 0 0 0 2px #111827; }        /* 今日＝黒枠 */
.hc-cell.selected { background: var(--primary-weak); box-shadow: inset 0 0 0 2px var(--primary); }  /* 選択中＝青枠（今日より優先）*/
.hc-day { font-size: 14px; font-weight: 600; color: #374151; line-height: 1; }
.hc-day.sun { color: #ef4444; }
.hc-day.sat { color: #0891b2; }
.hc-wx { position: absolute; top: 3px; right: 4px; font-size: 11px; line-height: 1; }
/* マスの星は「その日に何をしたか」だけを示す（件数・金額は日をタップした詳細で読む）。
   4つでも横1列（User 2026-10-05）。4つの日だけ少し小さくして、狭いマスにも収める */
.hc-dots { margin-top: auto; display: flex; gap: 3px; justify-content: center; }
/* セルの実績スターはゲーム風: 発光＋光沢＋3D回転（コインのように自軸で回る）＋わずかな点滅 */
.hc-dots .dot {
  font-size: 15px;
  filter: drop-shadow(0 0 2px currentColor);
  text-shadow: 0 -0.5px 0 rgba(255,255,255,0.85), 0 1px 1px rgba(0,0,0,0.25);
  transform-style: preserve-3d;
  animation: hcStarSpin 2.6s linear infinite, hcStarTwinkle 2.4s ease-in-out infinite;
  will-change: transform, opacity;
}
/* 複数の星は位相をずらして波打つように回す */
.hc-dots .dot:nth-child(2) { animation-delay: -0.65s, 0s; }
.hc-dots .dot:nth-child(3) { animation-delay: -1.3s, 0s; }
.hc-dots .dot:nth-child(4) { animation-delay: -1.95s, 0s; }
.hc-dots.dots-4 { gap: 1px; }
.hc-dots.dots-4 .dot { font-size: 10.5px; }
@keyframes hcStarSpin { from { transform: perspective(100px) rotateY(0); } to { transform: perspective(100px) rotateY(360deg); } }
@keyframes hcStarTwinkle { 0%, 100% { opacity: 1; } 50% { opacity: 0.82; } }
/* 注: 実績スターの回転は演出として常時再生する（端末の「視差効果を減らす」設定でも止めない） */

/* 祝日名。日付のすぐ下に小さく1行で置く。2行にすると星の位置を押し下げてしまうので、
   入り切らない名前（勤労感謝の日など・狭い端末）は末尾を … で切る */
.hc-hol-name {
  font-size: 8px; font-weight: 700; line-height: 1.2; color: #dc2626; letter-spacing: -0.3px;
  text-align: center; margin-top: 1px; width: 100%;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

/* 暦の需要要因レイヤー（帯＝背景）。祝前日の下線・給料日・五十日の印はマスに出さない（User 2026-10-05） */
.hc-cell.band-holiday:not(.today):not(.selected) { background: #fef2f2; }  /* 祝日 薄赤 */
.hc-cell.band-span:not(.today):not(.selected)    { background: #f5f3ff; }  /* お盆・年末年始 薄紫 */
.hc-cell.band-season:not(.today):not(.selected)  { background: #effdfa; }  /* 長期休暇 薄ティール */
.hc-cell.band-long:not(.today):not(.selected)    { background: #fffbeb; }  /* 連休 薄アンバー */
/* 連休（3連休以上）の連結アンダーライン。隣接セルと繋がり、連休の端を丸める */
.hc-run { position: absolute; left: 0; right: 0; bottom: 1px; height: 4px; background: #ec4899; z-index: 1; }
.hc-run.capL { left: 3px; border-top-left-radius: 3px; border-bottom-left-radius: 3px; }
.hc-run.capR { right: 3px; border-top-right-radius: 3px; border-bottom-right-radius: 3px; }
.hc-day.hol { color: #dc2626; font-weight: 700; }
.hc-note-mark { position: absolute; bottom: 2px; right: 3px; font-size: 9px; line-height: 1; }
/* 発注予定はマスの左端の帯。実績（★）と同じ形にすると「発注した日」と読めてしまうので、
   星ではなく帯にして、予定と実績を形で見分けられるようにする。色は発注の橙に揃える */

.hc-sheet-factors { display: flex; flex-wrap: wrap; gap: 6px; margin: -2px 0 8px; }
.hc-fchip { font-size: 11px; font-weight: 700; border-radius: 20px; padding: 2px 9px; }
.hc-fchip.f-holiday { background: #fef2f2; color: #dc2626; }
.hc-fchip.f-span    { background: #f5f3ff; color: #7c3aed; }
.hc-fchip.f-season  { background: #effdfa; color: #0f766e; }
.hc-fchip.f-long    { background: #fffbeb; color: #b45309; }
.hc-fchip.f-pay     { background: #ecfdf5; color: #047857; }
.hc-fchip.f-pension { background: #ecfeff; color: #155e75; }
.hc-fchip.f-weekday { background: #edf5f7; color: #3d5a62; }

/* この日の基本情報・比較 */
.hc-facts { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 12px; margin-bottom: 10px; }
.hc-fact { display: flex; align-items: baseline; gap: 6px; font-size: 12px; }
.hc-fact-k { color: #7d969c; font-weight: 700; flex-shrink: 0; min-width: 48px; }
.hc-fact-v { color: #1f3d45; font-weight: 600; }

/* 発注予定（詳細モーダル）*/

/* 日別メモ */
.hc-memo { background: #fafaf9; border: 1px solid #eef0f2; border-radius: 10px; padding: 10px; margin-bottom: 10px; }
.hc-memo-text { width: 100%; box-sizing: border-box; border: 1px solid #d6e6ea; border-radius: 8px; padding: 7px 9px; font-size: 13px; resize: vertical; font-family: inherit; }
.hc-memo-excl { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #3d5a62; margin: 7px 0; cursor: pointer; }
.hc-memo-excl input { width: 16px; height: 16px; }
.hc-memo-save { border: none; background: var(--primary); color: #fff; border-radius: 8px; padding: 7px 16px; font-size: 13px; font-weight: 800; cursor: pointer; }

/* 選択日の詳細。枠・余白・せり上がりは共通の .modal-sheet（style.css）に任せる */
.hc-day-close { width: 100%; margin-top: 12px; }
.hc-sheet-head { display: flex; align-items: center; gap: 8px; padding-bottom: 8px; border-bottom: 1px solid #eef0f2; margin-bottom: 8px; }
.hc-sheet-date { font-weight: 700; font-size: 15px; color: #1f2937; }
.hc-sheet-wx { font-size: 12px; color: #6b7280; }
.hc-sheet-close { margin-left: auto; border: none; background: none; font-size: 15px; color: #9ca3af; cursor: pointer; padding: 2px 6px; }

.hc-sec-title { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 700; color: #6b7280; margin: 10px 0 6px; }
.hc-sec-title:first-of-type { margin-top: 2px; }
.hc-sec-total { margin-left: auto; font-size: 13px; font-weight: 800; color: #1f2937; }

.hc-entry { border: 1px solid #eef0f2; border-radius: 10px; margin-bottom: 6px; overflow: hidden; }
.hc-entry-stock { cursor: pointer; }
.hc-entry-stock:active { background: #ecfeff; }
.hc-entry-main { display: flex; align-items: center; gap: 8px; padding: 10px 12px; }
.hc-entry-time { font-size: 12px; color: #6b7280; flex-shrink: 0; }
.hc-order-sup { font-size: 14px; font-weight: 700; color: #374151; }
.hc-entry-info { font-size: 13px; color: #4b5563; }
.hc-entry-amt { margin-left: auto; font-size: 13px; font-weight: 700; color: #1f2937; flex-shrink: 0; white-space: nowrap; }
.hc-entry-amt.none { font-size: 11px; font-weight: 600; color: #9ca3af; }
.hc-entry-arrow { font-size: 12px; color: #9ca3af; flex-shrink: 0; }
.hc-entry-order .hc-entry-main,
.hc-entry-move .hc-entry-main { cursor: pointer; }
.hc-move-note { flex: 1; min-width: 0; font-size: 11px; color: #6b7280; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hc-entry-imported { font-size: 10px; font-weight: 700; color: #3d5a62; background: #edf5f7; border: 1px solid #bfd6dc; border-radius: 10px; padding: 1px 7px; flex-shrink: 0; }
.hc-ord-done { font-size: 10px; font-weight: 700; color: #047857; background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 10px; padding: 1px 7px; flex-shrink: 0; }
.hc-entry-warn { font-size: 11px; color: #b45309; background: #fffbeb; border-top: 1px solid #fde68a; padding: 6px 12px; line-height: 1.5; }
.hc-est-note { font-size: 10.5px; color: #9ca3af; margin: 2px 0 4px; }

.hc-order-lines { border-top: 1px solid #f3f4f6; }
.hc-order-export { display: block; width: calc(100% - 24px); margin: 8px 12px 10px; min-height: 40px; border: 1px solid var(--primary-border, #a5f3fc); border-radius: 10px; background: var(--primary-weak, #ecfeff); color: var(--primary, #0e7490); font-size: 13px; font-weight: 800; cursor: pointer; }
.hc-order-line { display: flex; justify-content: space-between; padding: 6px 12px; font-size: 13px; color: #4b5563; border-top: 1px solid #f6fafb; }

.hc-empty { padding: 20px; text-align: center; color: #9ca3af; font-size: 13px; }
</style>
