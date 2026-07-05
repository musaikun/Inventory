<script setup>
import { ref, computed, reactive, watch } from 'vue'
import { useConfig } from '../composables/useConfig.js'

const emit = defineEmits(['close'])

const { config, addAxisGroup, renameAxisGroup, removeAxisGroup, assignItemsToGroup } = useConfig()

// 名前が設定されている軸のみ対象
const namedAxes = computed(() => {
  const names = config.axisNames ?? ['', '']
  const out = []
  if (names[0]) out.push({ index: 0, name: names[0] })
  if (names[1]) out.push({ index: 1, name: names[1] })
  return out
})

const activeAxis = ref(0)
watch(namedAxes, (arr) => {
  if (!arr.some(a => a.index === activeAxis.value)) activeAxis.value = arr[0]?.index ?? 0
}, { immediate: true })

const tagMap  = computed(() => activeAxis.value === 0 ? (config.tagsA ?? {}) : (config.tagsB ?? {}))
const defined = computed(() => activeAxis.value === 0 ? (config.axisGroupsA ?? []) : (config.axisGroupsB ?? []))

// 表示するグループ = 定義済み ＋ 実データにある値（孤立値も拾う）
const displayGroups = computed(() => {
  const set = new Set(defined.value)
  for (const v of Object.values(tagMap.value)) if (v) set.add(v)
  return [...set]
})

const groupCount = computed(() => {
  const m = {}
  for (const g of displayGroups.value) m[g] = 0
  let unassigned = 0
  for (const item of config.order) {
    const g = tagMap.value[item]
    if (g) m[g] = (m[g] || 0) + 1
    else   unassigned++
  }
  return { map: m, unassigned }
})

// ── 振り分け対象の選択 ──────────────────────────
const targetGroup = ref('')         // '' = その他（未割り当てに戻す）
const selected    = reactive({})
const search      = ref('')
const unassignedOnly = ref(false)

function _clearSelection() { Object.keys(selected).forEach(k => delete selected[k]) }
watch(activeAxis, () => { _clearSelection(); targetGroup.value = ''; search.value = '' })

const filteredItems = computed(() => {
  const q = search.value.trim().toLowerCase()
  return config.order
    .map(item => ({ item, group: tagMap.value[item] || '' }))
    .filter(r => {
      if (unassignedOnly.value && r.group) return false
      if (q && !r.item.toLowerCase().includes(q)) return false
      return true
    })
})

const selectedList = computed(() => Object.keys(selected).filter(k => selected[k]))

function toggleSelect(item) { selected[item] = !selected[item] }
function selectAllVisible() { for (const r of filteredItems.value) selected[r.item] = true }

// ── グループ管理 ──────────────────────────────
const newGroupName = ref('')
function onAddGroup() {
  const n = newGroupName.value.trim()
  if (!n) return
  addAxisGroup(activeAxis.value, n)
  newGroupName.value = ''
}
function onRenameGroup(g) {
  const nn = (prompt(`「${g}」の新しい名前`, g) || '').trim()
  if (!nn || nn === g) return
  if (!renameAxisGroup(activeAxis.value, g, nn)) alert('その名前は既に使われています')
}
function onDeleteGroup(g) {
  const cnt = groupCount.value.map[g] || 0
  if (!confirm(`「${g}」を削除します。${cnt}件の品目は「その他」に戻ります。よろしいですか？`)) return
  removeAxisGroup(activeAxis.value, g)
  if (targetGroup.value === g) targetGroup.value = ''
}

// ── 振り分け実行 ──────────────────────────────
function onApply() {
  if (selectedList.value.length === 0) return
  assignItemsToGroup(activeAxis.value, [...selectedList.value], targetGroup.value)
  _clearSelection()
}
const targetLabel = computed(() => targetGroup.value || 'その他（未割り当て）')
</script>

