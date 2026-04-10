<script setup>
import { ref } from 'vue'
import { useConfig } from '../composables/useConfig.js'
import PdfImporterModal from './PdfImporterModal.vue'

const emit = defineEmits(['close'])
const {
  config, itemCount,
  loadFromCSV, exportConfigCSV, resetToDefault,
  masterKeywordCount, exportMasterCSV, resetMaster,
} = useConfig()

const status       = ref(null)  // { type: 'success'|'error', msg: String }
const showImporter = ref(false)
const dragging  = ref(false)
const fileInput = ref(null)

// ── 品目リスト ファイル読み込み ────────────────────────────────────────────────
function handleFile(file) {
  if (!file) return
  if (!file.name.match(/\.csv$/i)) {
    status.value = { type: 'error', msg: 'CSVファイルを選択してください' }
    return
  }

  const reader = new FileReader()
  reader.onload = e => {
    try {
      const result = loadFromCSV(e.target.result)
      status.value = { type: 'success', msg: `${result.count}件の品目を読み込みました` }
    } catch (err) {
      status.value = { type: 'error', msg: err.message }
    }
  }
  reader.readAsText(file, 'UTF-8')
}

function onFileChange(e)   { handleFile(e.target.files[0]) }
function onDrop(e)         { dragging.value = false; handleFile(e.dataTransfer.files[0]) }

// ── 品目リスト CSVダウンロード ─────────────────────────────────────────────────
function downloadCSV() {
  const csv  = exportConfigCSV()
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = '棚卸品目リスト.csv'
  a.click()
  URL.revokeObjectURL(url)
}

// ── 品目リスト リセット ────────────────────────────────────────────────────────
function onReset() {
  if (!confirm('デフォルトの品目リストに戻しますか？\nアップロードした設定は削除されます。')) return
  resetToDefault()
  status.value = { type: 'success', msg: 'デフォルトに戻しました' }
}

// ── マスター辞書 CSVダウンロード ───────────────────────────────────────────────
function downloadMasterCSV() {
  const csv  = exportMasterCSV()
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = 'マスター辞書.csv'
  a.click()
  URL.revokeObjectURL(url)
}

// ── マスター辞書 リセット ──────────────────────────────────────────────────────
function onResetMaster() {
  if (!confirm('マスター辞書をすべて削除しますか？\n蓄積した学習データがリセットされます。')) return
  resetMaster()
}
</script>

<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-sheet">
      <div class="sheet-handle"></div>
      <div class="sheet-title">品目リスト設定</div>

      <!-- 現在の状態 -->
      <div class="status-bar" :class="config.isCustom ? 'custom' : 'default'">
        <span class="status-icon">{{ config.isCustom ? '📝' : '📋' }}</span>
        <span>
          {{ config.isCustom ? 'カスタム設定' : 'デフォルト設定' }}
          ／ {{ itemCount }}件
        </span>
      </div>

      <!-- ドロップゾーン -->
      <div
        class="drop-zone"
        :class="{ over: dragging }"
        @dragover.prevent="dragging = true"
        @dragleave="dragging = false"
        @drop.prevent="onDrop"
        @click="fileInput.click()"
      >
        <div class="drop-icon">📂</div>
        <div class="drop-label">CSVをドラッグ or タップしてアップロード</div>
        <div class="drop-hint">（UTF-8形式推奨）</div>
        <input ref="fileInput" type="file" accept=".csv" class="hidden-input" @change="onFileChange" />
      </div>

      <!-- ステータスメッセージ -->
      <div v-if="status" class="msg" :class="status.type">
        {{ status.type === 'success' ? '✓' : '✗' }} {{ status.msg }}
      </div>

      <!-- CSVフォーマット説明 -->
      <details class="format-help">
        <summary>CSVフォーマットを確認</summary>
        <div class="format-body">
          <p>1行目はヘッダー行（スキップされます）</p>
          <pre>品目名,単位,単価,カテゴリ,エイリアス
