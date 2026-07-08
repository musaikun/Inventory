<script setup>
import { ref, computed } from 'vue'
import { useHistory } from '../composables/useHistory.js'
import { useEscapeKey } from '../composables/useEscapeKey.js'

const emit = defineEmits(['close'])

useEscapeKey(() => {
  if (detailView.value) { detailView.value = null }
  else { emit('close') }
})

const { getSnapshots, deleteSnapshot, exportSnapshotCSV } = useHistory()
const snapshots = computed(() => getSnapshots())

// ── 詳細ビュー状態 ─────────────────────────────────────────────────────────────
// null | { snapDate: string, name: string, items: [], totalValue: number|null }
const detailView = ref(null)
const expandedCats = ref([])

function openDetail(snapDate, participantObj) {
  expandedCats.value = []
  detailView.value = {
    snapDate,
    name:       participantObj.name,
    items:      participantObj.items,
    totalValue: participantObj.totalValue,
  }
}

function closeDetail() {
  detailView.value = null
}

function toggleCat(cat) {
  const idx = expandedCats.value.indexOf(cat)
  if (idx >= 0) expandedCats.value.splice(idx, 1)
  else          expandedCats.value.push(cat)
}

const detailGroups = computed(() => {
  if (!detailView.value) return null
  const hasCats = detailView.value.items.some(it => it.category != null)
  if (!hasCats) return null
  const map = new Map()
  for (const it of detailView.value.items) {
    const cat = it.category ?? 'その他'
    if (!map.has(cat)) map.set(cat, [])
    map.get(cat).push(it)
  }
  return [...map.entries()].map(([cat, items]) => ({ cat, items }))
})

// ── 参加者行リスト構築 ─────────────────────────────────────────────────────────
function getParticipantRows(snap) {
  if (snap.participants && snap.participants.length > 0) {
    return snap.participants.filter(p => p.items.length > 0)
  }
  // 旧データ or 参加者情報なし → 入力済みを全品目として1行
  return [{
    name:       '全員',
    items:      snap.items.filter(it => it.qty !== null),
    totalValue: snap.totalValue,
  }]
}

// ── ユーティリティ ─────────────────────────────────────────────────────────────
function fmtDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })
}

function fmtShortDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('ja-JP', { month: 'long', day: 'numeric' })
}

function fmtYen(n) {
  return '¥' + Math.round(n).toLocaleString('ja-JP')
}

