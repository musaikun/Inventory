<script setup>
import { ref, watch } from 'vue'
import { useVoice, parseText } from './composables/useVoice.js'
import { useInventory } from './composables/useInventory.js'
import { useConfig } from './composables/useConfig.js'
import VoiceButton from './components/VoiceButton.vue'
import ConfirmModal from './components/ConfirmModal.vue'
import CandidateModal from './components/CandidateModal.vue'
import InventoryTable from './components/InventoryTable.vue'
import SettingsModal from './components/SettingsModal.vue'

// ── Config（動的品目リスト）────────────────────────────────────────────────────
const { config } = useConfig()

// ── Inventory ──────────────────────────────────────────────────────────────────
const { inventory, filledCount, setItem, updateQty, removeItem, reset, exportCSV } = useInventory()

// ── Settings modal ─────────────────────────────────────────────────────────────
const showSettings = ref(false)

// ── Modal state ────────────────────────────────────────────────────────────────
const confirmState   = ref(null) // { ingredient, qty, unit, existing }
const candidateState = ref(null) // { candidates, qty, unit }

// ── Transcript ─────────────────────────────────────────────────────────────────
const transcriptMsg    = ref('例：「ブラジル 3袋」「牛乳 5」')
const transcriptStatus = ref('')

function setTranscript(msg, status = '') {
  transcriptMsg.value    = msg
  transcriptStatus.value = status
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
    .toLowerCase()
    .replace(/\s/g, '')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[\u30A1-\u30F6]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60))
}

function findCandidates(name) {
  if (!name) return []
  const nInput = normalize(name)
  const seen   = new Map()

  for (const [alias, canonical] of Object.entries(config.dictionary)) {
    const nAlias = normalize(alias)
    let score = 0
    if      (nAlias === nInput)              score = 1000
    else if (nAlias.startsWith(nInput))      score = 500 + nInput.length
    else if (nInput.startsWith(nAlias))      score = 400 + nAlias.length
    else if (nAlias.includes(nInput))        score = 300 + nInput.length
    else if (nInput.includes(nAlias))        score = 200 + nAlias.length
    if (score > 0 && score > (seen.get(canonical) ?? 0)) seen.set(canonical, score)
  }

  return [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c)
}

// ── Voice ──────────────────────────────────────────────────────────────────────
function onVoiceResult(raw) {
  setTranscript(`"${raw}"`)
  const { name, qty, unit } = parseText(raw)

  // 常に候補選択画面へ（品目を目視確認してから確定する）
  const matched = name ? findCandidates(name) : []
  candidateState.value = { searchTerm: name ?? '', matched, qty, unit }
}

const { isListening, liveText, toggle } = useVoice(onVoiceResult)

watch(liveText, v => {
  if (isListening.value) setTranscript(v, 'active')
})

// ── Confirm modal ──────────────────────────────────────────────────────────────
function openConfirm(ingredient, qty, unit) {
  confirmState.value = {
    ingredient,
    qty,
    unit,
    existing: inventory[ingredient] ?? null,
  }
}

function onConfirm({ ingredient, qty, unit, isAdd }) {
  const existing  = confirmState.value.existing
  const finalQty  = isAdd && existing ? existing.qty + qty : qty
  setItem(ingredient, qty, unit, isAdd)
  const label = isAdd ? `追加 → 合計 ${finalQty}${unit}` : `${finalQty}${unit}`
  setTranscript(`✓ ${ingredient}　${label}`, 'confirmed')
  showToast(isAdd ? `${ingredient} に追加しました` : `${ingredient} を更新しました`)
  confirmState.value = null
}

// ── Candidate modal ────────────────────────────────────────────────────────────
function onCandidateSelect(canonical) {
  const { qty, unit } = candidateState.value
  candidateState.value = null
  openConfirm(canonical, qty, unit)
}

// マイクなしで棚卸表から直接タップした場合（qty=null → 数量未入力で確認画面へ）
function onTableTap(item) {
  openConfirm(item, null, '')
}

// ── Table handlers ─────────────────────────────────────────────────────────────
function onTableUpdate({ item, qty, unit }) {
  updateQty(item, qty)
}

// ── Reset ──────────────────────────────────────────────────────────────────────
function onReset() {
  if (!confirm('棚卸データをすべてリセットしますか？')) return
  reset()
  showToast('リセットしました')
}

// ── CSV export ─────────────────────────────────────────────────────────────────
function onExport() {
  const csv = exportCSV()
  navigator.clipboard?.writeText(csv)
    .then(() => showToast('CSVをコピーしました'))
    .catch(() => fallbackCopy(csv))
    ?? fallbackCopy(csv)
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.cssText = 'position:fixed;top:-9999px'
  document.body.appendChild(ta)
  ta.select()
  document.execCommand('copy')
  document.body.removeChild(ta)
  showToast('CSVをコピーしました')
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
        <button class="settings-btn" @click="showSettings = true" title="品目リスト設定">⚙️</button>
      </div>
    </header>

    <!-- 音声入力 -->
    <section class="voice-section">
      <VoiceButton :is-listening="isListening" @toggle="toggle" />
      <div class="transcript-box" :class="transcriptStatus">
        {{ transcriptMsg }}
      </div>
    </section>

    <!-- 棚卸テーブル -->
    <InventoryTable
      :inventory="inventory"
      :filled-count="filledCount"
      @update="onTableUpdate"
      @remove="removeItem"
      @reset="onReset"
    />

    <!-- 確認モーダル -->
    <ConfirmModal
      v-if="confirmState"
      :ingredient="confirmState.ingredient"
      :initial-qty="confirmState.qty"
      :initial-unit="confirmState.unit"
      :existing="confirmState.existing"
      @confirm="onConfirm"
      @cancel="confirmState = null"
    />

    <!-- 候補選択モーダル -->
    <CandidateModal
      v-if="candidateState"
      :search-term="candidateState.searchTerm"
      :matched="candidateState.matched"
      :qty="candidateState.qty"
      :unit="candidateState.unit"
      @select="onCandidateSelect"
      @cancel="candidateState = null"
    />

    <!-- フッター -->
    <div class="app-footer">
      <button class="btn-export" @click="onExport">📋 CSVをコピー</button>
    </div>

    <!-- 設定モーダル -->
    <SettingsModal v-if="showSettings" @close="showSettings = false" />

    <!-- トースト -->
    <Transition name="toast">
      <div v-if="toastShow" class="toast">{{ toastMsg }}</div>
    </Transition>
  </div>
</template>
