<script setup>
import { ref, computed } from 'vue'
import { useConfig } from '../composables/useConfig.js'
import { useHistory } from '../composables/useHistory.js'
import { shopCode } from '../composables/useStore.js'
import { showAxisAssign, axisAssignInitial, settingsSection } from '../composables/appMenuState.js'

const emit = defineEmits(['back', 'clear-master'])

const { config, itemCount, hideItem, unhideItem, setAxisName, clearAxis } = useConfig()
const { getSnapshots } = useHistory()

const hiddenSet  = computed(() => new Set(config.hiddenItems))
const hiddenList = computed(() => [...config.hiddenItems])

// ── 非表示の由来（自動＝前回まで未入力 / 手動）と絞り込み ───────
const autoSet        = computed(() => new Set(config.hiddenAuto))
const autoHiddenList = computed(() => hiddenList.value.filter(n => autoSet.value.has(n)))
const manualHiddenList = computed(() => hiddenList.value.filter(n => !autoSet.value.has(n)))
const hFilter = ref('all')  // 'all' | 'auto' | 'manual'
const filteredHidden = computed(() =>
  hFilter.value === 'auto' ? autoHiddenList.value
  : hFilter.value === 'manual' ? manualHiddenList.value
  : hiddenList.value
)
function isAuto(n) { return autoSet.value.has(n) }

// 直近スナップショットの入力済み集合（新しい順）→ 未入力の連続数で由来の深さを出す
const enteredSets = computed(() =>
  getSnapshots().map(snap => {
    const s = new Set()
    for (const it of (snap.items ?? [])) if (it.qty !== null && it.qty !== undefined) s.add(it.item)
    return s
  })
)
function unusedStreak(item) {
  let n = 0
  for (const set of enteredSets.value) { if (set.has(item)) break; n++ }
  return n
}
// 1 = 前回のみ未入力（青）/ 2 = 前回・前々回とも未入力（濃い青）
function srcLevel(n)  { return Math.min(2, Math.max(1, unusedStreak(n))) }
function srcLabel(n)  { return srcLevel(n) >= 2 ? '前回・前々回 未入力' : '前回 未入力' }
function restoreAllAuto() {
  if (!autoHiddenList.value.length) return
  if (!confirm(`自動で非表示にした ${autoHiddenList.value.length} 件をすべて戻します。よろしいですか？`)) return
  for (const n of [...autoHiddenList.value]) unhideItem(n)
}

const USAGE_SESSIONS = 3
const usedNames = computed(() => {
  const s = new Set()
  for (const snap of getSnapshots().slice(0, USAGE_SESSIONS)) {
    for (const it of (snap.items ?? [])) {
      if (it.qty !== null && it.qty !== undefined) s.add(it.item)
    }
  }
  return s
})
const hasHistory = computed(() => usedNames.value.size > 0)
const unusedCandidates = computed(() =>
  config.order.filter(i => !hiddenSet.value.has(i) && !usedNames.value.has(i))
)

const listOpen = ref(false)
const hiddenOpen = ref(false)
const unusedOpen = ref(false)
function genreOf(item) { return config.categories?.[item] || '' }
function axisTagsOf(item) {
  return [...(config.tagsA?.[item] || []), ...(config.tagsB?.[item] || [])]
}

function openReorder(idx) { axisAssignInitial.value = idx; showAxisAssign.value = true }

// ── 分類（第1レイヤー）の登録 ─────────────────────────────
const draft = ref(['', ''])
const show2 = ref(false)
function confirmAxis(idx) {
  const name = draft.value[idx].trim()
  if (!name) return
  setAxisName(idx, name)
  draft.value[idx] = ''
}
function deleteAxis(idx) {
  const name = config.axisNames[idx]
  if (!confirm(`分類「${name}」を削除します。振り分け（分類先・割り当て）もすべて外れます。よろしいですか？`)) return
  clearAxis(idx)
  if (idx === 1) show2.value = false
}

