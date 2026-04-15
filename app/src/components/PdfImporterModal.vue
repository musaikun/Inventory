<script setup>
import { ref, onMounted } from 'vue'
import { parseExcelFile, parsePdfFile, itemsToConfigCSV } from '../composables/usePdfImporter.js'
import { useConfig } from '../composables/useConfig.js'
import { useEscapeKey } from '../composables/useEscapeKey.js'

const props = defineProps({
  initialFile: { type: Object, default: null },  // File|null: 起動時に自動で処理するファイル
})

const emit = defineEmits(['close', 'imported'])
useEscapeKey(() => emit('close'))

const { loadFromCSV } = useConfig()

const dragging    = ref(false)
const fileInput   = ref(null)
const status      = ref(null)   // { type, msg }
const loading     = ref(false)
const preview     = ref([])     // [{ name, unit, category, code, packQty, prevMonth }]
const groupMap    = ref({})     // { カテゴリ: count }
const debugLines  = ref([])     // PDF解析失敗時のraw行
const showDetail  = ref(false)  // true=詳細一覧, false=カテゴリ集計

function applyItems(items) {
  if (items.length === 0) return false
  preview.value = items
  const gm = {}
  for (const { category } of items) {
    const key = category || '（カテゴリなし）'
    gm[key] = (gm[key] ?? 0) + 1
  }
  groupMap.value = gm
  status.value = { type: 'success', msg: `${items.length}件の品目を検出（${Object.keys(gm).length}カテゴリ）` }
  return true
}

async function handleFile(file) {
  if (!file) return
  const isPdf   = file.name.match(/\.pdf$/i)
  const isExcel = file.name.match(/\.(xlsx|xls)$/i)
  if (!isPdf && !isExcel) {
    status.value = { type: 'error', msg: 'PDFまたはExcelファイル（.pdf / .xlsx）を選択してください' }
    return
  }
  status.value     = null
  preview.value    = []
  debugLines.value = []
  showDetail.value = false
  loading.value    = true

  try {
    const buf = await file.arrayBuffer()
    if (isPdf) {
      const { items, debugLines: dl } = await parsePdfFile(buf)
      if (!applyItems(items)) {
        debugLines.value = dl
        status.value = { type: 'error', msg: '品目が見つかりませんでした。下記の解析結果を確認してください' }
      }
    } else {
      const items = parseExcelFile(buf)
      if (!applyItems(items)) {
        status.value = { type: 'error', msg: '品目が見つかりませんでした。ファイルの形式を確認してください' }
      }
    }
  } catch (err) {
    status.value = { type: 'error', msg: `読み込みエラー: ${err.message}` }
  } finally {
    loading.value = false
  }
}

function onDrop(e)       { dragging.value = false; handleFile(e.dataTransfer.files[0]) }
function onFileChange(e) { handleFile(e.target.files[0]) }

// 起動時に事前ファイルが渡されていれば自動で処理開始
onMounted(() => {
  if (props.initialFile) handleFile(props.initialFile)
})

function onImport() {
  try {
    const csv    = itemsToConfigCSV(preview.value)
    const result = loadFromCSV(csv)
    emit('imported', result)
    emit('close')
  } catch (err) {
    status.value = { type: 'error', msg: err.message }
  }
}
</script>

