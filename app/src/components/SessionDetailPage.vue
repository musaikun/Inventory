<script setup>
import { ref, computed, reactive } from 'vue'
import { useHistory } from '../composables/useHistory.js'
import { useHorizontalSwipe } from '../composables/useSwipe.js'
import InventoryTable from './InventoryTable.vue'
import { participantStats as buildParticipantStats, sharedItemCounts, toEpochMs } from '../services/participantStats.js'
import ItemHistoryModal from './ItemHistoryModal.vue'
import { buildResultUrl, resultShareText, viewDaysRemaining } from '../services/resultShare.js'
import { buildSessionReport, findPrevSnapshot } from '../services/sessionReport.js'

const props = defineProps({
  snapshot: { type: Object, required: true },
  isHost:   { type: Boolean, default: true },
  // 共有リンクの組み立てに要る。未ログイン・未設定なら空で、共有UI自体を出さない。
  shopCode: { type: String, default: '' },
})
const emit = defineEmits(['back', 'patched'])

const { exportSnapshotCSV, getSnapshots, patchSnapshotItems } = useHistory()

const activeTab     = ref('items')
const dragOffset    = ref(0)

// 閲覧用の品目検索。**絞り込むだけ**で、無い品目を足す導線は持たない
// （入力画面の検索は「無ければ追加」へ繋がるが、完了済みの記録に足す意味は無い）。
// 絞り込み自体は InventoryTable の searchTerm がやる（仕入れ画面と同じ経路）。
const itemSearch = ref('')

// ── スナップショット → InventoryTable 用データへ変換 ───────────────────────────
const snapItems = computed(() => props.snapshot.items ?? [])

const snapInventory = computed(() => {
  const inv = {}
  for (const it of snapItems.value) {
    if (it.qty !== null && it.qty !== undefined) {
      inv[it.item] = { qty: it.qty, unit: it.unit ?? '' }
    }
  }
  return inv
})

const snapConfig = computed(() => {
  const order = [], categories = {}, prices = {}, codes = {}
  for (const it of snapItems.value) {
    order.push(it.item)
    if (it.category != null)  categories[it.item] = it.category
    if (it.unitPrice != null) prices[it.item]     = it.unitPrice
    if (it.code)              codes[it.item]       = it.code
  }
  return { order, categories, prices, codes, categoryCodes: {}, prevMonths: {}, lotSizes: {}, units: {} }
})

const snapFlags = computed(() => {
  const f = {}
  for (const it of snapItems.value) if (it.flagged) f[it.item] = true
  return Object.keys(f).length ? f : null
})

// ── ヘッダー集計 ──────────────────────────────────────────────────────────────
const filledCount = computed(() => snapItems.value.filter(it => it.qty !== null).length)
const totalCount  = computed(() => snapItems.value.length)

// ── 変更履歴 ──────────────────────────────────────────────────────────────────
const sortedLog = computed(() => {
  const log = props.snapshot.auditLog
  if (!Array.isArray(log) || !log.length) return []
  return [...log].reverse()
})
const hasAuditLog    = computed(() => sortedLog.value.length > 0)
const hasParticipants = computed(() => participantStats.value.length > 0)

// ── 訂正ウィンドウ（3日間 または 次のセッション完了まで）─────────────────────
const CORRECTION_DAYS = 3

const isLocked = computed(() => {
  if (props.snapshot.locked) return true   // 恒久ロック（新しい棚卸の完了で確定済み）
  const savedAt = new Date(props.snapshot.savedAt ?? props.snapshot.date)
  if (Date.now() - savedAt.getTime() > CORRECTION_DAYS * 86400_000) return true
  return getSnapshots().some(s =>
    s.sessionId !== props.snapshot.sessionId &&
    new Date(s.savedAt ?? s.date) > savedAt
  )
})

const correctionDaysRemaining = computed(() => {
  if (isLocked.value) return 0
  const savedAt   = new Date(props.snapshot.savedAt ?? props.snapshot.date)
  const remaining = CORRECTION_DAYS * 86400_000 - (Date.now() - savedAt.getTime())
  return Math.max(0, Math.ceil(remaining / 86400_000))
})

// ── 訂正モード ────────────────────────────────────────────────────────────────
const isEditing = ref(false)
const editQtys  = ref({})

// ── 結果の共有（完了済みのみ・ホストのみ）─────────────────────────────────────
// CSVではなく**アプリの画面のまま**見せるためのリンク。渡した相手には金額が出ない
// （Worker の _sanitizeForGuest が単価・小計・在庫金額を落とす）→ services/resultShare.js
const showShare  = ref(false)
const urlCopied  = ref(false)
const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

const shareUrl      = computed(() => buildResultUrl(props.shopCode, props.snapshot?.sessionId))
const canShare      = computed(() => !!shareUrl.value)
const shareDaysLeft = computed(() => viewDaysRemaining(props.snapshot))
const shareExpired  = computed(() => shareDaysLeft.value === 0)

