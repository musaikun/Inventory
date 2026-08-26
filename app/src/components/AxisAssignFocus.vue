<script setup>
import { ref, reactive, computed, watch, nextTick, onUnmounted } from 'vue'
import { useConfig } from '../composables/useConfig.js'
import { useHistory } from '../composables/useHistory.js'
import { useHorizontalSwipe } from '../composables/useSwipe.js'
import { registerInnerLayerCloser } from '../composables/appMenuState.js'

const props = defineProps({ initialAxis: { type: Number, default: 0 } })
const emit = defineEmits(['close', 'hide-item', 'unhide-item'])

const { config, addAxisGroup, renameAxisGroup, removeAxisGroup, restoreAxisGroup, addItemToGroup, removeItemFromGroup, moveAxisGroup, setAxisGroupOrder } = useConfig()
const { getSnapshots } = useHistory()

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

// ── ページ（A=グループ / B=品目）─────────────────────────────
const page = ref('groups')  // 'groups' | 'items'
const target = ref('')
function pickGroup(g) { target.value = g; page.value = 'items'; search.value = '' }
function backToGroups() { page.value = 'groups' }   // target は保持（スワイプで戻れる）
watch(activeAxis, () => { page.value = 'groups'; target.value = ''; search.value = '' })

// スワイプで双方向にカード切替（指に追従→離すとスナップ）
const vpEl = ref(null)
const dragPx = ref(0)
const dragging = ref(false)
const swipe = useHorizontalSwipe({
  threshold: 55,
  onDrag: dx => {
    if (dx === 0) { dragging.value = false; dragPx.value = 0; return }
    const W = vpEl.value?.clientWidth || 320
    dragging.value = true
    if (page.value === 'groups') dragPx.value = Math.max(-W, Math.min(0, dx))
    else                         dragPx.value = Math.min(W, Math.max(0, dx))
  },
  onRight: () => { if (page.value === 'items') backToGroups() },
  onLeft:  () => { if (page.value === 'groups') page.value = 'items' },
})

// ── 品目プール ──────────────────────────────────────────────
const search = ref('')
const unassignedOnly = ref(false)
const usedOnly = ref(false)        // 直近の棚卸で入力があった品目だけ
const neverUsedOnly = ref(false)   // 逆に、一度も入力の無い品目だけ（非表示にする候補を探す用）
// 「前回入力のみ」と「未使用のみ」は互いに素なので、片方を押したらもう片方を降ろす
function toggleUsedOnly()      { usedOnly.value = !usedOnly.value; if (usedOnly.value) neverUsedOnly.value = false }
function toggleNeverUsedOnly() { neverUsedOnly.value = !neverUsedOnly.value; if (neverUsedOnly.value) usedOnly.value = false }
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
  if (!target.value) { _showFlash('先に振り分け先を選んでください', ''); return }
  if (itemGroups(item).includes(target.value)) {
    removeItemFromGroup(activeAxis.value, item, target.value)
    _showFlash(`「${item}」を ${target.value} から外しました`, '')
  } else {
    addItemToGroup(activeAxis.value, item, target.value)
    _showFlash(`「${item}」を ${target.value} に追加`, item)
  }
}
function _showFlash(msg, item) {
  flash.value = msg
  flashItem.value = item
  clearTimeout(_flashT)
  _flashT = setTimeout(() => { flash.value = ''; flashItem.value = '' }, 1100)
}

// ── 一覧から非表示にする ────────────────────────────────────────
// 使っていない食材は「品目マスタ管理」まで行かないと隠せなかった。
// 振り分け中はどの品目を使っていないかが一番よく見えるので、その場で隠せるようにする。
// 実際の hide/unhide は App 側（既存の onHideItem / onUnhideItem）へ渡す。
// D1 保存・同期・ゲスト側への反映を、他の非表示導線とまったく同じ経路に乗せるため。
function hideFromPool(item) {
  emit('hide-item', item)
  _offerUndo(`「${item}」を一覧から非表示にしました`, '棚卸の一覧と進捗からも外れます', () => {
    emit('unhide-item', item)
    _showFlash(`「${item}」を一覧に戻しました`, '')
  })
}

// ── 振り分け済みの確認モーダル＋逆引きフォーカス ───────────────
const listEl = ref(null)
const showAssigned = ref(false)
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

