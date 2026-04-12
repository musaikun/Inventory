<script setup>
import { ref, watch } from 'vue'
import { useVoice, parseText } from './composables/useVoice.js'
import { useInventory } from './composables/useInventory.js'
import { useConfig } from './composables/useConfig.js'
import { useHistory } from './composables/useHistory.js'
import VoiceButton from './components/VoiceButton.vue'
import ConfirmModal from './components/ConfirmModal.vue'
import CandidateModal from './components/CandidateModal.vue'
import InventoryTable from './components/InventoryTable.vue'
import SettingsModal from './components/SettingsModal.vue'
import HistoryModal from './components/HistoryModal.vue'

// ── Config（動的品目リスト）────────────────────────────────────────────────────
const { config, dictionary, masterDict, registerAlias } = useConfig()

// ── Inventory ──────────────────────────────────────────────────────────────────
const { inventory, filledCount, totalValue, setItem, updateQty, removeItem, reset, exportCSV } = useInventory()

// ── History ────────────────────────────────────────────────────────────────────
const { saveSnapshot } = useHistory()

// 在庫が変わるたびに自動保存（空のときはスキップ）
watch(inventory, () => {
  if (Object.keys(inventory).length > 0) {
    saveSnapshot(inventory, config.prices, config.order)
  }
}, { deep: true })

// ── Settings / History modal ───────────────────────────────────────────────────
const showSettings = ref(false)
const showHistory  = ref(false)

// ── Modal state ────────────────────────────────────────────────────────────────
const confirmState   = ref(null) // { ingredient, qty, unit, existing }
const candidateState = ref(null) // { candidates, qty, unit }

// ── Transcript / テキスト検索 ──────────────────────────────────────────────────
const searchText   = ref('')
const searchStatus = ref('') // '' | 'active' | 'confirmed'

function setConfirmedMsg(msg) {
  searchText.value   = msg
  searchStatus.value = 'confirmed'
}

// ── Toast ──────────────────────────────────────────────────────────────────────
const toastMsg  = ref('')
const toastShow = ref(false)
let   toastTimer = null

function showToast(msg) {
  toastMsg.value  = msg
  toastShow.value = true
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toastShow.value = false), 2600)
}

// ── Dictionary matching ────────────────────────────────────────────────────────
function normalize(str) {
  return str
    .normalize('NFKC')  // 半角カタカナ→全角カタカナ、全角英数→半角英数
    .toLowerCase()
    .replace(/\s/g, '')
    .replace(/[\u30A1-\u30F6]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60))  // カタカナ→ひらがな
}

function scoreMatch(nTarget, nInput) {
  if (nTarget === nInput)              return 1000
  if (nTarget.startsWith(nInput))     return 500 + nInput.length
  if (nInput.startsWith(nTarget))     return 400 + nTarget.length
  if (nTarget.includes(nInput))       return 300 + nInput.length
  if (nInput.includes(nTarget))       return 200 + nTarget.length
  return 0
}

function findCandidates(name) {
  if (!name) return []
  const nInput = normalize(name)
  const seen   = new Map()

  // ① 辞書エイリアスとのマッチ（CSV定義 + 自動学習済み）
  for (const [alias, canonical] of Object.entries(dictionary.value)) {
    const score = scoreMatch(normalize(alias), nInput)
    if (score > 0 && score > (seen.get(canonical) ?? 0)) seen.set(canonical, score)
  }

  // ② 正式品目名そのものともマッチ（"コーヒー豆" → "コーヒー豆 ブラジル..." を拾う）
  for (const canonical of config.order) {
    const score = scoreMatch(normalize(canonical), nInput)
    // エイリアス経由より若干低いスコアで登録（エイリアスを優先）
    const adjusted = score > 0 ? Math.max(score - 50, 1) : 0
    if (adjusted > 0 && adjusted > (seen.get(canonical) ?? 0)) seen.set(canonical, adjusted)
  }

  // ③ マスター辞書（1キーワード→複数品目）
  for (const [keyword, canonicals] of Object.entries(masterDict)) {
    const score = scoreMatch(normalize(keyword), nInput)
    if (score > 0) {
      for (const canonical of canonicals) {
        if (!config.order.includes(canonical)) continue
        if (score > (seen.get(canonical) ?? 0)) seen.set(canonical, score)
      }
    }
  }

  return [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c)
}

// ── 検索共通処理（音声・テキスト兼用）────────────────────────────────────────
function runSearch(raw) {
  const { name, qty, unit } = parseText(raw)
  const matched = name ? findCandidates(name) : []
  candidateState.value = { searchTerm: name ?? raw, matched, qty, unit }
}