async function onCopyShareUrl() {
  if (!shareUrl.value) return
  try {
    await navigator.clipboard.writeText(shareUrl.value)
    urlCopied.value = true
    setTimeout(() => urlCopied.value = false, 1500)
  } catch (_) { /* 権限が無い環境では黙って何もしない（URLは画面に出ている） */ }
}

async function onNativeShareResult() {
  if (!shareUrl.value) return
  try {
    await navigator.share({ title: '棚卸結果', text: resultShareText(props.snapshot), url: shareUrl.value })
  } catch (_) { /* ユーザーがキャンセル */ }
}

function onShareResultLine() {
  if (!shareUrl.value) return
  const text = `${resultShareText(props.snapshot)}\n${shareUrl.value}`
  window.open(`https://line.me/R/msg/text/?${encodeURIComponent(text)}`, '_blank', 'noopener')
}

function onShareResultMail() {
  if (!shareUrl.value) return
  const subject = encodeURIComponent('棚卸結果の共有')
  const body    = encodeURIComponent(`${resultShareText(props.snapshot)}\n\n${shareUrl.value}`)
  window.location.href = `mailto:?subject=${subject}&body=${body}`
}

function enterEdit() {
  const init = {}
  for (const it of snapItems.value) {
    init[it.item] = it.qty !== null && it.qty !== undefined ? it.qty : null
  }
  editQtys.value = init
  isEditing.value = true
}

function cancelEdit() {
  isEditing.value = false
}

function saveEdit() {
  const patches = {}
  for (const it of snapItems.value) {
    const orig    = it.qty !== null && it.qty !== undefined ? it.qty : null
    const edited  = editQtys.value[it.item]
    if (edited !== orig) patches[it.item] = { qty: edited }
  }
  if (Object.keys(patches).length === 0) { isEditing.value = false; return }
  // sessionId をキーに更新する（同じ日の別セッションを取り違えない）
  const updated = patchSnapshotItems(props.snapshot.sessionId ?? props.snapshot.date, patches)
  isEditing.value = false
  if (updated) emit('patched', updated)
}

function onQtyInput(itemName, e) {
  const v = e.target.value
  editQtys.value[it.item] = v === '' ? null : parseFloat(v)
}

function setEditQty(itemName, rawValue) {
  editQtys.value[itemName] = rawValue === '' ? null : parseFloat(rawValue)
}

// ── タブ制御（3パネル固定: items / participants / history）──────────────────
// パネルは常に3枚DOMに存在し、スムーズなスライドを実現する
const TAB_ORDER  = ['items', 'participants', 'history']
// 'report' はスライド対象外（下の3枚パネルとは別に描画する）。-1 のまま使わない。
const activeIdx  = computed(() => Math.max(0, TAB_ORDER.indexOf(activeTab.value)))

const swipe = useHorizontalSwipe({
  onLeft: () => {
    const idx = activeIdx.value
    if (idx === 0) {
      if (hasParticipants.value) activeTab.value = 'participants'
      else if (hasAuditLog.value) activeTab.value = 'history'
    } else if (idx === 1 && hasAuditLog.value) {
      activeTab.value = 'history'
    }
  },
  onRight: () => {
    const idx = activeIdx.value
    if (idx === 2) {
      activeTab.value = hasParticipants.value ? 'participants' : 'items'
    } else if (idx === 1) {
      activeTab.value = 'items'
    }
  },
  onDrag: (dx) => {
    if (dx === 0) { dragOffset.value = 0; return }
    const idx = activeIdx.value
    if (dx > 0 && idx === 0) return
    if (dx < 0 && idx === 2) return
    if (dx < 0 && idx === 1 && !hasAuditLog.value) return
    if (dx > 0 && idx === 2 && !hasParticipants.value) return
    dragOffset.value = dx
  },
})

const trackStyle = computed(() => {
  const base = -activeIdx.value * (100 / 3)
  if (dragOffset.value === 0) {
    return { transform: `translateX(${base}%)`, transition: 'transform 0.32s cubic-bezier(0.4, 0, 0.2, 1)' }
  }
  return { transform: `translateX(calc(${base}% + ${dragOffset.value}px))`, transition: 'none' }
})

// ── 参加者別 ──────────────────────────────────────────────────────────────────
// 集計は services/participantStats に置く（数え方の定義が要るため）。
// 件数は**操作単位（重複あり）**。同じ品目を別の担当者が直したら、それぞれ1件と数える。
function _durationLabel(ms) {
  const min = Math.max(1, Math.round(ms / 60000))
  if (min < 60) return `${min}分`
  const h = Math.floor(min / 60), m = min % 60
  return `${h}時間${m > 0 ? `${m}分` : ''}`
}

const participantStats = computed(() => buildParticipantStats(props.snapshot))

// 品目ごとの変更履歴。タイムスタンプのベタ書き（変更履歴タブ）では
// 「この品目に何が起きたか」を追えないので、品目から引ける導線を用意する。
const historyItem = ref(null)
function openItemHistory(item) { historyItem.value = item }

