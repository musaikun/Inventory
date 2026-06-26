<script setup>
import { ref } from 'vue'
import { useConfig } from '../composables/useConfig.js'
import { deviceId, deviceName, setDeviceName } from '../composables/useDeviceId.js'
import { useEscapeKey } from '../composables/useEscapeKey.js'
import { shopCode } from '../composables/useStore.js'
import { downloadItemTemplate } from '../composables/usePdfImporter.js'
import PdfImporterModal from './PdfImporterModal.vue'
import CsvMapperModal from './CsvMapperModal.vue'
import { pushSubscribed, pushLoading, pushSupported, subscribePush, unsubscribePush } from '../composables/usePush.js'

const props = defineProps({ isGuest: Boolean })
const emit = defineEmits(['close'])
useEscapeKey(() => emit('close'))

const {
  config, itemCount,
  loadFromCSV, loadFromCSVMapped, exportConfigCSV,
} = useConfig()

const status         = ref(null)  // { type: 'success'|'error', msg: String }
const showImporter   = ref(false)
const importerFile   = ref(null)  // PdfImporterModal に渡す事前ファイル
const showMapper     = ref(false)
const mapperCsvText  = ref('')
const mapperFilename = ref('')
const dragging       = ref(false)
const fileInput      = ref(null)
const mapperInput    = ref(null)

// ── 端末名 ───────────────────────────────────────────────────────────────────
const deviceNameInput = ref(deviceName.value)

function saveDeviceName() {
  setDeviceName(deviceNameInput.value)
}

function saveAndClose() {
  setDeviceName(deviceNameInput.value)
  emit('close')
}

// ── ファイル読み込み（CSV / PDF / Excel 自動判別）─────────────────────────────
function handleFile(file) {
  if (!file) return

  const isCsv   = /\.csv$/i.test(file.name)
  const isPdf   = /\.pdf$/i.test(file.name)
  const isExcel = /\.(xlsx|xls)$/i.test(file.name)

  if (!isCsv && !isPdf && !isExcel) {
    status.value = { type: 'error', msg: 'CSV / PDF / Excel ファイルを選択してください' }
    return
  }

  // PDF / Excel → プレビューモーダルで確認
  if (isPdf || isExcel) {
    status.value       = null
    importerFile.value = file
    showImporter.value = true
    return
  }

  // CSV → その場で直接読み込み
  const reader = new FileReader()
  reader.onload = e => {
    const text = e.target.result
    try {
      const result = loadFromCSV(text)
      status.value = { type: 'success', msg: `${result.count}件の品目を読み込みました` }
    } catch (err) {
      status.value = { type: 'error', msg: err.message }
    }
  }
  reader.readAsText(file, 'UTF-8')
}

function openMapper(file) {
  const reader = new FileReader()
  reader.onload = e => {
    mapperCsvText.value  = e.target.result
    mapperFilename.value = file.name
    showMapper.value     = true
    status.value         = null
  }
  reader.readAsText(file, 'UTF-8')
}

function onMapperImported({ mapping, csvText }) {
  try {
    const result = loadFromCSVMapped(csvText, mapping)
    showMapper.value = false
    status.value = { type: 'success', msg: `${result.count}件の品目を読み込みました` }
  } catch (err) {
    status.value = { type: 'error', msg: err.message }
    showMapper.value = false
  }
}

function onFileChange(e) { handleFile(e.target.files[0]) }
function onDrop(e)       { dragging.value = false; handleFile(e.dataTransfer.files[0]) }

function onImporterClose() {
  showImporter.value = false
  importerFile.value = null
}

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

// ── Excelテンプレート ダウンロード ─────────────────────────────────────────────
function onDownloadTemplate() {
  try {
    downloadItemTemplate()
    status.value = { type: 'success', msg: 'テンプレートをダウンロードしました' }
  } catch (err) {
    status.value = { type: 'error', msg: err.message }
  }
}

