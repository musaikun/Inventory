<script setup>
import { ref, computed, reactive } from 'vue'
import { useHistory } from '../composables/useHistory.js'
import { useHorizontalSwipe } from '../composables/useSwipe.js'
import InventoryTable from './InventoryTable.vue'

const props = defineProps({
  snapshot: { type: Object, required: true },
  isHost:   { type: Boolean, default: true },
})
const emit = defineEmits(['back', 'patched'])

const { exportSnapshotCSV, getSnapshots, patchSnapshotItems } = useHistory()

const activeTab     = ref('items')
const dragOffset    = ref(0)

// ── スナップショット → InventoryTable 用データへ変換 ───────────────────────────
const snapItems = computed(() => props.snapshot.items ?? [])

const snapInventory = computed(() => {
  const inv = {}
  for (const it of snapItems.value) {
    if (it.qty !== null && it.qty !== undefined) {
      inv[it.item] = { qty: it.qty, unit: it.unit ?? '' }
    }
  }
  return inv
})

const snapConfig = computed(() => {
  const order = [], categories = {}, prices = {}, codes = {}
  for (const it of snapItems.value) {
    order.push(it.item)
    if (it.category != null)  categories[it.item] = it.category
    if (it.unitPrice != null) prices[it.item]     = it.unitPrice
    if (it.code)              codes[it.item]       = it.code
  }
  return { order, categories, prices, codes, categoryCodes: {}, prevMonths: {}, lotSizes: {}, units: {} }
})

const snapFlags = computed(() => {
  const f = {}
  for (const it of snapItems.value) if (it.flagged) f[it.item] = true
  return Object.keys(f).length ? f : null
})

// ── ヘッダー集計 ──────────────────────────────────────────────────────────────
const filledCount = computed(() => snapItems.value.filter(it => it.qty !== null).length)
const totalCount  = computed(() => snapItems.value.length)

// ── 変更履歴 ──────────────────────────────────────────────────────────────────
const sortedLog = computed(() => {
  const log = props.snapshot.auditLog
  if (!Array.isArray(log) || !log.length) return []
  return [...log].reverse()
})
const hasAuditLog    = computed(() => sortedLog.value.length > 0)
const hasParticipants = computed(() => (props.snapshot.participants?.length ?? 0) > 0)

// ── 訂正ウィンドウ（3日間 または 次のセッション完了まで）─────────────────────
const CORRECTION_DAYS = 3

const isLocked = computed(() => {
  if (props.snapshot.locked) return true   // 恒久ロック（新しい棚卸の完了で確定済み）
  const savedAt = new Date(props.snapshot.savedAt ?? props.snapshot.date)
  if (Date.now() - savedAt.getTime() > CORRECTION_DAYS * 86400_000) return true
  return getSnapshots().some(s =>
    s.sessionId !== props.snapshot.sessionId &&
    new Date(s.savedAt ?? s.date) > savedAt
  )
})

const correctionDaysRemaining = computed(() => {
  if (isLocked.value) return 0
  const savedAt   = new Date(props.snapshot.savedAt ?? props.snapshot.date)
  const remaining = CORRECTION_DAYS * 86400_000 - (Date.now() - savedAt.getTime())
  return Math.max(0, Math.ceil(remaining / 86400_000))
})

// ── 訂正モード ────────────────────────────────────────────────────────────────
const isEditing = ref(false)
const editQtys  = ref({})

function enterEdit() {
  const init = {}
  for (const it of snapItems.value) {
    init[it.item] = it.qty !== null && it.qty !== undefined ? it.qty : null
  }
  editQtys.value = init
  isEditing.value = true
}

function cancelEdit() {
  isEditing.value = false
}

function saveEdit() {
  const patches = {}
  for (const it of snapItems.value) {
    const orig    = it.qty !== null && it.qty !== undefined ? it.qty : null
    const edited  = editQtys.value[it.item]
    if (edited !== orig) patches[it.item] = { qty: edited }
  }
  if (Object.keys(patches).length === 0) { isEditing.value = false; return }
  const updated = patchSnapshotItems(props.snapshot.date, patches)
  isEditing.value = false
  if (updated) emit('patched', updated)
}

function onQtyInput(itemName, e) {
  const v = e.target.value
  editQtys.value[it.item] = v === '' ? null : parseFloat(v)
}

function setEditQty(itemName, rawValue) {
  editQtys.value[itemName] = rawValue === '' ? null : parseFloat(rawValue)
}

