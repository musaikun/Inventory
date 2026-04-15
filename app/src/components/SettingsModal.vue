<script setup>
import { ref } from 'vue'
import { useConfig } from '../composables/useConfig.js'
import { deviceId, deviceName, setDeviceName } from '../composables/useDeviceId.js'
import PdfImporterModal from './PdfImporterModal.vue'

const emit = defineEmits(['close'])
const {
  config, itemCount,
  loadFromCSV, exportConfigCSV, resetToDefault,
} = useConfig()

const status       = ref(null)  // { type: 'success'|'error', msg: String }
const showImporter = ref(false)
const dragging     = ref(false)
const fileInput    = ref(null)

// ── 端末名 ───────────────────────────────────────────────────────────────────
const deviceNameInput = ref(deviceName.value)

function saveDeviceName() {
  setDeviceName(deviceNameInput.value)
}

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
          <p class="format-intro">1行目はヘッダー行（スキップされます）。列2以降は省略可能です。</p>

          <div class="col-table">
            <div class="col-row col-head">
              <span>列</span><span>項目名</span><span>説明</span>
            </div>
            <div class="col-row"><span>1</span><span>品目名</span><span>正式名称（必須）</span></div>
            <div class="col-row"><span>2</span><span>単位</span><span>袋・本・個・パックなど（省略可）</span></div>
            <div class="col-row"><span>3</span><span>単価</span><span>在庫金額の計算に使用（省略可）</span></div>
            <div class="col-row"><span>4</span><span>カテゴリ</span><span>ジャンル別表示に使用（省略可）</span></div>
            <div class="col-row"><span>5</span><span>エイリアス</span><span>音声・検索で使う別名・略称、カンマ区切り（省略可）</span></div>
            <div class="col-row"><span>6</span><span>商品コード</span><span>コード入力で直接検索できる（省略可）</span></div>
            <div class="col-row"><span>7</span><span>分類コード</span><span>カテゴリの並び順を数値で制御（省略可）</span></div>
            <div class="col-row"><span>8</span><span>前月実績</span><span>入力画面にヒント表示（省略可）</span></div>
            <div class="col-row"><span>9</span><span>入数</span><span>仕入れ単位をヒント表示・入力ミス防止（省略可）</span></div>
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

      <!-- 端末名設定 -->
      <div class="device-section">
        <div class="device-label">端末名（マルチデバイス同期の準備）</div>
        <div class="device-row">
          <input
            v-model="deviceNameInput"
            type="text"
            class="device-input"
            placeholder="例: Aさん・厨房・ホール"
            maxlength="20"
            @blur="saveDeviceName"
            @keyup.enter="saveDeviceName"
          />
          <button class="device-save-btn" @click="saveDeviceName">保存</button>
        </div>
        <div class="device-id-row">
          <span class="device-id-label">端末ID：</span>
          <span class="device-id-value">{{ deviceId.slice(0, 8) }}…</span>
        </div>
      </div>

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

/* 端末名設定 */
.device-section {
  margin-bottom: 16px;
  padding: 12px 14px;
  background: #f8fafc;
  border: 1.5px solid var(--border);
  border-radius: 12px;
}

.device-label {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-muted);
  margin-bottom: 8px;
}

.device-row {
  display: flex;
  gap: 8px;
  margin-bottom: 6px;
}

.device-input {
  flex: 1;
  border: 1.5px solid var(--border);
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 14px;
  color: var(--text);
  background: white;
  outline: none;
  font-family: inherit;
}
.device-input:focus { border-color: var(--primary); }

.device-save-btn {
  padding: 8px 14px;
  font-size: 13px;
  font-weight: 700;
  background: var(--primary);
  color: white;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  flex-shrink: 0;
}
.device-save-btn:active { opacity: 0.8; }

.device-id-row {
  display: flex;
  align-items: center;
  gap: 4px;
}
.device-id-label { font-size: 11px; color: var(--text-muted); }
.device-id-value  { font-size: 11px; color: var(--text-muted); font-family: monospace; }

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