// 参加者ごとの開閉。件数は重複ありで数えるので人によっては行が長くなる。
// 既定は開いた状態（開かないと何も見えない画面にはしない）で、畳めるようにする。
// 閉じた人は id を持つ ＝ 未知の参加者は開いて出る。
const closedParticipants = reactive({})
const isParticipantOpen = (id) => !closedParticipants[id]
function toggleParticipant(id) {
  if (closedParticipants[id]) delete closedParticipants[id]
  else closedParticipants[id] = true
}

// 複数人が変更した品目。一覧で色を変えて、重複変更があったことを分かるようにする。
const sharedItems = computed(() => {
  const out = {}
  for (const [item, n] of Object.entries(sharedItemCounts(props.snapshot))) if (n > 1) out[item] = true
  return Object.keys(out).length ? out : null
})

// ── フォーマット ──────────────────────────────────────────────────────────────
function fmtDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })
}

// server を経由すると数値の時刻が文字列で返ることがあり、そのまま Date に渡すと
// Invalid Date になる。toEpochMs で数値へ揃えてから整形する。
function fmtTime(ts) {
  const ms = toEpochMs(ts)
  if (ms == null) return ''
  return new Date(ms).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
}

function fmtYen(n) {
  return '¥' + Math.round(n).toLocaleString('ja-JP')
}

function actionLabel(action) {
  const m = { new: '新規', add: '追加', overwrite: '上書き', remove: '削除', flag_recount: '🔖フラグ', unflag_recount: 'フラグ解除', order_set: '発注', order_clear: '発注取消' }
  return m[action] ?? action
}

function actionClass(action) {
  if (action === 'remove')    return 'act-remove'
  if (action === 'new')       return 'act-new'
  if (action === 'add')       return 'act-add'
  if (action === 'overwrite') return 'act-over'
  return 'act-flag'
}

// ── 完了後レポート（ホストのみ・金額を含む）───────────────────────────────────
// 品目を1行ずつ追う前に「この棚卸が信用できるか」を判断するための面。
// 合計金額だけを大きく出すと、単価未設定で一部しか計上されていない数字を
// 正しい在庫金額だと誤読させるため、金額に入っていない件数を必ず並べて出す。
const report = computed(() =>
  buildSessionReport(props.snapshot, findPrevSnapshot(props.snapshot, getSnapshots()))
)

function fmtDuration(ms) {
  if (!ms || ms < 0) return '—'
  const min = Math.round(ms / 60_000)
  if (min < 60) return `${min}分`
  return `${Math.floor(min / 60)}時間${String(min % 60).padStart(2, '0')}分`
}

function fmtSignedYen(n) {
  if (n == null) return '—'
  return (n > 0 ? '+' : '') + fmtYen(n)
}

function fmtSignedPct(n) {
  if (n == null) return ''
  return `${n > 0 ? '+' : ''}${n}%`
}

function diffClass(n) {
  if (n == null || n === 0) return ''
  return n > 0 ? 'diff-up' : 'diff-down'
}

