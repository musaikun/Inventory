<script setup>
import { ref, computed } from 'vue'
import InventoryTable from './InventoryTable.vue'

const props = defineProps({
  result:       { type: Object, default: null },   // null = エラー（期間切れ・未完了・未発見）
  errorMessage: { type: String, default: '' },
})
const emit = defineEmits(['home'])

const activeTab = ref('items')

const snapItems = computed(() => props.result?.items ?? [])

// InventoryTable 用に変換（金額は持たない＝prices 空 → 金額列は出ない）
const snapInventory = computed(() => {
  const inv = {}
  for (const it of snapItems.value) {
    if (it.qty !== null && it.qty !== undefined) inv[it.item] = { qty: it.qty, unit: it.unit ?? '' }
  }
  return inv
})

const snapConfig = computed(() => {
  const order = [], categories = {}, codes = {}
  for (const it of snapItems.value) {
    order.push(it.item)
    if (it.category != null) categories[it.item] = it.category
    if (it.code)             codes[it.item]      = it.code
  }
  return { order, categories, prices: {}, codes, categoryCodes: {}, prevMonths: {}, lotSizes: {}, units: {} }
})

const snapFlags = computed(() => {
  const f = {}
  for (const it of snapItems.value) if (it.flagged) f[it.item] = true
  return Object.keys(f).length ? f : null
})

const filledCount = computed(() => snapItems.value.filter(it => it.qty !== null && it.qty !== undefined).length)
const totalCount  = computed(() => snapItems.value.length)

const participants = computed(() => props.result?.participants ?? [])
const hasParticipants = computed(() => participants.value.length > 0)

const sortedLog = computed(() => {
  const log = props.result?.auditLog
  if (!Array.isArray(log) || !log.length) return []
  return [...log].reverse()
})
const hasAuditLog = computed(() => sortedLog.value.length > 0)

function fmtDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })
}

