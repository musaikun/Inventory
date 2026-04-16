<script setup>
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import { useVoice, parseText } from './composables/useVoice.js'
import { useInventory, applyRemoteUpdate, applyRemoteRemove } from './composables/useInventory.js'
import { useConfig, applyRemoteConfig } from './composables/useConfig.js'
import { useHistory } from './composables/useHistory.js'
import {
  useSync,
  setInventoryCallbacks, registerInventoryGetter,
  registerConfigGetter, setConfigCallback,
  setDoneCallback, setMessageCallback, setDissolvedCallback,
  broadcastUpdate, broadcastRemove, broadcastDone, broadcastConfig,
  markMessagesRead,
} from './composables/useSync.js'
import { deviceName } from './composables/useDeviceId.js'
import VoiceButton from './components/VoiceButton.vue'
import ConfirmModal from './components/ConfirmModal.vue'
import CandidateModal from './components/CandidateModal.vue'
import InventoryTable from './components/InventoryTable.vue'
import SettingsModal from './components/SettingsModal.vue'
import HistoryModal from './components/HistoryModal.vue'
import SyncModal from './components/SyncModal.vue'
import ChatModal from './components/ChatModal.vue'

// ── Config（動的品目リスト）────────────────────────────────────────────────────
const { config, dictionary, masterDict, registerAlias } = useConfig()

// ── Inventory ──────────────────────────────────────────────────────────────────
const {
  inventory, filledCount, totalValue,
  isCompleted, completedAt,
  entryLog,
  setItem, updateQty, removeItem, reset, exportCSV, undoLast,
  completeSession, reopenSession,
} = useInventory()

// ── History ────────────────────────────────────────────────────────────────────
const { saveSnapshot } = useHistory()


// ── Settings / History / Sync modal ────────────────────────────────────────────
const showSettings     = ref(false)
const showHistory      = ref(false)
const showSync         = ref(false)
const inventoryTableRef = ref(null)

// ── Sync ───────────────────────────────────────────────────────────────────────
const { state: syncState, isActive: syncActive, isHost: syncIsHost, participantList, joinRoom, unreadCount } = useSync()

// 受信ハンドラを登録（useInventory ↔ useSync を循環なしで接続）
setInventoryCallbacks(applyRemoteUpdate, applyRemoteRemove)
registerInventoryGetter(() => ({ ...inventory }))
registerConfigGetter(() => ({
  order:         config.order,
  units:         config.units,
  prices:        config.prices,
  categories:    config.categories,
  codes:         config.codes,
  categoryCodes: config.categoryCodes,
  prevMonths:    config.prevMonths,
  lotSizes:      config.lotSizes,
  dictionary:    config.dictionary,
  isCustom:      config.isCustom,
}))
setConfigCallback(applyRemoteConfig)
setDoneCallback((name) => showNotification('done', `${name} が棚卸を完了しました ✓`))
setMessageCallback((msgObj) => {
  // チャット画面が開いていないときだけポップアップ通知
  if (!showChat.value) showNotification('message', msgObj.text, msgObj.senderName)
})
setDissolvedCallback(() => {
  showChat.value = false
  showSync.value = false
  showNotification('dissolved', 'ルームが解散されました')
})

// URL パラメータ ?room=CODE があれば自動参加
onMounted(() => {
  const params = new URLSearchParams(window.location.search)
  const roomCode = params.get('room')
  if (roomCode) {
    // URL から room パラメータを除去（リフレッシュで再参加しないよう）
    const url = new URL(window.location.href)
    url.searchParams.delete('room')
    history.replaceState({}, '', url.pathname + (url.search !== '?' ? url.search : ''))

    joinRoom(roomCode)
      .then(() => showToast(`ルーム ${roomCode} に参加しました`))
      .catch(() => showToast(`ルーム ${roomCode} への参加に失敗しました`))
  }
})

// ── Modal state ────────────────────────────────────────────────────────────────
const confirmState   = ref(null) // { ingredient, qty, unit, unitLocked, existing }
const candidateState = ref(null) // { candidates, qty, unit }

// ── Transcript / テキスト検索 ──────────────────────────────────────────────────
const searchText     = ref('')
const searchStatus   = ref('') // '' | 'active'
const searchInputRef = ref(null)

