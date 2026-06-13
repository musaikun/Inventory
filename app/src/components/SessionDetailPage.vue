<script setup>
import { ref, computed, watch } from 'vue'
import { useHistory } from '../composables/useHistory.js'
import { useHorizontalSwipe } from '../composables/useSwipe.js'

const props = defineProps({
  snapshot: { type: Object, required: true },
})
const emit = defineEmits(['back'])

const { exportSnapshotCSV } = useHistory()

const activeTab    = ref('items')
const expandedCats = ref([])
const dragOffset   = ref(0)

const catGroups = computed(() => {
  const map = new Map()
  for (const it of props.snapshot.items) {
    const cat = it.category ?? 'その他'
    if (!map.has(cat)) map.set(cat, [])
    map.get(cat).push(it)
  }
  return [...map.entries()].map(([cat, items]) => ({ cat, items }))
})

watch(() => props.snapshot, () => {
  expandedCats.value = []
}, { immediate: true })

function toggleCat(cat) {
  const idx = expandedCats.value.indexOf(cat)
  if (idx >= 0) expandedCats.value.splice(idx, 1)
  else          expandedCats.value.push(cat)
}

const recorderMap = computed(() => {
  const map = new Map()
  if (!props.snapshot.participants) return map
  for (const p of props.snapshot.participants) {
    for (const it of (p.items ?? [])) map.set(it.item, p.name)
  }
  return map
})

const hasRecorder = computed(() => recorderMap.value.size > 0)

const sortedLog = computed(() => {
  const log = props.snapshot.auditLog
  if (!Array.isArray(log) || !log.length) return []
  return [...log].reverse()
})

const hasAuditLog = computed(() => sortedLog.value.length > 0)

const swipe = useHorizontalSwipe({
  onLeft:  () => { if (activeTab.value === 'items' && hasAuditLog.value) activeTab.value = 'history' },
  onRight: () => { if (activeTab.value === 'history') activeTab.value = 'items' },
  onDrag: (dx) => {
    if (dx === 0) { dragOffset.value = 0; return }
    if (activeTab.value === 'items'   && dx > 0) return
    if (activeTab.value === 'history' && dx < 0) return
    if (activeTab.value === 'items'   && !hasAuditLog.value) return
    dragOffset.value = dx
  },
})

const trackStyle = computed(() => {
  const base = activeTab.value === 'items' ? 0 : -50
  if (dragOffset.value === 0) {
    return { transform: `translateX(${base}%)`, transition: 'transform 0.32s cubic-bezier(0.4, 0, 0.2, 1)' }
  }
  return { transform: `translateX(calc(${base}% + ${dragOffset.value}px))`, transition: 'none' }
})

const filledCount = computed(() => props.snapshot.items.filter(it => it.qty !== null).length)
const totalCount  = computed(() => props.snapshot.items.length)

function catFilledCount(items) { return items.filter(it => it.qty !== null).length }
function catTotalValue(items)  { return items.reduce((s, it) => s + (it.subtotal ?? 0), 0) }
function catHasPrice(items)    { return items.some(it => it.unitPrice != null) }

function fmtDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })
}

function fmtTime(ts) {
  if (!ts) return ''
  return new Date(ts).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
}

function fmtYen(n) {
  return '¥' + Math.round(n).toLocaleString('ja-JP')
}

function actionLabel(action) {
  const m = { new: '新規', add: '追加', overwrite: '上書き', remove: '削除', flag_recount: '🔖フラグ', unflag_recount: 'フラグ解除' }
  return m[action] ?? action
}

function actionClass(action) {
  if (action === 'remove')    return 'act-remove'
  if (action === 'new')       return 'act-new'
  if (action === 'add')       return 'act-add'
  if (action === 'overwrite') return 'act-over'
  return 'act-flag'
}

