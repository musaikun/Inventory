<script setup>
import { ref } from 'vue'
import { parseExcelFile, parsePdfFile, itemsToConfigCSV } from '../composables/usePdfImporter.js'
import { useConfig } from '../composables/useConfig.js'

const emit = defineEmits(['close', 'imported'])

const { loadFromCSV } = useConfig()

const dragging    = ref(false)
const fileInput   = ref(null)
const status      = ref(null)   // { type, msg }
const loading     = ref(false)
const preview     = ref([])     // [{ name, unit, category }]
const groupMap    = ref({})     // { カテゴリ: count }
const debugLines  = ref([])     // PDF解析失敗時のraw行

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
  status.value  = null
  preview.value = []
  debugLines.value = []
  loading.value = true

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

      <!-- プレビュー：カテゴリ別集計 -->
      <div v-if="preview.length > 0" class="preview-section">
        <div class="preview-title">カテゴリ別件数</div>
        <ul class="preview-list">
          <li v-for="(count, cat) in groupMap" :key="cat">
            <span class="cat-name">{{ cat }}</span>
            <span class="cat-count">{{ count }}件</span>
          </li>
        </ul>
      </div>

      <!-- デバッグ: 解析失敗時に1ページ目のraw行を表示 -->
      <details v-if="debugLines.length > 0" class="debug-section">
        <summary>解析結果（1ページ目 先頭15行）</summary>
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
.preview-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 8px;
}
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