function hideAllUnused() {
  if (!unusedCandidates.value.length) return
  if (!confirm(`前回まで未入力の ${unusedCandidates.value.length} 件をまとめて非表示にします。\nいつでも戻せます。よろしいですか？`)) return
  for (const n of [...unusedCandidates.value]) hideItem(n, true)
}

// ── 一括削除（店舗コード入力ゲート）─────────────────────────────
const delCode = ref('')
const canDelete = computed(() => !!shopCode.value && delCode.value.trim().toUpperCase() === shopCode.value)
function onClear() {
  if (!canDelete.value) return
  if (!confirm(`登録済みの品目 ${itemCount.value} 件をすべて削除します。\n（軸の名前・グループ定義は残ります）\nこの操作は取り消せません。本当に削除しますか？`)) return
  emit('clear-master')
  delCode.value = ''
}
</script>

<template>
  <div class="mp">
    <header class="mp-header">
      <button class="mp-back" @click="emit('back')">‹ 戻る</button>
      <span class="mp-title">📦 品目マスタ管理</span>
      <span class="mp-count">{{ itemCount }}件</span>
    </header>

    <div class="mp-scroll">
      <!-- 取込む -->
      <button class="mm-row" @click="settingsSection = 'import'">
        <span class="mm-row-ico">📥</span>
        <span class="mm-row-body">
          <span class="mm-row-title">品目を取込む / 更新</span>
          <span class="mm-row-sub">CSV・Excel・PDF から</span>
        </span>
        <span class="mm-row-arrow">→</span>
      </button>

      <!-- 分類の追加（並び順） -->
      <div class="mm-block">
        <div class="mm-block-head"><span class="mm-block-title">分類の追加（並び順）</span></div>

        <!-- 分類① -->
        <div class="mm-axis-row">
          <span class="mm-axis-label">分類①</span>
          <template v-if="config.axisNames[0]">
            <span class="mm-axis-name">{{ config.axisNames[0] }}</span>
            <button class="mm-axis-go" @click="openReorder(0)">振り分け →</button>
            <button class="mm-axis-del" @click="deleteAxis(0)">削除</button>
          </template>
          <template v-else>
            <input class="mm-axis-input" v-model="draft[0]" maxlength="12" placeholder="分類名（例：保管場所）" @keyup.enter="confirmAxis(0)" />
            <button class="mm-axis-confirm" :disabled="!draft[0].trim()" @click="confirmAxis(0)">確定</button>
          </template>
        </div>

        <!-- 分類②: 設定済み or ＋で表示 -->
        <div v-if="config.axisNames[1] || show2" class="mm-axis-row">
          <span class="mm-axis-label">分類②</span>
          <template v-if="config.axisNames[1]">
            <span class="mm-axis-name">{{ config.axisNames[1] }}</span>
            <button class="mm-axis-go" @click="openReorder(1)">振り分け →</button>
            <button class="mm-axis-del" @click="deleteAxis(1)">削除</button>
          </template>
          <template v-else>
            <input class="mm-axis-input" v-model="draft[1]" maxlength="12" placeholder="分類名（例：仕入先）" @keyup.enter="confirmAxis(1)" />
            <button class="mm-axis-confirm" :disabled="!draft[1].trim()" @click="confirmAxis(1)">確定</button>
          </template>
        </div>
        <button v-else-if="config.axisNames[0]" class="mm-axis-add" @click="show2 = true">＋ 分類を追加</button>

        <div class="mm-block-sub">分類（例：保管場所・仕入先）を追加すると、品目を分類先に振り分けられます。ジャンルは取込元由来（編集不可）。</div>
      </div>

      <!-- 使っていない候補（前回まで未入力） -->
      <div class="mm-block">
        <button class="mm-block-head mm-toggle" @click="unusedOpen = !unusedOpen">
          <span class="mm-block-title">使っていない候補</span>
          <span class="mm-block-note">{{ unusedOpen ? '▲' : '▼' }} {{ hasHistory ? unusedCandidates.length + '件' : '前回まで未入力' }}</span>
        </button>
        <template v-if="unusedOpen">
          <div v-if="!hasHistory" class="mm-empty">棚卸の履歴がまだありません。数回の棚卸のあとに候補が出ます。</div>
          <div v-else-if="unusedCandidates.length === 0" class="mm-empty">直近の棚卸で全ての品目に入力があります。候補はありません。</div>
          <template v-else>
            <div class="mm-block-sub">{{ unusedCandidates.length }}件。要らないものは非表示にできます（進捗の分母から外れます）。</div>
            <button class="mm-bulk" @click="hideAllUnused">まとめて非表示にする（{{ unusedCandidates.length }}件）</button>
            <div class="mm-chiplist">
              <button v-for="n in unusedCandidates" :key="n" class="mm-chip" @click="hideItem(n, true)">{{ n }}<span class="mm-chip-x">×</span></button>
            </div>
          </template>
        </template>
      </div>

      <!-- 非表示中の管理 -->
      <div class="mm-block">
        <button class="mm-block-head mm-toggle" @click="hiddenOpen = !hiddenOpen">
          <span class="mm-block-title">非表示中</span>
          <span class="mm-block-note">{{ hiddenOpen ? '▲' : '▼' }} {{ hiddenList.length }}件</span>
        </button>
        <template v-if="hiddenOpen">
          <!-- 由来で絞り込み -->
          <div v-if="hiddenList.length > 0" class="mm-hfilter">
            <button :class="['mm-hf', { on: hFilter === 'all' }]" @click="hFilter = 'all'">すべて {{ hiddenList.length }}</button>
            <button :class="['mm-hf', { on: hFilter === 'auto' }]" @click="hFilter = 'auto'">自動 {{ autoHiddenList.length }}</button>
            <button :class="['mm-hf', { on: hFilter === 'manual' }]" @click="hFilter = 'manual'">手動 {{ manualHiddenList.length }}</button>
          </div>
          <button
            v-if="(hFilter === 'all' || hFilter === 'auto') && autoHiddenList.length > 0"
            class="mm-restore-all" @click="restoreAllAuto">
            自動非表示をまとめて戻す（{{ autoHiddenList.length }}件）
          </button>
          <div v-if="filteredHidden.length === 0" class="mm-empty">
            {{ hiddenList.length === 0 ? '非表示の品目はありません。' : '該当する品目はありません。' }}
          </div>
          <div v-else>
            <div v-for="n in filteredHidden" :key="n" class="mm-hidden-row">
              <span class="mm-hidden-name">{{ n }}</span>
              <span v-if="isAuto(n)" class="mm-src" :class="'lv' + srcLevel(n)">{{ srcLabel(n) }}</span>
              <span v-else class="mm-src manual">手動</span>
              <button class="mm-restore" @click="unhideItem(n)">戻す</button>
            </div>
          </div>
        </template>
      </div>

      <!-- 品目一覧（閲覧） -->
      <div class="mm-block">
        <button class="mm-block-head mm-toggle" @click="listOpen = !listOpen">
          <span class="mm-block-title">品目一覧を見る</span>
          <span class="mm-block-note">{{ listOpen ? '▲' : '▼' }} {{ itemCount }}件</span>
        </button>
        <div v-if="listOpen" class="mm-items">
          <div v-for="item in config.order" :key="item" class="mm-item" :class="{ hidden: hiddenSet.has(item) }">
            <span class="mm-item-name">{{ item }}</span>
            <span class="mm-item-meta">
              <span v-if="genreOf(item)" class="mm-tag genre">{{ genreOf(item) }}</span>
              <span v-for="t in axisTagsOf(item)" :key="t" class="mm-tag">{{ t }}</span>
              <span v-if="hiddenSet.has(item)" class="mm-tag off">非表示</span>
            </span>
          </div>
        </div>
      </div>

      <!-- 一括削除（危険操作・店舗コードゲート） -->
      <div v-if="itemCount > 0" class="mm-block danger">
        <div class="mm-block-head"><span class="mm-block-title danger">品目マスタを一括削除</span></div>
        <div class="mm-block-sub">
          登録済みの品目をすべて削除します（軸の名前・グループ定義は残ります）。取り消せません。<br>
          削除するには店舗コード <b>{{ shopCode || '（未取得）' }}</b> を入力してください。
        </div>
        <input class="mm-del-input" v-model="delCode" placeholder="店舗コードを入力" autocapitalize="characters" />
        <button class="mm-del-btn" :disabled="!canDelete" @click="onClear">全品目を削除</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mp { min-height: 100vh; background: #f8fafc; }
.mp-header {
  position: sticky; top: 0; z-index: 2;
  display: flex; align-items: center; gap: 10px;
  padding: 12px 14px; background: #fff; border-bottom: 1px solid #e2e8f0;
}
.mp-back { border: none; background: none; color: var(--primary, #2563eb); font-size: 14px; font-weight: 700; cursor: pointer; padding: 4px 2px; }
.mp-title { font-size: 16px; font-weight: 800; color: #1e293b; }
.mp-count { margin-left: auto; font-size: 13px; font-weight: 800; color: var(--primary, #2563eb); }
.mp-scroll { padding: 14px; max-width: 620px; margin: 0 auto; }

.mm-row {
  width: 100%; display: flex; align-items: center; gap: 12px;
  background: #fff; border: 1px solid #e2e8f0; border-radius: 12px;
  padding: 14px; margin-bottom: 12px; cursor: pointer; text-align: left;
}
.mm-row:active { background: #f1f5f9; }
.mm-row-ico { font-size: 20px; }
.mm-row-body { flex: 1; min-width: 0; }
.mm-row-title { display: block; font-size: 15px; font-weight: 700; color: #334155; }
.mm-row-sub { display: block; font-size: 12px; color: #94a3b8; margin-top: 2px; }
.mm-row-arrow { color: #cbd5e1; font-size: 18px; }

.mm-block { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px 14px; margin-bottom: 12px; }
.mm-block.danger { border-color: #fecaca; }
.mm-block-head { display: flex; align-items: center; gap: 8px; width: 100%; border: none; background: none; padding: 0; }
.mm-toggle { cursor: pointer; }
.mm-block-title { font-size: 14px; font-weight: 800; color: #334155; }
.mm-block-title.danger { color: #dc2626; }
.mm-block-note { margin-left: auto; font-size: 12px; font-weight: 700; color: #94a3b8; }
.mm-block-sub { font-size: 12px; color: #64748b; margin: 8px 0; line-height: 1.6; }
.mm-empty { font-size: 12px; color: #94a3b8; margin-top: 8px; }

.mm-axis-row { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.mm-axis-label { font-size: 13px; font-weight: 800; color: #64748b; width: 32px; flex-shrink: 0; }
.mm-axis-input { flex: 1; min-width: 0; border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px 10px; font-size: 14px; }
.mm-axis-go { flex-shrink: 0; border: 1px solid var(--primary-border, #bfdbfe); background: #fff; color: var(--primary, #2563eb); border-radius: 8px; font-size: 12px; font-weight: 700; padding: 7px 12px; cursor: pointer; }
.mm-axis-name { flex: 1; min-width: 0; font-size: 15px; font-weight: 800; color: #1e293b; }
.mm-axis-confirm { flex-shrink: 0; border: none; background: var(--primary, #2563eb); color: #fff; border-radius: 8px; font-size: 13px; font-weight: 700; padding: 8px 16px; cursor: pointer; }
.mm-axis-confirm:disabled { background: #cbd5e1; cursor: not-allowed; }
.mm-axis-del { flex-shrink: 0; border: 1px solid #fecaca; background: #fff; color: #dc2626; border-radius: 8px; font-size: 12px; font-weight: 700; padding: 7px 12px; cursor: pointer; }
.mm-axis-add { width: 100%; border: 1px dashed var(--primary-border, #bfdbfe); background: #fff; color: var(--primary, #2563eb); border-radius: 8px; font-size: 13px; font-weight: 700; padding: 10px; cursor: pointer; margin-top: 8px; }

.mm-bulk { width: 100%; border: none; border-radius: 10px; padding: 10px; background: #64748b; color: #fff; font-size: 13px; font-weight: 800; cursor: pointer; margin-bottom: 8px; }
.mm-bulk:active { background: #475569; }
.mm-chiplist { display: flex; flex-wrap: wrap; gap: 6px; }
.mm-chip { border: 1px solid #e2e8f0; background: #f8fafc; color: #475569; border-radius: 20px; padding: 4px 10px; font-size: 12px; cursor: pointer; }
.mm-chip-x { color: #cbd5e1; margin-left: 4px; }

.mm-hfilter { display: flex; gap: 6px; margin: 8px 0; }
.mm-hf { border: 1px solid #e2e8f0; background: #fff; color: #64748b; border-radius: 20px; padding: 5px 12px; font-size: 12px; font-weight: 700; cursor: pointer; }
.mm-hf.on { background: var(--primary, #2563eb); color: #fff; border-color: var(--primary, #2563eb); }
.mm-restore-all { width: 100%; border: 1px solid var(--primary-border, #bfdbfe); background: var(--primary-weak, #eff6ff); color: var(--primary, #2563eb); border-radius: 10px; padding: 9px; font-size: 13px; font-weight: 800; cursor: pointer; margin-bottom: 8px; }
.mm-restore-all:active { background: #dbeafe; }

.mm-hidden-row { display: flex; align-items: center; gap: 8px; padding: 8px 2px; border-bottom: 1px solid #f1f5f9; }
.mm-hidden-name { flex: 1; min-width: 0; font-size: 14px; color: #334155; }
.mm-src { flex-shrink: 0; font-size: 10px; font-weight: 800; border-radius: 6px; padding: 3px 8px; white-space: nowrap; }
.mm-src.lv1 { color: #2563eb; background: #eff6ff; border: 1px solid #bfdbfe; }
.mm-src.lv2 { color: #fff; background: #1e3a8a; border: 1px solid #1e3a8a; }
.mm-src.manual { color: #64748b; background: #f1f5f9; border: 1px solid #e2e8f0; }
.mm-restore { flex-shrink: 0; border: 1px solid var(--primary-border, #bfdbfe); background: #fff; color: var(--primary, #2563eb); border-radius: 8px; font-size: 12px; font-weight: 700; padding: 5px 14px; cursor: pointer; }

.mm-items { margin-top: 8px; max-height: 50vh; overflow-y: auto; }
.mm-item { display: flex; align-items: center; gap: 8px; padding: 8px 2px; border-bottom: 1px solid #f1f5f9; }
.mm-item.hidden { opacity: 0.5; }
.mm-item-name { font-size: 14px; color: #334155; flex: 1; min-width: 0; }
.mm-item-meta { display: flex; flex-wrap: wrap; gap: 4px; justify-content: flex-end; }
.mm-tag { font-size: 10px; font-weight: 700; color: #64748b; background: #f1f5f9; border-radius: 6px; padding: 2px 7px; }
.mm-tag.genre { color: #6d28d9; background: #ede9fe; }
.mm-tag.off { color: #dc2626; background: #fef2f2; }

.mm-del-input { width: 100%; border: 1.5px solid #fecaca; border-radius: 8px; padding: 10px; font-size: 15px; letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 8px; }
.mm-del-btn { width: 100%; border: none; border-radius: 10px; padding: 11px; background: #dc2626; color: #fff; font-size: 14px; font-weight: 800; cursor: pointer; }
.mm-del-btn:disabled { background: #fca5a5; cursor: not-allowed; }
</style>