// ── 連続音声モード ─────────────────────────────────────────────────────────────
const continuousMode = ref(false)

// ── Voice ──────────────────────────────────────────────────────────────────────
function onVoiceResult(raw) {
  searchText.value   = raw
  searchStatus.value = ''
  runSearch(raw)
}

const { isListening, liveText, toggle, start: startVoice, stop: stopVoice } = useVoice(onVoiceResult)

watch(liveText, v => {
  if (isListening.value) {
    searchText.value   = v
    searchStatus.value = 'active'
  }
})

/** 連続モード開始 */
function onStartContinuous() {
  continuousMode.value = true
  if (!isListening.value) startVoice()
}

/** 連続モード停止 */
function onStopContinuous() {
  continuousMode.value = false
  if (isListening.value) stopVoice()
}

/** 確定 or キャンセル後に連続モードなら次の音声認識を開始 */
function _restartIfContinuous() {
  if (!continuousMode.value) return
  setTimeout(() => {
    if (continuousMode.value && !isListening.value) startVoice()
  }, 400)
}

// ── テキスト検索 ───────────────────────────────────────────────────────────────
function onTextSearch() {
  const raw = searchText.value.trim()
  if (!raw) return
  searchStatus.value = ''
  runSearch(raw)
}

// ── Confirm modal ──────────────────────────────────────────────────────────────
function openConfirm(ingredient, qty, unit) {
  confirmState.value = {
    ingredient,
    qty,
    unit: unit || config.units?.[ingredient] || '',
    existing: inventory[ingredient] ?? null,
  }
}

function onConfirm({ ingredient, qty, unit, isAdd }) {
  const existing  = confirmState.value.existing
  const rawFinal  = isAdd && existing ? existing.qty + qty : qty
  const finalQty  = Math.round(rawFinal * 10000) / 10000
  setItem(ingredient, qty, unit, isAdd)
  const label = isAdd ? `追加 → 合計 ${finalQty}${unit}` : `${finalQty}${unit}`
  setConfirmedMsg(`✓ ${ingredient}　${label}`)
  showToast(isAdd ? `${ingredient} に追加しました` : `${ingredient} を更新しました`)
  confirmState.value = null
  _restartIfContinuous()
}

function onCancelConfirm() {
  confirmState.value = null
  _restartIfContinuous()
}

// ── Candidate modal ────────────────────────────────────────────────────────────
function onCandidateSelect(canonical) {
  const { qty, unit, searchTerm } = candidateState.value
  candidateState.value = null
  registerAlias(searchTerm, canonical)
  openConfirm(canonical, qty, unit)
}

function onCancelCandidate() {
  candidateState.value = null
  _restartIfContinuous()
}

// マイクなしで棚卸表から直接タップした場合（qty=null → 数量未入力で確認画面へ）
function onTableTap(item) {
  openConfirm(item, null, config.units?.[item] || '')
}

// ── Table handlers ─────────────────────────────────────────────────────────────
function onTableUpdate({ item, qty, unit }) {
  updateQty(item, qty, unit)
}

// ── Reset ──────────────────────────────────────────────────────────────────────
function onReset() {
  if (!confirm('棚卸データをすべてリセットしますか？')) return
  reset()
  showToast('リセットしました')
}

// ── CSV export ─────────────────────────────────────────────────────────────────
const zeroItems     = ref([])  // 数量0品目
const unfilledItems = ref([])  // 未入力品目

function onExport() {
  const zeros    = Object.entries(inventory)
    .filter(([, e]) => e.qty === 0)
    .map(([item]) => item)
  const unfilled = config.order
    .filter(item => !(item in inventory))

  if (zeros.length > 0 || unfilled.length > 0) {
    zeroItems.value     = zeros
    unfilledItems.value = unfilled
    return
  }
  doExport()
}