// ── 店舗コード ─────────────────────────────────────────────────────────────────
const codeCopied = ref(false)
function copyCode() {
  navigator.clipboard.writeText(shopCode.value).then(() => {
    codeCopied.value = true
    setTimeout(() => (codeCopied.value = false), 2000)
  })
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

      <!-- ゲストは品目変更不可 -->
      <div v-if="props.isGuest" class="guest-notice">
        参加中はホストが品目リストを管理します。<br>品目の変更はホスト端末から行ってください。
      </div>

      <!-- ドロップゾーン（CSV / PDF / Excel 全対応）※ゲストには非表示 -->
      <template v-else>
        <div
          class="drop-zone"
          :class="{ over: dragging }"
          @dragover.prevent="dragging = true"
          @dragleave="dragging = false"
          @drop.prevent="onDrop"
          @click="fileInput.click()"
        >
          <div class="drop-icon">📂</div>
          <div class="drop-label">ドラッグ or タップしてアップロード</div>
          <div class="drop-hint">CSV / PDF / Excel（.csv / .pdf / .xlsx）</div>
          <input ref="fileInput" type="file" accept=".csv,.pdf,.xlsx,.xls" class="hidden-input" @change="onFileChange" />
        </div>

        <!-- ステータスメッセージ -->
        <div v-if="status" class="msg" :class="status.type">
          {{ status.type === 'success' ? '✓' : '✗' }} {{ status.msg }}
        </div>
      </template>

      <!-- フォーマット不明CSVのマッピング取込（ゲストには非表示） -->
      <div v-if="!props.isGuest" class="mapper-row">
        <button class="mapper-trigger" @click="mapperInput.click()">
          🗂 フォーマット不明のCSVを列指定でインポート
        </button>
        <input ref="mapperInput" type="file" accept=".csv" class="hidden-input" @change="e => { if (e.target.files[0]) openMapper(e.target.files[0]) }" />
      </div>

      <!-- Excelテンプレート ダウンロード（ゲストには非表示） -->
      <button v-if="!props.isGuest" class="btn btn-secondary template-btn" @click="onDownloadTemplate">
        📥 Excelテンプレートをダウンロード
      </button>

      <!-- CSVフォーマット説明 -->
      <details class="format-help">
        <summary>フォーマットを確認（自作する場合）</summary>
        <div class="format-body">
          <p class="format-intro">上の「Excelテンプレート」を使うと、記入してそのまま .xlsx でアップロードできます。<br>1行目はヘッダー行（スキップされます）。列2以降は省略可能です。</p>

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

      <!-- 店舗コード -->
      <div v-if="shopCode" class="store-section">
        <div class="store-label">店舗コード</div>
        <div class="store-code-row">
          <span class="store-code-value">{{ shopCode }}</span>
          <button class="store-copy-btn" @click="copyCode">
            {{ codeCopied ? '✓ コピー済み' : 'コピー' }}
          </button>
        </div>
        <div class="store-hint">このコードで他の端末からも同じデータにアクセスできます</div>
      </div>

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
            @keyup.enter="saveAndClose"
          />
          <button class="device-save-btn" @click="saveAndClose">保存</button>
        </div>
        <div class="device-id-row">
          <span class="device-id-label">端末ID：</span>
          <span class="device-id-value">{{ deviceId.slice(0, 8) }}…</span>
        </div>
      </div>

      <!-- アクションボタン（ゲストは非表示） -->
      <div v-if="!props.isGuest" class="actions">
        <button class="btn btn-secondary" @click="downloadCSV">📤 CSV出力</button>
      </div>

      <!-- プッシュ通知 -->
      <div v-if="pushSupported" class="notif-section">
        <div class="device-label">棚卸リマインダー通知</div>
        <div class="notif-row">
          <span class="notif-desc">
            {{ pushSubscribed ? '月末・棚卸リマインダーを受信します' : '棚卸のリマインダーを通知で受け取れます' }}
          </span>
          <button
            class="notif-toggle"
            :class="{ on: pushSubscribed }"
            :disabled="pushLoading"
            @click="pushSubscribed ? unsubscribePush() : subscribePush()"
          >{{ pushSubscribed ? 'ON' : 'OFF' }}</button>
        </div>
      </div>

      <button class="btn btn-primary close-btn" @click="$emit('close')">閉じる</button>
    </div>
  </div>

  <!-- 棚卸記入表 変換モーダル（PDF/Excel時に自動表示） -->
  <PdfImporterModal
    v-if="showImporter"
    :initial-file="importerFile"
    @close="onImporterClose"
    @imported="result => { onImporterClose(); status = { type: 'success', msg: `${result.count}件の品目を読み込みました` } }"
  />

  <!-- CSVカラムマッピングモーダル -->
  <CsvMapperModal
    v-if="showMapper"
    :csv-text="mapperCsvText"
    :filename="mapperFilename"
    @imported="onMapperImported"
    @close="showMapper = false"
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

.template-btn {
  width: 100%;
  margin-bottom: 10px;
}
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

/* 店舗コード */
.store-section {
  margin-bottom: 16px;
  padding: 12px 14px;
  background: #eff6ff;
  border: 1.5px solid var(--primary);
  border-radius: 12px;
}

.store-label {
  font-size: 12px;
  font-weight: 700;
  color: var(--primary);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 8px;
}

.store-code-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
}

