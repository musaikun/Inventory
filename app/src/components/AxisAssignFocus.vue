<script setup>
import { ref, reactive, computed, watch, nextTick, onUnmounted } from 'vue'
import { useConfig } from '../composables/useConfig.js'
import { useHistory } from '../composables/useHistory.js'
import { useRowHideSwipe, REVEAL_AT } from '../composables/useRowHideSwipe.js'
import { registerInnerLayerCloser } from '../composables/appMenuState.js'

const props = defineProps({ initialAxis: { type: Number, default: 0 } })
const emit = defineEmits(['close', 'hide-item', 'unhide-item'])

const {
  config, addAxisGroup, renameAxisGroup, removeAxisGroup, restoreAxisGroup,
  addItemToGroup, removeItemFromGroup, setAxisGroupOrder,
} = useConfig()
const { getSnapshots } = useHistory()

const reduceMotion = typeof matchMedia === 'function'
  && matchMedia('(prefers-reduced-motion: reduce)').matches

// ── 対象の軸（分類）─────────────────────────────────────────
const namedAxes = computed(() => {
  const names = config.axisNames ?? ['', '']
  const out = []
  if (names[0]) out.push({ index: 0, name: names[0] })
  if (names[1]) out.push({ index: 1, name: names[1] })
  return out
})
const activeAxis = ref(props.initialAxis ?? 0)
watch(namedAxes, arr => {
  if (!arr.some(a => a.index === activeAxis.value)) activeAxis.value = arr[0]?.index ?? 0
}, { immediate: true })

const tagMap  = computed(() => activeAxis.value === 0 ? (config.tagsA ?? {}) : (config.tagsB ?? {}))
const defined = computed(() => activeAxis.value === 0 ? (config.axisGroupsA ?? []) : (config.axisGroupsB ?? []))
const groups  = computed(() => {
  const set = new Set(defined.value)
  for (const v of Object.values(tagMap.value)) for (const g of (v || [])) set.add(g)
  const extras = [...set].filter(g => !defined.value.includes(g))
  return [...defined.value, ...extras]
})
function itemGroups(item) { return tagMap.value[item] || [] }

// 非表示品目は振り分け対象外（進捗・プール・件数すべてから除外）
const hiddenSet = computed(() => new Set(config.hiddenItems))
const visibleOrder = computed(() => config.order.filter(i => !hiddenSet.value.has(i)))

const groupCount = computed(() => {
  const m = {}
  for (const g of groups.value) m[g] = 0
  for (const it of visibleOrder.value) for (const g of itemGroups(it)) m[g] = (m[g] || 0) + 1
  return m
})

// ── 進捗（非表示を除いた品目のうち、1つ以上のグループに入っている数）───────
const assignedCount = computed(() => visibleOrder.value.reduce((n, i) => n + (itemGroups(i).length ? 1 : 0), 0))
const total = computed(() => visibleOrder.value.length)
const progressPct = computed(() => total.value ? Math.round(assignedCount.value / total.value * 100) : 0)
const allDone = computed(() => total.value > 0 && assignedCount.value === total.value)

// ── 分類先ホイール（縦回転）────────────────────────────────────
// 実運用で分類先は20件近くある。一覧から選ぶ形だと、選ぶたびに品目一覧との
// 往復が要る。回して選ぶ形にすると往復が消え、いま何に振り分けているかも常に見える。
// 縦にしたのは、19件を横で送るのが現実的でないため（縦は勢いで遠くまで飛ばせる）。
const STEP = 19          // カード1枚あたりの角度
const VISIBLE = 4        // 中央から前後いくつ描くか
const CARD_H = 56
const RADIUS = Math.round((CARD_H / 2) / Math.tan((STEP / 2) * Math.PI / 180))

const pos = ref(0)                                   // 仮想位置。端を持たず、小数＝回転中
function wrapIndex(i, n = groups.value.length) {
  return n > 0 ? ((i % n) + n) % n : -1
}
const targetIdx = computed(() => wrapIndex(Math.round(pos.value)))
const target = computed(() => targetIdx.value >= 0 ? (groups.value[targetIdx.value] ?? '') : '')
const wheelAriaLabel = computed(() => {
  if (!groups.value.length) return '分類先は未設定です'
  if (groups.value.length === 1) return `分類先。現在 ${target.value}`
  return `分類先ホイール。現在 ${target.value}。上下矢印キーで変更`
})

// 開き具合。1で扇状に開き、0で中央へ重なって畳まれる。高さの変化と同じ時間で動かすので
// 開閉が「伸び縮み」ではなく「カードが開く／閉じる」動きに見える。
const fan = ref(1)
const wheelCards = computed(() => {
  const n = groups.value.length
  if (!n) return []
  const out = []
  // 1件だけは同じ名前を上下へ複製しない。2件以上は現在位置の前後に仮想枠を
  // 描き、実際のindexへ剰余で写像することで先頭と末尾をつなぐ。
  // 畳みきった帯では周りのカードが中央へ完全に重なる。透明でも同じ3D位置に居ると
  // 手前後の判定が曖昧になり、中央の件数を押しても後ろのカードへ吸われる。
  // 見えていない間はDOMからも外し、押せる相手を中央の1枚だけにする。
  const single = n === 1 || fan.value <= 0.001
  const base = Math.round(pos.value)
  const from = single ? 0 : -VISIBLE
  const to   = single ? 0 : VISIBLE
  for (let k = from; k <= to; k++) {
    const slot = n === 1 ? 0 : base + k
    const idx = n === 1 ? 0 : wrapIndex(slot, n)
    const name = groups.value[idx]
    const offset = n === 1 ? 0 : slot - pos.value
    const angle = offset * STEP * fan.value
    if (Math.abs(angle) > 62) continue
    const centre = Math.abs(offset) < 0.5
    out.push({
      name, idx, slot, centre,
      count: groupCount.value[name] || 0,
      style: {
        transform: `rotateX(${-angle}deg) translateZ(${RADIUS}px)`,
        opacity: centre ? 1 : Math.max(0, 1 - Math.abs(offset) / (VISIBLE + 0.4)) * fan.value,
        zIndex: 100 - Math.round(Math.abs(offset) * 10),
        // 畳んでいる間、重なって見えない周りのカードは触らせない。中央の1枚だけは常に
        // 押せるままにして、展開しなくても件数から振り分け済みを開けるようにする。
        pointerEvents: centre || fan.value > 0.6 ? 'auto' : 'none',
      },
    })
  }
  return out
})

// 面積は2段階。触った方へ寄せる。
//   band … 品目を入れている時間。分類先は1枚だけ残す
//   open … 分類先を探している時間。探しているのだから広く見せる
// 途中の高さを挟むと、回し終わりに「一度縮んでまた動く」段が増え、どこで
// 止まったのかが読み取りにくい。段は「入れている」「探している」の2つだけにする。
const BAND_H = 56, OPEN_MIN = 196, OPEN_MAX = 336, PANEL_MS = 700
const wheelState = ref('open')                       // 'band' | 'open'
const banded = computed(() => wheelState.value === 'band')
function openHeight() {
  const h = typeof window === 'undefined' ? 640 : window.innerHeight
  return Math.max(OPEN_MIN, Math.min(Math.round(h * 0.54), OPEN_MAX))
}
const wheelH = computed(() => banded.value ? BAND_H : openHeight())

let _fanRaf = 0
function tweenFan(to) {
  cancelAnimationFrame(_fanRaf)
  if (reduceMotion) { fan.value = to; return }
  const from = fan.value, t0 = performance.now(), D = PANEL_MS
  const step = () => {
    const t = Math.min(1, (performance.now() - t0) / D)
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
    fan.value = from + (to - from) * e
    if (t < 1) _fanRaf = requestAnimationFrame(step)
  }
  _fanRaf = requestAnimationFrame(step)
}
function setWheelState(next) {
  if (wheelState.value === next) return
  const wasBand = banded.value
  wheelState.value = next
  if (banded.value !== wasBand) tweenFan(banded.value ? 0 : 1)
}

// 指で回す。慣性が無いと20件近くを探せない。
const PX_PER_CARD = 46
const TAP_SLOP = 7
const FRAME_MS = 1000 / 60
const VELOCITY_WINDOW_MS = 120
const MAX_GLIDE_SPEED = 1.45
const TOUCH_FLING_BOOST = 1.25
const GLIDE_FRICTION = 0.94
let _dragging = false, _vel = 0, _glideRaf = 0
let _wheelPointerId = null, _wheelTapSlot = null, _wheelTravel = 0
let _wheelPointerType = '', _wheelSamples = []
let _countDownY = null                               // 件数buttonを押している間の開始位置
// 中央カードのカウントは「振り分け済みを開く」ボタン。回転にも展開にも食わせない。
const isCountTap = e => !!e.target?.closest?.('.af-gcard.on .af-gcount')
const pointerMatches = (e, id) => id == null || e.pointerId == null || e.pointerId === id
function slotFromTarget(targetEl) {
  const card = targetEl?.closest?.('[data-slot]')
  const slot = Number(card?.getAttribute('data-slot'))
  return Number.isFinite(slot) ? slot : null
}