// ── タブ制御（3パネル固定: items / participants / history）──────────────────
// パネルは常に3枚DOMに存在し、スムーズなスライドを実現する
const TAB_ORDER  = ['items', 'participants', 'history']
const activeIdx  = computed(() => TAB_ORDER.indexOf(activeTab.value))

const swipe = useHorizontalSwipe({
  onLeft: () => {
    const idx = activeIdx.value
    if (idx === 0) {
      if (hasParticipants.value) activeTab.value = 'participants'
      else if (hasAuditLog.value) activeTab.value = 'history'
    } else if (idx === 1 && hasAuditLog.value) {
      activeTab.value = 'history'
    }
  },
  onRight: () => {
    const idx = activeIdx.value
    if (idx === 2) {
      activeTab.value = hasParticipants.value ? 'participants' : 'items'
    } else if (idx === 1) {
      activeTab.value = 'items'
    }
  },
  onDrag: (dx) => {
    if (dx === 0) { dragOffset.value = 0; return }
    const idx = activeIdx.value
    if (dx > 0 && idx === 0) return
    if (dx < 0 && idx === 2) return
    if (dx < 0 && idx === 1 && !hasAuditLog.value) return
    if (dx > 0 && idx === 2 && !hasParticipants.value) return
    dragOffset.value = dx
  },
})

const trackStyle = computed(() => {
  const base = -activeIdx.value * (100 / 3)
  if (dragOffset.value === 0) {
    return { transform: `translateX(${base}%)`, transition: 'transform 0.32s cubic-bezier(0.4, 0, 0.2, 1)' }
  }
  return { transform: `translateX(calc(${base}% + ${dragOffset.value}px))`, transition: 'none' }
})

// ── 参加者別 ──────────────────────────────────────────────────────────────────
// auditLog から参加者ごとのアクティブ時間（最初〜最後のアクション）
const participantStats = computed(() => {
  const timeMap = new Map()
  for (const entry of (props.snapshot.auditLog ?? [])) {
    if (!entry.enteredById || !entry.ts) continue
    const t = new Date(entry.ts).getTime()
    if (!timeMap.has(entry.enteredById)) {
      timeMap.set(entry.enteredById, { name: entry.enteredBy || '?', first: t, last: t })
    } else {
      const cur = timeMap.get(entry.enteredById)
      cur.first = Math.min(cur.first, t)
      cur.last  = Math.max(cur.last, t)
    }
  }

  return (props.snapshot.participants ?? []).map(p => {
    const timeEntry = [...timeMap.values()].find(t => t.name === p.name)
    let activeDur = null
    if (timeEntry) {
      const min = Math.max(1, Math.round((timeEntry.last - timeEntry.first) / 60000))
      activeDur = min < 60 ? `${min}分` : `${Math.floor(min / 60)}時間${min % 60 > 0 ? (min % 60) + '分' : ''}`
    }
    return { name: p.name, items: p.items ?? [], totalValue: p.totalValue, activeDur }
  })
})