function onDownload() {
  const csv  = exportSnapshotCSV(props.snapshot)
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url
  a.download = `棚卸_${props.snapshot.date}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div class="detail-page">

    <!-- ヘッダー -->
    <div class="detail-header">
      <button class="btn-back" @click="emit('back')">‹ 戻る</button>
      <div class="header-center">
        <div class="header-date">{{ fmtDate(snapshot.date) }}</div>
        <div class="header-meta">
          {{ filledCount }}/{{ totalCount }}品目入力済み
          <span v-if="snapshot.totalValue != null" class="header-total">{{ fmtYen(snapshot.totalValue) }}</span>
        </div>
      </div>
      <button class="btn-icon" @click="onDownload" title="CSVダウンロード">💾</button>
    </div>

    <!-- タブバー -->
    <div class="tab-bar">
      <button :class="['tab-btn', { active: activeTab === 'items' }]" @click="activeTab = 'items'">品目一覧</button>
      <button
        :class="['tab-btn', { active: activeTab === 'history' }]"
        @click="activeTab = 'history'"
        :disabled="!hasAuditLog"
      >変更履歴{{ hasAuditLog ? ` (${sortedLog.length})` : '' }}</button>
    </div>

    <!-- スライドパネル -->
    <div
      class="tab-panels-wrapper"
      @touchstart.passive="swipe.onTouchStart"
      @touchmove.passive="swipe.onTouchMove"
      @touchend.passive="swipe.onTouchEnd"
    >
      <div class="tab-panels-track" :style="trackStyle">

        <!-- 品目一覧パネル -->
        <div class="tab-panel">
          <div v-for="group in catGroups" :key="group.cat" class="cat-group">

            <button class="cat-header" @click="toggleCat(group.cat)">
              <span class="cat-arrow">{{ expandedCats.includes(group.cat) ? '▼' : '▶' }}</span>
              <span class="cat-name">{{ group.cat }}</span>
              <span class="cat-filled">{{ catFilledCount(group.items) }}/{{ group.items.length }}品目</span>
              <span v-if="catHasPrice(group.items)" class="cat-total">
                {{ fmtYen(catTotalValue(group.items)) }}
              </span>
            </button>

            <div v-if="expandedCats.includes(group.cat)" class="cat-body">
              <div
                v-for="it in group.items"
                :key="it.item"
                class="item-row"
                :class="{ unfilled: it.qty === null }"
              >
                <div class="item-left">
                  <span class="item-name">
                    {{ it.item }}
                    <span v-if="it.flagged" class="flag-badge">🔖</span>
                  </span>
                  <span v-if="hasRecorder && recorderMap.get(it.item)" class="item-recorder">
                    {{ recorderMap.get(it.item) }}
                  </span>
                </div>
                <div class="item-right">
                  <span v-if="it.qty !== null" class="item-qty">{{ it.qty }}{{ it.unit }}</span>
                  <span v-else class="item-unfilled">未入力</span>
                  <span v-if="it.subtotal != null" class="item-price">{{ fmtYen(it.subtotal) }}</span>
                </div>
              </div>
            </div>
          </div>

          <div v-if="snapshot.totalValue != null" class="grand-total">
            合計金額　<strong>{{ fmtYen(snapshot.totalValue) }}</strong>
          </div>
        </div>

        <!-- 変更履歴パネル -->
        <div class="tab-panel">
          <div v-if="!hasAuditLog" class="empty-msg">変更履歴がありません</div>

          <div v-for="entry in sortedLog" :key="entry.id" class="log-entry">
            <div class="log-left">
              <span class="log-time">{{ fmtTime(entry.timestamp) }}</span>
              <span class="log-person">{{ entry.enteredBy || '—' }}</span>
            </div>
            <div class="log-right">
              <div class="log-item">{{ entry.ingredient }}</div>
              <div class="log-detail">
                <span :class="['action-badge', actionClass(entry.action)]">{{ actionLabel(entry.action) }}</span>
                <span v-if="entry.totalQty != null && entry.action !== 'flag_recount' && entry.action !== 'unflag_recount'" class="log-qty">
                  {{ entry.totalQty }}{{ entry.unit }}
                </span>
                <span v-if="entry.delta && entry.action === 'add'" class="log-delta">+{{ entry.delta }}</span>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>

  </div>
</template>

<style scoped>
.detail-page {
  height: 100dvh;
  background: var(--bg-secondary, #f8fafc);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* ── ヘッダー ── */
.detail-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px 12px;
  background: white;
  border-bottom: 1px solid #e2e8f0;
  flex-shrink: 0;
}

.btn-back {
  background: none;
  border: none;
  font-size: 18px;
  color: var(--primary, #3b82f6);
  cursor: pointer;
  padding: 4px 8px;
  flex-shrink: 0;
  transition: opacity 0.12s;
  -webkit-tap-highlight-color: transparent;
}
.btn-back:active { opacity: 0.5; }

.header-center {
  flex: 1;
  text-align: center;
  min-width: 0;
}

.header-date {
  font-size: 14px;
  font-weight: 700;
  color: var(--text-primary, #1e293b);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.header-meta {
  font-size: 11px;
  color: var(--text-muted, #64748b);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  flex-wrap: wrap;
}

.header-total {
  font-size: 12px;
  font-weight: 700;
  color: var(--primary, #3b82f6);
  background: #eff6ff;
  padding: 1px 7px;
  border-radius: 5px;
}

.btn-icon {
  background: none;
  border: none;
  font-size: 20px;
  cursor: pointer;
  padding: 4px;
  flex-shrink: 0;
  opacity: 0.7;
  transition: opacity 0.12s, transform 0.12s;
  -webkit-tap-highlight-color: transparent;
}
.btn-icon:active { opacity: 1; transform: scale(0.9); }

/* ── タブバー ── */
.tab-bar {
  display: flex;
  background: white;
  border-bottom: 1.5px solid #e2e8f0;
  padding: 0 16px;
  flex-shrink: 0;
}

.tab-btn {
  flex: 1;
  padding: 10px 4px;
  background: none;
  border: none;
  border-bottom: 2.5px solid transparent;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-muted, #64748b);
  cursor: pointer;
  transition: color 0.2s, border-color 0.2s, transform 0.1s;
  -webkit-tap-highlight-color: transparent;
}

.tab-btn.active {
  color: var(--primary, #3b82f6);
  border-bottom-color: var(--primary, #3b82f6);
}

.tab-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.tab-btn:not(:disabled):active { transform: scale(0.95); }

/* ── スライドパネル ── */
.tab-panels-wrapper {
  flex: 1;
  overflow: hidden;
  min-height: 0;
  position: relative;
}

.tab-panels-track {
  display: flex;
  width: 200%;
  height: 100%;
  will-change: transform;
}

.tab-panel {
  width: 50%;
  overflow-y: auto;
  padding: 12px 12px 24px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  touch-action: pan-y;
  box-sizing: border-box;
  -webkit-overflow-scrolling: touch;
}

/* ── カテゴリアコーディオン ── */
.cat-group {
  background: white;
  border-radius: 14px;
  overflow: hidden;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
}

.cat-header {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  background: white;
  border: none;
  cursor: pointer;
  text-align: left;
  -webkit-tap-highlight-color: transparent;
  transition: background 0.12s;
}
.cat-header:active { background: #f0f9ff; }

.cat-arrow {
  font-size: 10px;
  color: var(--text-muted, #64748b);
  width: 12px;
  flex-shrink: 0;
}

.cat-name {
  font-size: 14px;
  font-weight: 700;
  color: var(--text-primary, #1e293b);
  flex: 1;
}

.cat-filled {
  font-size: 11px;
  color: var(--text-muted, #64748b);
  flex-shrink: 0;
}

.cat-total {
  font-size: 12px;
  font-weight: 600;
  color: var(--primary, #3b82f6);
  background: #eff6ff;
  padding: 2px 8px;
  border-radius: 6px;
  flex-shrink: 0;
}

/* ── 品目リスト ── */
.cat-body { border-top: 1px solid #f1f5f9; }

.item-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid #f8fafc;
  gap: 8px;
}
.item-row:last-child { border-bottom: none; }
.item-row.unfilled   { opacity: 0.45; }

.item-left {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.item-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary, #1e293b);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.flag-badge { font-size: 11px; margin-left: 3px; }

.item-recorder {
  font-size: 11px;
  color: var(--text-muted, #64748b);
  display: flex;
  align-items: center;
  gap: 3px;
}
.item-recorder::before {
  content: '';
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #94a3b8;
  flex-shrink: 0;
}

.item-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  flex-shrink: 0;
}

.item-qty {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-primary, #1e293b);
}

.item-unfilled {
  font-size: 12px;
  color: var(--text-muted, #64748b);
}

.item-price {
  font-size: 11px;
  color: var(--text-muted, #64748b);
}

/* ── 合計行 ── */
.grand-total {
  text-align: right;
  font-size: 15px;
  color: var(--text-muted, #64748b);
  padding: 8px 4px 2px;
}
.grand-total strong {
  font-size: 18px;
  color: #15803d;
  margin-left: 8px;
}

/* ── 変更履歴 ── */
.empty-msg {
  text-align: center;
  color: var(--text-muted, #64748b);
  font-size: 13px;
  padding: 32px 16px;
}

.log-entry {
  display: flex;
  gap: 10px;
  background: white;
  border-radius: 12px;
  padding: 10px 14px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

.log-left {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  flex-shrink: 0;
  min-width: 64px;
}

.log-time {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-primary, #1e293b);
  font-variant-numeric: tabular-nums;
}

.log-person {
  font-size: 11px;
  color: var(--text-muted, #64748b);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 64px;
}

.log-right { flex: 1; min-width: 0; }

.log-item {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary, #1e293b);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-bottom: 4px;
}

.log-detail {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.action-badge {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 20px;
}

.act-new     { background: #dcfce7; color: #15803d; }
.act-add     { background: #dbeafe; color: #1d4ed8; }
.act-over    { background: #fef9c3; color: #854d0e; }
.act-remove  { background: #fee2e2; color: #b91c1c; }
.act-flag    { background: #fff7ed; color: #9a3412; }

.log-qty {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-primary, #1e293b);
}

.log-delta {
  font-size: 11px;
  color: var(--primary, #3b82f6);
  font-weight: 600;
}
</style>