// ── グループ管理 ────────────────────────────────────────────
// 名前変更（✎）も削除（🗑）もカードに常設する。編集モードの切替は持たない
// （削除の歯止めは onDelete の確認ダイアログ）。

// グループ追加はモーダルで行う（カード一覧の下の「＋」から開く）
const adding = ref(false)
const newName = ref('')
const addError = ref('')
const addInputEl = ref(null)
function openAdd() {
  newName.value = ''
  addError.value = ''
  adding.value = true
  nextTick(() => addInputEl.value?.focus())
}
function closeAdd() { adding.value = false; newName.value = ''; addError.value = '' }
function submitNew() {
  const n = newName.value.trim()
  if (!n) return
  // addAxisGroup は同名を黙って捨てるため、ここで気づけるようにする
  if (groups.value.includes(n)) { addError.value = 'その名前は既に使われています'; return }
  addAxisGroup(activeAxis.value, n)
  _showFlash(`グループ「${n}」を追加しました`, '')
  closeAdd()
}
function onRename(g) {
  const n = (prompt('新しい名前', g) || '').trim()
  if (n && n !== g) {
    if (!renameAxisGroup(activeAxis.value, g, n)) alert('その名前は既に使われています')
    else if (target.value === g) target.value = n
  }
}
function onDelete(g) {
  if (!confirm(`グループ「${g}」を削除します。品目の割り当ても外れます。`)) return
  // 消す前に「戻すのに要るもの」を控える。振り分け済みの品目も、一覧での位置も
  // 削除で失われるため、ここで取らないと元に戻せない。
  const snapshot = {
    axis: activeAxis.value,
    name: g,
    index: defined.value.indexOf(g),          // -1 = 定義リストに無い（割り当てだけで現れていた）
    items: config.order.filter(i => itemGroups(i).includes(g)),
    wasTarget: target.value === g,
  }
  removeAxisGroup(activeAxis.value, g)
  if (target.value === g) { target.value = ''; page.value = 'groups' }

  const n = snapshot.items.length
  _offerUndo(`「${g}」を削除しました`, n ? `品目 ${n} 件の振り分けも解除` : '', () => {
    restoreAxisGroup(snapshot.axis, snapshot.name, snapshot.index, snapshot.items)
    if (snapshot.wasTarget && activeAxis.value === snapshot.axis) target.value = snapshot.name
    _showFlash(n ? `「${snapshot.name}」を戻しました（品目 ${n} 件の振り分けも復元）`
                 : `「${snapshot.name}」を戻しました`, '')
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
// 軸を切り替えたら、その画面に属する取り消しも一緒に畳む
watch(activeAxis, dismissUndo)
function move(g, dir) { moveAxisGroup(activeAxis.value, g, dir) }

// ── ドラッグハンドルでグループ並べ替え ─────────────────────────
// 誤操作防止: カードを 0.5 秒長押しして初めて並べ替えが起動（振動＋他カードを暗く）。
// タップ＝選択 / 長押し＝並べ替え / ✎ボタン＝名前変更。起動前に指が動いたらキャンセル。
const dragG = ref(null)         // 並べ替え起動中のグループ
const holdG = ref('')           // 長押し判定中（起動前）のグループ
const draftOrder = ref(null)
const renderGroups = computed(() => draftOrder.value ?? groups.value)
const HOLD_MS = 500
const HOLD_CANCEL_PX = 10
let _holdTimer = null
let _holdStart = null
let _suppressClick = false      // 長押し起動後のクリック（＝選択）を抑止
function _clearHold() { clearTimeout(_holdTimer); _holdTimer = null; _holdStart = null; holdG.value = '' }
function onCardDown(g, e) {
  _suppressClick = false
  const t = e.touches?.[0]
  _holdStart = { x: t ? t.clientX : e.clientX, y: t ? t.clientY : e.clientY }
  holdG.value = g
  clearTimeout(_holdTimer)
  _holdTimer = setTimeout(() => {
    holdG.value = ''
    dragG.value = g
    draftOrder.value = [...groups.value]
    _suppressClick = true
    navigator.vibrate?.(15)
  }, HOLD_MS)
}
function onCardMove(e) {
  const t = e.touches?.[0]
  // 起動前: 少し動いたら長押しをキャンセル（グラつき・スクロール誤爆を防ぐ）
  if (!dragG.value) {
    if (_holdStart && t &&
        (Math.abs(t.clientX - _holdStart.x) > HOLD_CANCEL_PX ||
         Math.abs(t.clientY - _holdStart.y) > HOLD_CANCEL_PX)) _clearHold()
    return
  }
  if (e.cancelable) e.preventDefault()   // 起動後はスクロールを止めて並べ替え
  if (!draftOrder.value || !t) return
  const el = document.elementFromPoint(t.clientX, t.clientY)
  const card = el?.closest('[data-group]')
  const overG = card?.getAttribute('data-group')
  if (!overG || overG === dragG.value) return
  // ポインタが対象カードの上半分/下半分かで前後に差し込む（中点しきい値で往復＝ぶれを防ぐ）
  const rect = card.getBoundingClientRect()
  const after = t.clientY > rect.top + rect.height / 2
  const next = draftOrder.value.filter(g => g !== dragG.value)
  next.splice(next.indexOf(overG) + (after ? 1 : 0), 0, dragG.value)
  if (next.join('') !== draftOrder.value.join('')) draftOrder.value = next
}
function onCardUp() {
  _clearHold()
  if (dragG.value && draftOrder.value) setAxisGroupOrder(activeAxis.value, draftOrder.value)
  dragG.value = null; draftOrder.value = null
}
function onCardClick(g) {
  if (_suppressClick) { _suppressClick = false; return }   // 長押し（並べ替え）後の選択は無視
  pickGroup(g)
}

// 戻る操作は、この画面を閉じる前に開いているモーダルを1枚だけ閉じる。
// （追加モーダルを開いたまま戻ると振り分け画面ごと消える、を防ぐ）
onUnmounted(registerInnerLayerCloser(() => {
  if (adding.value)       { closeAdd();               return true }
  if (showAssigned.value) { showAssigned.value = false; return true }
  return false
}))

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
      <button class="af-back" @click="page === 'items' ? backToGroups() : emit('close')">{{ page === 'items' ? '‹ 分類一覧' : '‹ 閉じる' }}</button>
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
      <div v-if="namedAxes.length > 1 && page === 'groups'" class="af-tabs">
        <button v-for="a in namedAxes" :key="a.index" :class="['af-tab', { on: activeAxis === a.index }]" @click="activeAxis = a.index">{{ a.name }}</button>
      </div>

      <!-- 2カード・スライド（指に追従） -->
      <div class="af-viewport" ref="vpEl"
           @touchstart.passive="swipe.onTouchStart" @touchmove.passive="swipe.onTouchMove" @touchend="swipe.onTouchEnd">
        <div class="af-track" :class="{ dragging }" :style="{ transform: `translateX(calc(${page === 'items' ? -50 : 0}% + ${dragPx}px))` }">

          <!-- カードA: 分類先（グループ）選択 -->
          <section class="af-pane">
            <div class="af-pane-hint">振り分ける<b>分類先</b>を選んでください<span class="af-hint-sub">（長押しで並べ替え・✎で名前変更・🗑で削除）</span></div>
            <TransitionGroup tag="div" name="af-reorder" class="af-glist" :class="{ reordering: dragG }">
              <div v-for="g in renderGroups" :key="g" :data-group="g"
                   class="af-gcard" :class="{ active: g === target, dragging: g === dragG, holding: g === holdG }"
                   @click="onCardClick(g)"
                   @touchstart.passive="onCardDown(g, $event)"
                   @touchmove="onCardMove($event)"
                   @touchend="onCardUp" @touchcancel="onCardUp"
                   @mousedown="onCardDown(g, $event)"
                   @mousemove="onCardMove($event)"
                   @mouseup="onCardUp" @mouseleave="onCardUp">
                <span class="af-gname">{{ g }}</span>
                <span class="af-gcount">{{ groupCount[g] || 0 }}</span>
                <button class="af-gicon" title="名前を変更" :aria-label="`${g} の名前を変更`" @click.stop="onRename(g)" @touchstart.stop @mousedown.stop>✎</button>
                <button class="af-gicon af-gdel" title="削除" :aria-label="`${g} を削除`" @click.stop="onDelete(g)" @touchstart.stop @mousedown.stop>🗑</button>
                <span class="af-garrow">→</span>
              </div>
            </TransitionGroup>
            <div v-if="groups.length === 0" class="af-empty">下の「＋」で分類先を作ってください（例：冷蔵庫・棚）。</div>
            <button class="af-gadd-card" @click="openAdd">
              <span class="af-gadd-plus">＋</span>
              <span class="af-gadd-label">分類先を追加</span>
            </button>
          </section>

          <!-- カードB: 品目プール -->
          <section class="af-pane af-pane-b">
            <div class="af-b-head">
              <div class="af-target-bar">
                <button class="af-target-back" @click="backToGroups">← 分類一覧</button>
                <span v-if="target" class="af-target-name">{{ target }} に振り分け中</span>
                <span v-else class="af-target-none">グループ未選択 — 振り分け先を選択してください</span>
                <button v-if="target" class="af-confirm" @click="showAssigned = true">確認 <b>{{ assignedItems.length }}</b></button>
              </div>
              <div class="af-tools">
                <input v-model="search" class="af-search" type="text" placeholder="品目を検索" />
                <button :class="['af-chip-btn', { on: unassignedOnly }]" @click="unassignedOnly = !unassignedOnly">未振り分けのみ</button>
                <button v-if="hasUsage" :class="['af-chip-btn', { on: usedOnly }]" @click="toggleUsedOnly">前回入力のみ</button>
                <button v-if="hasUsage" :class="['af-chip-btn', { on: neverUsedOnly }]" @click="toggleNeverUsedOnly">未使用のみ</button>
              </div>
            </div>
            <div class="af-list" ref="listEl">
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
                      :class="['af-item', { in: itemGroups(item).includes(target), pop: flashItem === item, locate: locateName === item }]"
                      role="button" tabindex="0"
                      @click="toggle(item)" @keydown.enter.prevent="toggle(item)" @keydown.space.prevent="toggle(item)"
                    >
                      <span class="af-check">{{ itemGroups(item).includes(target) ? '✓' : '＋' }}</span>
                      <span class="af-item-name">{{ item }}</span>
                      <span v-if="hasUsage && !usage[item]" class="af-item-unused">未使用</span>
                      <span v-if="itemGroups(item).length" class="af-item-tags">
                        <span v-for="g in itemGroups(item)" :key="g" class="af-item-tag" :class="{ cur: g === target }">{{ g }}</span>
                      </span>
                      <button class="af-ihide" title="一覧から非表示" :aria-label="`${item} を一覧から非表示にする`" @click.stop="hideFromPool(item)">🚫</button>
                    </div>
                  </template>
                </template>
              </template>
              <template v-else>
                <div
                  v-for="item in poolItems" :key="item" :data-item="item"
                  :class="['af-item', { in: itemGroups(item).includes(target), pop: flashItem === item, locate: locateName === item }]"
                  role="button" tabindex="0"
                  @click="toggle(item)" @keydown.enter.prevent="toggle(item)" @keydown.space.prevent="toggle(item)"
                >
                  <span class="af-check">{{ itemGroups(item).includes(target) ? '✓' : '＋' }}</span>
                  <span class="af-item-name">{{ item }}</span>
                  <span v-if="hasUsage && !usage[item]" class="af-item-unused">未使用</span>
                  <span v-if="itemGroups(item).length" class="af-item-tags">
                    <span v-for="g in itemGroups(item)" :key="g" class="af-item-tag" :class="{ cur: g === target }">{{ g }}</span>
                  </span>
                  <button class="af-ihide" title="一覧から非表示" :aria-label="`${item} を一覧から非表示にする`" @click.stop="hideFromPool(item)">🚫</button>
                </div>
              </template>
              <div v-if="poolItems.length === 0" class="af-empty">
                {{ unassignedOnly ? '未振り分けの品目はありません 🎉'
                 : neverUsedOnly ? '使っていない品目はありません 🎉'
                 : '該当する品目がありません。' }}
              </div>
            </div>
          </section>
        </div>
      </div>
    </template>

    <!-- グループ追加モーダル -->
    <div v-if="adding" class="af-modal af-modal-center" @click.self="closeAdd">
      <div class="af-gadd-sheet" role="dialog" aria-modal="true" aria-label="分類先を追加">
        <div class="af-sheet-head">
          <span class="af-sheet-title">分類先を追加</span>
          <button class="af-sheet-close" @click="closeAdd">✕</button>
        </div>
        <div class="af-gadd-body">
          <input ref="addInputEl" v-model="newName" class="af-gadd-input" maxlength="20"
                 placeholder="グループ名（例：冷蔵庫）"
                 @input="addError = ''" @keyup.enter="submitNew" @keyup.esc="closeAdd" />
          <div v-if="addError" class="af-gadd-err">{{ addError }}</div>
        </div>
        <div class="af-gadd-actions">
          <button class="af-gadd-cancel" @click="closeAdd">キャンセル</button>
          <button class="af-gadd-ok" :disabled="!newName.trim()" @click="submitNew">登録</button>
        </div>
      </div>
    </div>

    <!-- 振り分け済みの確認モーダル -->
    <div v-if="showAssigned" class="af-modal" @click.self="showAssigned = false">
      <div class="af-sheet">
        <div class="af-sheet-head">
          <span class="af-sheet-title">{{ target }} の振り分け済み <b>{{ assignedItems.length }}</b></span>
          <button class="af-sheet-close" @click="showAssigned = false">✕</button>
        </div>
        <div class="af-sheet-hint">タップすると一覧の該当品目へ移動します</div>
        <div class="af-sheet-list">
          <button v-for="item in assignedItems" :key="item" class="af-sheet-item" @click="locate(item)">
            <span class="af-sheet-item-name">{{ item }}</span>
            <span class="af-sheet-item-go">確認 ›</span>
          </button>
          <div v-if="assignedItems.length === 0" class="af-empty">まだ振り分けられた品目はありません。</div>
        </div>
      </div>
    </div>

    <!-- 削除の取り消し（Undo）。振り分け済みの品目ごと戻す -->
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
.af-tabs { display: flex; gap: 6px; padding: 10px 14px 0; flex-shrink: 0; }
.af-tab { flex: 1; border: 1px solid #e2e8f0; background: #fff; color: #64748b; border-radius: 10px; padding: 9px; font-size: 14px; font-weight: 700; cursor: pointer; }
.af-tab.on { background: var(--primary, #2563eb); color: #fff; border-color: var(--primary, #2563eb); }

.af-viewport { flex: 1; overflow: hidden; }
.af-track { display: flex; width: 200%; height: 100%; transition: transform 0.3s cubic-bezier(0.22,0.61,0.36,1); }
.af-track.dragging { transition: none; }
.af-pane { width: 50%; height: 100%; overflow-y: auto; display: flex; flex-direction: column; padding: 12px 14px 24px; }
/* カードB: ヘッダー（分類一覧/確認・検索・フィルタ）は固定、品目一覧だけスクロール */
.af-pane-b { overflow: hidden; padding: 0; }
.af-b-head { flex-shrink: 0; padding: 12px 14px 8px; background: #f8fafc; border-bottom: 1px solid #eef2f6; }
.af-pane-b .af-list { flex: 1; overflow-y: auto; padding: 10px 14px 24px; -webkit-overflow-scrolling: touch; }
.af-pane-b .af-tools { margin-bottom: 0; }

.af-pane-hint { font-size: 14px; color: #475569; margin-bottom: 10px; }
.af-pane-hint b { color: var(--primary, #2563eb); }
.af-hint-sub { color: #94a3b8; font-size: 12px; margin-left: 6px; }
.af-glist { display: flex; flex-direction: column; gap: 7px; }
.af-gcard {
  display: flex; align-items: center; gap: 10px; width: 100%;
  background: #fff; border: 1.5px solid #e2e8f0; border-radius: 12px;
  padding: 11px 14px; font-size: 15px; font-weight: 800; color: #1e293b; cursor: pointer; text-align: left;
}
.af-gcard:active { background: #f1f5f9; }
.af-gcard.active { border-color: var(--primary, #2563eb); background: var(--primary-weak, #eff6ff); box-shadow: 0 0 0 1px var(--primary, #2563eb) inset; }
/* 長押し判定中（起動前）: つかもうとしていることを軽く示す */
.af-gcard.holding { border-color: var(--primary, #2563eb); box-shadow: 0 0 0 1px var(--primary, #2563eb) inset; }
/* 並べ替え起動中: 掴んだカードを強調し、他カードは暗くグレーアウト */
/* 並べ替え中の他カード: 暗転に加え、退避（Displacement）を滑らかにアニメーション。
   transform を transition に含めないと FLIP（.af-reorder-move）を打ち消して瞬間移動になる。 */
.af-glist.reordering .af-gcard:not(.dragging) { opacity: 0.4; filter: grayscale(0.55); transition: transform 0.42s cubic-bezier(0.22, 0.8, 0.28, 1), opacity 0.2s, filter 0.2s; }
/* 掴んでいるカードは FLIP アニメを無効化＝指の下でぶれずにその場に留まる */
.af-gcard.dragging { opacity: 1; background: var(--primary-weak, #eff6ff); box-shadow: 0 12px 30px rgba(37,99,235,0.3); border-color: var(--primary, #2563eb); position: relative; z-index: 3; transition: none; transform: scale(1.03); }
/* Reorder Animation（FLIP）: 入れ換わるカードが新しい位置へゆっくり滑らかに移動 */
.af-reorder-move { transition: transform 0.62s cubic-bezier(0.22, 0.8, 0.28, 1); will-change: transform; }
.af-glist { position: relative; }
.af-gname { flex: 1; min-width: 0; }
/* カードに常設する ✎ / 🗑。指で押し分けられるよう 40px 角を確保する */
.af-gicon {
  flex-shrink: 0; display: flex; align-items: center; justify-content: center;
  min-width: 40px; min-height: 40px; padding: 0;
  border: 1px solid #e2e8f0; background: #fff; color: #64748b; border-radius: 8px;
  font-size: 15px; line-height: 1; cursor: pointer; -webkit-tap-highlight-color: transparent;
}
.af-gicon:active { background: #f1f5f9; color: var(--primary, #2563eb); }
.af-gcount { background: var(--primary-weak, #eff6ff); color: var(--primary, #2563eb); border-radius: 14px; padding: 2px 12px; font-size: 14px; }
.af-garrow { color: #cbd5e1; font-size: 20px; }
.af-gdel { border-color: #fecaca; color: #dc2626; }
.af-gdel:active { background: #fef2f2; color: #dc2626; }
/* 一覧の下に置く「＋」＝ここが分類先を増やす唯一の入口 */
.af-gadd-card {
  display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%;
  margin-top: 7px; background: #fff; border: 1.5px dashed var(--primary-border, #bfdbfe);
  border-radius: 12px; padding: 13px 14px; color: var(--primary, #2563eb);
  font-size: 14px; font-weight: 800; cursor: pointer;
}
.af-gadd-card:active { background: var(--primary-weak, #eff6ff); }
.af-gadd-plus { font-size: 18px; line-height: 1; }
.af-gadd-label { line-height: 1; }

/* グループ追加モーダル */
/* .af-modal はこの下で align-items: flex-end を指定するため、詳細度を上げて中央寄せにする */
.af-modal.af-modal-center { align-items: center; padding: 20px; }
.af-gadd-sheet { width: 100%; max-width: 420px; background: #fff; border-radius: 16px; box-shadow: 0 12px 36px rgba(0,0,0,0.28); animation: af-gadd-in 0.18s cubic-bezier(0.22,0.8,0.28,1); }
@keyframes af-gadd-in { from { opacity: 0; transform: translateY(10px) scale(0.98); } to { opacity: 1; transform: none; } }
.af-gadd-body { padding: 4px 16px 0; }
.af-gadd-err { margin-top: 8px; font-size: 12px; font-weight: 700; color: #dc2626; }
.af-gadd-actions { display: flex; gap: 8px; padding: 14px 16px 16px; }
.af-gadd-input { width: 100%; box-sizing: border-box; border: 1.5px solid var(--primary-border, #bfdbfe); border-radius: 12px; padding: 15px 14px; font-size: 15px; }
.af-gadd-cancel { flex: 1; border: 1px solid #e2e8f0; background: #fff; color: #64748b; border-radius: 12px; font-size: 14px; font-weight: 800; padding: 14px 16px; cursor: pointer; }
.af-gadd-ok { flex: 1; border: none; background: var(--primary, #2563eb); color: #fff; border-radius: 12px; font-size: 14px; font-weight: 800; padding: 14px 18px; cursor: pointer; }
.af-gadd-ok:disabled { background: #cbd5e1; cursor: not-allowed; }

.af-target-bar { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.af-target-back { border: 1px solid #e2e8f0; background: #fff; color: #64748b; border-radius: 8px; font-size: 12px; font-weight: 700; padding: 6px 10px; cursor: pointer; }
.af-target-name { font-size: 15px; font-weight: 800; color: var(--primary, #2563eb); }
.af-target-none { font-size: 14px; font-weight: 800; color: #dc2626; animation: af-blink 1s ease-in-out infinite; }
@keyframes af-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.2; } }
.af-confirm { margin-left: auto; flex-shrink: 0; border: 1px solid var(--primary-border, #bfdbfe); background: var(--primary-weak, #eff6ff); color: var(--primary, #2563eb); border-radius: 8px; font-size: 12px; font-weight: 800; padding: 6px 12px; cursor: pointer; }
.af-confirm b { font-weight: 800; }
.af-tools { display: flex; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
.af-search { flex: 1; min-width: 120px; border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px 12px; font-size: 15px; }
.af-chip-btn { border: 1px solid #e2e8f0; background: #fff; color: #64748b; border-radius: 10px; font-size: 12px; font-weight: 700; padding: 0 12px; cursor: pointer; }
.af-chip-btn.on { background: #fffbeb; color: #b45309; border-color: #fde68a; }

.af-list { flex: 1; }
.af-cat-head { width: 100%; display: flex; align-items: center; gap: 8px; background: #f1f5f9; border: none; border-radius: 8px; padding: 9px 12px; margin: 6px 0 4px; cursor: pointer; }
.af-cat-arrow { color: #94a3b8; font-size: 11px; }
.af-cat-name { font-size: 13px; font-weight: 800; color: #475569; }
.af-cat-count { margin-left: auto; font-size: 12px; font-weight: 700; color: #94a3b8; }
/* 行は <div role="button">。内側に「非表示」ボタンを置くため（button の入れ子は不可）。
   div は content-box なので box-sizing を明示する（width:100% + padding ではみ出す） */
.af-item {
  width: 100%; box-sizing: border-box; display: flex; align-items: center; gap: 10px;
  background: #fff; border: 1px solid #eef2f6; border-radius: 12px;
  padding: 9px 8px 9px 14px; margin-bottom: 8px; cursor: pointer; text-align: left;
  transition: transform 0.12s, background 0.12s; -webkit-tap-highlight-color: transparent;
}
.af-item:focus-visible { outline: 2px solid var(--primary, #2563eb); outline-offset: 2px; }
.af-item.in { background: #eff6ff; border-color: var(--primary-border, #bfdbfe); }
.af-item.pop { animation: af-pop 0.35s ease; }
@keyframes af-pop { 0% { transform: scale(1); } 40% { transform: scale(1.03); background: #dbeafe; } 100% { transform: scale(1); } }
/* 逆引きフォーカス: うっすら光らせて位置を知らせる */
.af-item.locate { animation: af-locate 1.6s ease-out; }
@keyframes af-locate {
  0%   { box-shadow: 0 0 0 0 rgba(37, 99, 235, 0); }
  18%  { box-shadow: 0 0 16px 4px rgba(37, 99, 235, 0.55); border-color: var(--primary, #2563eb); }
  100% { box-shadow: 0 0 0 0 rgba(37, 99, 235, 0); }
}
.af-check { width: 28px; height: 28px; flex-shrink: 0; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 16px; font-weight: 800; color: #cbd5e1; border: 1.5px solid #e2e8f0; }
.af-item.in .af-check { background: var(--primary, #2563eb); color: #fff; border-color: var(--primary, #2563eb); }
.af-item-name { flex: 1; min-width: 0; font-size: 15px; font-weight: 600; color: #1e293b; }
.af-item-tags { display: flex; flex-wrap: wrap; gap: 4px; justify-content: flex-end; max-width: 34%; }
/* 直近の棚卸で一度も入力が無い品目。隠す候補をその場で見分けるための印 */
.af-item-unused { flex-shrink: 0; font-size: 10px; font-weight: 800; color: #b45309; background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; padding: 2px 6px; }
/* 一覧から非表示にする。行タップ（振り分け）と押し分けられるよう 40px 角を確保する */
.af-ihide {
  flex-shrink: 0; display: flex; align-items: center; justify-content: center;
  min-width: 40px; min-height: 40px; padding: 0;
  border: 1px solid #eef2f6; background: #f8fafc; border-radius: 10px;
  font-size: 14px; line-height: 1; cursor: pointer; -webkit-tap-highlight-color: transparent;
}
.af-ihide:active { background: #fef2f2; border-color: #fecaca; }
.af-item-tag { font-size: 10px; font-weight: 700; color: #64748b; background: #f1f5f9; border-radius: 6px; padding: 2px 7px; }
.af-item-tag.cur { color: #fff; background: var(--primary, #2563eb); }

.af-modal { position: fixed; inset: 0; z-index: 70; background: rgba(15, 23, 42, 0.45); display: flex; align-items: flex-end; justify-content: center; }
.af-sheet { width: 100%; max-width: 560px; max-height: 78vh; background: #fff; border-radius: 18px 18px 0 0; display: flex; flex-direction: column; box-shadow: 0 -8px 30px rgba(0,0,0,0.25); animation: af-sheet-up 0.24s cubic-bezier(0.22,0.8,0.28,1); }
@keyframes af-sheet-up { from { transform: translateY(100%); } to { transform: translateY(0); } }
.af-sheet-head { display: flex; align-items: center; gap: 10px; padding: 14px 16px 8px; }
.af-sheet-title { font-size: 15px; font-weight: 800; color: #1e293b; }
.af-sheet-title b { color: var(--primary, #2563eb); }
.af-sheet-close { margin-left: auto; border: none; background: none; font-size: 18px; color: #94a3b8; cursor: pointer; padding: 2px 6px; }
.af-sheet-hint { padding: 0 16px 8px; font-size: 12px; color: #94a3b8; }
.af-sheet-list { flex: 1; overflow-y: auto; padding: 4px 12px 20px; -webkit-overflow-scrolling: touch; }
.af-sheet-item { width: 100%; display: flex; align-items: center; gap: 10px; background: #f8fafc; border: 1px solid #eef2f6; border-radius: 12px; padding: 14px; margin-bottom: 8px; cursor: pointer; text-align: left; }
.af-sheet-item:active { background: #eef2f6; }
.af-sheet-item-name { flex: 1; min-width: 0; font-size: 15px; font-weight: 700; color: #1e293b; }
.af-sheet-item-go { flex-shrink: 0; font-size: 12px; font-weight: 800; color: var(--primary, #2563eb); }

.af-flashbar {
  position: fixed; left: 50%; bottom: 26px; transform: translateX(-50%);
  background: #1e293b; color: #fff; font-size: 13px; font-weight: 700;
  padding: 10px 18px; border-radius: 22px; z-index: 61; box-shadow: 0 6px 20px rgba(0,0,0,0.28);
}
/* Undo バーが出ているあいだ、トーストはその上へ避ける */
.af-flashbar.lifted { bottom: 88px; }
.af-flash-enter-active, .af-flash-leave-active { transition: opacity 0.2s, transform 0.2s; }
.af-flash-enter-from, .af-flash-leave-to { opacity: 0; transform: translateX(-50%) translateY(8px); }

/* 削除の取り消しバー。押し間違えても戻せることを、消した直後にその場で示す */
.af-undobar {
  position: fixed; left: 50%; bottom: 22px; transform: translateX(-50%);
  display: flex; align-items: center; gap: 10px;
  width: calc(100% - 28px); max-width: 520px; box-sizing: border-box;
  background: #1e293b; color: #fff; border-radius: 14px;
  padding: 10px 10px 10px 16px; z-index: 62; box-shadow: 0 6px 20px rgba(0,0,0,0.32);
}
.af-undo-msg { flex: 1; min-width: 0; font-size: 13px; font-weight: 700; line-height: 1.4; }
.af-undo-sub { display: block; font-size: 11px; font-weight: 600; color: #cbd5e1; }
.af-undo-btn {
  flex-shrink: 0; min-height: 40px; border: none; border-radius: 10px;
  background: #fff; color: #1e293b; font-size: 13px; font-weight: 800; padding: 0 14px; cursor: pointer;
}
.af-undo-btn:active { background: #e2e8f0; }
.af-undo-x { flex-shrink: 0; min-width: 32px; min-height: 40px; border: none; background: none; color: #94a3b8; font-size: 14px; cursor: pointer; }
</style>
