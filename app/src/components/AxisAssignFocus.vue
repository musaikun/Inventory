<script setup>
import { ref, reactive, computed, watch } from 'vue'
import { useConfig } from '../composables/useConfig.js'
import { useHistory } from '../composables/useHistory.js'
import { useHorizontalSwipe } from '../composables/useSwipe.js'

const props = defineProps({ initialAxis: { type: Number, default: 0 } })
const emit = defineEmits(['close'])

const { config, addAxisGroup, renameAxisGroup, removeAxisGroup, addItemToGroup, removeItemFromGroup, moveAxisGroup, setAxisGroupOrder } = useConfig()
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
    if (page.value === 'groups') dragPx.value = target.value ? Math.max(-W, Math.min(0, dx)) : 0
    else                         dragPx.value = Math.min(W, Math.max(0, dx))
  },
  onRight: () => { if (page.value === 'items') backToGroups() },
  onLeft:  () => { if (page.value === 'groups' && target.value) page.value = 'items' },
})

// ── 品目プール ──────────────────────────────────────────────
const search = ref('')
const unassignedOnly = ref(false)
const usedOnly = ref(false)
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
    (!unassignedOnly.value || itemGroups(i).length === 0)
  )
  arr = [...arr].sort((a, b) => {
    const ia = itemGroups(a).includes(target.value) ? 1 : 0
    const ib = itemGroups(b).includes(target.value) ? 1 : 0
    if (ia !== ib) return ib - ia
    return (usage.value[b] ?? 0) - (usage.value[a] ?? 0)
  })
  return arr
})