function doExport() {
  zeroItems.value     = []
  unfilledItems.value = []
  const csv  = exportCSV()
  const date = new Date().toISOString().slice(0, 10)
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `棚卸_${date}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
  showToast('CSVを保存しました')
}

// ── Date ───────────────────────────────────────────────────────────────────────
const dateStr = new Date().toLocaleDateString('ja-JP', {
  year: 'numeric', month: 'long', day: 'numeric', weekday: 'short',
})
</script>

<template>
  <div id="app">
    <!-- ヘッダー -->
    <header class="app-header">
      <h1>棚卸入力</h1>
      <div class="header-right">
        <div class="date">{{ dateStr }}</div>
        <button class="settings-btn" @click="showHistory = true" title="棚卸履歴">📅</button>
        <button class="settings-btn" @click="showSettings = true" title="品目リスト設定">⚙️</button>
      </div>
    </header>

    <!-- 音声入力 / テキスト検索 -->
    <section class="voice-section">
      <!-- 連続入力モード バナー -->
      <div v-if="continuousMode" class="continuous-banner">
        <span class="continuous-pulse"></span>
        <span class="continuous-label">連続入力モード</span>
        <span class="continuous-status">{{ isListening ? '聞いています…' : '次の発話を待っています' }}</span>
        <button class="continuous-stop-btn" @click="onStopContinuous">■ 停止</button>
      </div>

      <div class="voice-row">
        <VoiceButton
          :is-listening="isListening"
          :continuous-mode="continuousMode"
          @toggle="continuousMode ? onStopContinuous() : toggle()"
        />
        <!-- 連続入力モード開始ボタン（通常時のみ表示） -->
        <button v-if="!continuousMode" class="continuous-start-btn" @click="onStartContinuous">
          <span class="cs-icon">🔁</span>
          <span class="cs-label">連続<br>入力</span>
        </button>
      </div>

      <div class="search-row">
        <input
          type="text"
          v-model="searchText"
          :class="['search-input', searchStatus]"
          placeholder="例：ブラジル 3袋　（音声 or 入力）"
          @keyup.enter="onTextSearch"
          @focus="searchStatus = ''"
        />
        <button class="search-btn" @click="onTextSearch" title="検索">🔍</button>
      </div>
    </section>

    <!-- 棚卸テーブル -->
    <InventoryTable
      :inventory="inventory"
      :filled-count="filledCount"
      @update="onTableUpdate"
      @remove="removeItem"
      @reset="onReset"
      @tap="onTableTap"
    />

    <!-- 確認モーダル -->
    <ConfirmModal
      v-if="confirmState"
      :ingredient="confirmState.ingredient"
      :initial-qty="confirmState.qty"
      :initial-unit="confirmState.unit"
      :existing="confirmState.existing"
      :prev-month="config.prevMonths?.[confirmState.ingredient] ?? ''"
      @confirm="onConfirm"
      @cancel="onCancelConfirm"
    />

    <!-- 候補選択モーダル -->
    <CandidateModal
      v-if="candidateState"
      :search-term="candidateState.searchTerm"
      :matched="candidateState.matched"
      :qty="candidateState.qty"
      :unit="candidateState.unit"
      @select="onCandidateSelect"
      @cancel="onCancelCandidate"
    />

    <!-- フッター -->
    <div class="app-footer">
      <div v-if="totalValue != null" class="footer-total">
        在庫合計　<strong>¥{{ totalValue.toLocaleString('ja-JP') }}</strong>
      </div>
      <button class="btn-export" @click="onExport">💾 CSVを保存</button>
    </div>

    <!-- 未入力・数量0品目の確認モーダル -->
    <div v-if="zeroItems.length || unfilledItems.length" class="modal-overlay" @click.self="zeroItems = []; unfilledItems = []">
      <div class="modal-sheet">
        <div class="sheet-handle"></div>
        <div class="sheet-title">確認してください</div>

        <!-- 未入力品目 -->
        <template v-if="unfilledItems.length">
          <div class="zero-confirm-msg">
            以下の品目が<strong>未入力</strong>のため数量空欄でCSVに含まれます。
          </div>
          <ul class="zero-list">
            <li v-for="item in unfilledItems" :key="item" class="unfilled-item">{{ item }}</li>
          </ul>
        </template>

        <!-- 数量0品目 -->
        <template v-if="zeroItems.length">
          <div class="zero-confirm-msg" :style="unfilledItems.length ? 'margin-top:12px' : ''">
            以下の品目が<strong>在庫0</strong>として記録されます。
          </div>
          <ul class="zero-list">
            <li v-for="item in zeroItems" :key="item">{{ item }}</li>
          </ul>
        </template>

        <div class="actions">
          <button class="btn btn-secondary" @click="zeroItems = []; unfilledItems = []">戻る</button>
          <button class="btn btn-success" @click="doExport">このまま保存</button>
        </div>
      </div>
    </div>

    <!-- 設定モーダル -->
    <SettingsModal v-if="showSettings" @close="showSettings = false" />

    <!-- 履歴モーダル -->
    <HistoryModal v-if="showHistory" @close="showHistory = false" />

    <!-- トースト -->
    <Transition name="toast">
      <div v-if="toastShow" class="toast">{{ toastMsg }}</div>
    </Transition>
  </div>
</template>