"コーヒー豆　ブラジルNo.2　中煎り　1kg袋",袋,2500,コーヒー豆,"ブラジル,中煎り"
"牛乳　成分無調整　1Lパック",パック,180,乳製品,"牛乳,ミルク"
"レタス　1玉",玉,120,野菜,</pre>
          <p>単位・単価・カテゴリ・エイリアスはすべて省略可。カテゴリを設定するとジャンル別並び替えが使えます。</p>
          <p style="margin-top:6px;color:#d97706">単位は「ml」「g」より「パック」「本」など数える単位を推奨します。</p>
        </div>
      </details>

      <!-- 棚卸記入表変換ボタン -->
      <button class="btn btn-primary import-btn" @click="showImporter = true">
        📊 棚卸記入表Excelから変換
      </button>

      <!-- アクションボタン -->
      <div class="actions">
        <button class="btn btn-secondary" @click="downloadCSV">📤 CSV出力</button>
        <button class="btn btn-secondary reset" @click="onReset" :disabled="!config.isCustom">
          🔄 デフォルトに戻す
        </button>
      </div>

      <!-- ── マスター辞書 セクション ── -->
      <div class="section-divider"></div>
      <div class="sheet-title" style="margin-top:4px">検索学習</div>

      <!-- 説明 -->
      <div class="master-desc">
        検索して品目を選ぶたびに、そのキーワードが自動的に学習されます。<br>
        品目リストCSVが差し替わっても学習データは保持されます。
      </div>

      <!-- 現在の状態 -->
      <div class="status-bar" :class="masterKeywordCount > 0 ? 'custom' : 'default'">
        <span class="status-icon">{{ masterKeywordCount > 0 ? '🧠' : '📭' }}</span>
        <span>
          {{ masterKeywordCount > 0 ? `${masterKeywordCount}件のキーワードを学習済み` : '未学習' }}
        </span>
      </div>

      <!-- アクションボタン -->
      <div class="actions">
        <button class="btn btn-secondary" @click="downloadMasterCSV" :disabled="masterKeywordCount === 0">
          📤 CSV出力
        </button>
        <button class="btn btn-secondary reset" @click="onResetMaster" :disabled="masterKeywordCount === 0">
          🗑️ 学習リセット
        </button>
      </div>

      <button class="btn btn-primary close-btn" @click="$emit('close')">閉じる</button>
    </div>
  </div>

  <!-- 棚卸記入表 変換モーダル -->
  <PdfImporterModal
    v-if="showImporter"
    @close="showImporter = false"
    @imported="result => { showImporter = false; status = { type: 'success', msg: `${result.count}件の品目を読み込みました` } }"
  />
</template>

<style scoped>
.modal-sheet {
  max-height: 88vh;
  overflow-y: auto;
}

.status-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 16px;
}
.status-bar.default { background: #f1f5f9; color: var(--text-muted); }
.status-bar.custom  { background: #eff6ff; color: var(--primary); }

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
.drop-zone:hover { border-color: var(--primary); background: #eff6ff; }

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

.format-help {
  margin-bottom: 16px;
  font-size: 13px;
  color: var(--text-muted);
}
.format-help summary {
  cursor: pointer;
  font-weight: 600;
  padding: 4px 0;
}
.format-body {
  margin-top: 10px;
  padding: 12px;
  background: #f8fafc;
  border-radius: 8px;
}
.format-body pre {
  font-size: 11px;
  background: #1e293b;
  color: #e2e8f0;
  padding: 10px;
  border-radius: 6px;
  overflow-x: auto;
  margin: 8px 0;
  white-space: pre;
}
.format-body p { margin: 4px 0; line-height: 1.5; }

.section-divider {
  border-top: 1px solid var(--border);
  margin: 16px 0;
}

.master-desc {
  font-size: 13px;
  color: var(--text-muted);
  line-height: 1.6;
  margin-bottom: 14px;
  padding: 10px 14px;
  background: #f8fafc;
  border-radius: 10px;
}

.actions {
  display: flex;
  gap: 10px;
  margin-bottom: 12px;
}
.btn.reset:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.import-btn { width: 100%; margin-bottom: 12px; }
.close-btn  { width: 100%; margin-top: 4px; }
</style>