function onDownload(snapshot) {
  const csv  = exportSnapshotCSV(snapshot)
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `棚卸_${snapshot.date}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function onDelete(date) {
  if (!confirm(`${date} の履歴を削除しますか？`)) return
  deleteSnapshot(date)
}
</script>

<template>
  <div class="modal-overlay" @click.self="detailView ? closeDetail() : $emit('close')">
    <div class="modal-sheet history-sheet">
      <div class="sheet-handle"></div>

      <!-- ── 詳細ビュー ── -->
      <template v-if="detailView">
        <div class="detail-nav">
          <button class="back-btn" @click="closeDetail">← 戻る</button>
          <div class="detail-nav-info">
            <span class="detail-nav-date">{{ fmtShortDate(detailView.snapDate) }}</span>
            <span class="detail-nav-sep">·</span>
            <span class="detail-nav-name">{{ detailView.name }}</span>
          </div>
        </div>

        <div class="detail-meta">
          <span class="detail-count">{{ detailView.items.length }}品目</span>
          <span v-if="detailView.totalValue != null" class="detail-total">
            {{ fmtYen(detailView.totalValue) }}
          </span>
        </div>

        <div class="detail-body">
          <!-- カテゴリ別アコーディオン -->
          <template v-if="detailGroups">
            <div v-for="group in detailGroups" :key="group.cat" class="cat-group">
              <button class="cat-group-header" @click="toggleCat(group.cat)">
                <span class="cat-arrow">{{ expandedCats.includes(group.cat) ? '▼' : '▶' }}</span>
                <span class="cat-group-name">{{ group.cat }}</span>
                <span class="cat-group-count">{{ group.items.length }}品目</span>
                <span v-if="group.items.some(it => it.subtotal != null)" class="cat-group-total">
                  {{ fmtYen(group.items.reduce((s, it) => s + (it.subtotal ?? 0), 0)) }}
                </span>
              </button>
              <div v-if="expandedCats.includes(group.cat)" class="cat-group-body">
                <table class="detail-table">
                  <thead>
                    <tr>
                      <th class="th-name">品目</th>
                      <th class="th-num">数量</th>
                      <th v-if="group.items.some(it => it.unitPrice != null)" class="th-num">金額</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="it in group.items" :key="it.item">
                      <td class="td-name">
                        {{ it.item }}
                        <span v-if="it.flagged" class="hist-flag-badge">🔖</span>
                      </td>
                      <td class="td-num">{{ it.qty }}{{ it.unit }}</td>
                      <td v-if="group.items.some(it2 => it2.unitPrice != null)" class="td-num">
                        {{ it.subtotal != null ? fmtYen(it.subtotal) : '—' }}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
            <div v-if="detailView.totalValue != null" class="detail-summary-total">
              合計: <strong>{{ fmtYen(detailView.totalValue) }}</strong>
            </div>
          </template>

          <!-- フラットテーブル（カテゴリ情報なし・旧スナップショット） -->
          <template v-else>
            <table class="detail-table">
              <thead>
                <tr>
                  <th class="th-name">品目</th>
                  <th class="th-num">数量</th>
                  <th v-if="detailView.items.some(it => it.unitPrice != null)" class="th-num">金額</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="it in detailView.items" :key="it.item">
                  <td class="td-name">
                    {{ it.item }}
                    <span v-if="it.flagged" class="hist-flag-badge" title="あとで数えるフラグ付き">🔖</span>
                  </td>
                  <td class="td-num">{{ it.qty }}{{ it.unit }}</td>
                  <td v-if="detailView.items.some(it2 => it2.unitPrice != null)" class="td-num">
                    {{ it.subtotal != null ? fmtYen(it.subtotal) : '—' }}
                  </td>
                </tr>
              </tbody>
              <tfoot v-if="detailView.totalValue != null">
                <tr class="total-row">
                  <td>合計</td>
                  <td></td>
                  <td class="td-num total">{{ fmtYen(detailView.totalValue) }}</td>
                </tr>
              </tfoot>
            </table>
          </template>
        </div>
      </template>

      <!-- ── 履歴一覧ビュー ── -->
      <template v-else>
        <div class="sheet-title">棚卸履歴</div>

        <div v-if="!snapshots.length" class="empty-msg">
          まだ履歴がありません。<br>棚卸完了後に記録が残ります。
        </div>

        <div class="history-list">
          <div v-for="snap in snapshots" :key="snap.date" class="history-card">

            <!-- カードヘッダー -->
            <div class="card-header">
              <div class="card-info">
                <div class="card-date">{{ fmtDate(snap.date) }}</div>
                <div class="card-meta">
                  <span class="meta-count">
                    {{ snap.items.filter(it => it.qty !== null).length }} / {{ snap.items.length }}品目入力済み
                  </span>
                  <span v-if="snap.totalValue != null" class="meta-total">
                    {{ fmtYen(snap.totalValue) }}
                  </span>
                </div>
              </div>
              <div class="card-actions">
                <button class="icon-btn" @click="onDownload(snap)" title="CSVダウンロード">💾</button>
                <button class="icon-btn danger" @click="onDelete(snap.date)" title="削除">🗑</button>
              </div>
            </div>

            <!-- 参加者行リスト -->
            <div class="participant-list">
              <div
                v-for="(participant, idx) in getParticipantRows(snap)"
                :key="idx"
                class="participant-row"
                @click="openDetail(snap.date, participant)"
              >
                <div class="participant-info">
                  <span class="participant-name">{{ participant.name }}</span>
                  <span class="participant-count">{{ participant.items.length }}品目</span>
                  <span v-if="participant.totalValue != null" class="participant-total">
                    {{ fmtYen(participant.totalValue) }}
                  </span>
                </div>
                <span class="participant-arrow">▶</span>
              </div>
            </div>

          </div>
        </div>

        <button class="btn btn-primary close-btn" @click="$emit('close')">閉じる</button>
      </template>
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

.empty-msg {
  text-align: center;
  color: var(--text-muted);
  font-size: 14px;
  padding: 30px 20px;
  line-height: 1.8;
}

/* ── 履歴一覧 ── */
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
  background: var(--surface);
}

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
  background: var(--primary-weak);
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

/* ── 参加者行 ── */
.participant-list {
  border-top: 1px solid var(--border);
}

.participant-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid #f1f5f9;
  cursor: pointer;
  background: #fafafa;
  transition: background 0.12s;
  -webkit-tap-highlight-color: transparent;
}

.participant-row:last-child { border-bottom: none; }
.participant-row:active      { background: var(--primary-weak); }

.participant-info {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
}

.participant-name {
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
  flex-shrink: 0;
}

.participant-count {
  font-size: 12px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.participant-total {
  font-size: 12px;
  font-weight: 600;
  color: var(--primary);
  background: var(--primary-weak);
  padding: 1px 7px;
  border-radius: 5px;
  flex-shrink: 0;
}

.participant-arrow {
  font-size: 10px;
  color: var(--text-muted);
  flex-shrink: 0;
}

/* ── 詳細ビュー ── */
.detail-nav {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 2px 0 14px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 12px;
}

.back-btn {
  padding: 6px 12px;
  font-size: 13px;
  font-weight: 600;
  color: var(--primary);
  background: var(--primary-weak);
  border: none;
  border-radius: 8px;
  cursor: pointer;
  flex-shrink: 0;
}

.back-btn:active { opacity: 0.7; }

.detail-nav-info {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  overflow: hidden;
}

.detail-nav-date {
  color: var(--text-muted);
  white-space: nowrap;
}

.detail-nav-sep {
  color: var(--border);
  flex-shrink: 0;
}

.detail-nav-name {
  font-weight: 700;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail-meta {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-bottom: 10px;
}

.detail-count {
  font-size: 12px;
  color: var(--text-muted);
}

.detail-total {
  font-size: 14px;
  font-weight: 700;
  color: var(--primary);
  background: var(--primary-weak);
  padding: 2px 10px;
  border-radius: 6px;
}

.detail-body {
  flex: 1;
  overflow-y: auto;
  margin-bottom: 4px;
}

/* ── 詳細テーブル ── */
.detail-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  border: 1.5px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
}

.detail-table th {
  background: #1e3a8a;
  color: white;
  padding: 8px 10px;
  text-align: left;
  font-weight: 700;
  font-size: 11px;
}

.th-num { text-align: right; width: 70px; }

.detail-table td {
  padding: 8px 10px;
  border-top: 1px solid var(--border);
  color: var(--text);
  line-height: 1.4;
  word-break: keep-all;
  overflow-wrap: break-word;
}

.td-num { text-align: right; }
.hist-flag-badge { font-size: 11px; margin-left: 4px; }

.total-row td {
  font-weight: 700;
  background: #f0fdf4;
  border-top: 2px solid #86efac;
}

.total { color: var(--success); }

.close-btn { width: 100%; margin-top: 4px; }

/* ── カテゴリアコーディオン ── */
.cat-group {
  border: 1.5px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  margin-bottom: 8px;
}

.cat-group-header {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: var(--surface, #f8fafc);
  border: none;
  cursor: pointer;
  text-align: left;
  -webkit-tap-highlight-color: transparent;
}

.cat-group-header:active { background: var(--primary-weak); }

.cat-arrow {
  font-size: 10px;
  color: var(--text-muted);
  flex-shrink: 0;
  width: 12px;
}

.cat-group-name {
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
  flex: 1;
}

.cat-group-count {
  font-size: 12px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.cat-group-total {
  font-size: 12px;
  font-weight: 600;
  color: var(--primary);
  background: var(--primary-weak);
  padding: 1px 7px;
  border-radius: 5px;
  flex-shrink: 0;
}

.cat-group-body {
  border-top: 1px solid var(--border);
}

.cat-group-body .detail-table {
  border-radius: 0;
  border: none;
}

.detail-summary-total {
  text-align: right;
  font-size: 14px;
  color: var(--text-muted);
  padding: 10px 4px 4px;
}

.detail-summary-total strong {
  color: var(--success);
  font-size: 16px;
  margin-left: 4px;
}
</style>
