<script setup>
import { computed } from 'vue'
import { useEscapeKey } from '../composables/useEscapeKey.js'

const props = defineProps({
  participant: { type: Object, required: true },   // { id, name, isMe }
  auditLog:    { type: Array,  default: () => [] },
})
const emit = defineEmits(['close'])
useEscapeKey(() => emit('close'))

// このメンバーの変更だけを新しい順で抽出（auditLog はリアクティブなのでリアルタイム更新）
const entries = computed(() => {
  const { id, name } = props.participant
  return props.auditLog
    .filter(e => (e.enteredById ? e.enteredById === id : e.enteredBy === name))
    .slice()
    .reverse()
})

// 数量を伴う実入力の件数（フラグ操作を除く）
const qtyCount = computed(() =>
  entries.value.filter(e => e.action !== 'flag_recount' && e.action !== 'unflag_recount' && e.action !== 'remove').length
)

function fmtTime(ts) {
  const d = new Date(ts)
  if (isNaN(d)) return ''
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
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
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-sheet member-sheet">
      <div class="sheet-handle"></div>

      <div class="member-head">
        <div class="member-avatar">{{ (participant.name || '?').slice(0, 1) }}</div>
        <div class="member-head-body">
          <div class="member-name">
            {{ participant.name || '名前未設定' }}
            <span v-if="participant.isMe" class="member-me">あなた</span>
          </div>
          <div class="member-sub">入力 {{ qtyCount }}件 ・ 履歴 {{ entries.length }}件</div>
        </div>
        <span v-if="participant.present === false" class="member-left">退室済み</span>
        <span v-else class="member-live"><span class="member-live-dot"></span>リアルタイム</span>
      </div>

      <div class="member-log">
        <div v-if="entries.length === 0" class="member-empty">
          まだこのメンバーの入力はありません
        </div>
        <div v-for="entry in entries" :key="entry.id" class="log-entry">
          <div class="log-left">
            <span class="log-time">{{ fmtTime(entry.timestamp) }}</span>
          </div>
          <div class="log-right">
            <div class="log-item">{{ entry.ingredient }}</div>
            <div class="log-detail">
              <span :class="['action-badge', actionClass(entry.action)]">{{ actionLabel(entry.action) }}</span>
              <span
                v-if="entry.totalQty != null && entry.action !== 'flag_recount' && entry.action !== 'unflag_recount'"
                class="log-qty"
              >{{ entry.totalQty }}{{ entry.unit }}</span>
              <span v-if="entry.delta && entry.action === 'add'" class="log-delta">+{{ entry.delta }}</span>
            </div>
          </div>
        </div>
      </div>

      <button class="btn btn-secondary member-close" @click="$emit('close')">閉じる</button>
    </div>
  </div>
</template>

<style scoped>
.member-sheet {
  max-height: 88vh;
  display: flex;
  flex-direction: column;
}

.member-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border, #e2e8f0);
  margin-bottom: 10px;
}

.member-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: linear-gradient(135deg, #2563eb, #4f46e5);
  color: #fff;
  font-weight: 800;
  font-size: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.member-head-body { flex: 1; min-width: 0; }

.member-name {
  font-size: 16px;
  font-weight: 800;
  color: var(--text, #0f172a);
  display: flex;
  align-items: center;
  gap: 6px;
}
.member-me {
  font-size: 10px;
  font-weight: 700;
  background: #dbeafe;
  color: #1d4ed8;
  border-radius: 6px;
  padding: 1px 6px;
}
.member-sub {
  font-size: 12px;
  color: var(--text-muted, #64748b);
  margin-top: 2px;
}

.member-live {
  font-size: 10px;
  font-weight: 700;
  color: #16a34a;
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}
.member-live-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #22c55e;
  animation: member-pulse 1.4s ease-in-out infinite;
}
.member-left {
  font-size: 10px;
  font-weight: 700;
  color: #94a3b8;
  background: #f1f5f9;
  border-radius: 6px;
  padding: 2px 7px;
  flex-shrink: 0;
}
@keyframes member-pulse {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.3; }
}

.member-log {
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.member-empty {
  text-align: center;
  color: var(--text-muted, #94a3b8);
  font-size: 13px;
  padding: 32px 0;
}

.log-entry {
  display: flex;
  gap: 10px;
  padding: 9px 2px;
  border-bottom: 1px solid #f1f5f9;
}
.log-entry:last-child { border-bottom: none; }

.log-left { flex-shrink: 0; }
.log-time {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted, #64748b);
  font-variant-numeric: tabular-nums;
}

.log-right { flex: 1; min-width: 0; }
.log-item {
  font-size: 14px;
  font-weight: 700;
  color: var(--text, #0f172a);
}
.log-detail {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 2px;
}

.action-badge {
  font-size: 10px;
  font-weight: 700;
  border-radius: 5px;
  padding: 1px 6px;
}
.act-new    { background: #dcfce7; color: #166534; }
.act-add    { background: #dbeafe; color: #1d4ed8; }
.act-over   { background: #fef3c7; color: #b45309; }
.act-remove { background: #fee2e2; color: #991b1b; }
.act-flag   { background: #f1f5f9; color: #475569; }

.log-qty {
  font-size: 13px;
  font-weight: 700;
  color: var(--text, #0f172a);
}
.log-delta {
  font-size: 12px;
  font-weight: 700;
  color: #16a34a;
}

.member-close {
  width: 100%;
  margin-top: 12px;
}
</style>