.store-code-value {
  font-size: 28px;
  font-weight: 800;
  color: var(--primary);
  letter-spacing: 0.2em;
  font-family: 'SF Mono', 'Menlo', monospace;
  flex: 1;
}

.store-copy-btn {
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 700;
  background: var(--primary);
  color: white;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  flex-shrink: 0;
  white-space: nowrap;
}
.store-copy-btn:active { opacity: 0.8; }

.store-hint {
  font-size: 11px;
  color: #3b82f6;
  line-height: 1.5;
}

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
.import-btn { width: 100%; margin-bottom: 12px; }
.close-btn  { width: 100%; margin-top: 4px; }

.mapper-row {
  margin-bottom: 10px;
}

.mapper-trigger {
  width: 100%;
  padding: 10px 14px;
  background: #f8fafc;
  border: 1.5px dashed var(--border);
  border-radius: 10px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-muted);
  cursor: pointer;
  text-align: left;
  -webkit-tap-highlight-color: transparent;
  transition: background 0.15s, border-color 0.15s;
}
.mapper-trigger:hover { background: #eff6ff; border-color: var(--primary); color: var(--primary); }

.guest-notice {
  padding: 14px 16px;
  background: #f0f9ff;
  border: 1.5px solid #bae6fd;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 600;
  color: #0369a1;
  line-height: 1.6;
  margin-bottom: 16px;
  text-align: center;
}

/* 通知設定 */
.notif-section {
  margin-bottom: 16px;
  padding: 12px 14px;
  background: #f8fafc;
  border: 1.5px solid var(--border);
  border-radius: 12px;
}
.notif-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.notif-desc {
  flex: 1;
  font-size: 13px;
  color: var(--text);
  line-height: 1.4;
}
.notif-toggle {
  flex-shrink: 0;
  min-width: 52px;
  padding: 7px 12px;
  font-size: 13px;
  font-weight: 700;
  border-radius: 20px;
  border: 2px solid var(--border);
  background: #e5e7eb;
  color: #6b7280;
  cursor: pointer;
  transition: background 0.2s, color 0.2s, border-color 0.2s;
  -webkit-tap-highlight-color: transparent;
}
.notif-toggle.on {
  background: var(--primary);
  color: #fff;
  border-color: var(--primary);
}
.notif-toggle:disabled { opacity: 0.6; cursor: default; }
</style>