function wheelEventTime(e) {
  const t = Number(e?.timeStamp)
  return Number.isFinite(t) && t >= 0 ? t : performance.now()
}
function rememberWheelPoint(y, time) {
  if (!Number.isFinite(y)) return
  const previous = _wheelSamples[_wheelSamples.length - 1]
  const t = previous ? Math.max(previous.time, time) : time
  if (previous && previous.y === y && previous.time === t) return
  _wheelSamples.push({ y, time: t })
  const cutoff = t - VELOCITY_WINDOW_MS
  // 窓の直前を1点残す。スマホがpointermoveをまとめて通知しても、窓の端から
  // 指を離すまでの距離を失わず速度へ換算できる。
  while (_wheelSamples.length > 2 && _wheelSamples[1].time < cutoff) _wheelSamples.shift()
}
function estimateWheelVelocity() {
  if (_wheelSamples.length < 2) return 0
  const last = _wheelSamples[_wheelSamples.length - 1]
  const cutoff = last.time - VELOCITY_WINDOW_MS
  let first = _wheelSamples[0]
  for (const sample of _wheelSamples) {
    if (sample.time >= cutoff) { first = sample; break }
  }
  const dt = last.time - first.time
  if (dt < 8) return 0
  const slots = -(last.y - first.y) / PX_PER_CARD
  const boost = _wheelPointerType === 'touch' ? TOUCH_FLING_BOOST : 1
  return Math.max(-MAX_GLIDE_SPEED, Math.min(MAX_GLIDE_SPEED, slots / (dt / FRAME_MS) * boost))
}
function applyWheelPoint(point) {
  const y = Number(point?.clientY)
  if (!Number.isFinite(y)) return
  const previous = _wheelSamples[_wheelSamples.length - 1]
  if (previous) {
    const dy = y - previous.y
    _wheelTravel += Math.abs(dy)
    if (groups.value.length > 1) pos.value -= dy / PX_PER_CARD
  }
  rememberWheelPoint(y, wheelEventTime(point))
  _vel = groups.value.length > 1 ? estimateWheelVelocity() : 0
}
function wheelMovePoints(e) {
  let points = []
  try { points = e.getCoalescedEvents?.() ?? [] } catch (_) { /* 未対応WebView */ }
  if (!points.length) return [e]
  const last = points[points.length - 1]
  return last.clientY === e.clientY && wheelEventTime(last) === wheelEventTime(e)
    ? points
    : [...points, e]
}

function onWheelDown(e) {
  // 押下中に高さまで変えるとpointerup時のhit targetがずれるため、件数buttonでは
  // 回転位置だけを固定し、領域の変更は押し切ってから行う。
  if (isCountTap(e)) { stopWheelAtNearest(); _countDownY = Number(e.clientY); return }
  _countDownY = null
  if (_dragging || e.isPrimary === false) return
  setWheelState('open')
  _dragging = true; _vel = 0
  _wheelPointerId = e.pointerId ?? null
  _wheelPointerType = e.pointerType || 'mouse'
  _wheelSamples = []
  rememberWheelPoint(Number(e.clientY), wheelEventTime(e))
  _wheelTapSlot = slotFromTarget(e.target)
  _wheelTravel = 0
  cancelAnimationFrame(_glideRaf)
  _glideRaf = 0
  if (_wheelPointerId != null) e.currentTarget.setPointerCapture?.(_wheelPointerId)
}
function onWheelMove(e) {
  if (!_dragging || !pointerMatches(e, _wheelPointerId)) return
  if (e.cancelable) e.preventDefault()
  for (const point of wheelMovePoints(e)) applyWheelPoint(point)
}
function finishWheelGesture(e, cancelled) {
  if (!_dragging || !pointerMatches(e, _wheelPointerId)) return
  // pointerupの座標と時刻も速度窓へ入れる。指を止めてから離した場合は慣性を
  // 弱めつつ、pointermoveの最後の1pxだけで全速度が消えるスマホ特有の偏りを避ける。
  if (!cancelled) applyWheelPoint(e)
  const pointerId = _wheelPointerId
  const tapSlot = !cancelled && _wheelTravel <= TAP_SLOP ? _wheelTapSlot : null
  const releaseVelocity = _vel
  _dragging = false
  _wheelPointerId = null
  _wheelPointerType = ''
  _wheelSamples = []
  _wheelTapSlot = null
  _wheelTravel = 0
  try { if (pointerId != null) e.currentTarget.releasePointerCapture?.(pointerId) } catch (_) { /* 既に外れている */ }
  // Pointer Capture中のtapはclickのtargetがstageへ置き換わるため、down時の
  // 物理slotをpointerupで確定する。
  if (tapSlot != null) {
    selectWheelSlot(tapSlot)
    return
  }
  if (cancelled) {
    stopWheelAtNearest()
    return
  }
  _vel = releaseVelocity
  glide()
}
// 件数の押下をclickだけに頼らない。3Dで重ねたカードやPointer Captureが絡むと、
// 端末によってはclickのtargetがstageへ置き換わり、件数buttonまで届かない。
// 押し始めが件数で、指がほとんど動かずに離れたなら、その時点で開く。
function takeCountTap(e) {
  const from = _countDownY
  _countDownY = null
  if (from == null) return false
  const y = Number(e?.clientY)
  return !Number.isFinite(y) || Math.abs(y - from) <= TAP_SLOP
}
function onWheelUp(e) {
  if (takeCountTap(e)) { openAssigned(); return }
  finishWheelGesture(e, false)
}
function onWheelCancel(e) { _countDownY = null; finishWheelGesture(e, true) }

function stopWheelAtNearest() {
  cancelAnimationFrame(_glideRaf)
  _glideRaf = 0
  _vel = 0
  _wheelSamples = []
  pos.value = groups.value.length <= 1 ? 0 : Math.round(pos.value)
}
// 一覧のpointerdownでは回転位置だけを固定する。ここで高さも畳むと、特に
// reduced-motion時に押した行がpointerup前に移動しclickを失う。
function onListPointerDown() {
  if (_dragging) return
  stopWheelAtNearest()
}
function onListCommit() {
  if (_dragging) return
  stopWheelAtNearest()
  // 分類先が0件のときは畳まない。畳んでも見せる1枚が無く、案内だけが潰れる。
  if (groups.value.length) setWheelState('band')
}
function glide() {
  cancelAnimationFrame(_glideRaf)
  if (groups.value.length <= 1) {
    pos.value = 0; _vel = 0; _glideRaf = 0; return
  }
  if (reduceMotion) {
    pos.value = Math.round(pos.value); _vel = 0; _glideRaf = 0; return
  }
  let lastFrame = performance.now()
  const step = now => {
    const elapsed = Number.isFinite(now) ? now - lastFrame : FRAME_MS
    const frameScale = Math.max(0.5, Math.min(2, elapsed / FRAME_MS || 1))
    lastFrame = Number.isFinite(now) ? now : lastFrame + FRAME_MS
    pos.value += _vel * frameScale
    _vel *= Math.pow(GLIDE_FRICTION, frameScale)
    if (Math.abs(_vel) < 0.008) {                    // 止まりかけたら一番近い枠へ吸い付く
      const snap = Math.round(pos.value)
      const snapRate = 1 - Math.pow(1 - 0.28, frameScale)
      pos.value += (snap - pos.value) * snapRate
      if (Math.abs(snap - pos.value) < 0.002) {
        pos.value = snap; _vel = 0; _glideRaf = 0; return
      }
    }
    _glideRaf = requestAnimationFrame(step)
  }
  _glideRaf = requestAnimationFrame(step)
}
// 狙った枠へ回す。慣性に任せると行き過ぎるので、距離を詰める形で寄せて必ずそこで止める。
function spinTo(slot) {
  cancelAnimationFrame(_glideRaf)
  _glideRaf = 0
  _vel = 0
  if (groups.value.length <= 1) { pos.value = 0; return }
  const dest = slot
  if (reduceMotion) { pos.value = dest; return }
  const step = () => {
    pos.value += (dest - pos.value) * 0.18
    if (Math.abs(dest - pos.value) < 0.002) {
      pos.value = dest; _glideRaf = 0; return
    }
    _glideRaf = requestAnimationFrame(step)
  }
  _glideRaf = requestAnimationFrame(step)
}
function selectWheelSlot(slot) {
  setWheelState('open')
  if (!Number.isFinite(slot) || Math.abs(slot - pos.value) < 0.002) return
  spinTo(slot)
}
// 中央以外をタップしたらそこまで回す（1枚ずつ送らせない）
function onWheelClick(e) {
  if (isCountTap(e)) { openAssigned(); return }
  const slot = slotFromTarget(e.target)
  if (slot != null) selectWheelSlot(slot)
}
function onWheelKeydown(e) {
  if (e.target !== e.currentTarget || !['ArrowUp', 'ArrowDown'].includes(e.key)) return
  e.preventDefault()
  selectWheelSlot(Math.round(pos.value) + (e.key === 'ArrowUp' ? -1 : 1))
}
watch(activeAxis, () => {
  stopWheelAtNearest()
  pos.value = 0; search.value = ''; setWheelState('open')
})

// ── 品目プール ──────────────────────────────────────────────
const search = ref('')
const unassignedOnly = ref(false)
const usedOnly = ref(false)        // 直近の棚卸で入力があった品目だけ
const neverUsedOnly = ref(false)   // 逆に、一度も入力の無い品目だけ（非表示にする候補を探す用）
// 「前回入力のみ」と「未使用のみ」は互いに素なので、片方を押したらもう片方を降ろす
function toggleUsedOnly()      { usedOnly.value = !usedOnly.value; if (usedOnly.value) neverUsedOnly.value = false }
function toggleNeverUsedOnly() { neverUsedOnly.value = !neverUsedOnly.value; if (neverUsedOnly.value) usedOnly.value = false }
function clearSearch() { search.value = ''; nextTick(() => searchEl.value?.focus()) }
const searchEl = ref(null)
const USAGE = 3
const usage = computed(() => {
  const m = {}
  for (const s of getSnapshots().slice(0, USAGE)) for (const it of (s.items || [])) {
    if (it.qty !== null && it.qty !== undefined) m[it.item] = (m[it.item] || 0) + 1
  }
  return m
})
const hasUsage = computed(() => Object.keys(usage.value).length > 0)
const _norm = s => (s || '').normalize('NFKC').toLowerCase()

const poolItems = computed(() => {
  const q = _norm(search.value.trim())
  let arr = config.order.filter(i =>
    !hiddenSet.value.has(i) &&
    (!q || _norm(i).includes(q)) &&
    (!usedOnly.value || usage.value[i] > 0) &&
    (!neverUsedOnly.value || !usage.value[i]) &&
    (!unassignedOnly.value || itemGroups(i).length === 0)
  )
  // 振り分け状態では並べ替えない（タップした品目がその場から動かないように）。
  // 使用頻度のみで安定ソート（頻度は棚卸履歴由来でセッション中は不変＝並びが動かない）。
  arr = [...arr].sort((a, b) => (usage.value[b] ?? 0) - (usage.value[a] ?? 0))
  return arr
})

