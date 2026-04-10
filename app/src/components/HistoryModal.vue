<script setup>
import { ref, computed } from 'vue'
import { useHistory } from '../composables/useHistory.js'

defineEmits(['close'])

const { getSnapshots, deleteSnapshot, exportSnapshotCSV } = useHistory()

const snapshots    = computed(() => getSnapshots())
const expandedDate = ref(null)
const copyMsg      = ref('')
let   copyTimer    = null

function toggle(date) {
  expandedDate.value = expandedDate.value === date ? null : date
}

function fmtDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })
}

function fmtYen(n) {
  return '¥' + Math.round(n).toLocaleString('ja-JP')
}

async function onCopy(snapshot) {
  const csv = exportSnapshotCSV(snapshot)
  try {
    await navigator.clipboard.writeText(csv)
  } catch (_) {
    const ta = document.createElement('textarea')
    ta.value = csv
    ta.style.cssText = 'position:fixed;top:-9999px'
    document.body.appendChild(ta); ta.select(); document.execCommand('copy')
    document.body.removeChild(ta)
  }
  copyMsg.value = `${snapshot.date} をコピーしました`
  clearTimeout(copyTimer)
  copyTimer = setTimeout(() => (copyMsg.value = ''), 2200)
}

function onDelete(date) {
  if (!confirm(`${date} の履歴を削除しますか？`)) return
  deleteSnapshot(date)
  if (expandedDate.value === date) expandedDate.value = null
}
</script>

<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-sheet history-sheet">
      <div class="sheet-handle"></div>
      <div class="sheet-title">棚卸履歴</div>

      <!-- コピー完了トースト -->
      <div v-if="copyMsg" class="copy-toast">✓ {{ copyMsg }}</div>

      <!-- 履歴なし -->
      <div v-if="!snapshots.length" class="empty-msg">
        まだ履歴がありません。<br>棚卸を入力すると自動保存されます。
      </div>

      <!-- 履歴リスト -->
      <div class="history-list">
        <div v-for="snap in snapshots" :key="snap.date" class="history-card">

          <!-- カードヘッダー -->
          <div class="card-header" @click="toggle(snap.date)">
            <div class="card-info">
              <div class="card-date">{{ fmtDate(snap.date) }}</div>
              <div class="card-meta">
                <span class="meta-count">{{ snap.items.length }}品目</span>
                <span v-if="snap.totalValue != null" class="meta-total">
                  {{ fmtYen(snap.totalValue) }}
                </span>
              </div>
            </div>
            <div class="card-actions">
              <button class="icon-btn" @click.stop="onCopy(snap)" title="CSVコピー">📋</button>
              <button class="icon-btn danger" @click.stop="onDelete(snap.date)" title="削除">🗑</button>
              <span class="chevron">{{ expandedDate === snap.date ? '▲' : '▼' }}</span>
            </div>
          </div>

          <!-- 展開詳細 -->
          <div v-if="expandedDate === snap.date" class="card-detail">
            <table class="detail-table">
              <thead>
                <tr>
                  <th class="th-name">品目</th>
                  <th class="th-num">数量</th>
                  <th v-if="snap.totalValue != null" class="th-num">金額</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="it in snap.items" :key="it.item">
                  <td class="td-name">{{ it.item }}</td>
                  <td class="td-num">{{ it.qty }}{{ it.unit }}</td>
                  <td v-if="snap.totalValue != null" class="td-num">
                    {{ it.subtotal != null ? fmtYen(it.subtotal) : '—' }}
                  </td>
                </tr>
              </tbody>
              <tfoot v-if="snap.totalValue != null">
                <tr class="total-row">
                  <td>合計</td>
                  <td></td>
                  <td class="td-num total">{{ fmtYen(snap.totalValue) }}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>

      <button class="btn btn-primary close-btn" @click="$emit('close')">閉じる</button>
    </div>
  </div>
</template>

<style scoped>
.history-sheet {
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  padding-bottom: 20px;
}

.copy-toast {
  font-size: 13px;
  color: var(--success);
  background: #f0fdf4;
  border-radius: 8px;
  padding: 8px 12px;
  text-align: center;
  margin-bottom: 10px;
  font-weight: 600;
}

.empty-msg {
  text-align: center;
  color: var(--text-muted);
  font-size: 14px;
  padding: 30px 20px;
  line-height: 1.8;
}

.history-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 14px;
  padding-right: 2px;
}

.history-card {
  border: 1.5px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 14px;
  cursor: pointer;
  background: var(--surface);
  transition: background 0.15s;
}
.card-header:active { background: #f8fafc; }

.card-date {
  font-size: 14px;
  font-weight: 700;
  color: var(--text);
  margin-bottom: 4px;
}

.card-meta {
  display: flex;
  gap: 10px;
  align-items: center;
}

.meta-count {
  font-size: 12px;
  color: var(--text-muted);
}

.meta-total {
  font-size: 13px;
  font-weight: 700;
  color: var(--primary);
  background: #eff6ff;
  padding: 2px 8px;
  border-radius: 6px;
}

.card-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.icon-btn {
  width: 34px;
  height: 34px;
  border-radius: 8px;
  border: 1.5px solid var(--border);
  background: white;
  font-size: 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.icon-btn.danger { border-color: #fca5a5; }
.icon-btn:active  { opacity: 0.7; }

.chevron {
  font-size: 11px;
  color: var(--text-muted);
  min-width: 14px;
  text-align: center;
}

/* 詳細テーブル */
.card-detail {
  border-top: 1px solid var(--border);
  overflow-x: auto;
  background: #fafafa;
}

.detail-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.detail-table th {
  background: #f1f5f9;
  padding: 7px 10px;
  text-align: left;
  font-weight: 700;
  color: var(--text-muted);
  font-size: 11px;
}

.th-num { text-align: right; width: 70px; }

.detail-table td {
  padding: 7px 10px;
  border-top: 1px solid var(--border);
  color: var(--text);
  line-height: 1.4;
  word-break: keep-all;
  overflow-wrap: break-word;
}

.td-num { text-align: right; }

.total-row td {
  font-weight: 700;
  background: #f0fdf4;
  border-top: 2px solid #86efac;
}

.total { color: var(--success); }

.close-btn { width: 100%; margin-top: 4px; }
</style>