<template>
  <div class="ax-overlay">
    <div class="ax-header">
      <button class="ax-back" @click="emit('close')">‹ 戻る</button>
      <div class="ax-title">🗂️ 場所・分類の振り分け</div>
      <div class="ax-spacer"></div>
    </div>

    <div class="ax-body">
      <div v-if="namedAxes.length === 0" class="ax-empty">
        <div class="ax-empty-icon">🏷️</div>
        <div class="ax-empty-title">分類軸が未設定です</div>
        <div class="ax-empty-desc">設定画面の「分類軸」で軸名（例：場所・仕入先）を先に入力してください。</div>
      </div>

      <template v-else>
        <!-- 軸タブ -->
        <div v-if="namedAxes.length > 1" class="ax-tabs">
          <button
            v-for="a in namedAxes" :key="a.index"
            :class="['ax-tab', { on: activeAxis === a.index }]"
            @click="activeAxis = a.index"
          >{{ a.name }}</button>
        </div>

        <!-- グループ管理 -->
        <div class="ax-section">
          <div class="ax-section-title">グループ（{{ namedAxes.find(a => a.index === activeAxis)?.name }}）</div>
          <div class="ax-addrow">
            <input v-model="newGroupName" type="text" maxlength="20"
                   placeholder="例: 冷凍庫 / 仕込み場" class="ax-input"
                   @keyup.enter="onAddGroup" />
            <button class="ax-add-btn" @click="onAddGroup">＋追加</button>
          </div>
          <div class="ax-grouplist">
            <div v-for="g in displayGroups" :key="g" class="ax-grouprow">
              <span class="ax-gname">{{ g }}</span>
              <span class="ax-gcount">{{ groupCount.map[g] || 0 }}件</span>
              <button class="ax-gbtn" @click="onRenameGroup(g)">名前変更</button>
              <button class="ax-gbtn danger" @click="onDeleteGroup(g)">削除</button>
            </div>
            <div class="ax-grouprow muted">
              <span class="ax-gname">その他（未割り当て）</span>
              <span class="ax-gcount">{{ groupCount.unassigned }}件</span>
            </div>
          </div>
        </div>

        <!-- 振り分け -->
        <div class="ax-section">
          <div class="ax-section-title">振り分け</div>
          <div class="ax-step">① 振り分け先を選ぶ</div>
          <div class="ax-chips">
            <button
              v-for="g in displayGroups" :key="'t' + g"
              :class="['ax-chip', { on: targetGroup === g }]"
              @click="targetGroup = g"
            >{{ g }}</button>
            <button :class="['ax-chip', 'other', { on: targetGroup === '' }]" @click="targetGroup = ''">その他へ戻す</button>
          </div>

          <div class="ax-step">② 品目を複数選ぶ</div>
          <div class="ax-toolbar">
            <input v-model="search" type="text" placeholder="品目を検索" class="ax-search" />
            <button :class="['ax-mini', { on: unassignedOnly }]" @click="unassignedOnly = !unassignedOnly">未割り当てのみ</button>
            <button class="ax-mini" @click="selectAllVisible">表示中を全選択</button>
          </div>

          <div class="ax-items">
            <label v-for="r in filteredItems" :key="r.item" class="ax-item">
              <input type="checkbox" :checked="!!selected[r.item]" @change="toggleSelect(r.item)" />
              <span class="ax-item-name">{{ r.item }}</span>
              <span class="ax-item-group" :class="{ none: !r.group }">{{ r.group || 'その他' }}</span>
            </label>
            <div v-if="filteredItems.length === 0" class="ax-noitems">該当する品目がありません</div>
          </div>
        </div>
      </template>
    </div>

    <div v-if="namedAxes.length > 0" class="ax-footer">
      <button class="ax-apply" :disabled="selectedList.length === 0" @click="onApply">
        選択 {{ selectedList.length }}件 を「{{ targetLabel }}」へ振り分け
      </button>
    </div>
  </div>
</template>