// タップで所属トグル＋フィードバック
const flash = ref('')
const flashItem = ref('')
let _flashT = null
function toggle(item) {
  if (consumeClick()) return                                     // 直前がスワイプ操作
  if (swipeItem.value === item && swipeDx.value < 0) { resetSwipe(); return }  // 開いている→タップで閉じる
  if (_dragging) return
  stopWheelAtNearest()
  const destination = target.value
  if (!destination) { _showFlash('先に分類先を作ってください', ''); return }
  setWheelState('band')
  if (itemGroups(item).includes(destination)) {
    removeItemFromGroup(activeAxis.value, item, destination)
    _showFlash(`「${item}」を ${destination} から外しました`, '')
  } else {
    addItemToGroup(activeAxis.value, item, destination)
    _showFlash(`「${item}」を ${destination} に追加`, item)
  }
}
function _showFlash(msg, item) {
  flash.value = msg
  flashItem.value = item
  clearTimeout(_flashT)
  _flashT = setTimeout(() => { flash.value = ''; flashItem.value = '' }, 1100)
}

// ── 一覧から非表示にする（行の左スワイプ）──────────────────────
// 操作は棚卸の表とまったく同じ（useRowHideSwipe）。実際の hide/unhide は App 側の
// 既存の onHideItem / onUnhideItem へ渡す。D1 保存・同期・ゲスト側への反映を、
// 他の非表示導線とまったく同じ経路に乗せるため。
function hideFromPool(item) {
  emit('hide-item', item)
  _offerUndo(`「${item}」を一覧から非表示にしました`, '棚卸の一覧と進捗からも外れます', () => {
    emit('unhide-item', item)
    _showFlash(`「${item}」を一覧に戻しました`, '')
  })
}

const {
  swipeItem, swipeDx, swipeDragging, swipeFull, swipeActionW, swipeActionColor,
  hideDialogItem,
  onRowTouchStart, onRowTouchMove, onRowTouchEnd, onRowTouchCancel,
  openHideDialog, confirmHideDialog, cancelHideDialog, consumeClick, resetSwipe,
} = useRowHideSwipe({ onHide: hideFromPool })

// ── 振り分け済みの確認（中央カードのカウントから開く）＋逆引き ─────────
// 件数を持っている場所が、そのまま中身を開く入口になる。
const listEl = ref(null)
const showAssigned = ref(false)
// 件数は畳んだ帯でも押せる。ここで面積を広げると、シートを閉じた後に品目一覧の
// 位置が変わり、次に押す行を探し直すことになるので、回転だけ止めて開く。
function openAssigned() {
  stopWheelAtNearest()
  showAssigned.value = true
}
const assignedItems = computed(() =>
  target.value ? config.order.filter(i => !hiddenSet.value.has(i) && itemGroups(i).includes(target.value)) : []
)
const locateName = ref('')
let _locateT = null
function locate(item) {
  showAssigned.value = false
  search.value = ''
  unassignedOnly.value = false
  usedOnly.value = false
  neverUsedOnly.value = false
  if (hasGenres.value) openCat[config.categories?.[item] || 'その他'] = true
  locateName.value = item
  clearTimeout(_locateT)
  _locateT = setTimeout(() => { locateName.value = '' }, 1600)
  nextTick(() => {
    const sc = listEl.value
    if (!sc) return
    for (const el of sc.querySelectorAll('[data-item]')) {
      if (el.getAttribute('data-item') === item) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); break }
    }
  })
}
// シートから振り分けを外す。外すと一覧のどこにあるか分からなくなるので戻り道を出す。
function unassign(item) {
  const g = target.value
  if (!g) return
  removeItemFromGroup(activeAxis.value, item, g)
  _offerUndo(`「${item}」を ${g} から外しました`, '', () => {
    addItemToGroup(activeAxis.value, item, g)
  })
}

// ── 取り消し（Undo）──────────────────────────────────────────────
// グループ削除も品目の非表示も、確認だけでは戻せない操作。
// 押し間違えたときの戻り道を、その場（画面下）に置く。
const undoState = ref(null)     // { msg, sub, undo }
const UNDO_MS = 9000
let _undoT = null
function _offerUndo(msg, sub, undo) {
  undoState.value = { msg, sub, undo }
  clearTimeout(_undoT)
  _undoT = setTimeout(() => { undoState.value = null }, UNDO_MS)
}
function dismissUndo() { clearTimeout(_undoT); undoState.value = null }
function runUndo() {
  const s = undoState.value
  if (!s) return
  dismissUndo()
  s.undo()
}
watch(activeAxis, dismissUndo)

// ── 分類先の1枚だけの操作（ホイール隣のレール）────────────────────
// ⚙ の一括編集は「まとめて直す」場所。振り分けの途中で気づいた1枚は、ここで足す・消す。
const addOpen = ref(false)
const newName = ref('')
const addError = ref('')
const addInputEl = ref(null)
function openAdd() {
  stopWheelAtNearest()
  newName.value = ''
  addError.value = ''
  addOpen.value = true
  nextTick(() => addInputEl.value?.focus())
}
function closeAdd() { addOpen.value = false; newName.value = ''; addError.value = '' }
function submitNew() {
  const n = newName.value.trim()
  if (!n) return
  // addAxisGroup は同名を黙って捨てるため、ここで気づけるようにする
  if (groups.value.includes(n)) { addError.value = 'その名前は既に使われています'; return }
  addAxisGroup(activeAxis.value, n)
  closeAdd()
  nextTick(() => {                       // 足した1枚を中央へ持ってくる
    const at = groups.value.indexOf(n)
    if (at >= 0) pos.value = at
    setWheelState('open')
  })
  _showFlash(`分類先「${n}」を追加しました`, '')
}

const delTarget = ref('')
function askDelete(g) {
  stopWheelAtNearest()
  if (g) delTarget.value = g
}
function cancelDelete() { delTarget.value = '' }
function confirmDelete() {
  const g = delTarget.value
  delTarget.value = ''
  if (!g) return
  // 消す前に「戻すのに要るもの」を控える。振り分け済みの品目も、一覧での位置も
  // 削除で失われるため、ここで取らないと元に戻せない。
  const snapshot = {
    axis: activeAxis.value,
    name: g,
    index: defined.value.indexOf(g),
    wheelIndex: groups.value.indexOf(g),
    items: config.order.filter(i => itemGroups(i).includes(g)),
  }
  const previousTarget = target.value
  cancelAnimationFrame(_glideRaf)
  _glideRaf = 0
  _vel = 0
  removeAxisGroup(activeAxis.value, g)
  // 仮想位置は循環用なので、削除後はいったん実indexへ戻す。見ていた分類先が
  // 残っていれば維持し、中央を消した場合は同じ位置に詰まった次の分類先を選ぶ。
  const kept = groups.value.indexOf(previousTarget)
  pos.value = kept >= 0 ? kept : Math.max(0, wrapIndex(snapshot.wheelIndex, groups.value.length))
  setWheelState('open')
  const n = snapshot.items.length
  _offerUndo(`「${g}」を削除しました`, n ? `品目 ${n} 件の振り分けも解除` : '', () => {
    restoreAxisGroup(snapshot.axis, snapshot.name, snapshot.index, snapshot.items)
    _showFlash(n ? `「${snapshot.name}」を戻しました（品目 ${n} 件の振り分けも復元）`
                 : `「${snapshot.name}」を戻しました`, '')
  })
}

// ── 分類先の一括編集（⚙）──────────────────────────────────────
// 20件近い順番の入れ替えは、回しながらより一覧のほうが確実。追加・名前変更・削除・
// 並べ替えをここ1枚にまとめ、ホイールは「回して選ぶ」だけにする。
const editOpen = ref(false)
const editEl = ref(null)
const editDoneEl = ref(null)
const editTriggerEl = ref(null)
const editReturn = ref('')      // 開いた時に中央だった分類先。閉じるときそこへ戻す
function openEdit() {
  stopWheelAtNearest()
  // 割り当てだけで現れているグループ（定義リストに無い分）を先に取り込む。
  // setAxisGroupOrder は定義済みの並べ替えしか受け付けないため、
  // これをやらないと一部のカードだけ動かせない一覧になる。
  for (const g of groups.value) if (!defined.value.includes(g)) addAxisGroup(activeAxis.value, g)
  editReturn.value = target.value
  editOpen.value = true
  nextTick(() => editDoneEl.value?.focus())
}
function closeEdit() {
  if (_dragRow) onHandleUp()
  editOpen.value = false
  const i = groups.value.indexOf(editReturn.value)      // 順番が変わっていても見ていた1枚へ戻す
  pos.value = i >= 0 ? i : 0
  nextTick(() => editTriggerEl.value?.focus())
}
function trapEditFocus(e) {
  if (!editOpen.value || e.key !== 'Tab') return
  const focusable = [...(editEl.value?.querySelectorAll(
    'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])'
  ) ?? [])].filter(el => !el.closest('[inert]'))
  if (!focusable.length) return
  const first = focusable[0], last = focusable[focusable.length - 1]
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault(); last.focus()
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault(); first.focus()
  }
}

const renameTarget = ref('')
const renameText = ref('')
const renameError = ref('')
const renameInputEl = ref(null)
function openRename(g) {
  renameTarget.value = g
  renameText.value = g
  renameError.value = ''
  nextTick(() => renameInputEl.value?.focus())
}
function closeRename() { renameTarget.value = ''; renameText.value = ''; renameError.value = '' }
function submitRename() {
  const n = renameText.value.trim()
  const old = renameTarget.value
  if (!n || n === old) { closeRename(); return }
  if (!renameAxisGroup(activeAxis.value, old, n)) { renameError.value = 'その名前は既に使われています'; return }
  if (editReturn.value === old) editReturn.value = n
  closeRename()
}