// タップで所属トグル＋フィードバック
const flash = ref('')
const flashItem = ref('')
let _flashT = null
function toggle(item) {
  if (!target.value) return
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

// ── グループ管理 ────────────────────────────────────────────
const editMode = ref(false)

// カード上で直接グループ名を入力して登録（連続追加できるよう入力欄は開いたまま）
const adding = ref(false)
const newName = ref('')
function submitNew() {
  const n = newName.value.trim()
  if (!n) return
  addAxisGroup(activeAxis.value, n)
  newName.value = ''
}
function onRename(g) {
  const n = (prompt('新しい名前', g) || '').trim()
  if (n && n !== g) {
    if (!renameAxisGroup(activeAxis.value, g, n)) alert('その名前は既に使われています')
    else if (target.value === g) target.value = n
  }
}
function onDelete(g) {
  if (confirm(`グループ「${g}」を削除します。品目の割り当ても外れます。`)) {
    removeAxisGroup(activeAxis.value, g)
    if (target.value === g) { target.value = ''; page.value = 'groups' }
  }
}
function move(g, dir) { moveAxisGroup(activeAxis.value, g, dir) }

// ── ドラッグハンドルでグループ並べ替え ─────────────────────────
const dragG = ref(null)
const draftOrder = ref(null)
const renderGroups = computed(() => draftOrder.value ?? groups.value)
function onHandleStart(g) { dragG.value = g; draftOrder.value = [...groups.value] }
function onHandleMove(e) {
  if (!dragG.value || !draftOrder.value) return
  const t = e.touches?.[0]; if (!t) return
  const el = document.elementFromPoint(t.clientX, t.clientY)
  const card = el?.closest('[data-group]')
  const overG = card?.getAttribute('data-group')
  if (!overG || overG === dragG.value) return
  const arr = draftOrder.value
  const from = arr.indexOf(dragG.value), to = arr.indexOf(overG)
  if (from < 0 || to < 0) return
  arr.splice(to, 0, arr.splice(from, 1)[0])
}
function onHandleEnd() {
  if (dragG.value && draftOrder.value) setAxisGroupOrder(activeAxis.value, draftOrder.value)
  dragG.value = null; draftOrder.value = null
}

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
const closedCat = reactive({})
function toggleCat(c) { closedCat[c] = !closedCat[c] }
</script>

<template>
  <div class="af">
    <header class="af-head">
      <button class="af-back" @click="page === 'items' ? backToGroups() : emit('close')">{{ page === 'items' ? '‹ 分類一覧' : '‹ 閉じる' }}</button>
      <span class="af-title">{{ namedAxes.find(a => a.index === activeAxis)?.name || '振り分け' }}</span>
      <button v-if="page === 'groups'" class="af-edit" :class="{ on: editMode }" @click="editMode = !editMode">{{ editMode ? '完了' : '編集' }}</button>
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
            <div class="af-pane-hint">振り分ける<b>分類先</b>を選んでください</div>
            <div class="af-glist">
              <div v-for="g in renderGroups" :key="g" :data-group="g"
                   class="af-gcard" :class="{ active: g === target, dragging: g === dragG }"
                   @click="editMode ? null : pickGroup(g)">
                <span class="af-ghandle"
                      @touchstart.stop.prevent="onHandleStart(g)"
                      @touchmove.stop.prevent="onHandleMove"
                      @touchend.stop="onHandleEnd">≡</span>
                <span class="af-gname" @click.stop="editMode ? onRename(g) : pickGroup(g)">{{ g }}</span>
                <span class="af-gcount">{{ groupCount[g] || 0 }}</span>
                <span v-if="editMode" class="af-gdel" @click.stop="onDelete(g)">削除</span>
                <span v-else class="af-garrow">→</span>
              </div>
              <div v-if="adding" class="af-gadd-row">
                <input v-model="newName" class="af-gadd-input" maxlength="20" placeholder="グループ名（例：冷蔵庫）" @keyup.enter="submitNew" />
                <button class="af-gadd-ok" :disabled="!newName.trim()" @click="submitNew">登録</button>
                <button class="af-gadd-x" @click="adding = false; newName = ''">×</button>
              </div>
              <button v-else class="af-gadd" @click="adding = true">＋ グループを追加</button>
              <div v-if="groups.length === 0 && !adding" class="af-empty">まず「＋ グループを追加」で分類先を作ってください（例：冷蔵庫・棚）。</div>
            </div>
          </section>

          <!-- カードB: 品目プール -->
          <section class="af-pane">
            <div class="af-target-bar">
              <button class="af-target-back" @click="backToGroups">← 分類一覧</button>
              <span class="af-target-name">{{ target }} に振り分け中</span>
            </div>
            <div class="af-tools">
              <input v-model="search" class="af-search" type="text" placeholder="品目を検索" />
              <button :class="['af-chip-btn', { on: unassignedOnly }]" @click="unassignedOnly = !unassignedOnly">未振り分けのみ</button>
              <button v-if="hasUsage" :class="['af-chip-btn', { on: usedOnly }]" @click="usedOnly = !usedOnly">前回入力のみ</button>
            </div>
            <div class="af-list">
              <!-- ジャンルがあればアコーディオン、無ければフラット -->
              <template v-if="hasGenres">
                <template v-for="grp in groupedPool" :key="grp.cat">
                  <button class="af-cat-head" @click="toggleCat(grp.cat)">
                    <span class="af-cat-arrow">{{ closedCat[grp.cat] ? '▶' : '▼' }}</span>
                    <span class="af-cat-name">{{ grp.cat }}</span>
                    <span class="af-cat-count">{{ grp.items.length }}</span>
                  </button>
                  <template v-if="!closedCat[grp.cat]">
                    <button
                      v-for="item in grp.items" :key="item"
                      :class="['af-item', { in: itemGroups(item).includes(target), pop: flashItem === item }]"
                      @click="toggle(item)"
                    >
                      <span class="af-check">{{ itemGroups(item).includes(target) ? '✓' : '＋' }}</span>
                      <span class="af-item-name">{{ item }}</span>
                      <span v-if="itemGroups(item).length" class="af-item-tags">
                        <span v-for="g in itemGroups(item)" :key="g" class="af-item-tag" :class="{ cur: g === target }">{{ g }}</span>
                      </span>
                    </button>
                  </template>
                </template>
              </template>
              <template v-else>
                <button
                  v-for="item in poolItems" :key="item"
                  :class="['af-item', { in: itemGroups(item).includes(target), pop: flashItem === item }]"
                  @click="toggle(item)"
                >
                  <span class="af-check">{{ itemGroups(item).includes(target) ? '✓' : '＋' }}</span>
                  <span class="af-item-name">{{ item }}</span>
                  <span v-if="itemGroups(item).length" class="af-item-tags">
                    <span v-for="g in itemGroups(item)" :key="g" class="af-item-tag" :class="{ cur: g === target }">{{ g }}</span>
                  </span>
                </button>
              </template>
              <div v-if="poolItems.length === 0" class="af-empty">{{ unassignedOnly ? '未振り分けの品目はありません 🎉' : '該当する品目がありません。' }}</div>
            </div>
          </section>
        </div>
      </div>
    </template>

    <!-- 追加フィードバック -->
    <transition name="af-flash">
      <div v-if="flash" class="af-flashbar">{{ flash }}</div>
    </transition>
  </div>
</template>

<style scoped>
.af { position: fixed; inset: 0; z-index: 60; background: #f8fafc; display: flex; flex-direction: column; overflow: hidden; }
.af-head { display: flex; align-items: center; gap: 10px; padding: 12px 14px; background: #fff; border-bottom: 1px solid #e2e8f0; flex-shrink: 0; }
.af-back { border: none; background: none; color: var(--primary, #2563eb); font-size: 14px; font-weight: 700; cursor: pointer; }
.af-title { font-size: 16px; font-weight: 800; color: #1e293b; }
.af-edit { margin-left: auto; border: 1px solid #e2e8f0; background: #fff; color: #64748b; border-radius: 8px; font-size: 13px; font-weight: 700; padding: 5px 12px; cursor: pointer; }
.af-edit.on { background: var(--primary, #2563eb); color: #fff; border-color: var(--primary, #2563eb); }

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

.af-pane-hint { font-size: 14px; color: #475569; margin-bottom: 10px; }
.af-pane-hint b { color: var(--primary, #2563eb); }
.af-glist { display: flex; flex-direction: column; gap: 10px; }
.af-gcard {
  display: flex; align-items: center; gap: 10px; width: 100%;
  background: #fff; border: 1.5px solid #e2e8f0; border-radius: 14px;
  padding: 18px 16px; font-size: 16px; font-weight: 800; color: #1e293b; cursor: pointer; text-align: left;
}
.af-gcard:active { background: #f1f5f9; }
.af-gcard.active { border-color: var(--primary, #2563eb); background: var(--primary-weak, #eff6ff); box-shadow: 0 0 0 1px var(--primary, #2563eb) inset; }
.af-gcard.dragging { opacity: 0.85; box-shadow: 0 8px 24px rgba(0,0,0,0.18); transform: scale(1.02); }
.af-ghandle { flex-shrink: 0; color: #cbd5e1; font-size: 20px; cursor: grab; padding: 0 4px; touch-action: none; -webkit-tap-highlight-color: transparent; }
.af-gname { flex: 1; min-width: 0; }
.af-gcount { background: var(--primary-weak, #eff6ff); color: var(--primary, #2563eb); border-radius: 14px; padding: 2px 12px; font-size: 14px; }
.af-garrow { color: #cbd5e1; font-size: 20px; }
.af-gmove { color: #94a3b8; font-size: 14px; padding: 0 4px; }
.af-gdel { color: #dc2626; font-size: 13px; font-weight: 700; }
.af-gadd { width: 100%; border: 1.5px dashed var(--primary-border, #bfdbfe); background: #fff; color: var(--primary, #2563eb); border-radius: 14px; padding: 16px; font-size: 15px; font-weight: 700; cursor: pointer; }
.af-gadd-row { display: flex; gap: 8px; align-items: center; }
.af-gadd-input { flex: 1; min-width: 0; border: 1.5px solid var(--primary-border, #bfdbfe); border-radius: 12px; padding: 15px 14px; font-size: 15px; }
.af-gadd-ok { flex-shrink: 0; border: none; background: var(--primary, #2563eb); color: #fff; border-radius: 12px; font-size: 14px; font-weight: 800; padding: 15px 18px; cursor: pointer; }
.af-gadd-ok:disabled { background: #cbd5e1; cursor: not-allowed; }
.af-gadd-x { flex-shrink: 0; border: 1px solid #e2e8f0; background: #fff; color: #94a3b8; border-radius: 12px; font-size: 18px; padding: 12px 15px; cursor: pointer; }

.af-target-bar { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.af-target-back { border: 1px solid #e2e8f0; background: #fff; color: #64748b; border-radius: 8px; font-size: 12px; font-weight: 700; padding: 6px 10px; cursor: pointer; }
.af-target-name { font-size: 15px; font-weight: 800; color: var(--primary, #2563eb); }
.af-tools { display: flex; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
.af-search { flex: 1; min-width: 120px; border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px 12px; font-size: 15px; }
.af-chip-btn { border: 1px solid #e2e8f0; background: #fff; color: #64748b; border-radius: 10px; font-size: 12px; font-weight: 700; padding: 0 12px; cursor: pointer; }
.af-chip-btn.on { background: #fffbeb; color: #b45309; border-color: #fde68a; }

.af-list { flex: 1; }
.af-cat-head { width: 100%; display: flex; align-items: center; gap: 8px; background: #f1f5f9; border: none; border-radius: 8px; padding: 9px 12px; margin: 6px 0 4px; cursor: pointer; }
.af-cat-arrow { color: #94a3b8; font-size: 11px; }
.af-cat-name { font-size: 13px; font-weight: 800; color: #475569; }
.af-cat-count { margin-left: auto; font-size: 12px; font-weight: 700; color: #94a3b8; }
.af-item {
  width: 100%; display: flex; align-items: center; gap: 12px;
  background: #fff; border: 1px solid #eef2f6; border-radius: 12px;
  padding: 15px 14px; margin-bottom: 8px; cursor: pointer; text-align: left;
  transition: transform 0.12s, background 0.12s;
}
.af-item.in { background: #eff6ff; border-color: var(--primary-border, #bfdbfe); }
.af-item.pop { animation: af-pop 0.35s ease; }
@keyframes af-pop { 0% { transform: scale(1); } 40% { transform: scale(1.03); background: #dbeafe; } 100% { transform: scale(1); } }
.af-check { width: 28px; height: 28px; flex-shrink: 0; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 16px; font-weight: 800; color: #cbd5e1; border: 1.5px solid #e2e8f0; }
.af-item.in .af-check { background: var(--primary, #2563eb); color: #fff; border-color: var(--primary, #2563eb); }
.af-item-name { flex: 1; min-width: 0; font-size: 15px; font-weight: 600; color: #1e293b; }
.af-item-tags { display: flex; flex-wrap: wrap; gap: 4px; justify-content: flex-end; max-width: 42%; }
.af-item-tag { font-size: 10px; font-weight: 700; color: #64748b; background: #f1f5f9; border-radius: 6px; padding: 2px 7px; }
.af-item-tag.cur { color: #fff; background: var(--primary, #2563eb); }

.af-flashbar {
  position: fixed; left: 50%; bottom: 26px; transform: translateX(-50%);
  background: #1e293b; color: #fff; font-size: 13px; font-weight: 700;
  padding: 10px 18px; border-radius: 22px; z-index: 61; box-shadow: 0 6px 20px rgba(0,0,0,0.28);
}
.af-flash-enter-active, .af-flash-leave-active { transition: opacity 0.2s, transform 0.2s; }
.af-flash-enter-from, .af-flash-leave-to { opacity: 0; transform: translateX(-50%) translateY(8px); }
</style>