<style scoped>
.ax-overlay { position: fixed; inset: 0; z-index: 2100; background: #f5f6f8; display: flex; flex-direction: column; }
.ax-header { display: flex; align-items: center; padding: 12px 16px; background: #fff; border-bottom: 1px solid #e5e7eb; flex-shrink: 0; }
.ax-back { background: none; border: none; color: #2563eb; font-size: 16px; cursor: pointer; padding: 4px 8px; }
.ax-title { font-weight: 700; font-size: 15px; flex: 1; text-align: center; }
.ax-spacer { width: 56px; }
.ax-body { flex: 1; overflow-y: auto; padding: 14px; -webkit-overflow-scrolling: touch; }

.ax-empty { text-align: center; padding: 56px 24px; color: #6b7280; }
.ax-empty-icon { font-size: 44px; margin-bottom: 12px; }
.ax-empty-title { font-weight: 700; color: #374151; margin-bottom: 6px; }
.ax-empty-desc { font-size: 13px; line-height: 1.6; }

.ax-tabs { display: flex; gap: 6px; margin-bottom: 12px; }
.ax-tab { flex: 1; padding: 9px; border: 1.5px solid #d1d5db; background: #fff; border-radius: 10px; font-weight: 700; font-size: 14px; color: #6b7280; cursor: pointer; }
.ax-tab.on { border-color: #2563eb; color: #2563eb; background: #eff6ff; }

.ax-section { background: #fff; border-radius: 14px; padding: 14px; margin-bottom: 14px; box-shadow: 0 1px 2px rgba(0,0,0,0.04); }
.ax-section-title { font-weight: 700; font-size: 14px; margin-bottom: 10px; color: #374151; }

.ax-addrow { display: flex; gap: 8px; margin-bottom: 10px; }
.ax-input { flex: 1; border: 1.5px solid #d1d5db; border-radius: 9px; padding: 9px 11px; font-size: 14px; outline: none; }
.ax-input:focus { border-color: #2563eb; }
.ax-add-btn { flex-shrink: 0; border: none; background: #2563eb; color: #fff; font-weight: 700; border-radius: 9px; padding: 0 14px; cursor: pointer; }

.ax-grouplist { display: flex; flex-direction: column; gap: 6px; }
.ax-grouprow { display: flex; align-items: center; gap: 8px; padding: 7px 4px; border-bottom: 1px solid #f3f4f6; }
.ax-grouprow.muted { color: #9ca3af; }
.ax-gname { flex: 1; font-size: 14px; color: #374151; word-break: break-all; }
.ax-gcount { font-size: 12px; color: #9ca3af; flex-shrink: 0; }
.ax-gbtn { flex-shrink: 0; border: 1px solid #d1d5db; background: #fff; border-radius: 7px; padding: 4px 8px; font-size: 11px; color: #4b5563; cursor: pointer; }
.ax-gbtn.danger { color: #dc2626; border-color: #fecaca; }

.ax-step { font-size: 12px; font-weight: 700; color: #6b7280; margin: 10px 0 6px; }
.ax-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.ax-chip { border: 1.5px solid #d1d5db; background: #fff; border-radius: 20px; padding: 6px 12px; font-size: 13px; color: #4b5563; cursor: pointer; }
.ax-chip.on { border-color: #2563eb; background: #2563eb; color: #fff; }
.ax-chip.other { border-style: dashed; }

.ax-toolbar { display: flex; gap: 6px; margin-bottom: 8px; flex-wrap: wrap; }
.ax-search { flex: 1; min-width: 120px; border: 1.5px solid #d1d5db; border-radius: 9px; padding: 8px 11px; font-size: 14px; outline: none; }
.ax-search:focus { border-color: #2563eb; }
.ax-mini { border: 1.5px solid #d1d5db; background: #fff; border-radius: 9px; padding: 6px 10px; font-size: 12px; color: #4b5563; cursor: pointer; white-space: nowrap; }
.ax-mini.on { border-color: #2563eb; color: #2563eb; background: #eff6ff; }

.ax-items { max-height: 46vh; overflow-y: auto; border: 1px solid #f0f1f3; border-radius: 10px; }
.ax-item { display: flex; align-items: center; gap: 10px; padding: 9px 11px; border-bottom: 1px solid #f3f4f6; cursor: pointer; }
.ax-item input { width: 18px; height: 18px; flex-shrink: 0; }
.ax-item-name { flex: 1; font-size: 14px; color: #374151; word-break: break-all; }
.ax-item-group { font-size: 11px; font-weight: 700; color: #2563eb; background: #eff6ff; border-radius: 8px; padding: 2px 8px; flex-shrink: 0; }
.ax-item-group.none { color: #9ca3af; background: #f3f4f6; }
.ax-noitems { padding: 20px; text-align: center; color: #9ca3af; font-size: 13px; }

.ax-footer { flex-shrink: 0; padding: 10px 14px; background: #fff; border-top: 1px solid #e5e7eb; }
.ax-apply { width: 100%; border: none; background: #2563eb; color: #fff; font-weight: 700; font-size: 15px; border-radius: 12px; padding: 13px; cursor: pointer; }
.ax-apply:disabled { background: #cbd5e1; cursor: not-allowed; }
</style>