// つまみ（⋮⋮）を掴んで並べ替え。行そのものを掴ませると縦スクロールと取り合いになるので、
// つまみだけ touch-action: none にしてここでジェスチャを引き取る。
const FLIP_MS = 620
const FLIP_EASE = 'cubic-bezier(.4, 0, .2, 1)'
const FLIP_MS_REDUCED = 180                 // 「視差効果を減らす」でも 0 にはしない。
const FLIP_EASE_REDUCED = 'linear'          // どの行がどこへ動いたかは飾りではなく情報のため
const DROP_MS = 280
const DROP_EASE = 'cubic-bezier(.22, .8, .28, 1)'

const editListEl = ref(null)
let _dragRow = null, _dragCaptureEl = null, _dragPointerId = null, _dragY0 = 0, _dragOrder = null
const _rowShift = new WeakMap()
const _shiftAnimations = new Set()

function onHandleDown(e) {
  const handle = e.target.closest('.af-ehandle')
  if (!handle || _dragRow || e.isPrimary === false) return
  const row = handle.closest('.af-erow')
  if (!row) return
  // 直前のswapでこの行自身がまだ移動中なら、WAAPIのtransformが指追従の
  // inline transformより優先される前に、その補間を終点へ戻す。
  cancelRowShift(row)
  _dragRow = row
  // 動かす行やその子へcaptureを置くと、DOM順を入れ替えた瞬間にスマホが
  // lostpointercaptureを発火し、1段目でドラッグが終わる。移動しない一覧側で捕捉する。
  _dragCaptureEl = editListEl.value
  _dragPointerId = e.pointerId ?? null
  _dragY0 = e.clientY
  _dragOrder = [...groups.value]
  row.classList.add('drag')
  editListEl.value?.classList.add('dragging')
  if (_dragPointerId != null) _dragCaptureEl?.setPointerCapture?.(_dragPointerId)
  navigator.vibrate?.(10)
}
function onHandleMove(e) {
  if (!_dragRow || !pointerMatches(e, _dragPointerId)) return
  if (e.cancelable) e.preventDefault()
  _dragRow.style.transition = 'none'
  _dragRow.style.transform = `translateY(${e.clientY - _dragY0}px)`
  edgeScroll(e.clientY)
  // 掴んだ行は指に追従しているので、指の位置でいちばん上に居るのは常に自分自身。
  // 重なり全部から自分以外の最初の行を選ばないと、入れ替え先が永久に見つからない。
  const over = document.elementsFromPoint(e.clientX, e.clientY)
    .map(el => el.closest?.('.af-erow'))
    .find(r => r && r !== _dragRow)
  if (!over) return
  const rows = [...(editListEl.value?.children ?? [])]
  const from = rows.indexOf(_dragRow), to = rows.indexOf(over)
  if (from < 0 || to < 0) return
  // 触れた時点では入れ替えない。中点を越えてから動かす（触れただけで避けると
  // 「避けすぎ」に見えるうえ、境界で行ったり来たりしてぶれる）。
  const box = over.getBoundingClientRect()
  const mid = box.top + box.height / 2
  if (to > from ? e.clientY < mid : e.clientY > mid) return

  flipRows(() => {
    editListEl.value.insertBefore(_dragRow, from < to ? over.nextSibling : over)
  })
  _dragOrder = [...(editListEl.value?.children ?? [])].map(r => r.dataset.group)
  _dragY0 = e.clientY                      // 入れ替えた行は指の位置へ移っている
  _dragRow.style.transform = ''
  navigator.vibrate?.(6)
}
function onHandleUp(e) {
  if (!_dragRow || (e && !pointerMatches(e, _dragPointerId))) return
  const row = _dragRow
  const captureEl = _dragCaptureEl
  const pointerId = _dragPointerId
  const order = _dragOrder
  row.style.transition = `transform ${reduceMotion ? FLIP_MS_REDUCED : DROP_MS}ms ${reduceMotion ? FLIP_EASE_REDUCED : DROP_EASE}`
  row.style.transform = ''
  row.classList.remove('drag')
  editListEl.value?.classList.remove('dragging')
  _dragRow = null
  _dragCaptureEl = null
  _dragPointerId = null
  _dragOrder = null
  stopEdgeScroll()
  // stateを先に片付ける。release直後のlostpointercaptureが同期発火しても二重確定しない。
  try { if (pointerId != null) captureEl?.releasePointerCapture?.(pointerId) } catch (_) { /* 既に解放済み */ }
  // DOMの並びを先に完成させ、保存は指を離した時に1回だけ行う。ドラッグ中に
  // Vueのkeyed patchを走らせると、周囲のFLIP animationと競合して片方向が飛ぶ。
  if (order && order.join('\u0001') !== groups.value.join('\u0001')) {
    setAxisGroupOrder(activeAxis.value, order)
  }
}

function moveGroupByKeyboard(group, delta) {
  if (_dragRow || !delta) return
  const rows = [...(editListEl.value?.children ?? [])]
  const from = rows.findIndex(row => row.dataset.group === group)
  const to = Math.max(0, Math.min(rows.length - 1, from + delta))
  if (from < 0 || to === from) return
  const row = rows[from]
  const over = rows[to]
  flipRows(() => {
    editListEl.value.insertBefore(row, from < to ? over.nextSibling : over)
  })
  const order = [...editListEl.value.children].map(r => r.dataset.group)
  setAxisGroupOrder(activeAxis.value, order)
  nextTick(() => row.querySelector('.af-ehandle')?.focus())
}
function onHandleKeydown(e, group) {
  if (!['ArrowUp', 'ArrowDown'].includes(e.key)) return
  e.preventDefault()
  e.stopPropagation()
  moveGroupByKeyboard(group, e.key === 'ArrowUp' ? -1 : 1)
}

// 入れ替えを FLIP で見せる。並べ替えは「どれがどこへ動いたか」が分からないと結果を
// 確かめられないので、瞬間移動させず、退く行が滑って場所を空ける。
// 掴んでいる行は指の下に居るべきなので動かさない。
function flipRows(mutate) {
  const rows = [...(editListEl.value?.children ?? [])]
  // 走っているanimation込みの「いま目に見えている位置」を先に取る。DOMを動かした後で
  // 以前のanimationを外し、新しい終点との差を取り直すと、連続swapや反転でも瞬間移動しない。
  const before = new Map(rows.map(r => [r, r.getBoundingClientRect().top]))
  mutate()
  const ms   = reduceMotion ? FLIP_MS_REDUCED : FLIP_MS
  const ease = reduceMotion ? FLIP_EASE_REDUCED : FLIP_EASE
  for (const r of rows) {
    if (r === _dragRow) continue
    cancelRowShift(r)
    const d = before.get(r) - r.getBoundingClientRect().top
    if (!d) continue
    animateRowShift(r, d, ms, ease)
  }
}

function cancelRowShift(row) {
  const animation = _rowShift.get(row)
  if (animation) {
    _rowShift.delete(row)
    _shiftAnimations.delete(animation)
    try { animation.cancel() } catch (_) { /* 既に終了済み */ }
  }
  // Web Animations API が無い環境で使うfallbackのinline styleも終点へ戻す。
  if (row !== _dragRow) {
    row.style.transition = ''
    row.style.transform = ''
  }
}

function animateRowShift(row, delta, ms, ease) {
  const frames = [
    { transform: `translateY(${delta}px)` },
    { transform: 'translateY(0)' },
  ]
  if (typeof row.animate === 'function') {
    const animation = row.animate(frames, { duration: ms, easing: ease })
    if (animation) {
      _rowShift.set(row, animation)
      _shiftAnimations.add(animation)
      const clear = () => {
        if (_rowShift.get(row) === animation) _rowShift.delete(row)
        _shiftAnimations.delete(animation)
      }
      animation.onfinish = clear
      animation.oncancel = clear
    }
    return
  }
  // 古いWebView向けfallback。開始位置を確定してから終点へ補間する。
  row.style.transition = 'none'
  row.style.transform = frames[0].transform
  void row.offsetHeight
  row.style.transition = `transform ${ms}ms ${ease}`
  row.style.transform = frames[1].transform
}

// 20件近くあると、下の行を上まで運ぶのに一覧のスクロールが要る。
const EDGE = 64, EDGE_SPEED = 10
let _edgeRaf = 0, _edgeDir = 0
function edgeScroll(y) {
  const el = editListEl.value
  if (!el) return
  const r = el.getBoundingClientRect()
  _edgeDir = y < r.top + EDGE ? -1 : y > r.bottom - EDGE ? 1 : 0
  if (!_edgeDir) return stopEdgeScroll()
  if (_edgeRaf) return
  const step = () => {
    if (!_dragRow || !_edgeDir) return stopEdgeScroll()
    el.scrollTop += _edgeDir * EDGE_SPEED
    _edgeRaf = requestAnimationFrame(step)
  }
  _edgeRaf = requestAnimationFrame(step)
}
function stopEdgeScroll() { cancelAnimationFrame(_edgeRaf); _edgeRaf = 0; _edgeDir = 0 }

// 戻るは常に「ひとつ前」へ返す。この画面の中にも段があるので、上から順に1段だけ畳む。
//   開いているモーダル → 一括編集 → 画面を閉じて開いた元の画面（データ管理）へ
onUnmounted(registerInnerLayerCloser(() => {
  if (delTarget.value)    { cancelDelete();            return true }
  if (renameTarget.value) { closeRename();             return true }
  if (addOpen.value)      { closeAdd();                return true }
  if (hideDialogItem.value) { cancelHideDialog();      return true }
  if (showAssigned.value) { showAssigned.value = false; return true }
  if (editOpen.value)     { closeEdit();               return true }
  return false
}))
onUnmounted(() => {
  if (_dragRow) onHandleUp()
  _dragging = false
  _wheelPointerId = null
  _wheelPointerType = ''
  _wheelSamples = []
  _wheelTapSlot = null
  _wheelTravel = 0
  _countDownY = null
  _vel = 0
  cancelAnimationFrame(_fanRaf); cancelAnimationFrame(_glideRaf); stopEdgeScroll()
  for (const animation of _shiftAnimations) {
    try { animation.cancel() } catch (_) { /* 既に終了済み */ }
  }
  _shiftAnimations.clear()
  clearTimeout(_flashT); clearTimeout(_undoT); clearTimeout(_locateT)
})