<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-sheet importer-sheet">
      <div class="sheet-handle"></div>
      <div class="sheet-title">棚卸記入表 → 品目リスト変換</div>

      <!-- ドロップゾーン -->
      <div
        class="drop-zone"
        :class="{ over: dragging, loading }"
        @dragover.prevent="dragging = true"
        @dragleave="dragging = false"
        @drop.prevent="onDrop"
        @click="!loading && fileInput.click()"
      >
        <template v-if="loading">
          <div class="drop-icon">⏳</div>
          <div class="drop-label">解析中...</div>
        </template>
        <template v-else>
          <div class="drop-icon">📄</div>
          <div class="drop-label">PDFまたはExcelをドラッグ or タップして選択</div>
          <div class="drop-hint">.pdf / .xlsx（30ページ一括対応）</div>
        </template>
        <input ref="fileInput" type="file" accept=".pdf,.xlsx,.xls" class="hidden-input" @change="onFileChange" />
      </div>

      <!-- ステータス -->
      <div v-if="status" class="msg" :class="status.type">
        {{ status.type === 'success' ? '✓' : '✗' }} {{ status.msg }}
      </div>

      <!-- プレビュー -->
      <div v-if="preview.length > 0" class="preview-section">
        <div class="preview-title-row">
          <span class="preview-title">品目一覧</span>
          <button class="toggle-btn" @click="showDetail = !showDetail">
            {{ showDetail ? 'カテゴリ集計' : '詳細一覧' }}
          </button>
        </div>

        <!-- カテゴリ集計ビュー -->
        <ul v-if="!showDetail" class="preview-list">
          <li v-for="(count, cat) in groupMap" :key="cat">
            <span class="cat-name">{{ cat }}</span>
            <span class="cat-count">{{ count }}件</span>
          </li>
        </ul>

        <!-- 詳細一覧ビュー -->
        <div v-else class="detail-table-wrap">
          <table class="detail-table">
            <thead>
              <tr>
                <th>商品名</th>
                <th>単位</th>
                <th>商品コード</th>
                <th>入数</th>
                <th>前月実績</th>
                <th>カテゴリ</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(item, idx) in preview" :key="idx">
                <td class="col-name">{{ item.name }}</td>
                <td class="col-unit">{{ item.unit }}</td>
                <td class="col-code">{{ item.code }}</td>
                <td class="col-num">{{ item.packQty }}</td>
                <td class="col-num">{{ item.prevMonth }}</td>
                <td class="col-cat">{{ item.category }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- デバッグ: 解析失敗時に1ページ目のraw行を表示 -->
      <details v-if="debugLines.length > 0" class="debug-section">
        <summary>解析結果（1ページ目）</summary>
        <pre class="debug-pre">{{ debugLines.join('\n') }}</pre>
      </details>

      <!-- アクション -->
      <div class="actions">
        <button class="btn btn-secondary" @click="$emit('close')">キャンセル</button>
        <button
          class="btn btn-primary"
          :disabled="preview.length === 0"
          @click="onImport"
        >
          品目リストとして読み込む
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.importer-sheet {
  max-height: 88vh;
  overflow-y: auto;
}

.drop-zone {
  border: 2px dashed var(--border);
  border-radius: 14px;
  padding: 28px 20px;
  text-align: center;
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s;
  margin-bottom: 14px;
}
.drop-zone.over,
.drop-zone:hover  { border-color: var(--primary); background: #eff6ff; }
.drop-zone.loading { cursor: default; opacity: 0.7; }

.drop-icon  { font-size: 36px; margin-bottom: 8px; }
.drop-label { font-size: 15px; font-weight: 600; color: var(--text); }
.drop-hint  { font-size: 12px; color: var(--text-muted); margin-top: 4px; }
.hidden-input { display: none; }

.msg {
  padding: 10px 14px;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 14px;
}
.msg.success { background: #f0fdf4; color: var(--success); }
.msg.error   { background: #fef2f2; color: var(--danger); }

.preview-section {
  margin-bottom: 16px;
}
.preview-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.preview-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.toggle-btn {
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 20px;
  border: 1px solid var(--primary);
  background: transparent;
  color: var(--primary);
  cursor: pointer;
  font-weight: 600;
}
.toggle-btn:hover { background: #eff6ff; }

.preview-list {
  list-style: none;
  border: 1px solid var(--border);
  border-radius: 10px;
  max-height: 260px;
  overflow-y: auto;
  background: var(--surface);
}
.preview-list li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 9px 14px;
  font-size: 13px;
  border-bottom: 1px solid var(--border);
}
.preview-list li:last-child { border-bottom: none; }
.cat-name  { color: var(--text); font-weight: 500; }
.cat-count { color: var(--text-muted); font-size: 12px; }

.detail-table-wrap {
  border: 1px solid var(--border);
  border-radius: 10px;
  max-height: 300px;
  overflow: auto;
  background: var(--surface);
}
.detail-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  white-space: nowrap;
}
.detail-table thead {
  position: sticky;
  top: 0;
  background: #f1f5f9;
  z-index: 1;
}
.detail-table th {
  padding: 7px 10px;
  text-align: left;
  font-size: 11px;
  font-weight: 700;
  color: var(--text-muted);
  border-bottom: 1px solid var(--border);
}
.detail-table td {
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  color: var(--text);
}
.detail-table tr:last-child td { border-bottom: none; }
.col-name { min-width: 120px; white-space: normal; word-break: break-all; font-weight: 500; }
.col-unit { color: var(--text-muted); }
.col-code { color: var(--text-muted); font-size: 11px; }
.col-num  { text-align: right; color: var(--text-muted); }
.col-cat  { color: var(--primary); font-size: 11px; }

.actions {
  display: flex;
  gap: 10px;
}
.btn:disabled { opacity: 0.4; cursor: not-allowed; }

.debug-section {
  margin-bottom: 14px;
  font-size: 12px;
  color: var(--text-muted);
}
.debug-section summary { cursor: pointer; font-weight: 600; padding: 4px 0; }
.debug-pre {
  margin-top: 8px;
  background: #1e293b;
  color: #e2e8f0;
  padding: 10px;
  border-radius: 8px;
  font-size: 11px;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 200px;
  overflow-y: auto;
}
</style>
