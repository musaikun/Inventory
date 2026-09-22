<script setup>
import { ref, reactive, computed, watch, nextTick, onUnmounted } from 'vue'
import { useConfig, AXIS_NAME_MAX } from '../composables/useConfig.js'
import { useHistory } from '../composables/useHistory.js'
import { useRowHideSwipe, REVEAL_AT } from '../composables/useRowHideSwipe.js'
import { useListDragReorder } from '../composables/useListDragReorder.js'
import { useLongPressPick } from '../composables/useLongPressPick.js'
import { registerInnerLayerCloser } from '../composables/appMenuState.js'

const props = defineProps({ initialAxis: { type: Number, default: 0 } })
const emit = defineEmits(['close', 'hide-item', 'unhide-item'])

const {
  config, addAxisGroup, renameAxisGroup, removeAxisGroup, restoreAxisGroup,
  addItemToGroup, removeItemFromGroup, setAxisGroupOrder, reorderItemsInPlace,
  setAxisName, clearAxis,
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

/**
 * グループ（保管場所・仕入先など）そのものの作成・名前の変更・削除。
 *
 * 以前はデータ管理の画面にあり、ここは未設定だと「管理画面で追加してください」と
 * 突き放すだけだった。**設定する場所と使う場所が離れている**と、作りに戻って、
 * また開き直して、の往復になる。作るのも使うのもここで完結させる。
 */
const axisPanel = ref(false)
const axisDraft = ref('')
const axisErr   = ref('')
const editingAxis = ref(-1)   // -1 = 追加中 / 0,1 = その番号の名前を変更中
const freeAxisSlot = computed(() => {
  const names = config.axisNames ?? []
  if (!(names[0] || '').trim()) return 0
  if (!(names[1] || '').trim()) return 1
  return -1
})
// ジャンルは取込元データ由来。並び順の選択肢としては同格だが、名前も中身も編集できない
const genreCount = computed(() =>
  new Set(Object.values(config.categories || {}).filter(Boolean)).size)

function openAxisPanel(idx = -1) {
  editingAxis.value = idx
  axisDraft.value = idx >= 0 ? (config.axisNames?.[idx] ?? '') : ''
  axisErr.value = ''
  axisPanel.value = true
}
function closeAxisPanel() { axisPanel.value = false; axisErr.value = ''; editingAxis.value = -1 }
function saveAxis() {
  const n = axisDraft.value.trim()
  if (!n) return
  const idx = editingAxis.value >= 0 ? editingAxis.value : freeAxisSlot.value
  if (idx < 0) { axisErr.value = 'グループは2つまでです'; return }
  if (!setAxisName(idx, n)) { axisErr.value = 'ほかのグループと同じ名前です'; return }
  activeAxis.value = idx
  closeAxisPanel()
}
function dropAxis(idx) {
  const name = config.axisNames?.[idx]
  if (!confirm(`グループ「${name}」を削除します。\n分類先も、品目の振り分けもすべて外れます。\n\nよろしいですか？`)) return
  clearAxis(idx)
  closeAxisPanel()
}

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

// 端の外へどれだけ出せるか（カード何枚分）と、その間の重さ。
// 一周させると「どこから見始めたか」が消え、20件近い分類先では同じ名前が
// 何度も通り過ぎて探し疲れる。端は端として止める。湾曲は残す。
const OVER_MAX = 0.5, OVER_DAMP = 0.34
const pos = ref(0)                                   // 位置。0〜枠数-1の間。小数＝回転中

/**
 * ホイールの枠は「分類先の数 ＋ 1」。**末尾の1枠が「＋ 分類先を追加」**。
 *
 * 追加はホイール右のレールに置いていたが、**回している指の外**にあるので、
 * 作りたくなるたびに指を移す。回した先に「次はここに足せる」が見えているほうが、
 * 探す・作るがひと続きになる。0件のときも同じ ── 空の円筒ではなく、
 * 最初から1枚だけ「＋」のカードが座っている。
 */
const slotCount = computed(() => groups.value.length + 1)
const addSlot   = computed(() => groups.value.length)
function maxPos() { return Math.max(0, slotCount.value - 1) }
function clampPos(p) { return Math.max(0, Math.min(maxPos(), p)) }
function clampIndex(i) {
  const n = groups.value.length
  return n > 0 ? Math.max(0, Math.min(n - 1, i)) : -1
}
// 「＋」の枠に居る間は振り分け先が無い（品目を入れる相手ではない）
const onAddSlot = computed(() => Math.round(pos.value) >= addSlot.value)
const targetIdx = computed(() => (onAddSlot.value ? -1 : clampIndex(Math.round(pos.value))))
// 端を越えた分はゴムのように重くし、離したら必ず端へ戻す
function nudgePos(d) {
  const max = maxPos()
  let p = pos.value + d
  if (p < 0)        p = pos.value <= 0   ? pos.value + d * OVER_DAMP : p * OVER_DAMP
  else if (p > max) p = pos.value >= max ? pos.value + d * OVER_DAMP : max + (p - max) * OVER_DAMP
  pos.value = Math.max(-OVER_MAX, Math.min(max + OVER_MAX, p))
}
const target = computed(() => targetIdx.value >= 0 ? (groups.value[targetIdx.value] ?? '') : '')
const wheelAriaLabel = computed(() => {
  if (!groups.value.length) return '分類先はまだありません。回すと追加の枠が出ます'
  if (onAddSlot.value) return '分類先ホイール。現在 分類先を追加。上下矢印キーで変更'
  if (groups.value.length === 1) return `分類先。現在 ${target.value}`
  return `分類先ホイール。現在 ${target.value}。上下矢印キーで変更`
})

// 開き具合。1で扇状に開き、0で中央へ重なって畳まれる。高さの変化と同じ時間で動かすので
// 開閉が「伸び縮み」ではなく「カードが開く／閉じる」動きに見える。
const fan = ref(1)
const wheelCards = computed(() => {
  const n = slotCount.value                          // 末尾の1枠は「＋ 分類先を追加」
  const out = []
  // 1件だけは同じ名前を上下へ複製しない。2件以上は現在位置の前後の枠を描くが、
  // 端の外は描かない（先頭と末尾はつながない）。上や下にカードが無いことが、
  // そのまま「ここが端」の合図になる。
  // 畳みきった帯では周りのカードが中央へ完全に重なる。透明でも同じ3D位置に居ると
  // 手前後の判定が曖昧になり、中央の件数を押しても後ろのカードへ吸われる。
  // 見えていない間はDOMからも外し、押せる相手を中央の1枚だけにする。
  const single = n === 1 || fan.value <= 0.001
  const base = Math.round(pos.value)
  const from = single ? 0 : -VISIBLE
  const to   = single ? 0 : VISIBLE
  for (let k = from; k <= to; k++) {
    const slot = n === 1 ? 0 : base + k
    if (slot < 0 || slot > n - 1) continue            // 端の外は無い
    const idx = n === 1 ? 0 : slot
    const add = idx >= addSlot.value
    const name = add ? '' : groups.value[idx]
    const offset = n === 1 ? 0 : slot - pos.value
    const angle = offset * STEP * fan.value
    if (Math.abs(angle) > 62) continue
    const centre = Math.abs(offset) < 0.5
    out.push({
      name, idx, slot, centre, add,
      count: add ? 0 : (groupCount.value[name] || 0),
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
// タップかどうかは「押した点からどれだけ離れたか」で見る。
// 以前は指の移動距離の合計（経路長）で見ていたが、coalesced events は同じ場所を
// 押さえている間も細かい揺れを刻み続けるため、指が動いていなくても合計はすぐ伸びる。
// 件数のタップがそれで回転扱いになり、長く押さないと開かなかった。
// 経路長は「行って戻る回し方」を弾く保険としてだけ併用する。
const TAP_SLOP = 12
const TAP_PATH_MAX = 48
const FRAME_MS = 1000 / 60
const VELOCITY_WINDOW_MS = 120
const MAX_GLIDE_SPEED = 1.45
const TOUCH_FLING_BOOST = 1.25
const GLIDE_FRICTION = 0.94
let _dragging = false, _vel = 0, _glideRaf = 0
let _wheelPointerId = null, _wheelTapSlot = null, _wheelTravel = 0
let _wheelDownY = 0, _wheelShift = 0     // 押した位置と、そこからの変位
let _wheelPointerType = '', _wheelSamples = []
let _countTapSlot = null            // 押した瞬間に触れていた件数のカード
let _countJustOpened = false        // pointerupで開いた直後のclickを二重に効かせない
// 件数は「その分類先の振り分け済みを開く」入口。**どのカードのものでも**開く。
//
// もとは中央カードの件数だけを入口にしていたが、慣性で回っている最中は、指が着いた
// 瞬間にはもう別のカードが中央になっていることがある。人は**見えている数字**を狙って
// 押しているのに、判定を「いま中央か」で行うので、押した数字とは無関係に外れていた。
// 触った数字がその人の意図なので、そのカードの一覧を開く（User報告 2026-09-04）。
const isCountTap = e => !!e.target?.closest?.('.af-gcount')
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
    _wheelShift = Math.abs(y - _wheelDownY)
    if (groups.value.length > 1) nudgePos(-dy / PX_PER_CARD)
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
  if (_dragging || e.isPrimary === false) return
  _countJustOpened = false
  // 件数を押したかどうかは、ここで（押した瞬間の要素で）控える。
  // click は Pointer Capture で target が stage へ置き換わるうえ、回転中はカードが
  // 指の下から動くので、click では「どの数字を押したか」が分からない。
  // ここで早期returnせずに通常の経路へ乗せるのは、件数の上から指を滑らせたときに
  // ホイールが回らなくなるのを避けるため（押し切ったかどうかは pointerup で決める）。
  _countTapSlot = isCountTap(e) ? slotFromTarget(e.target) : null
  // 件数を押しただけでは面積を変えない。帯に畳んで品目を入れている最中に
  // 開いても、閉じたときに一覧の位置がずれないようにする。
  // 指が滑って本当の回転になったら、そこで広げる（onWheelMove）。
  if (_countTapSlot == null) setWheelState('open')
  _dragging = true; _vel = 0
  _wheelPointerId = e.pointerId ?? null
  _wheelPointerType = e.pointerType || 'mouse'
  _wheelSamples = []
  rememberWheelPoint(Number(e.clientY), wheelEventTime(e))
  _wheelTapSlot = slotFromTarget(e.target)
  _wheelDownY = Number(e.clientY) || 0
  _wheelShift = 0
  _wheelTravel = 0
  cancelAnimationFrame(_glideRaf)
  _glideRaf = 0
  if (_wheelPointerId != null) e.currentTarget.setPointerCapture?.(_wheelPointerId)
}
function onWheelMove(e) {
  if (!_dragging || !pointerMatches(e, _wheelPointerId)) return
  if (e.cancelable) e.preventDefault()
  for (const point of wheelMovePoints(e)) applyWheelPoint(point)
  // 件数から指が滑ったら、そこからは普通の回転として扱う
  if (_countTapSlot != null && _wheelShift > TAP_SLOP) {
    _countTapSlot = null
    setWheelState('open')
  }
}
function finishWheelGesture(e, cancelled) {
  if (!_dragging || !pointerMatches(e, _wheelPointerId)) return
  // pointerupの座標と時刻も速度窓へ入れる。指を止めてから離した場合は慣性を
  // 弱めつつ、pointermoveの最後の1pxだけで全速度が消えるスマホ特有の偏りを避ける。
  if (!cancelled) applyWheelPoint(e)
  const pointerId = _wheelPointerId
  const tap = !cancelled && _wheelShift <= TAP_SLOP && _wheelTravel <= TAP_PATH_MAX
  const tapSlot   = tap ? _wheelTapSlot : null
  const countSlot = tap ? _countTapSlot : null
  const releaseVelocity = _vel
  _dragging = false
  _wheelPointerId = null
  _wheelPointerType = ''
  _wheelSamples = []
  _wheelTapSlot = null
  _countTapSlot = null
  _wheelTravel = 0
  _wheelShift = 0
  try { if (pointerId != null) e.currentTarget.releasePointerCapture?.(pointerId) } catch (_) { /* 既に外れている */ }
  // Pointer Capture中のtapはclickのtargetがstageへ置き換わるため、down時の
  // 物理slotをpointerupで確定する。
  if (countSlot != null) {
    openAssigned(countSlot, { fromPointer: true })
    return
  }
  if (tapSlot != null) {
    if (tapSlot >= addSlot.value) { selectWheelSlot(tapSlot); openAdd(); return }
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
// 押し始めが件数で、指がほとんど動かずに離れたなら、その時点で開く
// （判定は finishWheelGesture の countSlot）。
function onWheelUp(e) { finishWheelGesture(e, false) }
function onWheelCancel(e) { finishWheelGesture(e, true) }

// 位置は動かさずに、回転だけ止める。指が触れている最中に pos を動かすと、
// カードが指の下から逃げる。
function freezeWheel() {
  cancelAnimationFrame(_glideRaf)
  _glideRaf = 0
  _vel = 0
  _wheelSamples = []
}
function stopWheelAtNearest() {
  freezeWheel()
  pos.value = slotCount.value <= 1 ? 0 : clampPos(Math.round(pos.value))
}
// 一覧のpointerdownでは回転位置だけを固定する。ここで高さも畳むと、特に
// reduced-motion時に押した行がpointerup前に移動しclickを失う。
function onListPointerDown() {
  if (_dragging) return
  stopWheelAtNearest()
}
// 一覧がスクロールし始めたら長押しは成立させない（browser 側のスクロールに譲る）
function onListScroll() {
  cancelLongPress()
  onListCommit()
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
    pos.value = clampPos(Math.round(pos.value)); _vel = 0; _glideRaf = 0; return
  }
  const max = maxPos()
  let lastFrame = performance.now()
  const step = now => {
    const elapsed = Number.isFinite(now) ? now - lastFrame : FRAME_MS
    const frameScale = Math.max(0.5, Math.min(2, elapsed / FRAME_MS || 1))
    lastFrame = Number.isFinite(now) ? now : lastFrame + FRAME_MS
    pos.value += _vel * frameScale
    _vel *= Math.pow(GLIDE_FRICTION, frameScale)
    // 端の外まで流れたら、そこで勢いを捨てて端へ戻す（跳ね返さず、寄せて止める）
    if (pos.value < 0 || pos.value > max) {
      const edge = pos.value < 0 ? 0 : max
      _vel = 0
      const backRate = 1 - Math.pow(1 - 0.3, frameScale)
      pos.value += (edge - pos.value) * backRate
      if (Math.abs(edge - pos.value) < 0.002) {
        pos.value = edge; _glideRaf = 0; return
      }
      _glideRaf = requestAnimationFrame(step)
      return
    }
    if (Math.abs(_vel) < 0.008) {                    // 止まりかけたら一番近い枠へ吸い付く
      const snap = clampPos(Math.round(pos.value))
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
  if (slotCount.value <= 1) { pos.value = 0; return }
  const dest = clampPos(slot)
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
/**
 * 押した件数の分類先を中央に据えて、振り分け済みを開く。
 * 回さずに合わせるのは、開いた一覧と中央のカードが食い違わないようにするため。
 */
// 分類先管理（⚙）の件数チップから開く。件数を持っている場所が中身を開く入口、
// という約束をホイールと揃える。開いたシートの対象は中央のカードなので、
// 押した分類先をホイールの中央へ据えてから開く。
function openAssignedFor(name) {
  const at = groups.value.indexOf(name)
  if (at < 0) return
  openAssigned(at)
}
// 件数を pointerup で開いた後、同じ指の click が「開いたばかりのシート」の上に降ってくる。
// 背景に当たれば即閉じ、行に当たれば別の品目へ飛ぶ。どちらも「タップでは反応しない」に見える。
// 長押しだと端末が click を出さない（長押しは別ジェスチャ扱い）ので、そちらだけ動いていた。
//
// 食べるのは「その1回」だけ。時間の窓で塞ぐと、窓の間は本当の操作まで死ぬし、
// 端末やアニメーションの速さで当たり外れが出る。指が離れた後に来る click は多くて1回なので、
// 1回だけ食べて即座に戻す。click が来ないまま（長押しなど）のときのために保険の時限も置く。
const GHOST_CLICK_MS = 500
let _swallowNextClick = false
let _swallowT = null
function armGhostSwallow() {
  _swallowNextClick = true
  clearTimeout(_swallowT)
  _swallowT = setTimeout(() => { _swallowNextClick = false }, GHOST_CLICK_MS)
}
function disarmGhostSwallow() {
  _swallowNextClick = false
  clearTimeout(_swallowT)
  _swallowT = null
}
function swallowAssignedGhost(e) {
  if (!_swallowNextClick) return
  disarmGhostSwallow()
  e.stopPropagation()
  e.stopImmediatePropagation?.()
  e.preventDefault()
}
function closeAssigned() {
  disarmGhostSwallow()
  sheetDrag.cleanup()
  sheetSorting.value = false
  exitTapOrder()
  showAssigned.value = false
}
// fromPointer: 指のタップ（pointerup）で開いたとき。その指の click が後から降ってくる
function openAssigned(slot, { fromPointer = false } = {}) {
  _countJustOpened = true
  if (fromPointer) armGhostSwallow(); else disarmGhostSwallow()
  freezeWheel()
  // 押した数字の分類先を中央に据える。回さずに合わせるのは、開いた一覧と
  // 中央のカードが食い違わないようにするため。
  if (Number.isFinite(slot) && slotCount.value > 1) pos.value = clampPos(slot)
  // 面積は変えない。帯に畳んで品目を入れている最中に開いても、
  // 閉じたときに一覧の位置がずれない（畳んだままでも開ける、の一部）。
  showAssigned.value = true
}
// 中央以外をタップしたらそこまで回す（1枚ずつ送らせない）
function onWheelClick(e) {
  if (isCountTap(e)) {
    // 指の操作は pointerup で確定済み。同じタップの click まで拾うと二重に効く。
    // ただしキーボード（Enter / Space）は click しか来ないので、そこは通す。
    if (_countJustOpened) { _countJustOpened = false; return }
    openAssigned(slotFromTarget(e.target))
    _countJustOpened = false
    return
  }
  const slot = slotFromTarget(e.target)
  if (slot == null) return
  selectWheelSlot(slot)
  if (slot >= addSlot.value) openAdd()
}
function onWheelKeydown(e) {
  if (e.target !== e.currentTarget || !['ArrowUp', 'ArrowDown'].includes(e.key)) return
  e.preventDefault()
  selectWheelSlot(clampPos(Math.round(pos.value) + (e.key === 'ArrowUp' ? -1 : 1)))
}
watch(activeAxis, () => {
  stopWheelAtNearest()
  pos.value = 0; search.value = ''; setWheelState('open')
  // 「直近に使った分類先」は軸ごとの話。持ち越すと別の軸の名前が推薦に混ざる
  closePick(); recentGroups.value = []
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
  if (consumeLongPress()) return                                 // 直前が長押し（分類先を選ぶを開いた）
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
    rememberGroup(destination)
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

// ── 品目から分類先を選ぶ（行を長押し）────────────────────────────
// ここまでの振り分けは「分類先を決めて品目を連打する」向き。同じ分類先が続く限りは
// それが最速なので置き換えない。長押しは、分類先がばらばらな品目が続くときに
// ホイールを回し直す往復だけを消すための逆向きの入口。
//
// 掴んで運ぶ形（ドラッグ）にしなかったのは速さのため。接触時間が長いうえ、
// 運んでいる最中に分類先を作り直す（ホイール→カード）ことになり、指の下で
// 落とし先が生まれる。20件近い分類先はどのみち1画面に並ばないので、
// ドラッグ中のスクロールまで要る。長押し＋タップならどれも要らない。
const PICK_HINT_MAX = 3      // ジャンルからの推測を何件まで上へ出すか
const PICK_RECENT_MAX = 5    // 直近に使った分類先を何件覚えるか
const PICK_MIN_H = 120       // 行の上下どちらに出しても、これだけは高さを取る
const PICK_GAP = 6
// 複数所属が日常になったら true にする（1タップで閉じる → 開いたまま連続で入れる）
const PICK_KEEP_OPEN = false

const pickItem = ref('')
const pickStyle = ref(null)
const pickEl = ref(null)

// 直近に使った分類先。この画面を開いている間だけ覚える。永続させると config →
// 同期・D1 まで巻き込むが、速さに効くのは「いまの作業での直近」なので持ち出さない。
const recentGroups = ref([])
function rememberGroup(g) {
  if (!g) return
  recentGroups.value = [g, ...recentGroups.value.filter(x => x !== g)].slice(0, PICK_RECENT_MAX)
}

// 同じジャンルの他の品目が、どの分類先に集まっているか。ジャンルは取込元由来で
// 1品目に1つあり（config.categories）、実際の保管場所や仕入先と相関が強い。
// 20件のうち正解が1タップ目で目に入れば、探している時間がそのまま消える。
function genreHint(item) {
  const cat = config.categories?.[item]
  if (!cat) return []
  const tally = {}
  for (const other of config.order) {
    if (other === item || hiddenSet.value.has(other)) continue
    if ((config.categories?.[other] || '') !== cat) continue
    for (const g of itemGroups(other)) tally[g] = (tally[g] || 0) + 1
  }
  return Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([g]) => g)
}

// 並び順がこの機能の速さの本体。上から
//   1. いま入っている分類先（＝ここで外せる）
//   2. 同じジャンルの品目が集まっている分類先
//   3. 直近に使った分類先
//   4. 残りはホイールと同じ順（覚えた位置が崩れない）
const pickOptions = computed(() => {
  const item = pickItem.value
  if (!item) return []
  const cat = config.categories?.[item] || ''
  const mine = new Set(itemGroups(item))
  const hint = genreHint(item).slice(0, PICK_HINT_MAX)
  const hintSet = new Set(hint)
  const recentSet = new Set(recentGroups.value)
  const out = []
  const seen = new Set()
  const push = g => {
    if (!g || seen.has(g) || !groups.value.includes(g)) return
    seen.add(g)
    out.push({
      name: g,
      on: mine.has(g),
      count: groupCount.value[g] || 0,
      why: mine.has(g) ? '' : hintSet.has(g) ? (cat ? `${cat}が多い` : 'よく使う') : recentSet.has(g) ? '直近' : '',
    })
  }
  for (const g of itemGroups(item)) push(g)
  for (const g of hint) push(g)
  for (const g of recentGroups.value) push(g)
  for (const g of groups.value) push(g)
  return out
})

// 押した行のすぐ下（入らなければ上）へ出す。画面下端に固定すると親指の移動距離が
// 毎回そのまま乗るので、速さを狙う機能としては置き場所を変えている。
function pickAnchorStyle(row) {
  const vh = typeof window === 'undefined' ? 640 : window.innerHeight
  const r = row?.getBoundingClientRect?.()
  if (!r || !r.height) return null              // 位置が取れない環境は CSS 側の既定（画面下）
  const below = vh - r.bottom - PICK_GAP
  const above = r.top - PICK_GAP
  const useBelow = below >= above
  const space = Math.max(PICK_MIN_H, Math.round(useBelow ? below : above))
  return useBelow
    ? { top: `${Math.round(r.bottom + PICK_GAP)}px`, maxHeight: `${space - 8}px` }
    : { bottom: `${Math.round(vh - r.top + PICK_GAP)}px`, maxHeight: `${space - 8}px` }
}

// 長押しは見えない操作なので、一度使うまでは一覧の上に一行だけ出す
const pickHinted = ref(false)
function openPick(item, row) {
  if (!groups.value.length) { _showFlash('先に分類先を作ってください', ''); return }
  pickHinted.value = true
  resetSwipe()
  stopWheelAtNearest()
  pickStyle.value = pickAnchorStyle(row)
  pickItem.value = item
  nextTick(() => pickEl.value?.querySelector('.af-pick-opt')?.focus())
}
function closePick() { pickItem.value = ''; pickStyle.value = null }

function choosePick(g) {
  // 長押しで開いた直後に降ってくる click を、選択として拾わない
  if (pickGuarded()) return
  const item = pickItem.value
  if (!item || !g) return
  if (itemGroups(item).includes(g)) {
    removeItemFromGroup(activeAxis.value, item, g)
    _showFlash(`「${item}」を ${g} から外しました`, '')
  } else {
    addItemToGroup(activeAxis.value, item, g)
    rememberGroup(g)
    _showFlash(`「${item}」を ${g} に追加`, item)
  }
  if (!PICK_KEEP_OPEN) closePick()
}
function onPickBackdrop() {
  if (pickGuarded()) return
  closePick()
}
function trapPickFocus(e) {
  if (!pickItem.value || e.key !== 'Tab') return
  const focusable = [...(pickEl.value?.querySelectorAll('button:not(:disabled)') ?? [])]
  if (!focusable.length) return
  const first = focusable[0], last = focusable[focusable.length - 1]
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
}

const {
  pressing, onRowPressStart, onRowPressMove, onRowPressEnd,
  cancelLongPress, consumeLongPress, pickGuarded,
} = useLongPressPick({ onPick: openPick })

// 行のジェスチャは1本にまとめる。左スワイプ（非表示）と長押しは同じ pointer から
// 分かれるので、片方だけ template に生えていると取り合いが見えなくなる。
function onRowDown(e, item) { onRowTouchStart(e, item); onRowPressStart(e, item, e.currentTarget) }
function onRowMove(e)       { onRowTouchMove(e); onRowPressMove(e) }
function onRowUp(e)         { onRowTouchEnd(e); onRowPressEnd() }
function onRowCancel(e)     { onRowTouchCancel(e); onRowPressEnd() }
// 長押しは touch だけの操作。デスクトップと Android の context menu は
// そのまま「分類先を選ぶ」に充てる（放っておくと長押しで選択メニューが出る）。
function onRowContextMenu(e, item) {
  e.preventDefault()
  cancelLongPress()
  // Android は長押し 500ms 前後で自前の menu を出す。こちらは 250ms で開いているので、
  // 指を離す前に二度目が来る。開いているものを開き直すと焦点と位置だけが飛ぶ。
  if (pickItem.value === item) return
  openPick(item, e.currentTarget)
}
function onRowKeydown(e, item) {
  if (e.key === 'ContextMenu') { e.preventDefault(); openPick(item, e.currentTarget); return }
  if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return
  e.preventDefault()
  if (e.shiftKey) openPick(item, e.currentTarget)
  else toggle(item)
}

// ── 振り分け済みの確認（中央カードのカウントから開く）＋逆引き ─────────
// 件数を持っている場所が、そのまま中身を開く入口になる。
const listEl = ref(null)
const showAssigned = ref(false)
// 件数は畳んだ帯でも押せる。ここで面積を広げると、シートを閉じた後に品目一覧の
// 位置が変わり、次に押す行を探し直すことになるので、回転だけ止めて開く。
const assignedItems = computed(() =>
  target.value ? config.order.filter(i => !hiddenSet.value.has(i) && itemGroups(i).includes(target.value)) : []
)
// ── 振り分け済みシートの並び替え ─────────────────────────────
// 棚卸・発注カードの「分類先の中の並び」は config.order の順がそのまま出る。
// ここで並べ替えると、その分類先の品目が今いる位置の集合へ新しい順で置き直される
// （他の分類先の並びは動かない）。
const sheetListEl = ref(null)
const sheetSorting = ref(false)     // 並び替えモードか
const tapOrderOn = ref(false)       // その中の「タップ順で並べる」
const tapSeq = ref([])              // タップした順の品目名

function _applyItemOrder(next) {
  const before = [...assignedItems.value]
  if (next.join('|') === before.join('|')) return
  if (!reorderItemsInPlace(next)) return
  _offerUndo('並び順を変えました', `${target.value} の中の ${next.length} 件`, () => {
    reorderItemsInPlace(before)
    _showFlash('並び順を戻しました', '')
  })
}

const sheetDrag = useListDragReorder({
  listEl: sheetListEl,
  rowSelector: '.af-sheet-item',
  // 「外す」「確認」は押せるままにする（押し続けても掴みにしない）
  ignoreSelector: '.af-sheet-off, .af-sheet-item-go',
  keyAttr: 'item',
  currentOrder: () => assignedItems.value,
  commitOrder: _applyItemOrder,
  focusAfterKeyboard: row => nextTick(() => row.querySelector('.af-sheet-handle')?.focus()),
})

function enterSheetSorting() { sheetSorting.value = true }
function exitSheetSorting()  { sheetSorting.value = false; exitTapOrder() }
// 品目は分類先より数が多く、1件ずつ運ぶと時間がかかる。
// 上から順にタップしていくだけで並ぶ道を別に用意する。
function enterTapOrder() {
  sheetDrag.cleanup()
  tapSeq.value = []
  tapOrderOn.value = true
}
function exitTapOrder() { tapOrderOn.value = false; tapSeq.value = [] }
function tapOrderNo(item) {
  const i = tapSeq.value.indexOf(item)
  return i < 0 ? 0 : i + 1
}
function tapOrderPick(item) {
  const i = tapSeq.value.indexOf(item)
  // もう一度タップしたら列から外す。後ろの番号は自動で繰り上がる
  if (i >= 0) tapSeq.value.splice(i, 1)
  else tapSeq.value.push(item)
}
function applyTapOrder() {
  if (!tapSeq.value.length) { exitTapOrder(); return }
  // タップした順が上。触らなかったものは今の順のまま後ろへ回す
  const picked = tapSeq.value.filter(n => assignedItems.value.includes(n))
  const rest = assignedItems.value.filter(n => !picked.includes(n))
  _applyItemOrder([...picked, ...rest])
  _showFlash(`${picked.length}件をタップした順に並べました`, '')
  exitTapOrder()
}

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
  // 件数が1つ減るので、位置は必ず範囲へ入れ直す。見ていた分類先が
  // 残っていれば維持し、中央を消した場合は同じ位置に詰まった次の分類先を選ぶ。
  const kept = groups.value.indexOf(previousTarget)
  pos.value = kept >= 0 ? kept : clampIndex(snapshot.wheelIndex)
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
  groupDrag.cleanup()
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

// 分類先の並べ替え（カードを長押し → 上下へ運ぶ）。操作そのものは useListDragReorder が持つ。
// 分類先の中の品目を並べ替えるシートでも同じ操作を使うため、片方だけ手を入れて
// 操作感がずれないように1つにまとめてある。
const editListEl = ref(null)
const groupDrag = useListDragReorder({
  listEl: editListEl,
  rowSelector: '.af-erow',
  // カードの上のボタン（件数・名前の変更・削除）は、押し続けても掴みにはしない
  ignoreSelector: '.af-ebtn, .af-ecount',
  keyAttr: 'group',
  currentOrder: () => groups.value,
  commitOrder: order => setAxisGroupOrder(activeAxis.value, order),
  focusAfterKeyboard: row => nextTick(() => row.querySelector('.af-ehandle')?.focus()),
})

// 戻るは常に「ひとつ前」へ返す。この画面の中にも段があるので、上から順に1段だけ畳む。
//   開いているモーダル → 分類先を選ぶ → 振り分け済み → 一括編集 → 画面を閉じて元の画面（データ管理）へ
onUnmounted(registerInnerLayerCloser(() => {
  if (delTarget.value)    { cancelDelete();            return true }
  if (renameTarget.value) { closeRename();             return true }
  if (addOpen.value)      { closeAdd();                return true }
  if (hideDialogItem.value) { cancelHideDialog();      return true }
  if (pickItem.value)     { closePick();               return true }
  // 並び替えの途中なら、まず並び替えを畳む（シートごと閉じてしまうと途中が消える）
  if (tapOrderOn.value)   { exitTapOrder();             return true }
  if (sheetSorting.value) { sheetSorting.value = false; return true }
  if (showAssigned.value) { closeAssigned();            return true }
  if (editOpen.value)     { closeEdit();               return true }
  return false
}))
onUnmounted(() => {
  groupDrag.cleanup()
  sheetDrag.cleanup()
  cancelLongPress()
  _dragging = false
  _wheelPointerId = null
  _wheelPointerType = ''
  _wheelSamples = []
  _wheelTapSlot = null
  _wheelTravel = 0
  _wheelShift = 0
  _countTapSlot = null
  _vel = 0
  cancelAnimationFrame(_fanRaf); cancelAnimationFrame(_glideRaf)
  clearTimeout(_flashT); clearTimeout(_undoT); clearTimeout(_locateT); clearTimeout(_swallowT)
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

    <!-- グループが1つも無いとき。ここで作れる（管理画面へ往復させない） -->
    <div v-if="namedAxes.length === 0" class="af-empty">
      <div class="af-empty-t">まず、まとめ方を1つ決めます</div>
      <p class="af-empty-n">
        「保管場所」「仕入先」のように、<b>品目を何でまとめるか</b>の名前です。
        決めたら、その中に分類先（冷蔵庫・常温棚…）を作って品目を入れていきます。
      </p>
      <button class="af-empty-go" @click="openAxisPanel(-1)">＋ グループを作る</button>
      <p v-if="genreCount" class="af-empty-g">
        取込元データ由来の「ジャンル別」（{{ genreCount }}種）は、作らなくてもそのまま並び順に使えます。
      </p>
    </div>

    <template v-else>
      <!-- グループのタブ。名前の変更・追加もここから（使う場所で設定まで済ませる） -->
      <div class="af-tabs">
        <button v-for="a in namedAxes" :key="a.index" :class="['af-tab', { on: activeAxis === a.index }]" @click="activeAxis = a.index">{{ a.name }}</button>
        <button class="af-tab-edit" aria-label="グループの名前を変える" @click="openAxisPanel(activeAxis)">✎</button>
        <button v-if="freeAxisSlot >= 0" class="af-tab-add" aria-label="グループを追加" @click="openAxisPanel(-1)">＋</button>
      </div>

      <!-- 分類先ホイール。触った方へ面積を寄せる（回す＝広い／入れる＝帯） -->
      <div
        class="af-wheel"
        :class="{ band: banded, reduced: reduceMotion }"
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
              class="af-gcard" :class="{ on: c.centre, add: c.add }" :style="c.style"
              :aria-hidden="c.centre ? undefined : 'true'"
            >
              <!-- 末尾の1枠。回した先に「次はここに足せる」が見えている -->
              <template v-if="c.add">
                <span class="af-gadd">＋ 分類先を追加</span>
              </template>
              <template v-else>
                <span class="af-gname">{{ c.name }}</span>
                <button
                  class="af-gcount"
                  :aria-label="c.centre ? `${c.name} の振り分け済みを見る` : undefined"
                  :tabindex="c.centre ? 0 : -1"
                >{{ c.count }}</button>
                <span v-if="c.centre && banded" class="af-gchev">変える ▾</span>
              </template>
            </div>
          </div>
          <div class="af-marker"></div>
          <div class="af-fade t"></div>
          <div class="af-fade b"></div>
        </div>
        <div
          class="af-rail"
          :aria-hidden="banded ? 'true' : 'false'" :inert="banded ? '' : null"
        >
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

      <!-- 長押しの導線。逆向き（品目 → 分類先）は見えない操作なので、使うまでは出しておく -->
      <div v-if="!pickHinted && groups.length && poolItems.length" class="af-pickhint">
        品目を<b>長押し</b>すると、分類先をその場で選べます
      </div>

      <div
        class="af-list" ref="listEl"
        @pointerdown="onListPointerDown" @click="onListCommit" @scroll.passive="onListScroll"
        @selectstart.prevent
        @dragstart.prevent
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
                :class="['af-item', { in: itemGroups(item).includes(target), pop: flashItem === item, locate: locateName === item, 'swipe-dragging': swipeDragging && swipeItem === item, pressing: pressing === item }]"
                :style="swipeItem === item ? { transform: `translateX(${swipeDx}px)` } : null"
                role="button" tabindex="0"
                @click="toggle(item)" @keydown="onRowKeydown($event, item)"
                @contextmenu="onRowContextMenu($event, item)"
                @touchstart.passive="onRowDown($event, item)"
                @touchmove.passive="onRowMove"
                @touchend="onRowUp($event)"
                @touchcancel="onRowCancel($event)"
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
            :class="['af-item', { in: itemGroups(item).includes(target), pop: flashItem === item, locate: locateName === item, 'swipe-dragging': swipeDragging && swipeItem === item, pressing: pressing === item }]"
            :style="swipeItem === item ? { transform: `translateX(${swipeDx}px)` } : null"
            role="button" tabindex="0"
            @click="toggle(item)" @keydown="onRowKeydown($event, item)"
            @contextmenu="onRowContextMenu($event, item)"
            @touchstart.passive="onRowDown($event, item)"
            @touchmove.passive="onRowMove"
            @touchend="onRowUp($event)"
            @touchcancel="onRowCancel($event)"
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

    <!-- グループ（まとめ方）そのものの設定 -->
    <div v-if="axisPanel" class="af-dialog-bg" @click.self="closeAxisPanel">
      <div class="af-dialog af-axis-dialog" role="dialog" aria-modal="true" aria-label="グループの設定">
        <div class="af-dialog-title">{{ editingAxis >= 0 ? 'グループの名前' : 'グループを作る' }}</div>
        <div class="af-dialog-sub">品目を何でまとめるかの名前です（例：保管場所・仕入先）。</div>
        <input
          v-model="axisDraft" class="af-dialog-input" type="text" :maxlength="AXIS_NAME_MAX"
          placeholder="保管場所" @input="axisErr = ''" @keyup.enter="saveAxis"
        />
        <div v-if="axisErr" class="af-dialog-err" role="alert">{{ axisErr }}</div>
        <div class="af-dialog-acts">
          <button class="af-dialog-cancel" @click="closeAxisPanel">やめる</button>
          <button class="af-dialog-ok" :disabled="!axisDraft.trim()" @click="saveAxis">
            {{ editingAxis >= 0 ? '変える' : '作る' }}
          </button>
        </div>
        <button v-if="editingAxis >= 0" class="af-dialog-sub-act" @click="dropAxis(editingAxis)">
          このグループを削除
        </button>
      </div>
    </div>

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
          <div class="af-edit-sub">{{ groups.length }}件 ・ カードを長押しして並べ替え</div>
        </div>
        <button ref="editDoneEl" class="af-edit-done" @click="closeEdit">完了</button>
      </header>
      <div class="af-edit-list" ref="editListEl"
           @pointerdown="groupDrag.onDown" @pointermove="groupDrag.onMove"
           @pointerup="groupDrag.onUp" @pointercancel="groupDrag.onUp"
           @lostpointercapture="groupDrag.onUp"
           @touchmove="groupDrag.onTouchMove"
           @contextmenu.prevent>
        <div v-for="g in groups" :key="g" :data-group="g" class="af-erow" @dragstart.prevent>
          <button
            type="button" class="af-ehandle" draggable="false"
            :aria-label="`${g} を並べ替え。現在 ${groups.indexOf(g) + 1} 番目。上下矢印キーで移動`"
            @keydown="groupDrag.onKeydown($event, g)"
          >⋮⋮</button>
          <span class="af-ename">{{ g }}</span>
          <button
            type="button" class="af-ecount"
            :aria-label="`${g} の振り分け済み ${groupCount[g] || 0}件を見る`"
            @click="openAssignedFor(g)"
          >{{ groupCount[g] || 0 }}</button>
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
    <div
      v-if="showAssigned" class="af-modal"
      @click.capture="swallowAssignedGhost"
      @click.self="closeAssigned"
    >
      <div class="af-sheet">
        <div class="af-sheet-head">
          <span class="af-sheet-title">{{ target }} の振り分け済み <b>{{ assignedItems.length }}</b></span>
          <template v-if="assignedItems.length > 1">
            <button v-if="sheetSorting" class="af-sheet-sort on" aria-pressed="true" @click="exitSheetSorting">並び替えを終える</button>
            <button v-else class="af-sheet-sort" aria-pressed="false" @click="enterSheetSorting">⇅ 並び替え</button>
          </template>
          <button class="af-sheet-close" aria-label="閉じる" @click="closeAssigned">✕</button>
        </div>

        <!-- 並び替えの道は2つ。1件ずつ運ぶドラッグと、上から順にタップしていくだけの簡易。
             品目は分類先より数が多く、全部運ぶと時間がかかるので後者を用意している。 -->
        <div v-if="sheetSorting" class="af-sheet-sortbar">
          <button v-if="tapOrderOn" class="af-sheet-tap on" aria-pressed="true" @click="exitTapOrder">タップ順をやめる</button>
          <button v-else class="af-sheet-tap" aria-pressed="false" @click="enterTapOrder">① タップ順で並べる</button>
          <button v-if="tapOrderOn" class="af-sheet-apply" :disabled="!tapSeq.length" @click="applyTapOrder">
            この順で確定{{ tapSeq.length ? `（${tapSeq.length}）` : '' }}
          </button>
        </div>

        <div class="af-sheet-hint">
          <template v-if="tapOrderOn">上にしたい順にタップしてください。もう一度タップで外せます。</template>
          <template v-else-if="sheetSorting">カードを長押しして上下へ運ぶと、棚卸カードの並びが変わります。</template>
          <template v-else>タップすると一覧の該当品目へ移動します。</template>
        </div>

        <div
          class="af-sheet-list" ref="sheetListEl"
          :class="{ sorting: sheetSorting, tapping: tapOrderOn }"
          @pointerdown="sheetSorting && !tapOrderOn ? sheetDrag.onDown($event) : null"
          @pointermove="sheetDrag.onMove"
          @pointerup="sheetDrag.onUp"
          @pointercancel="sheetDrag.onUp"
          @lostpointercapture="sheetDrag.onUp"
          @touchmove="sheetDrag.onTouchMove"
          @contextmenu="sheetSorting ? $event.preventDefault() : null"
        >
          <div
            v-for="item in assignedItems" :key="item" :data-item="item"
            :class="['af-sheet-item', { picked: tapOrderNo(item) > 0 }]"
          >
            <span v-if="tapOrderOn" class="af-sheet-no">{{ tapOrderNo(item) || '–' }}</span>
            <button
              v-else-if="sheetSorting"
              type="button" class="af-sheet-handle" draggable="false"
              :aria-label="`${item} を並べ替え。現在 ${assignedItems.indexOf(item) + 1} 番目。上下矢印キーで移動`"
              @keydown="sheetDrag.onKeydown($event, item)"
            >⋮⋮</button>
            <button
              v-if="tapOrderOn"
              class="af-sheet-item-name" @click="tapOrderPick(item)"
            >{{ item }}</button>
            <button v-else-if="sheetSorting" class="af-sheet-item-name as-text">{{ item }}</button>
            <button v-else class="af-sheet-item-name" @click="locate(item)">{{ item }}</button>
            <template v-if="!sheetSorting">
              <button class="af-sheet-off" @click="unassign(item)">外す</button>
              <button class="af-sheet-item-go" @click="locate(item)">確認 ›</button>
            </template>
          </div>
          <div v-if="assignedItems.length === 0" class="af-empty">まだ振り分けられた品目はありません。</div>
        </div>
      </div>
    </div>

    <!-- 品目から分類先を選ぶ（行の長押し）。押した行の近くへ出す -->
    <div v-if="pickItem" class="af-pick-back" @click.self="onPickBackdrop">
      <div
        ref="pickEl" class="af-pick" :class="{ float: !pickStyle }" :style="pickStyle"
        role="dialog" aria-modal="true" :aria-label="`${pickItem} の分類先`"
        @keydown.esc.prevent="closePick" @keydown="trapPickFocus"
      >
        <div class="af-pick-head">
          <span class="af-pick-name">{{ pickItem }}</span>
          <button class="af-pick-close" aria-label="閉じる" @click="closePick">✕</button>
        </div>
        <div class="af-pick-list">
          <button
            v-for="o in pickOptions" :key="o.name"
            :class="['af-pick-opt', { on: o.on }]"
            :aria-pressed="o.on ? 'true' : 'false'"
            @click="choosePick(o.name)"
          >
            <span class="af-pick-mark">{{ o.on ? '✓' : '＋' }}</span>
            <span class="af-pick-gname">{{ o.name }}</span>
            <span v-if="o.why" class="af-pick-why">{{ o.why }}</span>
            <span class="af-pick-count">{{ o.count }}</span>
          </button>
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
/* 末尾の「＋ 分類先を追加」の枠。破線にして「まだ空いている枠」と分かるようにする。
   0件のときはこの1枚だけが座る（空の円筒を見せない） */
.af-gcard.add { border-style: dashed; background: #f8fafc; justify-content: center; }
.af-gadd { font-size: 15px; font-weight: 800; color: var(--primary, #2563eb); }
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
  position: relative;
  flex-shrink: 0; min-width: 48px; min-height: 32px; border: none;
  background: #eef2f6; color: #64748b; border-radius: 14px; padding: 2px 12px;
  font-size: 14px; font-weight: 800; -webkit-tap-highlight-color: transparent;
}
/* 見た目は丸い数字のまま、指が触れる範囲だけカードの高さいっぱいに広げる。
   回っている最中に狙うと数ピクセル外してカード本体を踏み、「回る」だけになる。 */
.af-gcount::before { content: ''; position: absolute; inset: -9px -6px; }
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
/* 行だけに user-select: none を置いても、Android Chrome は長押しで「近くの選べる文字」
   （ジャンルの見出しなど）を探して選択を始める。面ごと選ばせない。
   検索欄は .af-tools 側にあるのでここには含まれない。 */
.af-list { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; padding: 6px 14px 24px; -webkit-overflow-scrolling: touch; touch-action: pan-y; overscroll-behavior-x: contain; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
.af-cat-head { width: 100%; display: flex; align-items: center; gap: 8px; background: #f1f5f9; border: none; border-radius: 8px; padding: 9px 12px; margin: 6px 0 4px; cursor: pointer; }
.af-cat-arrow { color: #94a3b8; font-size: 11px; }
.af-cat-name { font-size: 13px; font-weight: 800; color: #475569; }
.af-cat-count { margin-left: auto; font-size: 12px; font-weight: 700; color: #94a3b8; }
.af-item {
  width: 100%; box-sizing: border-box; display: flex; align-items: center; gap: 10px;
  background: #fff; border: 1px solid #eef2f6; border-radius: 12px;
  padding: 9px 8px 9px 14px; margin-bottom: 8px; cursor: pointer; text-align: left;
  position: relative;
  transition: transform 0.22s cubic-bezier(0.22,0.61,0.36,1), background 0.12s, box-shadow 0.12s;
  -webkit-tap-highlight-color: transparent;
  /* 長押しで iOS の選択・コールアウトが割り込むと、そのままジェスチャを持って行かれる */
  user-select: none; -webkit-user-select: none; -webkit-touch-callout: none;
}
/* 長押しの判定中。待ち時間そのものは消せないので、掴めていることを先に見せる。
   transform は横スワイプの追従が使っているので触らない。 */
.af-item.pressing { background: #eef2ff; box-shadow: inset 0 0 0 2px #c7d2fe; }
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
.af-tab-edit, .af-tab-add { flex-shrink: 0; border: 1px solid #cbd5e1; background: #fff; color: #475569;
  border-radius: 9px; padding: 6px 11px; font-size: 13px; font-weight: 800; cursor: pointer; }
.af-empty-t { font-size: 16px; font-weight: 800; color: #1e293b; margin-bottom: 6px; }
.af-empty-n { font-size: 12.5px; line-height: 1.65; color: #64748b; margin: 0 0 14px; }
.af-empty-n b { color: #1e293b; }
.af-empty-go { border: none; background: var(--primary, #2563eb); color: #fff; border-radius: 11px;
  padding: 12px 20px; font-size: 14px; font-weight: 800; cursor: pointer; }
.af-empty-g { font-size: 11px; line-height: 1.6; color: #94a3b8; margin: 14px 0 0; }

.af-edit {
  position: fixed; inset: 0; z-index: 65; background: #f8fafc;
  display: flex; flex-direction: column;
  transform: translateY(100%); transition: transform 0.3s cubic-bezier(0.22,0.61,0.36,1);
  /* つまみを長押しすると、ブラウザは文字選択のジェスチャを始める。選択が始まると
     そのジェスチャがポインタを奪い、pointercancel / lostpointercapture が飛んで
     掴んだ瞬間にドラッグが外れる。選択ハンドルやコールアウトも出る。
     並べ替えの面に読ませたい文字はあっても、選ばせたい文字は無いので面ごと止める。 */
  user-select: none; -webkit-user-select: none; -webkit-touch-callout: none;
}
/* 名前の変更だけは打てる必要がある */
.af-edit input { user-select: text; -webkit-user-select: text; }
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
  transition: box-shadow 0.16s, opacity 0.16s, background 0.16s, border-color 0.16s;
  cursor: grab;
}
.af-erow.drag { cursor: grabbing; }
.af-erow.drag { box-shadow: 0 12px 28px rgba(15,23,42,0.22); border-color: var(--primary, #2563eb); position: relative; z-index: 5; }
.af-edit-list.dragging .af-erow:not(.drag) { opacity: 0.55; }
/* つまみは「掴める場所」の目印とキーボード操作の受け口。指の掴みはカード全体が受けるので、
   ここで touch-action を奪わない（待っている間はブラウザに普通にスクロールさせる）。 */
.af-ehandle { flex-shrink: 0; width: 44px; height: 44px; padding: 0; border: 0; background: transparent; display: flex; align-items: center; justify-content: center; color: #94a3b8; font-size: 17px; letter-spacing: -2px; cursor: grab; -webkit-tap-highlight-color: transparent; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; -webkit-user-drag: none; }
.af-ehandle:focus-visible { outline: 3px solid var(--primary-border, #bfdbfe); outline-offset: -3px; border-radius: 9px; }
.af-erow.drag .af-ehandle { cursor: grabbing; color: var(--primary, #2563eb); }
/* 掴むまでの間。まだ動かないことと、待てば掴めることを同時に見せる */
.af-erow.holding { border-color: var(--primary-border, #bfdbfe); background: #f8fbff; }
.af-erow.holding .af-ehandle { color: var(--primary, #2563eb); }
.af-ename { flex: 1; min-width: 0; font-size: 15px; font-weight: 700; color: #1e293b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.af-ecount { flex-shrink: 0; min-width: 44px; min-height: 34px; text-align: center; font-size: 13px; font-weight: 800; color: var(--primary, #2563eb); background: var(--primary-weak, #eff6ff); border: 1px solid var(--primary-border, #bfdbfe); border-radius: 12px; padding: 5px 8px; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.af-ecount:active { background: #dbeafe; }
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
.af-dialog-ok:active:not(:disabled), .af-dialog-cancel:active { transform: scale(.98); }
/* 主な2つの下に置く脇役（削除など）。同じ並びに入れると重さが同じに見えてしまう */
.af-dialog-sub-act { display: block; width: 100%; margin-top: 4px; border: none; background: none;
  color: #dc2626; font-size: 12.5px; font-weight: 700; padding: 11px 4px 2px; cursor: pointer; }

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

/* 振り分け済みシートの並び替え */
.af-sheet-sort { margin-left: auto; flex-shrink: 0; border: 1px solid var(--primary-border, #bfdbfe); background: #fff; color: var(--primary, #2563eb); border-radius: 9px; font-size: 12px; font-weight: 800; padding: 7px 11px; cursor: pointer; white-space: nowrap; }
.af-sheet-sort.on { background: var(--primary, #2563eb); color: #fff; border-color: var(--primary, #2563eb); }
.af-sheet-head .af-sheet-close { margin-left: 0; }
.af-sheet-sortbar { display: flex; gap: 8px; padding: 0 16px 8px; }
.af-sheet-tap { flex: 1; min-width: 0; border: 1px dashed var(--primary-border, #bfdbfe); background: #fff; color: var(--primary, #2563eb); border-radius: 9px; font-size: 12px; font-weight: 800; padding: 9px; cursor: pointer; }
.af-sheet-tap.on { border-style: solid; background: var(--primary-weak, #eff6ff); }
.af-sheet-apply { flex-shrink: 0; border: none; background: var(--primary, #2563eb); color: #fff; border-radius: 9px; font-size: 12px; font-weight: 800; padding: 9px 14px; cursor: pointer; }
.af-sheet-apply:disabled { background: #cbd5e1; cursor: not-allowed; }
/* 並び替え中は、行を掴むまでの間もブラウザにスクロールさせる（touch-action を置かない） */
.af-sheet-list.sorting { user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
.af-sheet-list.sorting .af-sheet-item { cursor: grab; }
.af-sheet-item.drag { cursor: grabbing; box-shadow: 0 12px 28px rgba(15,23,42,0.22); border-color: var(--primary, #2563eb); position: relative; z-index: 5; }
.af-sheet-item.holding { border-color: var(--primary-border, #bfdbfe); background: #f8fbff; }
.af-sheet-list.dragging .af-sheet-item:not(.drag) { opacity: 0.55; }
.af-sheet-handle { flex-shrink: 0; width: 34px; height: 38px; padding: 0; border: 0; background: transparent; display: flex; align-items: center; justify-content: center; color: #94a3b8; font-size: 16px; letter-spacing: -2px; cursor: grab; -webkit-tap-highlight-color: transparent; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
.af-sheet-handle:focus-visible { outline: 3px solid var(--primary-border, #bfdbfe); outline-offset: -3px; border-radius: 9px; }
.af-sheet-item-name.as-text { cursor: inherit; }
/* タップ順。押した順の番号がそのまま上からの並びになる */
.af-sheet-no { flex-shrink: 0; width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 800; color: #cbd5e1; border: 1.5px solid #e2e8f0; background: #fff; }
.af-sheet-item.picked .af-sheet-no { background: var(--primary, #2563eb); color: #fff; border-color: var(--primary, #2563eb); }
.af-sheet-item.picked { background: var(--primary-weak, #eff6ff); border-color: var(--primary-border, #bfdbfe); }

/* 品目から分類先を選ぶ（行の長押し）。画面下端に固定せず押した行の近くへ出す。
   下端固定だと親指の移動距離が毎回そのまま乗り、速さを狙った機能の意味が薄れる。 */
.af-pickhint { margin: 0 14px 6px; padding: 7px 10px; background: #eef2ff; border: 1px solid #e0e7ff; border-radius: 9px; font-size: 12px; color: #4338ca; }
.af-pickhint b { font-weight: 800; }
.af-pick-back { position: fixed; inset: 0; z-index: 68; background: rgba(15, 23, 42, 0.18); }
.af-pick {
  position: fixed; left: 14px; right: 14px; max-width: 560px; margin-inline: auto;
  display: flex; flex-direction: column; overflow: hidden;
  background: #fff; border: 1px solid #e2e8f0; border-radius: 14px;
  box-shadow: 0 12px 34px rgba(15, 23, 42, 0.28);
  animation: af-pick-in 0.14s ease-out;
}
/* 行の位置が取れない環境（測れない WebView）では画面下から出す */
.af-pick.float { bottom: 16px; max-height: 60vh; }
@keyframes af-pick-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
.af-pick-head { display: flex; align-items: center; gap: 8px; padding: 10px 8px 8px 14px; border-bottom: 1px solid #f1f5f9; flex-shrink: 0; }
.af-pick-name { flex: 1; min-width: 0; font-size: 14px; font-weight: 800; color: #1e293b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.af-pick-close { flex-shrink: 0; border: none; background: none; font-size: 16px; color: #94a3b8; cursor: pointer; padding: 4px 8px; }
.af-pick-list { flex: 1; min-height: 0; overflow-y: auto; padding: 6px; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; }
.af-pick-opt {
  width: 100%; box-sizing: border-box; display: flex; align-items: center; gap: 9px;
  background: #fff; border: 1px solid #eef2f6; border-radius: 10px;
  padding: 10px 12px; margin-bottom: 5px; cursor: pointer; text-align: left;
  -webkit-tap-highlight-color: transparent;
}
.af-pick-opt:active { background: #f1f5f9; }
.af-pick-opt:focus-visible { outline: 2px solid var(--primary, #2563eb); outline-offset: 2px; }
.af-pick-opt.on { background: #eff6ff; border-color: var(--primary-border, #bfdbfe); }
.af-pick-mark { width: 22px; height: 22px; flex-shrink: 0; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 800; color: #cbd5e1; border: 1.5px solid #e2e8f0; }
.af-pick-opt.on .af-pick-mark { background: var(--primary, #2563eb); color: #fff; border-color: var(--primary, #2563eb); }
.af-pick-gname { flex: 1; min-width: 0; font-size: 15px; font-weight: 700; color: #1e293b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.af-pick-why { flex-shrink: 0; font-size: 10px; font-weight: 800; color: #4338ca; background: #eef2ff; border-radius: 6px; padding: 2px 7px; }
.af-pick-count { flex-shrink: 0; min-width: 20px; text-align: right; font-size: 12px; font-weight: 700; color: #94a3b8; }

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
  .af-item.pop, .af-item.locate, .af-sheet, .af-pick { animation: none; }
}
</style>