// ── ジャンル別アコーディオン（取込元にジャンルがある場合）───────
const hasGenres = computed(() => Object.keys(config.categories || {}).length > 0)
const groupedPool = computed(() => {
  const map = new Map()
  for (const it of poolItems.value) {
    const cat = config.categories?.[it] || 'その他'
    if (!map.has(cat)) map.set(cat, [])
    map.get(cat).push(it)
  }
  const entries = [...map.entries()].sort(([a], [b]) => {
    if (a === 'その他') return 1
    if (b === 'その他') return -1
    const ca = config.categoryCodes?.[a], cb = config.categoryCodes?.[b]
    if (ca != null && cb != null) return ca - cb
    if (ca != null) return -1
    if (cb != null) return 1
    return a.localeCompare(b, 'ja')
  })
  return entries.map(([cat, items]) => ({ cat, items }))
})
const openCat = reactive({})   // 既定は閉じた状態（未キー=閉）
function toggleCat(c) { openCat[c] = !openCat[c] }
</script>

<template>
  <div class="af">
    <header class="af-head">
      <button class="af-back" @click="emit('close')">‹ 閉じる</button>
      <span class="af-title">{{ namedAxes.find(a => a.index === activeAxis)?.name || '振り分け' }}</span>
    </header>

    <!-- 進捗バー -->
    <div class="af-progress">
      <div class="af-prog-text">
        <span class="af-prog-icon">{{ allDone ? '🎉' : '📦' }}</span>
        <span>振り分け済み <b>{{ assignedCount }}</b> / {{ total }}</span>
        <span v-if="allDone" class="af-done">全部できました！</span>
        <span class="af-prog-pct">{{ progressPct }}%</span>
      </div>
      <div class="af-prog-bar"><div class="af-prog-fill" :class="{ done: allDone }" :style="{ width: progressPct + '%' }"></div></div>
    </div>

    <div v-if="namedAxes.length === 0" class="af-empty">
      分類が未設定です。「品目マスタ管理」で分類を追加してください。
    </div>

    <template v-else>
      <!-- 軸（分類）タブ -->
      <div v-if="namedAxes.length > 1" class="af-tabs">
        <button v-for="a in namedAxes" :key="a.index" :class="['af-tab', { on: activeAxis === a.index }]" @click="activeAxis = a.index">{{ a.name }}</button>
      </div>

      <!-- 分類先ホイール。触った方へ面積を寄せる（回す＝広い／入れる＝帯） -->
      <div
        class="af-wheel"
        :class="{ band: banded, reduced: reduceMotion, empty: !groups.length }"
        :style="{
          height: wheelH + 'px',
          transitionDuration: reduceMotion ? '0ms' : PANEL_MS + 'ms',
          '--af-panel-ms': PANEL_MS + 'ms',
        }"
      >
        <div
          class="af-stage"
          role="group"
          :tabindex="groups.length > 1 ? 0 : -1"
          :aria-label="wheelAriaLabel"
          @pointerdown="onWheelDown"
          @pointermove="onWheelMove"
          @pointerup="onWheelUp"
          @pointercancel="onWheelCancel"
          @lostpointercapture="onWheelCancel"
          @click="onWheelClick"
          @keydown="onWheelKeydown"
          @selectstart.prevent
          @dragstart.prevent
        >
          <div class="af-stage-inner" :style="{ transform: `translateZ(${-RADIUS}px)` }">
            <!-- 円筒ごと半径ぶん奥へ下げる。下げないと中央のカードが手前に出て、
                 遠近法で拡大され左右が見切れる -->
            <div
              v-for="c in wheelCards" :key="c.slot" :data-gidx="c.idx" :data-slot="c.slot" :data-group="c.name"
              class="af-gcard" :class="{ on: c.centre }" :style="c.style"
              :aria-hidden="c.centre ? undefined : 'true'"
            >
              <span class="af-gname">{{ c.name }}</span>
              <button
                class="af-gcount"
                :aria-label="c.centre ? `${c.name} の振り分け済みを見る` : undefined"
                :tabindex="c.centre ? 0 : -1"
              >{{ c.count }}</button>
              <span v-if="c.centre && banded" class="af-gchev">変える ▾</span>
            </div>
          </div>
          <!-- 0件のときは回す物が無い。空の円筒を見せる代わりに、カードが座るはずの
               場所へそのまま置いて作り方を言う。ホイールの場所は「いま何に振り分けて
               いるか」を出す場所なので、まだ無いことも同じ位置で分かるようにする。 -->
          <div v-if="!groups.length" class="af-wheel-empty">
            <span class="af-wheel-empty-title">分類先がまだありません</span>
            <span class="af-wheel-empty-hint">右の「＋」で作ってください</span>
          </div>
          <div class="af-marker"></div>
          <div class="af-fade t"></div>
          <div class="af-fade b"></div>
        </div>
        <div
          class="af-rail"
          :aria-hidden="banded ? 'true' : 'false'" :inert="banded ? '' : null"
        >
          <button class="af-rail-btn" aria-label="分類先を足す" @click="openAdd">＋</button>
          <button ref="editTriggerEl" class="af-rail-btn gear" aria-label="分類先をまとめて編集" @click="openEdit">⚙</button>
          <button class="af-rail-btn del" aria-label="この分類先を消す" :disabled="!target" @click="askDelete(target)">🗑</button>
        </div>
      </div>

      <!-- 品目プール -->
      <div class="af-tools">
        <div class="af-search-wrap">
          <input ref="searchEl" v-model="search" class="af-search" type="text" placeholder="品目を検索" />
          <button v-if="search" class="af-search-x" aria-label="検索文字を消す" @click="clearSearch">✕</button>
        </div>
        <button :class="['af-chip-btn', { on: unassignedOnly }]" @click="unassignedOnly = !unassignedOnly">未振り分けのみ</button>
        <button v-if="hasUsage" :class="['af-chip-btn', { on: usedOnly }]" @click="toggleUsedOnly">前回入力のみ</button>
        <button v-if="hasUsage" :class="['af-chip-btn', { on: neverUsedOnly }]" @click="toggleNeverUsedOnly">未使用のみ</button>
      </div>

      <div
        class="af-list" ref="listEl"
        @pointerdown="onListPointerDown" @click="onListCommit" @scroll.passive="onListCommit"
      >
        <!-- ジャンルがあればアコーディオン、無ければフラット -->
        <template v-if="hasGenres">
          <template v-for="grp in groupedPool" :key="grp.cat">
            <button class="af-cat-head" @click="toggleCat(grp.cat)">
              <span class="af-cat-arrow">{{ openCat[grp.cat] ? '▼' : '▶' }}</span>
              <span class="af-cat-name">{{ grp.cat }}</span>
              <span class="af-cat-count">{{ grp.items.length }}</span>
            </button>
            <template v-if="openCat[grp.cat]">
              <div
                v-for="item in grp.items" :key="item" :data-item="item"
                :class="['af-item', { in: itemGroups(item).includes(target), pop: flashItem === item, locate: locateName === item, 'swipe-dragging': swipeDragging && swipeItem === item }]"
                :style="swipeItem === item ? { transform: `translateX(${swipeDx}px)` } : null"
                role="button" tabindex="0"
                @click="toggle(item)" @keydown.enter.prevent="toggle(item)" @keydown.space.prevent="toggle(item)"
                @touchstart.passive="onRowTouchStart($event, item)"
                @touchmove.passive="onRowTouchMove"
                @touchend="onRowTouchEnd($event)"
                @touchcancel="onRowTouchCancel"
              >
                <span class="af-check">{{ itemGroups(item).includes(target) ? '✓' : '＋' }}</span>
                <span class="af-item-name">{{ item }}</span>
                <span v-if="hasUsage && !usage[item]" class="af-item-unused">未使用</span>
                <span v-if="itemGroups(item).length" class="af-item-tags">
                  <span v-for="g in itemGroups(item)" :key="g" class="af-item-tag" :class="{ cur: g === target }">{{ g }}</span>
                </span>
                <button
                  v-if="swipeItem === item && -swipeDx >= REVEAL_AT"
                  :class="['af-row-action', { full: swipeFull }]"
                  :style="{ transform: `translateX(${-swipeDx}px)`, width: swipeActionW + 'px', background: swipeActionColor }"
                  @click.stop="openHideDialog(item)"
                >{{ swipeFull ? '離すと非表示' : '非表示' }}</button>
              </div>
            </template>
          </template>
        </template>
        <template v-else>
          <div
            v-for="item in poolItems" :key="item" :data-item="item"
            :class="['af-item', { in: itemGroups(item).includes(target), pop: flashItem === item, locate: locateName === item, 'swipe-dragging': swipeDragging && swipeItem === item }]"
            :style="swipeItem === item ? { transform: `translateX(${swipeDx}px)` } : null"
            role="button" tabindex="0"
            @click="toggle(item)" @keydown.enter.prevent="toggle(item)" @keydown.space.prevent="toggle(item)"
            @touchstart.passive="onRowTouchStart($event, item)"
            @touchmove.passive="onRowTouchMove"
            @touchend="onRowTouchEnd($event)"
            @touchcancel="onRowTouchCancel"
          >
            <span class="af-check">{{ itemGroups(item).includes(target) ? '✓' : '＋' }}</span>
            <span class="af-item-name">{{ item }}</span>
            <span v-if="hasUsage && !usage[item]" class="af-item-unused">未使用</span>
            <span v-if="itemGroups(item).length" class="af-item-tags">
              <span v-for="g in itemGroups(item)" :key="g" class="af-item-tag" :class="{ cur: g === target }">{{ g }}</span>
            </span>
            <button
              v-if="swipeItem === item && -swipeDx >= REVEAL_AT"
              :class="['af-row-action', { full: swipeFull }]"
              :style="{ transform: `translateX(${-swipeDx}px)`, width: swipeActionW + 'px', background: swipeActionColor }"
              @click.stop="openHideDialog(item)"
            >{{ swipeFull ? '離すと非表示' : '非表示' }}</button>
          </div>
        </template>
        <div v-if="poolItems.length === 0" class="af-empty">
          {{ unassignedOnly ? '未振り分けの品目はありません 🎉'
           : neverUsedOnly ? '使っていない品目はありません 🎉'
           : '該当する品目がありません。' }}
        </div>
      </div>
    </template>

    <!-- 分類先の一括編集（追加・名前変更・削除・並べ替え）-->
    <div
      ref="editEl" class="af-edit" :class="{ on: editOpen }"
      role="dialog" aria-modal="true" aria-label="分類先の管理"
      :aria-hidden="editOpen ? 'false' : 'true'" :inert="editOpen ? null : ''"
      @keydown="trapEditFocus"
    >
      <header class="af-edit-head">
        <div>
          <div class="af-edit-title">分類先の管理</div>
          <div class="af-edit-sub">{{ groups.length }}件 ・ つまみ ⋮⋮ を掴んで並べ替え</div>
        </div>
        <button ref="editDoneEl" class="af-edit-done" @click="closeEdit">完了</button>
      </header>
      <div class="af-edit-list" ref="editListEl"
           @pointerdown="onHandleDown" @pointermove="onHandleMove"
           @pointerup="onHandleUp" @pointercancel="onHandleUp"
           @lostpointercapture="onHandleUp">
        <div v-for="g in groups" :key="g" :data-group="g" class="af-erow">
          <button
            type="button" class="af-ehandle"
            :aria-label="`${g} を並べ替え。現在 ${groups.indexOf(g) + 1} 番目。上下矢印キーで移動`"
            @keydown="onHandleKeydown($event, g)"
          >⋮⋮</button>
          <span class="af-ename">{{ g }}</span>
          <span class="af-ecount">{{ groupCount[g] || 0 }}</span>
          <button class="af-ebtn" :aria-label="`${g} の名前を変える`" @click="openRename(g)">✎</button>
          <button class="af-ebtn del" :aria-label="`${g} を削除`" @click="askDelete(g)">🗑</button>
        </div>
      </div>
      <div class="af-edit-foot">
        <button class="af-edit-add" @click="openAdd">＋ 分類先を追加</button>
      </div>
    </div>

    <!-- 浅いスワイプで出したアクションを押したときの確認（棚卸の表と同じ） -->
    <div v-if="hideDialogItem" class="af-dialog-bg" @click.self="cancelHideDialog">
      <div class="af-dialog af-hide-dialog" role="dialog" aria-modal="true">
        <div class="af-dialog-title">この品目を非表示にしますか？</div>
        <div class="af-dialog-name">{{ hideDialogItem }}</div>
        <div class="af-dialog-acts">
          <button class="af-dialog-cancel" @click="cancelHideDialog">キャンセル</button>
          <button class="af-dialog-ok danger" @click="confirmHideDialog">非表示にする</button>
        </div>
      </div>
    </div>

    <!-- 分類先を足す -->
    <div v-if="addOpen" class="af-dialog-bg" @click.self="closeAdd">
      <div class="af-dialog" role="dialog" aria-modal="true" aria-label="分類先を追加">
        <div class="af-dialog-title">分類先を追加</div>
        <input ref="addInputEl" v-model="newName" class="af-dialog-input" maxlength="20"
               placeholder="分類先の名前（例：冷蔵庫）"
               @input="addError = ''" @keyup.enter="submitNew" />
        <div v-if="addError" class="af-dialog-err">{{ addError }}</div>
        <div class="af-dialog-acts">
          <button class="af-dialog-cancel" @click="closeAdd">キャンセル</button>
          <button class="af-dialog-ok" :disabled="!newName.trim()" @click="submitNew">追加</button>
        </div>
      </div>
    </div>

    <!-- 名前を変える -->
    <div v-if="renameTarget" class="af-dialog-bg" @click.self="closeRename">
      <div class="af-dialog" role="dialog" aria-modal="true" aria-label="分類先の名前を変える">
        <div class="af-dialog-title">分類先の名前を変える</div>
        <input ref="renameInputEl" v-model="renameText" class="af-dialog-input" maxlength="20"
               @input="renameError = ''" @keyup.enter="submitRename" />
        <div v-if="renameError" class="af-dialog-err">{{ renameError }}</div>
        <div class="af-dialog-acts">
          <button class="af-dialog-cancel" @click="closeRename">キャンセル</button>
          <button class="af-dialog-ok" :disabled="!renameText.trim()" @click="submitRename">変える</button>
        </div>
      </div>
    </div>

    <!-- 分類先を消す -->
    <div v-if="delTarget" class="af-dialog-bg" @click.self="cancelDelete">
      <div class="af-dialog" role="dialog" aria-modal="true">
        <div class="af-dialog-title">「{{ delTarget }}」を消しますか？</div>
        <div class="af-dialog-sub">
          {{ groupCount[delTarget] ? `${groupCount[delTarget]}件の割り当ても外れます` : '割り当てはありません' }}
        </div>
        <div class="af-dialog-acts">
          <button class="af-dialog-cancel" @click="cancelDelete">キャンセル</button>
          <button class="af-dialog-ok danger" @click="confirmDelete">削除する</button>
        </div>
      </div>
    </div>

    <!-- 振り分け済みの確認（中央カードのカウントから開く）-->
    <div v-if="showAssigned" class="af-modal" @click.self="showAssigned = false">
      <div class="af-sheet">
        <div class="af-sheet-head">
          <span class="af-sheet-title">{{ target }} の振り分け済み <b>{{ assignedItems.length }}</b></span>
          <button class="af-sheet-close" @click="showAssigned = false">✕</button>
        </div>
        <div class="af-sheet-hint">タップすると一覧の該当品目へ移動します</div>
        <div class="af-sheet-list">
          <div v-for="item in assignedItems" :key="item" class="af-sheet-item">
            <button class="af-sheet-item-name" @click="locate(item)">{{ item }}</button>
            <button class="af-sheet-off" @click="unassign(item)">外す</button>
            <button class="af-sheet-item-go" @click="locate(item)">確認 ›</button>
          </div>
          <div v-if="assignedItems.length === 0" class="af-empty">まだ振り分けられた品目はありません。</div>
        </div>
      </div>
    </div>

    <!-- 取り消し（削除・非表示は戻せることをその場に出す）-->
    <transition name="af-flash">
      <div v-if="undoState" class="af-undobar">
        <span class="af-undo-msg">
          {{ undoState.msg }}<span v-if="undoState.sub" class="af-undo-sub">{{ undoState.sub }}</span>
        </span>
        <button class="af-undo-btn" @click="runUndo">元に戻す</button>
        <button class="af-undo-x" aria-label="閉じる" @click="dismissUndo">✕</button>
      </div>
    </transition>

    <!-- 追加フィードバック -->
    <transition name="af-flash">
      <div v-if="flash" class="af-flashbar" :class="{ lifted: undoState }">{{ flash }}</div>
    </transition>
  </div>