// ── セッション管理 ─────────────────────────────────────────────────────────────
const completedAtDisplay = computed(() => {
  if (!completedAt.value) return ''
  const d = new Date(completedAt.value)
  return d.toLocaleDateString('ja-JP', { month: 'long', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
})

function onComplete() {
  if (filledCount.value === 0) {
    showToast('1件以上入力してから完了してください')
    return
  }
  if (!confirm('棚卸を完了しますか？\n完了後は読み取り専用になります。')) return
  completeSession()
  saveSnapshot(inventory, config.prices, config.order, config.codes, entryLog)
  undoItem.value = null
  if (continuousMode.value) onForceStop()
  showToast('棚卸を完了しました ✓')
  if (syncActive.value) broadcastDone()
}

function onReopen() {
  if (!confirm('完了した棚卸を再編集しますか？')) return
  reopenSession()
  showToast('編集モードに戻しました')
}

function onStartNew() {
  if (!confirm('新規棚卸を開始しますか？\n現在のデータはクリアされます（CSVは保存済みか確認してください）。')) return
  reset()
  undoItem.value = null
  showToast('新規棚卸を開始しました')
}

// ── Undo（直前の確定を1件戻す）────────────────────────────────────────────────
const undoItem = ref(null)  // { name, qty, unit } | null

function onUndo() {
  const restored = undoLast()
  if (restored) {
    // 取り消し後の状態をブロードキャスト（削除 or 以前の値に戻す）
    if (syncActive.value) {
      if (inventory[restored]) {
        broadcastUpdate(restored, inventory[restored].qty, inventory[restored].unit, inventory[restored].enteredBy ?? '')
      } else {
        broadcastRemove(restored)
      }
    }
    showToast(`↩ 「${restored}」を取り消しました`)
    searchText.value   = ''
    searchStatus.value = ''
  }
  undoItem.value = null
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

// ── 通知ポップアップ（完了通知・メッセージ・解散通知）──────────────────────────
const notification     = ref(null)  // { type, text, senderName }
let   notificationTimer = null

function showNotification(type, text, senderName = '') {
  notification.value = { type, text, senderName }
  clearTimeout(notificationTimer)
  notificationTimer = setTimeout(() => { notification.value = null }, 6000)
}

// ── チャットモーダル ───────────────────────────────────────────────────────────
const showChat = ref(false)
watch(showChat, (val) => { if (val) markMessagesRead() })

// ── ホスト: 品目リスト変更をルーム全員に同期 ─────────────────────────────────
watch(config, () => {
  if (syncIsHost.value && syncActive.value) {
    broadcastConfig({
      order:         config.order,
      units:         config.units,
      prices:        config.prices,
      categories:    config.categories,
      codes:         config.codes,
      categoryCodes: config.categoryCodes,
      prevMonths:    config.prevMonths,
      lotSizes:      config.lotSizes,
      dictionary:    config.dictionary,
      isCustom:      config.isCustom,
    })
  }
}, { deep: true })

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

// 資材・備品系品目が存在する場合のみ除外チップを表示
function isSupplyItem(canonical) {
  const cat = config.categories?.[canonical]
  if (!cat) return false
  return cat.includes('資材') || cat.includes('備品') || cat.includes('その他')
}

const hasSupplyItems = computed(() => config.order.some(item => isSupplyItem(item)))
// 'all' | 'exclude'（食材のみ） | 'only'（資材・備品のみ）
const searchFilter   = ref('all')

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

  let results = [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c)

  if (searchFilter.value === 'exclude') {
    results = results.filter(c => !isSupplyItem(c))
  } else if (searchFilter.value === 'only') {
    results = results.filter(c => isSupplyItem(c))
  }

  return results
}

// ── 検索共通処理（音声・テキスト兼用）────────────────────────────────────────
function runSearch(raw) {
  const { name, qty, unit } = parseText(raw)

  // 商品コード完全一致: parseText は数字を qty に抜き取るため
  // "A001" → name="A" のように壊れる。raw をそのまま照合する
  const rawTrimmed = raw.trim()
  if (rawTrimmed && config.codes) {
    for (const [item, code] of Object.entries(config.codes)) {
      if (code && code.trim() === rawTrimmed) {
        openConfirm(item, null, config.units?.[item] || '', 'search')
        return
      }
    }
  }

  const matched = name ? findCandidates(name) : []
  candidateState.value = { searchTerm: name ?? raw, matched, qty, unit }
}

// ── Voice（連続入力がデフォルト動作）─────────────────────────────────────────
const continuousMode = ref(false)

function onVoiceResult(raw) {
  searchText.value   = raw
  searchStatus.value = ''
  runSearch(raw)
}

const { isListening, liveText, start: startVoice, stop: stopVoice } = useVoice(onVoiceResult)

watch(liveText, v => {
  if (isListening.value) {
    searchText.value   = v
    searchStatus.value = 'active'
  }
})

/** ボタンタップの挙動:
 *  - 停止中（非連続）     → 連続モード開始＋認識開始
 *  - 連続モード＋認識中   → 連続モード停止＋認識停止
 *  - 連続モード＋待機中   → 認識を再開（連続モードは継続）
 */
function onVoiceButtonTap() {
  if (!continuousMode.value) {
    continuousMode.value = true
    startVoice()
  } else if (isListening.value) {
    continuousMode.value = false
    stopVoice()
  } else {
    // 待機中 → 再開
    startVoice()
  }
}

/** バナーの停止ボタン用（どの状態でも即停止） */
function onForceStop() {
  continuousMode.value = false
  stopVoice()
}

/** 確定 or キャンセル後に自動で次の音声認識を開始 */
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
// source: 'search'（テキスト/音声）| 'table'（棚卸表タップ）
function openConfirm(ingredient, qty, unit, source = 'search') {
  // TR行がfocusを持ったままだとEnterキーがTRの@keydownとModalのhandleKeydown
  // 両方に発火し、確定と同時に openConfirm(A) が再度呼ばれるバグを防ぐ
  document.activeElement?.blur()
  // PDF登録済みの単位を優先し、ロック状態にする
  const configUnit = config.units?.[ingredient]
  confirmState.value = {
    ingredient,
    qty,
    unit:       configUnit || unit || '',
    unitLocked: !!configUnit,          // PDF単位は変更不可
    existing:   inventory[ingredient] ?? null,
    source,
    lotSize:    config.lotSizes?.[ingredient] ?? '',
  }
}

function onConfirm({ ingredient, qty, unit, isAdd }) {
  const existing  = confirmState.value.existing
  const source    = confirmState.value.source
  const rawFinal  = isAdd && existing ? existing.qty + qty : qty
  const finalQty  = Math.round(rawFinal * 10000) / 10000
  setItem(ingredient, qty, unit, isAdd, deviceName.value || '自分')
  if (syncActive.value) broadcastUpdate(ingredient, finalQty, unit, deviceName.value || '自分')
  undoItem.value = { name: ingredient, qty: finalQty, unit }
  showToast(isAdd ? `${ingredient} に追加しました` : `${ingredient} を更新しました`)
  searchText.value   = ''
  searchStatus.value = ''

  if (source === 'table') {
    // テーブルタップ確定後 → 次の品目を自動オープン
    // :key="confirmState.ingredient" により ingredient 変化時に ConfirmModal を強制再マウント
    const nextItem = inventoryTableRef.value?.getNextVisibleItem(ingredient)
    if (nextItem) {
      openConfirm(nextItem, null, config.units?.[nextItem] || '', 'table')
    } else {
      confirmState.value = null  // リスト末尾: モーダルを閉じる
    }
  } else {
    confirmState.value = null
    nextTick(() => searchInputRef.value?.focus())
  }
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
  if (isCompleted.value) return   // 完了済みは編集不可
  openConfirm(item, null, config.units?.[item] || '', 'table')
}

// スワイプ左: 在庫0で即確定
function onTableZero(item) {
  if (isCompleted.value) return
  const unit = inventory[item]?.unit ?? config.units?.[item] ?? ''
  setItem(item, 0, unit, false, deviceName.value || '自分')
  undoItem.value = { name: item, qty: 0, unit }
  showToast(`${item} → 0 で確定`)
}

// ── Table handlers ─────────────────────────────────────────────────────────────
function onTableUpdate({ item, qty, unit }) {
  undoItem.value = null
  updateQty(item, qty, unit, deviceName.value || '自分')
  if (syncActive.value) broadcastUpdate(item, qty, unit, deviceName.value || '自分')
}

// ── Reset ──────────────────────────────────────────────────────────────────────
function onReset() {
  if (!confirm('入力データをすべてリセットしますか？')) return
  reset()
  undoItem.value = null
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
        <div v-if="deviceName" class="device-badge">{{ deviceName }}</div>
        <div class="date">{{ dateStr }}</div>
        <button
          class="settings-btn sync-btn"
          :class="{ active: syncActive }"
          @click="showSync = true"
          :title="syncActive ? `ルーム ${syncState.roomCode}（${participantList.length}名）` : '複数デバイス同期'"
        >
          <span v-if="syncActive" class="sync-badge">
            🔗<span class="sync-count">{{ participantList.length }}</span>
          </span>
          <span v-else>🔗</span>
        </button>
        <button class="settings-btn" @click="showHistory = true" title="棚卸履歴">📅</button>
        <button class="settings-btn" @click="showSettings = true" title="品目リスト設定">⚙️</button>
      </div>
    </header>

    <!-- 同期中バナー -->
    <div v-if="syncActive" class="sync-banner">
      <span class="sync-banner-dot"></span>
      <span class="sync-banner-text">
        <strong>{{ syncIsHost ? 'ホスト中' : '参加中' }}</strong>
        ・ルーム {{ syncState.roomCode }}
        ・{{ participantList.length }}名が接続
      </span>
      <button class="sync-banner-btn sync-msg-btn" @click="showChat = true" title="チャット">
        💬<span v-if="unreadCount > 0" class="unread-badge">!</span>
      </button>
      <button class="sync-banner-btn" @click="showSync = true">詳細</button>
    </div>

    <!-- 棚卸完了バナー -->
    <div v-if="isCompleted" class="complete-banner">
      <span class="complete-icon">✓</span>
      <span class="complete-text">棚卸完了 — {{ completedAtDisplay }}</span>
      <button class="reopen-btn" @click="onReopen">✏️ 編集に戻す</button>
    </div>

    <!-- 音声入力 / テキスト検索（完了時は非表示） -->
    <section v-if="!isCompleted" class="voice-section">
      <!-- 入力中ステータスバナー -->
      <div v-if="continuousMode" class="continuous-banner">
        <span class="continuous-pulse"></span>
        <span class="continuous-status">{{ isListening ? '聞いています…' : '認識停止中' }}</span>
        <button class="continuous-stop-btn" @click="onForceStop">■ 停止</button>
      </div>

      <VoiceButton
        :is-listening="isListening"
        :continuous-mode="continuousMode"
        @toggle="onVoiceButtonTap"
      />

      <div class="search-row">
        <input
          ref="searchInputRef"
          type="text"
          v-model="searchText"
          :class="['search-input', searchStatus]"
          placeholder="例：ブラジル 3袋　（音声 or 入力）"
          @keyup.enter="onTextSearch"
          @focus="searchStatus = ''"
        />
        <button class="search-btn" @click="onTextSearch" title="検索">🔍</button>
      </div>

      <!-- ↩ 戻すバー（直前の確定を取り消す） -->
      <div v-if="undoItem" class="undo-bar">
        <span class="undo-label">確定: {{ undoItem.name }}　{{ undoItem.qty }}{{ undoItem.unit }}</span>
        <button class="undo-btn" @click="onUndo">↩ 戻す</button>
      </div>

      <!-- 検索フィルターチップ（資材・備品系品目がある場合のみ表示） -->
      <div v-if="hasSupplyItems" class="search-filter-row">
        <span class="filter-label">🔍 検索対象：</span>
        <button
          class="filter-chip"
          :class="{ active: searchFilter === 'exclude' }"
          @click="searchFilter = searchFilter === 'exclude' ? 'all' : 'exclude'"
          type="button"
        >食材のみ</button>
        <button
          class="filter-chip"
          :class="{ active: searchFilter === 'only' }"
          @click="searchFilter = searchFilter === 'only' ? 'all' : 'only'"
          type="button"
        >資材・備品のみ</button>
      </div>
    </section>

    <!-- 棚卸テーブル -->
    <InventoryTable
      ref="inventoryTableRef"
      :inventory="inventory"
      :filled-count="filledCount"
      :read-only="isCompleted"
      @update="onTableUpdate"
      @remove="item => { removeItem(item); if (syncActive) broadcastRemove(item) }"
      @reset="onReset"
      @tap="onTableTap"
      @zero="onTableZero"
    />

    <!-- 確認モーダル（:key で ingredient 変化時に強制再マウント） -->
    <ConfirmModal
      v-if="confirmState"
      :key="confirmState.ingredient"
      :ingredient="confirmState.ingredient"
      :initial-qty="confirmState.qty"
      :initial-unit="confirmState.unit"
      :unit-locked="confirmState.unitLocked"
      :existing="confirmState.existing"
      :prev-month="config.prevMonths?.[confirmState.ingredient] ?? ''"
      :lot-size="confirmState.lotSize"
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
      <div class="footer-actions">
        <!-- 進行中 -->
        <template v-if="!isCompleted">
          <button class="btn-complete" @click="onComplete">✓ 棚卸完了</button>
          <button class="btn-export" @click="onExport">💾 CSV</button>
        </template>
        <!-- 完了済み -->
        <template v-else>
          <button class="btn-new-session" @click="onStartNew">＋ 新規棚卸</button>
          <button class="btn-export" @click="onExport">💾 CSV</button>
        </template>
      </div>
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

    <!-- 同期モーダル -->
    <SyncModal v-if="showSync" @close="showSync = false" />

    <!-- チャットモーダル -->
    <ChatModal v-if="showChat" @close="showChat = false" />

    <!-- 通知ポップアップ（完了通知・メッセージ・解散通知） -->
    <Transition name="notif-popup">
      <div v-if="notification" class="notif-overlay" @click="notification = null">
        <div class="notif-card" :class="notification.type">
          <div v-if="notification.type === 'message'" class="notif-sender">{{ notification.senderName }}</div>
          <div v-else-if="notification.type === 'done'" class="notif-done-icon">✓</div>
          <div v-else class="notif-done-icon">🔔</div>
          <div class="notif-text">{{ notification.text }}</div>
          <div class="notif-dismiss">タップで閉じる</div>
        </div>
      </div>
    </Transition>

    <!-- トースト -->
    <Transition name="toast">
      <div v-if="toastShow" class="toast">{{ toastMsg }}</div>
    </Transition>
  </div>
</template>

<style scoped>
/* ── 通知ポップアップ ── */
.notif-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.notif-card {
  background: #fff;
  border-radius: 24px;
  padding: 32px 28px 24px;
  max-width: 340px;
  width: 100%;
  text-align: center;
  box-shadow: 0 16px 56px rgba(0, 0, 0, 0.28);
}

.notif-sender {
  font-size: 12px;
  font-weight: 700;
  color: var(--primary);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 12px;
}

.notif-done-icon {
  font-size: 40px;
  color: var(--success);
  margin-bottom: 10px;
  line-height: 1;
}

.notif-text {
  font-size: 20px;
  font-weight: 700;
  color: var(--text);
  line-height: 1.5;
  margin-bottom: 18px;
  white-space: pre-wrap;
  word-break: break-word;
}

.notif-card.done .notif-text {
  color: var(--success);
}

.notif-dismiss {
  font-size: 12px;
  color: var(--text-muted);
}

.notif-popup-enter-active,
.notif-popup-leave-active {
  transition: opacity 0.2s ease, transform 0.25s ease;
}
.notif-popup-enter-from,
.notif-popup-leave-to {
  opacity: 0;
  transform: scale(0.88);
}

/* ── バナー内メッセージボタン ── */
.sync-msg-btn {
  position: relative;
  font-size: 16px;
  padding: 4px 8px;
}

.unread-badge {
  position: absolute;
  top: -3px;
  right: -3px;
  background: var(--danger);
  color: #fff;
  font-size: 9px;
  font-weight: 800;
  border-radius: 50%;
  width: 15px;
  height: 15px;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  pointer-events: none;
}
</style>