// ── フォーマット ──────────────────────────────────────────────────────────────
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
  const m = { new: '新規', add: '追加', overwrite: '上書き', remove: '削除', flag_recount: '🔖フラグ', unflag_recount: 'フラグ解除', order_set: '発注', order_clear: '発注取消' }
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
      <div class="header-right">
        <span v-if="!isLocked" class="correction-badge" @click="!isLocked && enterEdit()">
          ✏️ あと{{ correctionDaysRemaining > 0 ? correctionDaysRemaining + '日' : '今日まで' }}
        </span>
        <span v-else class="lock-badge">🔒 確定</span>
        <button v-if="isHost" class="btn-icon" @click="onDownload" title="CSVダウンロード">💾</button>
      </div>
    </div>

    <!-- タブバー -->
    <div class="tab-bar">
      <button :class="['tab-btn', { active: activeTab === 'items' }]" @click="activeTab = 'items'">品目一覧</button>
      <button
        :class="['tab-btn', { active: activeTab === 'participants' }]"
        :disabled="!hasParticipants"
        @click="activeTab = 'participants'"
      >参加者別{{ hasParticipants ? ` (${participantStats.length})` : '' }}</button>
      <button
        :class="['tab-btn', { active: activeTab === 'history' }]"
        :disabled="!hasAuditLog"
        @click="activeTab = 'history'"
      >変更履歴{{ hasAuditLog ? ` (${sortedLog.length})` : '' }}</button>
    </div>

    <!-- スライドパネル（3枚固定） -->
    <div
      class="tab-panels-wrapper"
      @touchstart.passive="swipe.onTouchStart"
      @touchmove.passive="swipe.onTouchMove"
      @touchend.passive="swipe.onTouchEnd"
    >
      <div class="tab-panels-track" :style="trackStyle">

        <!-- 品目一覧 -->
        <div class="tab-panel tab-panel-items">
          <InventoryTable
            :inventory="snapInventory"
            :filled-count="filledCount"
            :read-only="true"
            :recount-flags="snapFlags"
            :config-source="snapConfig"
          />
        </div>

        <!-- 参加者別 -->
        <div class="tab-panel tab-panel-scroll">
          <div v-if="!hasParticipants" class="empty-msg">参加者情報がありません</div>
          <div v-for="p in participantStats" :key="p.name" class="participant-section">
            <div class="participant-header">
              <span class="participant-name">{{ p.name }}</span>
              <div class="participant-meta">
                <span class="pmeta-chip">{{ p.items.length }}品目</span>
                <span v-if="p.activeDur" class="pmeta-chip">⏱ {{ p.activeDur }}</span>
                <span v-if="p.totalValue != null" class="pmeta-chip pmeta-value">{{ fmtYen(p.totalValue) }}</span>
              </div>
            </div>
            <div class="participant-items">
              <div v-for="it in p.items" :key="it.item" class="pi-row">
                <span class="pi-name">{{ it.item }}</span>
                <span class="pi-qty">{{ it.qty }}{{ it.unit }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 変更履歴 -->
        <div class="tab-panel tab-panel-scroll">
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

    <!-- 訂正モード オーバーレイ -->
    <Transition name="edit-slide">
      <div v-if="isEditing" class="edit-overlay">
        <div class="edit-header">
          <button class="edit-header-btn" @click="cancelEdit">キャンセル</button>
          <span class="edit-header-title">訂正モード</span>
          <button class="edit-header-btn edit-header-save" @click="saveEdit">保存</button>
        </div>
        <div class="edit-notice">数量のみ修正できます。品目の追加・削除はできません。</div>
        <div class="edit-list">
          <template v-for="it in snapItems" :key="it.item">
            <div v-if="it.category && (snapItems.indexOf(it) === 0 || snapItems[snapItems.indexOf(it) - 1]?.category !== it.category)" class="edit-cat-header">
              {{ it.category }}
            </div>
            <div class="edit-row" :class="{ changed: editQtys[it.item] !== (it.qty ?? null) }">
              <span class="edit-item-name">{{ it.item }}</span>
              <input
                type="number"
                class="edit-qty-input"
                :value="editQtys[it.item] ?? ''"
                min="0"
                step="0.1"
                @input="setEditQty(it.item, $event.target.value)"
              />
              <span class="edit-unit">{{ it.unit }}</span>
            </div>
          </template>
        </div>
      </div>
    </Transition>

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
  color: var(--primary, var(--primary-bright));
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
  color: var(--primary, var(--primary-bright));
  background: var(--primary-weak);
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

.header-right {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.correction-badge {
  font-size: 11px;
  font-weight: 700;
  color: #d97706;
  background: #fffbeb;
  border: 1px solid #fde68a;
  padding: 3px 9px;
  border-radius: 20px;
  cursor: pointer;
  white-space: nowrap;
  -webkit-tap-highlight-color: transparent;
}
.correction-badge:active { opacity: 0.7; }

.lock-badge {
  font-size: 11px;
  font-weight: 700;
  color: #64748b;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  padding: 3px 9px;
  border-radius: 20px;
  white-space: nowrap;
}

/* ── 訂正オーバーレイ ── */
.edit-overlay {
  position: absolute;
  inset: 0;
  background: #f8fafc;
  display: flex;
  flex-direction: column;
  z-index: 50;
}

.edit-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  background: white;
  border-bottom: 1px solid #e2e8f0;
  flex-shrink: 0;
}

.edit-header-title {
  font-size: 15px;
  font-weight: 700;
  color: #1e293b;
}

.edit-header-btn {
  background: none;
  border: none;
  font-size: 14px;
  color: var(--primary, var(--primary-bright));
  cursor: pointer;
  padding: 4px 8px;
  font-weight: 600;
  -webkit-tap-highlight-color: transparent;
}
.edit-header-save {
  color: #059669;
  font-size: 15px;
}

.edit-notice {
  font-size: 12px;
  color: #d97706;
  background: #fffbeb;
  border-bottom: 1px solid #fde68a;
  padding: 8px 16px;
  flex-shrink: 0;
}

.edit-list {
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.edit-cat-header {
  font-size: 11px;
  font-weight: 700;
  color: var(--text-muted, #64748b);
  background: #f1f5f9;
  padding: 6px 16px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.edit-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  background: white;
  border-bottom: 1px solid #f1f5f9;
  transition: background 0.15s;
}

.edit-row.changed {
  background: #fffbeb;
  border-left: 3px solid #f59e0b;
}

.edit-item-name {
  flex: 1;
  font-size: 13px;
  font-weight: 500;
  color: #1e293b;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.edit-qty-input {
  width: 72px;
  padding: 6px 8px;
  border: 1.5px solid #e2e8f0;
  border-radius: 8px;
  font-size: 15px;
  font-weight: 600;
  text-align: right;
  color: #1e293b;
  background: white;
  -webkit-appearance: none;
  appearance: none;
  flex-shrink: 0;
}
.edit-qty-input:focus {
  outline: none;
  border-color: var(--primary, var(--primary-bright));
  box-shadow: 0 0 0 2px rgba(59,130,246,0.15);
}

.edit-unit {
  font-size: 12px;
  color: #64748b;
  min-width: 28px;
  flex-shrink: 0;
}

.edit-slide-enter-active, .edit-slide-leave-active {
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
.edit-slide-enter-from, .edit-slide-leave-to {
  transform: translateX(100%);
}

/* ── タブバー ── */
.tab-bar {
  display: flex;
  background: white;
  border-bottom: 1.5px solid #e2e8f0;
  padding: 0 8px;
  flex-shrink: 0;
}

.tab-btn {
  flex: 1;
  padding: 10px 4px;
  background: none;
  border: none;
  border-bottom: 2.5px solid transparent;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted, #64748b);
  cursor: pointer;
  transition: color 0.2s, border-color 0.2s, transform 0.1s;
  -webkit-tap-highlight-color: transparent;
  white-space: nowrap;
}

.tab-btn.active {
  color: var(--primary, var(--primary-bright));
  border-bottom-color: var(--primary, var(--primary-bright));
}

.tab-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.tab-btn:not(:disabled):active { transform: scale(0.95); }

/* ── スライドパネル（3枚） ── */
.tab-panels-wrapper {
  flex: 1;
  overflow: hidden;
  min-height: 0;
  position: relative;
}

.tab-panels-track {
  position: absolute;
  top: 0;
  left: 0;
  display: flex;
  width: 300%;
  height: 100%;
  will-change: transform;
}

.tab-panel {
  width: 33.333%;
  height: 100%;
  overflow: hidden;
  padding: 12px 0 24px;
  box-sizing: border-box;
  touch-action: pan-y;
  -webkit-overflow-scrolling: touch;
}

.tab-panel-scroll {
  overflow-y: auto;
  padding: 12px 12px 24px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* 品目一覧タブも縦スクロールできるようにする（メイン画面同様、最後まで見える） */
.tab-panel-items {
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

/* ── 参加者別 ── */
.participant-section {
  background: white;
  border-radius: 14px;
  overflow: hidden;
  box-shadow: 0 1px 4px rgba(0,0,0,0.06);
}

.participant-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
  flex-wrap: wrap;
}

.participant-name {
  font-size: 14px;
  font-weight: 700;
  color: var(--text-primary, #1e293b);
  flex-shrink: 0;
}

.participant-meta {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.pmeta-chip {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted, #64748b);
  background: #e2e8f0;
  padding: 2px 8px;
  border-radius: 10px;
}

.pmeta-value {
  color: var(--primary, var(--primary-bright));
  background: var(--primary-weak);
}

.participant-items {
  padding: 4px 0;
}

.pi-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  font-size: 13px;
  border-bottom: 1px solid #f1f5f9;
}
.pi-row:last-child { border-bottom: none; }

.pi-name {
  color: var(--text-primary, #1e293b);
  font-weight: 500;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-right: 8px;
}

.pi-qty {
  font-size: 13px;
  font-weight: 700;
  color: var(--primary, var(--primary-bright));
  white-space: nowrap;
  flex-shrink: 0;
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
.act-add     { background: var(--primary-soft); color: var(--primary-deep); }
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
  color: var(--primary, var(--primary-bright));
  font-weight: 600;
}
</style>