function onDownload() {
  const csv  = exportSnapshotCSV(props.snapshot)
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url
  a.download = `棚卸_${props.snapshot.date}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div class="detail-page">

    <!-- ヘッダー -->
    <div class="detail-header">
      <button class="btn-back" @click="emit('back')">‹ 戻る</button>
      <div class="header-center">
        <div class="header-date">{{ fmtDate(snapshot.date) }}</div>
        <div class="header-meta">
          {{ filledCount }}/{{ totalCount }}品目入力済み
          <span v-if="snapshot.totalValue != null" class="header-total">{{ fmtYen(snapshot.totalValue) }}</span>
        </div>
      </div>
      <div class="header-right">
        <span v-if="!isLocked" class="correction-badge" @click="!isLocked && enterEdit()">
          ✏️ あと{{ correctionDaysRemaining > 0 ? correctionDaysRemaining + '日' : '今日まで' }}
        </span>
        <span v-else class="lock-badge">🔒 確定</span>
        <button v-if="isHost && canShare" class="btn-icon" @click="showShare = !showShare" title="結果を共有">📤</button>
        <button v-if="isHost" class="btn-icon" @click="onDownload" title="CSVダウンロード">💾</button>
      </div>
    </div>

    <!-- 結果の共有（アプリの見た目のまま渡す。CSVの代わり） -->
    <div v-if="showShare && canShare" class="share-panel">
      <div class="share-label">結果を共有</div>
      <p class="share-note">
        リンクを開いた人は、この画面と同じ品目一覧を見られます。
        <strong>単価・金額は表示されません。</strong>
      </p>
      <button class="share-url-row" @click="onCopyShareUrl">
        <span class="share-url-text">{{ shareUrl }}</span>
        <span class="share-url-copy">{{ urlCopied ? '✓' : '📋' }}</span>
      </button>
      <div class="share-btns">
        <button v-if="canNativeShare" class="share-btn" @click="onNativeShareResult">📤 共有</button>
        <button class="share-btn" @click="onShareResultLine">💬 LINE</button>
        <button class="share-btn" @click="onShareResultMail">✉️ メール</button>
      </div>
      <div :class="['share-expiry', { expired: shareExpired }]">
        <template v-if="shareExpired">⚠️ 閲覧期間が終了しています。リンクを開いても表示されません</template>
        <template v-else-if="shareDaysLeft">閲覧できるのはあと{{ shareDaysLeft }}日です</template>
      </div>
    </div>

    <!-- タブバー -->
    <div class="tab-bar">
      <button
        v-if="isHost"
        :class="['tab-btn', { active: activeTab === 'report' }]"
        @click="activeTab = 'report'"
      >レポート</button>
      <button :class="['tab-btn', { active: activeTab === 'items' }]" @click="activeTab = 'items'">品目一覧</button>
      <button
        :class="['tab-btn', { active: activeTab === 'participants' }]"
        :disabled="!hasParticipants"
        @click="activeTab = 'participants'"
      >参加者別{{ hasParticipants ? ` (${participantStats.length})` : '' }}</button>
      <button
        :class="['tab-btn', { active: activeTab === 'history' }]"
        :disabled="!hasAuditLog"
        @click="activeTab = 'history'"
      >変更履歴{{ hasAuditLog ? ` (${sortedLog.length})` : '' }}</button>
    </div>

    <!-- 品目の検索（品目一覧タブのみ）。スクロールする面の外に置いて、
         長い一覧をたどっている間も消えないようにする -->
    <div v-if="activeTab === 'items'" class="item-search-bar">
      <input
        v-model="itemSearch"
        type="search"
        class="item-search"
        placeholder="品目名で絞り込み"
        enterkeyhint="search"
      />
      <button v-if="itemSearch" class="item-search-clear" title="クリア" @click="itemSearch = ''">✕</button>
    </div>

    <!-- 完了後レポート（ホストのみ・金額を含む） -->
    <div v-if="activeTab === 'report'" class="report-panel">

      <!-- 在庫金額。信用できる数字かどうかを、金額のすぐ隣で分かるようにする -->
      <div class="rp-card rp-value">
        <div class="rp-value-label">在庫金額</div>
        <div class="rp-value-num">{{ report.value.total != null ? fmtYen(report.value.total) : '—' }}</div>
        <div v-if="report.value.partial" class="rp-warn">
          ⚠️ {{ report.value.unpricedCount }}品目は単価が未設定のため、この金額に含まれていません
        </div>
        <div v-else-if="report.value.total == null" class="rp-warn">
          単価が設定されていないため、金額を算出できません
        </div>
      </div>

      <!-- 概要 -->
      <div class="rp-card">
        <div class="rp-grid">
          <div class="rp-cell">
            <div class="rp-cell-num">{{ report.items.filled }}<span class="rp-cell-of">/{{ report.items.total }}</span></div>
            <div class="rp-cell-label">入力済み品目</div>
          </div>
          <div class="rp-cell" :class="{ 'rp-attn': report.items.missing > 0 }">
            <div class="rp-cell-num">{{ report.items.missing }}</div>
            <div class="rp-cell-label">未入力</div>
          </div>
          <div class="rp-cell" :class="{ 'rp-attn': report.items.flagged > 0 }">
            <div class="rp-cell-num">{{ report.items.flagged }}</div>
            <div class="rp-cell-label">要再確認</div>
          </div>
          <div class="rp-cell">
            <div class="rp-cell-num rp-cell-sm">{{ fmtDuration(report.activeMs) }}</div>
            <div class="rp-cell-label">所要時間</div>
          </div>
        </div>
      </div>

      <!-- 前回比 -->
      <div v-if="report.prev" class="rp-card">
        <div class="rp-card-title">前回（{{ report.prev.date }}）との比較</div>
        <div class="rp-diff-row">
          <span :class="['rp-diff-num', diffClass(report.prev.valueDiff)]">{{ fmtSignedYen(report.prev.valueDiff) }}</span>
          <span v-if="report.prev.valuePct != null" :class="['rp-diff-pct', diffClass(report.prev.valueDiff)]">
            {{ fmtSignedPct(report.prev.valuePct) }}
          </span>
        </div>
        <div class="rp-sub">
          前回 {{ report.prev.totalValue != null ? fmtYen(report.prev.totalValue) : '—' }}
          ／ 品目 {{ report.prev.addedItems }}件増・{{ report.prev.removedItems }}件減
        </div>

        <div v-if="report.prev.movers.length" class="rp-movers">
          <div class="rp-movers-title">金額の動きが大きい品目</div>
          <div v-for="m in report.prev.movers" :key="m.item" class="rp-mover">
            <span class="rp-mover-name">{{ m.item }}</span>
            <span :class="['rp-mover-diff', diffClass(m.diff)]">{{ fmtSignedYen(m.diff) }}</span>
          </div>
          <div v-if="report.prev.moversTruncated" class="rp-sub">
            ほか{{ report.prev.moversTruncated }}品目
          </div>
        </div>
      </div>
      <div v-else class="rp-card rp-empty">前回の棚卸が無いため、比較はありません</div>

      <!-- 担当者 -->
      <div v-if="report.people.count" class="rp-card">
        <div class="rp-card-title">担当者（{{ report.people.count }}名）</div>
        <div v-if="report.people.sharedItems" class="rp-sub">
          {{ report.people.sharedItems }}品目を複数人が入力しています
        </div>
        <div v-if="report.people.approximate" class="rp-warn">
          操作の記録が残っていないため、件数は品目単位の概算です
        </div>
        <div v-for="p in report.people.list" :key="p.name" class="rp-person">
          <span class="rp-person-name">{{ p.name }}</span>
          <span class="rp-person-meta">
            {{ p.count }}操作 / {{ p.itemCount }}品目<template v-if="p.sharedCount">（重複{{ p.sharedCount }}）</template>
          </span>
        </div>
      </div>
    </div>

    <!-- スライドパネル（3枚固定） -->
    <div
      v-else
      class="tab-panels-wrapper"
      @touchstart.passive="swipe.onTouchStart"
      @touchmove.passive="swipe.onTouchMove"
      @touchend.passive="swipe.onTouchEnd"
    >
      <div class="tab-panels-track" :style="trackStyle">

        <!-- 品目一覧 -->
        <div class="tab-panel tab-panel-items">
          <p class="items-hint">
            品目をタップすると、その品目の変更履歴が見られます<template v-if="sharedItems">。<span
              class="items-hint-shared">色つき</span>は複数人が変更した品目です</template>
          </p>
          <InventoryTable
            :inventory="snapInventory"
            :filled-count="filledCount"
            :read-only="true"
            :recount-flags="snapFlags"
            :highlight-items="sharedItems"
            :config-source="snapConfig"
            :search-term="itemSearch"
            @tap="openItemHistory"
          />
        </div>

        <!-- 参加者別 -->
        <div class="tab-panel tab-panel-scroll">
          <div v-if="!hasParticipants" class="empty-msg">参加者情報がありません</div>
          <div v-for="p in participantStats" :key="p.id" class="participant-section">
            <button
              class="participant-header"
              type="button"
              :aria-expanded="String(isParticipantOpen(p.id))"
              @click="toggleParticipant(p.id)"
            >
              <span class="participant-arrow">{{ isParticipantOpen(p.id) ? '▼' : '▶' }}</span>
              <span class="participant-name">{{ p.name }}</span>
              <div class="participant-meta">
                <span class="pmeta-chip">{{ p.count }}件</span>
                <span v-if="p.sharedCount" class="pmeta-chip pmeta-shared" title="他の担当者も変更した品目">
                  重複 {{ p.sharedCount }}品目
                </span>
                <span v-if="p.activeMs" class="pmeta-chip">⏱ {{ _durationLabel(p.activeMs) }}</span>
                <span v-if="p.totalValue != null" class="pmeta-chip pmeta-value">{{ fmtYen(p.totalValue) }}</span>
              </div>
            </button>
            <p v-if="p.approximate" v-show="isParticipantOpen(p.id)" class="participant-note">
              この棚卸には変更履歴が残っていないため、品目ごとの最終入力者だけを数えています
            </p>
            <div v-show="isParticipantOpen(p.id)" class="participant-items">
              <button
                v-for="(it, i) in p.entries" :key="`${it.item}-${i}`"
                class="pi-row" :class="{ shared: it.shared }"
                type="button"
                @click="openItemHistory(it.item)"
              >
                <span v-if="it.at" class="pi-at">{{ fmtTime(it.at) }}</span>
                <span class="pi-name">{{ it.item }}</span>
                <span v-if="it.action" class="pi-act" :class="actionClass(it.action)">{{ actionLabel(it.action) }}</span>
                <span class="pi-qty">{{ it.qty }}{{ it.unit }}</span>
              </button>
            </div>
          </div>
        </div>

        <!-- 変更履歴 -->
        <div class="tab-panel tab-panel-scroll">
          <div v-if="!hasAuditLog" class="empty-msg">変更履歴がありません</div>
          <div v-for="entry in sortedLog" :key="entry.id" class="log-entry">
            <div class="log-left">
              <span class="log-time">{{ fmtTime(entry.timestamp) }}</span>
              <span class="log-person">{{ entry.enteredBy || '—' }}</span>
            </div>
            <div class="log-right">
              <div class="log-item">{{ entry.ingredient }}</div>
              <div class="log-detail">
                <span :class="['action-badge', actionClass(entry.action)]">{{ actionLabel(entry.action) }}</span>
                <span v-if="entry.totalQty != null && entry.action !== 'flag_recount' && entry.action !== 'unflag_recount'" class="log-qty">
                  {{ entry.totalQty }}{{ entry.unit }}
                </span>
                <span v-if="entry.delta && entry.action === 'add'" class="log-delta">+{{ entry.delta }}</span>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>

    <!-- 訂正モード オーバーレイ -->
    <Transition name="edit-slide">
      <div v-if="isEditing" class="edit-overlay">
        <div class="edit-header">
          <button class="edit-header-btn" @click="cancelEdit">キャンセル</button>
          <span class="edit-header-title">訂正モード</span>
          <button class="edit-header-btn edit-header-save" @click="saveEdit">保存</button>
        </div>
        <div class="edit-notice">数量のみ修正できます。品目の追加・削除はできません。</div>
        <div class="edit-list">
          <template v-for="it in snapItems" :key="it.item">
            <div v-if="it.category && (snapItems.indexOf(it) === 0 || snapItems[snapItems.indexOf(it) - 1]?.category !== it.category)" class="edit-cat-header">
              {{ it.category }}
            </div>
            <div class="edit-row" :class="{ changed: editQtys[it.item] !== (it.qty ?? null) }">
              <span class="edit-item-name">{{ it.item }}</span>
              <input
                type="number"
                class="edit-qty-input"
                :value="editQtys[it.item] ?? ''"
                min="0"
                step="0.1"
                @input="setEditQty(it.item, $event.target.value)"
              />
              <span class="edit-unit">{{ it.unit }}</span>
            </div>
          </template>
        </div>
      </div>
    </Transition>

    <ItemHistoryModal
      v-if="historyItem"
      :snapshot="snapshot"
      :item="historyItem"
      @close="historyItem = null"
    />
  </div>
</template>

<style scoped>
.detail-page {
  height: 100dvh;
  background: var(--bg-secondary, #f8fafc);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* ── ヘッダー ── */
/* ── 品目の検索 ── */
.item-search-bar {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border, #e3e3e3);
  background: var(--surface, #fff);
}
.item-search {
  flex: 1; min-width: 0;
  border: 1.5px solid #e2e8f0; border-radius: 10px;
  padding: 9px 12px; font-size: 14px;
}
.item-search:focus { outline: none; border-color: #94a3b8; }
.item-search-clear {
  flex: none; border: none; background: transparent;
  font-size: 15px; padding: 6px 8px; cursor: pointer; opacity: .6;
}

/* ── 完了後レポート ── */
.report-panel { padding: 12px; display: flex; flex-direction: column; gap: 10px; overflow-y: auto; }
.rp-card {
  padding: 12px 14px; border: 1px solid var(--border, #e3e3e3);
  border-radius: 10px; background: var(--surface, #fff);
}
.rp-card-title { font-size: 13px; font-weight: 700; margin-bottom: 6px; }
.rp-sub  { font-size: 12px; opacity: .75; margin-top: 4px; }
.rp-warn { font-size: 12px; margin-top: 6px; color: var(--danger, #c0392b); font-weight: 600; line-height: 1.5; }
.rp-empty { font-size: 13px; opacity: .7; text-align: center; }

.rp-value-label { font-size: 12px; opacity: .75; }
.rp-value-num   { font-size: 28px; font-weight: 700; letter-spacing: -.02em; }

.rp-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.rp-cell { text-align: center; }
.rp-cell-num   { font-size: 20px; font-weight: 700; }
.rp-cell-sm    { font-size: 15px; }
.rp-cell-of    { font-size: 12px; font-weight: 400; opacity: .6; }
.rp-cell-label { font-size: 11px; opacity: .7; margin-top: 2px; }
.rp-attn .rp-cell-num { color: var(--danger, #c0392b); }

.rp-diff-row { display: flex; align-items: baseline; gap: 8px; }
.rp-diff-num { font-size: 22px; font-weight: 700; }
.rp-diff-pct { font-size: 14px; font-weight: 600; }
.diff-up   { color: var(--danger, #c0392b); }
.diff-down { color: var(--accent, #2d7d46); }

.rp-movers { margin-top: 10px; }
.rp-movers-title { font-size: 12px; font-weight: 600; opacity: .8; margin-bottom: 4px; }
.rp-mover {
  display: flex; justify-content: space-between; gap: 10px;
  padding: 5px 0; font-size: 13px; border-top: 1px solid var(--border, #eee);
}
.rp-mover-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rp-mover-diff { flex: none; font-weight: 600; }

.rp-person {
  display: flex; justify-content: space-between; gap: 10px;
  padding: 6px 0; font-size: 13px; border-top: 1px solid var(--border, #eee);
}
.rp-person-meta { flex: none; font-size: 12px; opacity: .75; }

/* ── 結果の共有 ── */
.share-panel {
  padding: 12px 14px 14px;
  border-bottom: 1px solid var(--border, #e3e3e3);
  background: var(--surface-2, #fafafa);
}
.share-label { font-size: 13px; font-weight: 700; margin-bottom: 6px; }
.share-note  { font-size: 12px; line-height: 1.5; margin: 0 0 8px; opacity: .85; }
.share-url-row {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 8px 10px; border: 1px solid var(--border, #ddd); border-radius: 8px;
  background: var(--surface, #fff); text-align: left; cursor: pointer;
}
.share-url-text {
  flex: 1; min-width: 0; font-size: 12px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.share-url-copy { flex: none; font-size: 14px; }
.share-btns { display: flex; gap: 8px; margin-top: 8px; }
.share-btn {
  flex: 1; padding: 9px 6px; font-size: 13px; border-radius: 8px;
  border: 1px solid var(--border, #ddd); background: var(--surface, #fff); cursor: pointer;
}
.share-expiry { margin-top: 8px; font-size: 12px; opacity: .8; }
.share-expiry.expired { color: var(--danger, #c0392b); opacity: 1; font-weight: 600; }

.detail-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px 12px;
  background: white;
  border-bottom: 1px solid #e2e8f0;
  flex-shrink: 0;
}

.btn-back {
  background: none;
  border: none;
  font-size: 18px;
  color: var(--primary, var(--primary-bright));
  cursor: pointer;
  padding: 4px 8px;
  flex-shrink: 0;
  transition: opacity 0.12s;
  -webkit-tap-highlight-color: transparent;
}
.btn-back:active { opacity: 0.5; }

.header-center {
  flex: 1;
  text-align: center;
  min-width: 0;
}

.header-date {
  font-size: 14px;
  font-weight: 700;
  color: var(--text-primary, #1e293b);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.header-meta {
  font-size: 11px;
  color: var(--text-muted, #64748b);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  flex-wrap: wrap;
}

.header-total {
  font-size: 12px;
  font-weight: 700;
  color: var(--primary, var(--primary-bright));
  background: var(--primary-weak);
  padding: 1px 7px;
  border-radius: 5px;
}

.btn-icon {
  background: none;
  border: none;
  font-size: 20px;
  cursor: pointer;
  padding: 4px;
  flex-shrink: 0;
  opacity: 0.7;
  transition: opacity 0.12s, transform 0.12s;
  -webkit-tap-highlight-color: transparent;
}
.btn-icon:active { opacity: 1; transform: scale(0.9); }

.header-right {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.correction-badge {
  font-size: 11px;
  font-weight: 700;
  color: #d97706;
  background: #fffbeb;
  border: 1px solid #fde68a;
  padding: 3px 9px;
  border-radius: 20px;
  cursor: pointer;
  white-space: nowrap;
  -webkit-tap-highlight-color: transparent;
}
.correction-badge:active { opacity: 0.7; }

.lock-badge {
  font-size: 11px;
  font-weight: 700;
  color: #64748b;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  padding: 3px 9px;
  border-radius: 20px;
  white-space: nowrap;
}

/* ── 訂正オーバーレイ ── */
.edit-overlay {
  position: absolute;
  inset: 0;
  background: #f8fafc;
  display: flex;
  flex-direction: column;
  z-index: 50;
}

.edit-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  background: white;
  border-bottom: 1px solid #e2e8f0;
  flex-shrink: 0;
}

.edit-header-title {
  font-size: 15px;
  font-weight: 700;
  color: #1e293b;
}

.edit-header-btn {
  background: none;
  border: none;
  font-size: 14px;
  color: var(--primary, var(--primary-bright));
  cursor: pointer;
  padding: 4px 8px;
  font-weight: 600;
  -webkit-tap-highlight-color: transparent;
}
.edit-header-save {
  color: #059669;
  font-size: 15px;
}

.edit-notice {
  font-size: 12px;
  color: #d97706;
  background: #fffbeb;
  border-bottom: 1px solid #fde68a;
  padding: 8px 16px;
  flex-shrink: 0;
}

.edit-list {
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.edit-cat-header {
  font-size: 11px;
  font-weight: 700;
  color: var(--text-muted, #64748b);
  background: #f1f5f9;
  padding: 6px 16px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.edit-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  background: white;
  border-bottom: 1px solid #f1f5f9;
  transition: background 0.15s;
}

.edit-row.changed {
  background: #fffbeb;
  border-left: 3px solid #f59e0b;
}

.edit-item-name {
  flex: 1;
  font-size: 13px;
  font-weight: 500;
  color: #1e293b;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.edit-qty-input {
  width: 72px;
  padding: 6px 8px;
  border: 1.5px solid #e2e8f0;
  border-radius: 8px;
  font-size: 15px;
  font-weight: 600;
  text-align: right;
  color: #1e293b;
  background: white;
  -webkit-appearance: none;
  appearance: none;
  flex-shrink: 0;
}
.edit-qty-input:focus {
  outline: none;
  border-color: var(--primary, var(--primary-bright));
  box-shadow: 0 0 0 2px rgba(59,130,246,0.15);
}

.edit-unit {
  font-size: 12px;
  color: #64748b;
  min-width: 28px;
  flex-shrink: 0;
}

.edit-slide-enter-active, .edit-slide-leave-active {
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
.edit-slide-enter-from, .edit-slide-leave-to {
  transform: translateX(100%);
}

/* ── タブバー ── */
.tab-bar {
  display: flex;
  background: white;
  border-bottom: 1.5px solid #e2e8f0;
  padding: 0 8px;
  flex-shrink: 0;
}

.tab-btn {
  flex: 1;
  padding: 10px 4px;
  background: none;
  border: none;
  border-bottom: 2.5px solid transparent;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted, #64748b);
  cursor: pointer;
  transition: color 0.2s, border-color 0.2s, transform 0.1s;
  -webkit-tap-highlight-color: transparent;
  white-space: nowrap;
}

.tab-btn.active {
  color: var(--primary, var(--primary-bright));
  border-bottom-color: var(--primary, var(--primary-bright));
}

.tab-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.tab-btn:not(:disabled):active { transform: scale(0.95); }

/* ── スライドパネル（3枚） ── */
.tab-panels-wrapper {
  flex: 1;
  overflow: hidden;
  min-height: 0;
  position: relative;
}

.tab-panels-track {
  position: absolute;
  top: 0;
  left: 0;
  display: flex;
  width: 300%;
  height: 100%;
  will-change: transform;
}

.tab-panel {
  width: 33.333%;
  height: 100%;
  overflow: hidden;
  padding: 12px 0 24px;
  box-sizing: border-box;
  touch-action: pan-y;
  -webkit-overflow-scrolling: touch;
}

.tab-panel-scroll {
  overflow-y: auto;
  padding: 12px 12px 24px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* 品目一覧タブも縦スクロールできるようにする（メイン画面同様、最後まで見える） */
.tab-panel-items {
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

/* ── 参加者別 ── */
.participant-section {
  background: white;
  border-radius: 14px;
  overflow: hidden;
  box-shadow: 0 1px 4px rgba(0,0,0,0.06);
}

.participant-header {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 12px 14px;
  background: #f8fafc;
  border: none;
  border-bottom: 1px solid #e2e8f0;
  flex-wrap: wrap;
  text-align: left;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.participant-arrow {
  font-size: 10px;
  width: 12px;
  flex-shrink: 0;
  color: var(--text-muted, #94a3b8);
}

.participant-name {
  font-size: 14px;
  font-weight: 700;
  color: var(--text-primary, #1e293b);
  flex-shrink: 0;
}

.participant-meta {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.pmeta-chip {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted, #64748b);
  background: #e2e8f0;
  padding: 2px 8px;
  border-radius: 10px;
}

.pmeta-value {
  color: var(--primary, var(--primary-bright));
  background: var(--primary-weak);
}

.participant-items {
  padding: 4px 0;
}

.pi-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 8px 14px;
  font-size: 13px;
  border: none;
  border-bottom: 1px solid #f1f5f9;
  background: none;
  text-align: left;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
/* 他の担当者も変更した品目 */
.pi-row.shared { background: #fff7ed; }
.pi-row.shared .pi-name { font-weight: 700; color: #9a3412; }
.pi-row:last-child { border-bottom: none; }

.items-hint {
  margin: 0;
  padding: 8px 14px 0;
  font-size: 11.5px;
  color: var(--text-muted, #94a3b8);
  line-height: 1.6;
}
.items-hint-shared {
  padding: 0 5px;
  border-radius: 4px;
  background: #fff7ed;
  color: #c2410c;
  font-weight: 700;
}

.participant-note {
  margin: 0 0 6px;
  font-size: 11.5px;
  color: var(--text-muted, #94a3b8);
  line-height: 1.6;
}

.pmeta-shared { background: #fff7ed !important; color: #c2410c !important; }

.pi-act {
  font-size: 11px;
  font-weight: 800;
  color: #64748b;
  flex-shrink: 0;
  margin-right: 8px;
}
.pi-act.act-new { color: #059669; }
.pi-act.act-add { color: #2563eb; }
.pi-act.act-over { color: #b45309; }
.pi-act.act-remove { color: #b91c1c; }

.pi-at {
  font-size: 11.5px;
  color: var(--text-muted, #94a3b8);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
  margin-right: 8px;
}

.pi-name {
  color: var(--text-primary, #1e293b);
  font-weight: 500;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-right: 8px;
}

.pi-qty {
  font-size: 13px;
  font-weight: 700;
  color: var(--primary, var(--primary-bright));
  white-space: nowrap;
  flex-shrink: 0;
}

/* ── 変更履歴 ── */
.empty-msg {
  text-align: center;
  color: var(--text-muted, #64748b);
  font-size: 13px;
  padding: 32px 16px;
}

.log-entry {
  display: flex;
  gap: 10px;
  background: white;
  border-radius: 12px;
  padding: 10px 14px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

.log-left {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  flex-shrink: 0;
  min-width: 64px;
}

.log-time {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-primary, #1e293b);
  font-variant-numeric: tabular-nums;
}

.log-person {
  font-size: 11px;
  color: var(--text-muted, #64748b);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 64px;
}

.log-right { flex: 1; min-width: 0; }

.log-item {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary, #1e293b);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-bottom: 4px;
}

.log-detail {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.action-badge {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 20px;
}

.act-new     { background: #dcfce7; color: #15803d; }
.act-add     { background: var(--primary-soft); color: var(--primary-deep); }
.act-over    { background: #fef9c3; color: #854d0e; }
.act-remove  { background: #fee2e2; color: #b91c1c; }
.act-flag    { background: #fff7ed; color: #9a3412; }

.log-qty {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-primary, #1e293b);
}

.log-delta {
  font-size: 11px;
  color: var(--primary, var(--primary-bright));
  font-weight: 600;
}
</style>