</template>

<style scoped>
.af { position: fixed; inset: 0; z-index: 60; background: #f8fafc; display: flex; flex-direction: column; overflow: hidden; }
.af-head { display: flex; align-items: center; gap: 10px; padding: 12px 14px; background: #fff; border-bottom: 1px solid #e2e8f0; flex-shrink: 0; }
.af-back { border: none; background: none; color: var(--primary, #2563eb); font-size: 14px; font-weight: 700; cursor: pointer; }
.af-title { font-size: 16px; font-weight: 800; color: #1e293b; }

.af-progress { padding: 10px 14px 8px; background: #fff; border-bottom: 1px solid #eef2f6; flex-shrink: 0; }
.af-prog-text { display: flex; align-items: center; gap: 6px; font-size: 13px; color: #334155; margin-bottom: 6px; }
.af-prog-text b { color: var(--primary, #2563eb); font-size: 15px; }
.af-done { color: #16a34a; font-weight: 800; }
.af-prog-pct { margin-left: auto; font-weight: 800; color: #64748b; }
.af-prog-bar { height: 8px; background: #eef2f6; border-radius: 6px; overflow: hidden; }
.af-prog-fill { height: 100%; background: var(--primary, #2563eb); border-radius: 6px; transition: width 0.35s ease; }
.af-prog-fill.done { background: #16a34a; }

.af-empty { padding: 24px 16px; color: #94a3b8; font-size: 13px; text-align: center; line-height: 1.6; }
/* 0件の案内。中央カードと同じ枠（left/right/top/height）に置き、まだ何も無いことを
   カードが来る場所そのもので伝える。破線にして「空いている枠」と分かるようにする */
.af-wheel-empty {
  position: absolute; left: 16px; right: 16px; top: 50%;
  height: 56px; margin-top: -28px; z-index: 3; pointer-events: none;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
  padding: 0 12px; text-align: center;
  background: #fff; border: 1.5px dashed #cbd5e1; border-radius: 12px;
}
.af-wheel-empty-title { font-size: 14px; font-weight: 800; color: #64748b; }
.af-wheel-empty-hint { font-size: 11px; color: #94a3b8; }
/* 案内の後ろに中央マーカーや端のフェードが残ると、選べる物があるように見える */
.af-wheel.empty .af-marker, .af-wheel.empty .af-fade { opacity: 0; }
.af-tabs { display: flex; gap: 6px; padding: 10px 14px 0; flex-shrink: 0; }
.af-tab { flex: 1; border: 1px solid #e2e8f0; background: #fff; color: #64748b; border-radius: 10px; padding: 9px; font-size: 14px; font-weight: 700; cursor: pointer; }
.af-tab.on { background: var(--primary, #2563eb); color: #fff; border-color: var(--primary, #2563eb); }

/* ── 分類先ホイール ─────────────────────────────────────────────
   横スワイプの取り合いを避けるため、指のジェスチャは touch-action で最初から
   この要素が引き取る。宣言しないと Android Chrome が同じ指の動きを
   「進む・戻る」のエッジ操作としても処理し、履歴を横取りする。 */
.af-wheel {
  flex-shrink: 0; position: relative; background: #fff;
  border-bottom: 1px solid #e2e8f0; overflow: hidden;
  transition-property: height;
  transition-timing-function: cubic-bezier(0.4,0,0.2,1);
}
.af-wheel.reduced { transition-duration: 0ms !important; }
.af-stage {
  position: absolute; inset: 0 64px 0 0;
  perspective: 460px; overflow: hidden;
  touch-action: none; -webkit-tap-highlight-color: transparent;
  transition: right var(--af-panel-ms, 700ms) cubic-bezier(0.4,0,0.2,1);
}
.af-stage, .af-stage * {
  user-select: none; -webkit-user-select: none; -webkit-touch-callout: none;
}
.af-stage:focus-visible { outline: 3px solid var(--primary-border, #bfdbfe); outline-offset: -3px; }
.af-wheel.band .af-stage { right: 0; }
/* 円筒ごと半径ぶん奥へ下げる。下げないと中央のカードが translateZ で手前に来て、
   遠近法で拡大され左右が見切れる。下げると中央が z=0 ＝原寸になる。 */
.af-stage-inner { position: absolute; inset: 0; transform-style: preserve-3d; }

.af-gcard {
  position: absolute; left: 16px; right: 16px; top: 50%;
  height: 56px; margin-top: -28px;
  display: flex; align-items: center; gap: 10px; padding: 0 14px;
  background: #fff; border: 1.5px solid #e2e8f0; border-radius: 12px;
  will-change: transform, opacity; backface-visibility: hidden;
}
.af-gcard.on { border-color: var(--primary, #2563eb); background: var(--primary-weak, #eff6ff); box-shadow: 0 6px 18px rgba(37,99,235,0.18); }
.af-gname { flex: 1; min-width: 0; font-size: 15px; font-weight: 800; color: #1e293b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.af-gcount {
  flex-shrink: 0; min-width: 48px; min-height: 32px; border: none;
  background: #eef2f6; color: #64748b; border-radius: 14px; padding: 2px 12px;
  font-size: 14px; font-weight: 800; -webkit-tap-highlight-color: transparent;
}
/* 中央カードのカウントは押せる。ここから振り分け済みを開く */
.af-gcard.on .af-gcount { background: var(--primary, #2563eb); color: #fff; cursor: pointer; box-shadow: 0 0 0 3px rgba(37,99,235,0.18); }
.af-gcard.on .af-gcount:active { filter: brightness(0.9); }
/* 畳んでいる間、これが「振り分け済みを開く」唯一の入口になる。56pxの帯の中で
   カードのタップ（＝ホイールを開く）と押し分けられるよう、指の当たりを広げる。 */
.af-wheel.band .af-gcard.on .af-gcount { min-height: 44px; padding: 2px 14px; }
.af-gchev { flex-shrink: 0; font-size: 11px; font-weight: 800; color: #64748b; border: 1px solid #e2e8f0; border-radius: 8px; padding: 5px 9px; background: #fff; white-space: nowrap; }

.af-marker { position: absolute; left: 0; right: 0; top: 50%; height: 58px; margin-top: -29px; pointer-events: none; border-top: 1px solid var(--primary-border, #bfdbfe); border-bottom: 1px solid var(--primary-border, #bfdbfe); opacity: 0.5; transition: opacity var(--af-panel-ms, 700ms) cubic-bezier(0.4,0,0.2,1), visibility 0s; }
.af-fade { position: absolute; left: 0; right: 0; height: 34px; pointer-events: none; z-index: 2; opacity: 1; transition: opacity var(--af-panel-ms, 700ms) cubic-bezier(0.4,0,0.2,1), visibility 0s; }
.af-fade.t { top: 0; background: linear-gradient(#fff, rgba(255,255,255,0)); }
.af-fade.b { bottom: 0; background: linear-gradient(rgba(255,255,255,0), #fff); }
.af-wheel.band .af-marker,
.af-wheel.band .af-fade {
  opacity: 0; visibility: hidden;
  transition: opacity var(--af-panel-ms, 700ms) cubic-bezier(0.4,0,0.2,1),
              visibility 0s linear var(--af-panel-ms, 700ms);
}

/* 操作は「今まん中にある1枚」に効く。足すと消すが隣り合わないよう間に ⚙ を置く */
.af-rail {
  position: absolute; top: 0; right: 0; bottom: 0; width: 64px;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
  border-left: 1px solid #eef2f6; background: linear-gradient(90deg, rgba(248,250,252,0), #f8fafc);
  transition: opacity var(--af-panel-ms, 700ms) cubic-bezier(0.4,0,0.2,1);
}
.af-wheel.band .af-rail { opacity: 0; pointer-events: none; }
.af-rail-btn {
  width: 46px; height: 44px; display: flex; align-items: center; justify-content: center;
  border: 1px solid #e2e8f0; background: #fff; border-radius: 10px;
  font-size: 16px; color: #64748b; cursor: pointer; -webkit-tap-highlight-color: transparent;
}
.af-rail-btn:active { background: #f1f5f9; }
.af-rail-btn.gear { font-size: 18px; }
.af-rail-btn.del { border-color: #fecaca; color: #dc2626; }
.af-rail-btn.del:active { background: #fef2f2; }
.af-rail-btn:disabled { opacity: 0.4; }

/* ── 品目プール ─────────────────────────────────────────────── */
.af-tools { display: flex; gap: 8px; padding: 8px 14px; flex-wrap: wrap; flex-shrink: 0; }
.af-search-wrap { position: relative; flex: 1; min-width: 120px; display: flex; }
.af-search { flex: 1; min-width: 0; border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px 38px 10px 12px; font-size: 15px; }
/* 文字が入っているときだけ ✕ を出す（入力中に幅が動かないよう場所は常に取る）*/
.af-search-x {
  position: absolute; right: 4px; top: 50%; transform: translateY(-50%);
  width: 30px; height: 30px; display: flex; align-items: center; justify-content: center;
  border: none; background: #eef2f6; color: #64748b; border-radius: 50%;
  font-size: 11px; cursor: pointer; -webkit-tap-highlight-color: transparent;
}
.af-search-x:active { background: #e2e8f0; }
.af-chip-btn { border: 1px solid #e2e8f0; background: #fff; color: #64748b; border-radius: 10px; font-size: 12px; font-weight: 700; padding: 0 12px; cursor: pointer; }
.af-chip-btn.on { background: #fffbeb; color: #b45309; border-color: #fde68a; }

/* 行を左へ引くので overflow-x は塞ぐ（引いた分だけ横スクロールが生えるのを防ぐ）。
   横ジェスチャは touch-action で最初からこちらが引き取る。宣言しないと Android Chrome が
   同じ指の動きを「進む・戻る」のエッジ操作としても処理し、履歴を横取りする。
   このアプリは戻るを履歴の受け皿で捕まえているので、横取りされると受け皿が消える。 */
.af-list { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; padding: 6px 14px 24px; -webkit-overflow-scrolling: touch; touch-action: pan-y; overscroll-behavior-x: contain; }
.af-cat-head { width: 100%; display: flex; align-items: center; gap: 8px; background: #f1f5f9; border: none; border-radius: 8px; padding: 9px 12px; margin: 6px 0 4px; cursor: pointer; }
.af-cat-arrow { color: #94a3b8; font-size: 11px; }
.af-cat-name { font-size: 13px; font-weight: 800; color: #475569; }
.af-cat-count { margin-left: auto; font-size: 12px; font-weight: 700; color: #94a3b8; }
.af-item {
  width: 100%; box-sizing: border-box; display: flex; align-items: center; gap: 10px;
  background: #fff; border: 1px solid #eef2f6; border-radius: 12px;
  padding: 9px 8px 9px 14px; margin-bottom: 8px; cursor: pointer; text-align: left;
  position: relative;
  transition: transform 0.22s cubic-bezier(0.22,0.61,0.36,1), background 0.12s;
  -webkit-tap-highlight-color: transparent;
}
.af-item.swipe-dragging { transition: none; }
.af-item:focus-visible { outline: 2px solid var(--primary, #2563eb); outline-offset: 2px; }
.af-item.in { background: #eff6ff; border-color: var(--primary-border, #bfdbfe); }
.af-item.pop { animation: af-pop 0.35s ease; }
@keyframes af-pop { 0% { transform: scale(1); } 40% { transform: scale(1.03); background: #dbeafe; } 100% { transform: scale(1); } }
.af-item.locate { animation: af-locate 1.6s ease-out; }
@keyframes af-locate {
  0%   { box-shadow: 0 0 0 0 rgba(37, 99, 235, 0); }
  18%  { box-shadow: 0 0 16px 4px rgba(37, 99, 235, 0.55); border-color: var(--primary, #2563eb); }
  100% { box-shadow: 0 0 0 0 rgba(37, 99, 235, 0); }
}
.af-check { width: 28px; height: 28px; flex-shrink: 0; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 16px; font-weight: 800; color: #cbd5e1; border: 1.5px solid #e2e8f0; }
.af-item.in .af-check { background: var(--primary, #2563eb); color: #fff; border-color: var(--primary, #2563eb); }
.af-item-name { flex: 1; min-width: 0; font-size: 15px; font-weight: 600; color: #1e293b; }
.af-item-unused { flex-shrink: 0; font-size: 10px; font-weight: 800; color: #b45309; background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; padding: 2px 6px; }
.af-item-tags { display: flex; flex-wrap: wrap; gap: 4px; justify-content: flex-end; max-width: 34%; }
.af-item-tag { font-size: 10px; font-weight: 700; color: #64748b; background: #f1f5f9; border-radius: 6px; padding: 2px 7px; }
.af-item-tag.cur { color: #fff; background: var(--primary, #2563eb); }
/* 左スワイプで現れる非表示アクション。色は引いた量に応じて灰→赤へ寄る */
.af-row-action {
  position: absolute; top: 0; bottom: 0; right: 0; width: 96px;
  border: none; background: #64748b; color: #fff;
  font-size: 13px; font-weight: 800; letter-spacing: 0.04em;
  border-radius: 12px; cursor: pointer; z-index: 3;
  -webkit-tap-highlight-color: transparent; transition: background-color 0.18s linear;
}
.af-item.swipe-dragging .af-row-action { transition: none; }
.af-row-action:active { filter: brightness(0.85); }
.af-row-action.full { box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.4); }

/* ── 分類先の一括編集 ─────────────────────────────────────────
   つまみ（⋮⋮）を掴んでいる間だけ行が動く。行そのものを掴ませると縦スクロールと
   取り合いになり、並べ替えのつもりが画面ごと流れる。 */
.af-edit {
  position: fixed; inset: 0; z-index: 65; background: #f8fafc;
  display: flex; flex-direction: column;
  transform: translateY(100%); transition: transform 0.3s cubic-bezier(0.22,0.61,0.36,1);
}
.af-edit.on { transform: translateY(0); }
.af-edit-head { flex-shrink: 0; display: flex; align-items: center; gap: 10px; padding: 14px 14px 12px; background: #fff; border-bottom: 1px solid #e2e8f0; }
.af-edit-title { font-size: 16px; font-weight: 800; color: #1e293b; }
.af-edit-sub { font-size: 11px; color: #94a3b8; font-weight: 700; }
.af-edit-done { margin-left: auto; border: none; background: var(--primary, #2563eb); color: #fff; border-radius: 10px; font-size: 14px; font-weight: 800; padding: 9px 18px; cursor: pointer; }
.af-edit-list { flex: 1; overflow-y: auto; overscroll-behavior: contain; padding: 10px 14px 8px; }
.af-erow {
  display: flex; align-items: center; gap: 8px;
  background: #fff; border: 1.5px solid #e2e8f0; border-radius: 12px;
  padding: 8px 10px 8px 4px; margin-bottom: 8px;
  transition: box-shadow 0.16s, opacity 0.16s;
}
.af-erow.drag { box-shadow: 0 12px 28px rgba(15,23,42,0.22); border-color: var(--primary, #2563eb); position: relative; z-index: 5; }
.af-edit-list.dragging .af-erow:not(.drag) { opacity: 0.55; }
.af-ehandle { flex-shrink: 0; width: 44px; height: 44px; padding: 0; border: 0; background: transparent; display: flex; align-items: center; justify-content: center; color: #94a3b8; font-size: 17px; letter-spacing: -2px; touch-action: none; cursor: grab; -webkit-tap-highlight-color: transparent; }
.af-ehandle:focus-visible { outline: 3px solid var(--primary-border, #bfdbfe); outline-offset: -3px; border-radius: 9px; }
.af-erow.drag .af-ehandle { cursor: grabbing; color: var(--primary, #2563eb); }
.af-ename { flex: 1; min-width: 0; font-size: 15px; font-weight: 700; color: #1e293b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.af-ecount { flex-shrink: 0; min-width: 42px; text-align: center; font-size: 13px; font-weight: 800; color: #64748b; background: #eef2f6; border-radius: 12px; padding: 3px 8px; }
.af-ebtn { flex-shrink: 0; width: 44px; height: 44px; border-radius: 9px; border: 1px solid #e2e8f0; background: #fff; color: #64748b; font-size: 14px; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.af-ebtn.del { border-color: #fecaca; color: #dc2626; }
.af-edit-foot { flex-shrink: 0; padding: 10px 14px calc(14px + env(safe-area-inset-bottom)); background: #fff; border-top: 1px solid #e2e8f0; }
.af-edit-add { width: 100%; border: 1.5px dashed var(--primary-border, #bfdbfe); background: #fff; color: var(--primary, #2563eb); border-radius: 12px; font-size: 14px; font-weight: 800; padding: 13px; cursor: pointer; }

/* ── 確認・入力のダイアログ ──────────────────────────────────── */
.af-dialog-bg { position: fixed; inset: 0; z-index: 70; background: rgba(15,23,42,0.45); display: flex; align-items: center; justify-content: center; padding: 22px; }
.af-dialog { width: 100%; max-width: 340px; background: #fff; border-radius: 16px; padding: 20px 18px 16px; box-shadow: 0 14px 40px rgba(0,0,0,0.28); text-align: center; }
.af-dialog-title { font-size: 15px; font-weight: 800; color: #1e293b; }
.af-dialog-sub { margin-top: 8px; font-size: 12px; color: #64748b; }
.af-dialog-name { font-size: 14px; font-weight: 700; color: #475569; background: #f1f5f9; border-radius: 8px; padding: 8px 12px; margin: 12px 0 0; word-break: break-all; }
.af-dialog-input { width: 100%; box-sizing: border-box; margin-top: 14px; border: 1.5px solid var(--primary-border, #bfdbfe); border-radius: 12px; padding: 13px 14px; font-size: 15px; }
.af-dialog-err { margin-top: 8px; font-size: 12px; font-weight: 700; color: #dc2626; }
.af-dialog-acts { display: flex; gap: 10px; margin-top: 16px; }
.af-dialog-acts button { flex: 1; border-radius: 10px; font-size: 14px; font-weight: 800; padding: 12px; cursor: pointer; }
.af-dialog-cancel { border: 1px solid #e2e8f0; background: #fff; color: #64748b; }
.af-dialog-ok { border: none; background: var(--primary, #2563eb); color: #fff; }
.af-dialog-ok.danger { background: #dc2626; }
.af-dialog-ok:disabled { background: #cbd5e1; cursor: not-allowed; }

/* ── 振り分け済みシート ──────────────────────────────────────── */
.af-modal { position: fixed; inset: 0; z-index: 70; background: rgba(15, 23, 42, 0.45); display: flex; align-items: flex-end; justify-content: center; }
.af-sheet { width: 100%; max-width: 560px; max-height: 78vh; background: #fff; border-radius: 18px 18px 0 0; display: flex; flex-direction: column; box-shadow: 0 -8px 30px rgba(0,0,0,0.25); animation: af-sheet-up 0.24s cubic-bezier(0.22,0.8,0.28,1); }
@keyframes af-sheet-up { from { transform: translateY(100%); } to { transform: translateY(0); } }
.af-sheet-head { display: flex; align-items: center; gap: 10px; padding: 14px 16px 8px; }
.af-sheet-title { font-size: 15px; font-weight: 800; color: #1e293b; }
.af-sheet-title b { color: var(--primary, #2563eb); }
.af-sheet-close { margin-left: auto; border: none; background: none; font-size: 18px; color: #94a3b8; cursor: pointer; padding: 2px 6px; }
.af-sheet-hint { padding: 0 16px 8px; font-size: 12px; color: #94a3b8; }
.af-sheet-list { flex: 1; overflow-y: auto; padding: 4px 12px 20px; -webkit-overflow-scrolling: touch; }
.af-sheet-item { display: flex; align-items: center; gap: 10px; background: #f8fafc; border: 1px solid #eef2f6; border-radius: 12px; padding: 8px 10px 8px 14px; margin-bottom: 8px; }
.af-sheet-item-name { flex: 1; min-width: 0; border: none; background: none; font-size: 15px; font-weight: 700; color: #1e293b; text-align: left; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.af-sheet-off { flex-shrink: 0; border: 1px solid #fecaca; background: #fff; color: #dc2626; border-radius: 9px; font-size: 12px; font-weight: 800; padding: 8px 12px; cursor: pointer; }
.af-sheet-off:active { background: #fef2f2; }
.af-sheet-item-go { flex-shrink: 0; border: none; background: none; font-size: 12px; font-weight: 800; color: var(--primary, #2563eb); cursor: pointer; }

/* ── 取り消しバーとトースト ──────────────────────────────────── */
.af-undobar {
  position: fixed; left: 50%; bottom: 22px; transform: translateX(-50%);
  display: flex; align-items: center; gap: 10px;
  width: calc(100% - 28px); max-width: 520px; box-sizing: border-box;
  background: #1e293b; color: #fff; border-radius: 14px;
  padding: 10px 10px 10px 16px; z-index: 62; box-shadow: 0 6px 20px rgba(0,0,0,0.32);
}
.af-undo-msg { flex: 1; min-width: 0; font-size: 13px; font-weight: 700; line-height: 1.4; }
.af-undo-sub { display: block; font-size: 11px; font-weight: 600; color: #cbd5e1; }
.af-undo-btn { flex-shrink: 0; min-height: 40px; border: none; border-radius: 10px; background: #fff; color: #1e293b; font-size: 13px; font-weight: 800; padding: 0 14px; cursor: pointer; }
.af-undo-btn:active { background: #e2e8f0; }
.af-undo-x { flex-shrink: 0; min-width: 32px; min-height: 40px; border: none; background: none; color: #94a3b8; font-size: 14px; cursor: pointer; }

.af-flashbar {
  position: fixed; left: 50%; bottom: 26px; transform: translateX(-50%);
  background: #1e293b; color: #fff; font-size: 13px; font-weight: 700;
  padding: 10px 18px; border-radius: 22px; z-index: 61; box-shadow: 0 6px 20px rgba(0,0,0,0.28);
}
.af-flashbar.lifted { bottom: 88px; }
.af-flash-enter-active, .af-flash-leave-active { transition: opacity 0.2s, transform 0.2s; }
.af-flash-enter-from, .af-flash-leave-to { opacity: 0; transform: translateX(-50%) translateY(8px); }

@media (prefers-reduced-motion: reduce) {
  .af-wheel, .af-edit, .af-item { transition: none; }
  .af-stage, .af-rail, .af-marker, .af-fade { transition: none; }
  .af-item.pop, .af-item.locate, .af-sheet { animation: none; }
}
</style>