function fmtTime(ts) {
  if (!ts) return ''
  return new Date(ts).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
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
</script>

<template>
  <div class="guest-page">

    <!-- ── エラー（期間切れ・未完了・未発見）── -->
    <div v-if="!result" class="guest-empty">
      <div class="guest-empty-icon">🔒</div>
      <div class="guest-empty-title">閲覧できません</div>
      <div class="guest-empty-msg">{{ errorMessage || 'この棚卸の閲覧期間が終了したか、まだ完了していません。' }}</div>
      <button class="guest-home-btn" @click="emit('home')">ホームへ</button>
    </div>

    <!-- ── 結果（読み取り専用・金額なし）── -->
    <template v-else>
      <div class="guest-header">
        <div class="header-center">
          <div class="header-date">{{ fmtDate(result.date) }}</div>
          <div class="header-meta">
            {{ filledCount }}/{{ totalCount }}品目入力済み
            <span class="guest-badge">👁 閲覧専用</span>
          </div>
        </div>
        <button class="btn-home" @click="emit('home')">ホーム</button>
      </div>

      <div class="tab-bar">
        <button :class="['tab-btn', { active: activeTab === 'items' }]" @click="activeTab = 'items'">品目一覧</button>
        <button
          :class="['tab-btn', { active: activeTab === 'participants' }]"
          :disabled="!hasParticipants"
          @click="activeTab = 'participants'"
        >参加者別{{ hasParticipants ? ` (${participants.length})` : '' }}</button>
        <button
          :class="['tab-btn', { active: activeTab === 'history' }]"
          :disabled="!hasAuditLog"
          @click="activeTab = 'history'"
        >変更履歴{{ hasAuditLog ? ` (${sortedLog.length})` : '' }}</button>
      </div>

      <div class="guest-body">
        <!-- 品目一覧 -->
        <div v-show="activeTab === 'items'" class="panel panel-items">
          <InventoryTable
            :inventory="snapInventory"
            :filled-count="filledCount"
            :read-only="true"
            :recount-flags="snapFlags"
            category-scope="all"
            :config-source="snapConfig"
          />
        </div>

        <!-- 参加者別 -->
        <div v-show="activeTab === 'participants'" class="panel panel-scroll">
          <div v-if="!hasParticipants" class="empty-msg">参加者情報がありません</div>
          <div v-for="p in participants" :key="p.name" class="participant-section">
            <div class="participant-header">
              <span class="participant-name">{{ p.name }}</span>
              <span class="pmeta-chip">{{ p.items.length }}品目</span>
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
        <div v-show="activeTab === 'history'" class="panel panel-scroll">
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
    </template>

  </div>
</template>

<style scoped>
.guest-page {
  height: 100dvh;
  background: var(--bg-secondary, #f8fafc);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* ── エラー ── */
.guest-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 32px;
  text-align: center;
}
.guest-empty-icon { font-size: 44px; }
.guest-empty-title { font-size: 18px; font-weight: 700; color: var(--text-primary, #1e293b); }
.guest-empty-msg { font-size: 14px; color: var(--text-muted, #64748b); max-width: 320px; line-height: 1.6; }
.guest-home-btn {
  margin-top: 8px;
  padding: 10px 24px;
  background: var(--primary, var(--primary-bright));
  color: white;
  border: none;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}

/* ── ヘッダー ── */
.guest-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px 12px;
  background: white;
  border-bottom: 1px solid #e2e8f0;
  flex-shrink: 0;
}
.header-center { flex: 1; text-align: center; min-width: 0; }
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
.guest-badge {
  font-size: 11px;
  font-weight: 700;
  color: #0369a1;
  background: #e0f2fe;
  border: 1px solid #bae6fd;
  padding: 1px 8px;
  border-radius: 20px;
}
.btn-home {
  background: none;
  border: none;
  font-size: 14px;
  color: var(--primary, var(--primary-bright));
  font-weight: 600;
  cursor: pointer;
  padding: 4px 8px;
  flex-shrink: 0;
  -webkit-tap-highlight-color: transparent;
}
.btn-home:active { opacity: 0.5; }

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
  transition: color 0.2s, border-color 0.2s;
  -webkit-tap-highlight-color: transparent;
  white-space: nowrap;
}
.tab-btn.active {
  color: var(--primary, var(--primary-bright));
  border-bottom-color: var(--primary, var(--primary-bright));
}
.tab-btn:disabled { opacity: 0.35; cursor: not-allowed; }

/* ── 本文 ── */
.guest-body { flex: 1; overflow: hidden; min-height: 0; position: relative; }
.panel { height: 100%; box-sizing: border-box; padding: 12px 0 24px; overflow: hidden; }
/* 品目一覧タブも縦スクロールできるようにする（最後の品目まで見える） */
.panel-items {
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}
.panel-scroll {
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 12px 12px 24px;
  display: flex;
  flex-direction: column;
  gap: 10px;
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
}
.participant-name { font-size: 14px; font-weight: 700; color: var(--text-primary, #1e293b); flex: 1; }
.pmeta-chip {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted, #64748b);
  background: #e2e8f0;
  padding: 2px 8px;
  border-radius: 10px;
}
.participant-items { padding: 4px 0; }
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
.pi-qty { font-size: 13px; font-weight: 700; color: var(--primary, var(--primary-bright)); white-space: nowrap; flex-shrink: 0; }

/* ── 変更履歴 ── */
.empty-msg { text-align: center; color: var(--text-muted, #64748b); font-size: 13px; padding: 32px 16px; }
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
.log-time { font-size: 12px; font-weight: 700; color: var(--text-primary, #1e293b); font-variant-numeric: tabular-nums; }
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
.log-detail { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.action-badge { font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 20px; }
.act-new     { background: #dcfce7; color: #15803d; }
.act-add     { background: var(--primary-soft); color: var(--primary-deep); }
.act-over    { background: #fef9c3; color: #854d0e; }
.act-remove  { background: #fee2e2; color: #b91c1c; }
.act-flag    { background: #fff7ed; color: #9a3412; }
.log-qty { font-size: 13px; font-weight: 700; color: var(--text-primary, #1e293b); }
.log-delta { font-size: 11px; color: var(--primary, var(--primary-bright)); font-weight: 600; }
</style>
