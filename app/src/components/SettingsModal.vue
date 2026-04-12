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
          <p class="format-intro">1行目はヘッダー行（スキップされます）</p>

          <div class="col-table">
            <div class="col-row col-head">
              <span>列</span><span>項目名</span><span>説明</span>
            </div>
            <div class="col-row"><span>1</span><span>品目名</span><span>正式名称（必須）</span></div>
            <div class="col-row"><span>2</span><span>単位</span><span>袋・本・個・パックなど</span></div>
            <div class="col-row"><span>3</span><span>単価</span><span>省略可</span></div>
            <div class="col-row"><span>4</span><span>カテゴリ</span><span>ジャンル別表示に使用</span></div>
            <div class="col-row"><span>5</span><span>エイリアス</span><span>音声で呼ぶ別名・略称（カンマ区切り）</span></div>
          </div>

          <p class="format-intro" style="margin-top:10px">記入例：</p>
          <div class="example-table">
            <div class="ex-row ex-head">
              <span>品目名</span><span>単位</span><span>カテゴリ</span><span>エイリアス</span>
            </div>
            <div class="ex-row">
              <span>ビール（プレモル生樽）</span><span>本</span><span>酒類</span><span>生,ビール,プレモル</span>
            </div>
            <div class="ex-row">
              <span>牛乳　成分無調整　1Lパック</span><span>パック</span><span>乳製品</span><span>牛乳,ミルク</span>
            </div>
            <div class="ex-row">
              <span>レタス　1玉</span><span>玉</span><span>野菜</span><span>（省略可）</span>
            </div>
          </div>

          <p class="format-note">エイリアスを設定すると、音声で短縮名を言っても認識されます。<br>PDFから取込むと、品目名に応じてエイリアスが自動設定されます。</p>
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
.format-body p { margin: 4px 0; line-height: 1.5; }
.format-intro { font-size: 12px; color: var(--text-muted); }
.format-note  { font-size: 12px; color: var(--text-muted); margin-top: 8px !important; line-height: 1.6; }

/* 列説明テーブル */
.col-table {
  margin: 8px 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  font-size: 12px;
}
.col-row {
  display: grid;
  grid-template-columns: 24px 72px 1fr;
  gap: 0;
  border-bottom: 1px solid var(--border);
  align-items: center;
}
.col-row:last-child { border-bottom: none; }
.col-row > span {
  padding: 5px 8px;
  border-right: 1px solid var(--border);
}
.col-row > span:last-child { border-right: none; }
.col-head { background: #f1f5f9; font-weight: 700; color: var(--text); }
.col-row:not(.col-head) > span:first-child { color: var(--text-muted); text-align: center; }
.col-row:not(.col-head) > span:nth-child(2) { font-weight: 700; color: var(--primary); }

/* 記入例テーブル */
.example-table {
  margin: 6px 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  font-size: 11px;
}
.ex-row {
  display: grid;
  grid-template-columns: 2fr 48px 64px 1fr;
  border-bottom: 1px solid var(--border);
  align-items: center;
}
.ex-row:last-child { border-bottom: none; }
.ex-row > span {
  padding: 5px 7px;
  border-right: 1px solid var(--border);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ex-row > span:last-child { border-right: none; }
.ex-head { background: #f1f5f9; font-weight: 700; color: var(--text); }
.ex-row:not(.ex-head) > span:nth-child(2),
.ex-row:not(.ex-head) > span:nth-child(3) {
  color: var(--success);
  font-weight: 600;
}
.ex-row:not(.ex-head) > span:last-child { color: var(--primary); font-weight: 600; }

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
