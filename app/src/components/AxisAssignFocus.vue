<script setup>
import { ref, computed, watch } from 'vue'
import { useConfig } from '../composables/useConfig.js'
import { useHistory } from '../composables/useHistory.js'

const props = defineProps({ initialAxis: { type: Number, default: 0 } })
const emit = defineEmits(['close'])

const { config, addAxisGroup, renameAxisGroup, removeAxisGroup, addItemToGroup, removeItemFromGroup, moveAxisGroup } = useConfig()
const { getSnapshots } = useHistory()

// ── 対象の軸 ────────────────────────────────────────────────
const namedAxes = computed(() => {
  const names = config.axisNames ?? ['', '']
  const out = []
  if (names[0]) out.push({ index: 0, name: names[0] })
  if (names[1]) out.push({ index: 1, name: names[1] })
  return out
})
const activeAxis = ref(props.initialAxis ?? 0)
watch(namedAxes, arr => {
  if (!arr.some(a => a.index === activeAxis.value)) activeAxis.value = arr[0]?.index ?? 0
}, { immediate: true })

const tagMap  = computed(() => activeAxis.value === 0 ? (config.tagsA ?? {}) : (config.tagsB ?? {}))
const defined = computed(() => activeAxis.value === 0 ? (config.axisGroupsA ?? []) : (config.axisGroupsB ?? []))
const groups  = computed(() => {
  const set = new Set(defined.value)
  for (const v of Object.values(tagMap.value)) for (const g of (v || [])) set.add(g)
  return [...set]
})
function itemGroups(item) { return tagMap.value[item] || [] }
const groupCount = computed(() => {
  const m = {}
  for (const g of groups.value) m[g] = 0
  for (const it of config.order) for (const g of itemGroups(it)) m[g] = (m[g] || 0) + 1
  return m
})

// ── 入れ先グループ ──────────────────────────────────────────
const target = ref('')
function selectGroup(g) { target.value = target.value === g ? '' : g }
watch(activeAxis, () => { target.value = ''; search.value = '' })

// ── 品目リスト（全幅・検索・前回入力優先）─────────────────────
const search = ref('')
const USAGE = 3
const usage = computed(() => {
  const m = {}
  for (const s of getSnapshots().slice(0, USAGE)) for (const it of (s.items || [])) {
    if (it.qty !== null && it.qty !== undefined) m[it.item] = (m[it.item] || 0) + 1
  }
  return m
})
const hasUsage = computed(() => Object.keys(usage.value).length > 0)
const usedOnly = ref(false)
const _norm = s => (s || '').normalize('NFKC').toLowerCase()

const items = computed(() => {
  const q = _norm(search.value.trim())
  let arr = config.order.filter(i => (!q || _norm(i).includes(q)) && (!usedOnly.value || (usage.value[i] > 0)))
  // 選択中グループの所属を上に、次いで使用頻度順
  arr = [...arr].sort((a, b) => {
    if (target.value) {
      const ia = itemGroups(a).includes(target.value) ? 1 : 0
      const ib = itemGroups(b).includes(target.value) ? 1 : 0
      if (ia !== ib) return ib - ia
    }
    return (usage.value[b] ?? 0) - (usage.value[a] ?? 0)
  })
  return arr
})
const assignedInTarget = computed(() => target.value ? items.value.filter(i => itemGroups(i).includes(target.value)).length : 0)

function toggle(item) {
  if (!target.value) return
  if (itemGroups(item).includes(target.value)) removeItemFromGroup(activeAxis.value, item, target.value)
  else addItemToGroup(activeAxis.value, item, target.value)
}

// ── グループ管理 ────────────────────────────────────────────
const editMode = ref(false)
function onAdd() {
  const n = (prompt('新しいグループ名') || '').trim()
  if (n) { addAxisGroup(activeAxis.value, n); target.value = n }
}
function onRename(g) {
  const n = (prompt('新しい名前', g) || '').trim()
  if (n && n !== g) {
    if (!renameAxisGroup(activeAxis.value, g, n)) alert('その名前は既に使われています')
    else if (target.value === g) target.value = n
  }
}
function onDelete(g) {
  if (confirm(`グループ「${g}」を削除します。品目の割り当ても外れます。`)) {
    removeAxisGroup(activeAxis.value, g)
    if (target.value === g) target.value = ''
  }
}
function move(g, dir) { moveAxisGroup(activeAxis.value, g, dir) }
const orderedGroups = computed(() => {
  const def = defined.value
  const extras = groups.value.filter(g => !def.includes(g))
  return [...def, ...extras]
})
</script>

<template>
  <div class="af">
    <header class="af-head">
      <button class="af-back" @click="emit('close')">‹ 閉じる</button>
      <span class="af-title">振り分け</span>
      <button class="af-edit" :class="{ on: editMode }" @click="editMode = !editMode">{{ editMode ? '完了' : '編集' }}</button>
    </header>

    <div v-if="namedAxes.length === 0" class="af-empty">
      並び替えの軸が未設定です。「品目マスタ管理」で軸①/軸②の名前を登録してください。
    </div>

    <template v-else>
      <!-- 軸タブ（2軸あるとき） -->
      <div v-if="namedAxes.length > 1" class="af-tabs">
        <button v-for="a in namedAxes" :key="a.index" :class="['af-tab', { on: activeAxis === a.index }]" @click="activeAxis = a.index">{{ a.name }}</button>
      </div>

      <!-- グループ選択（全幅チップ・横スクロール） -->
      <div class="af-groups">
        <button v-for="g in orderedGroups" :key="g" :class="['af-chip', { on: target === g }]" @click="editMode ? null : selectGroup(g)">
          <template v-if="editMode">
            <span class="af-chip-move" @click.stop="move(g, -1)">◀</span>
            <span class="af-chip-name" @click.stop="onRename(g)">{{ g }}</span>
            <span class="af-chip-move" @click.stop="move(g, 1)">▶</span>
            <span class="af-chip-del" @click.stop="onDelete(g)">×</span>
          </template>
          <template v-else>
            {{ g }}<span class="af-chip-count">{{ groupCount[g] || 0 }}</span>
          </template>
        </button>
        <button class="af-chip add" @click="onAdd">＋ グループ</button>
      </div>

      <!-- 入れ先の案内 -->
      <div class="af-hint">
        <template v-if="target">入れ先：<b>{{ target }}</b>（{{ assignedInTarget }}件）・品目をタップで追加/解除</template>
        <template v-else>上の<b>グループを選んで</b>から、品目をタップ</template>
      </div>

      <!-- ツール -->
      <div class="af-tools">
        <input v-model="search" class="af-search" type="text" placeholder="品目を検索" />
        <button v-if="hasUsage" :class="['af-used', { on: usedOnly }]" @click="usedOnly = !usedOnly">前回入力のみ</button>
      </div>

      <!-- 全幅の品目リスト -->
      <div class="af-list">
        <button
          v-for="item in items" :key="item"
          :class="['af-item', { in: target && itemGroups(item).includes(target), disabled: !target }]"
          @click="toggle(item)"
        >
          <span class="af-check">{{ target && itemGroups(item).includes(target) ? '✓' : '＋' }}</span>
          <span class="af-item-name">{{ item }}</span>
          <span v-if="itemGroups(item).length" class="af-item-tags">
            <span v-for="g in itemGroups(item)" :key="g" class="af-item-tag" :class="{ cur: g === target }">{{ g }}</span>
          </span>
        </button>
        <div v-if="items.length === 0" class="af-empty">該当する品目がありません。</div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.af { position: fixed; inset: 0; z-index: 60; background: #f8fafc; display: flex; flex-direction: column; }
.af-head {
  display: flex; align-items: center; gap: 10px; padding: 12px 14px;
  background: #fff; border-bottom: 1px solid #e2e8f0; flex-shrink: 0;
}
.af-back { border: none; background: none; color: var(--primary, #2563eb); font-size: 14px; font-weight: 700; cursor: pointer; }
.af-title { font-size: 16px; font-weight: 800; color: #1e293b; }
.af-edit { margin-left: auto; border: 1px solid #e2e8f0; background: #fff; color: #64748b; border-radius: 8px; font-size: 13px; font-weight: 700; padding: 5px 12px; cursor: pointer; }
.af-edit.on { background: var(--primary, #2563eb); color: #fff; border-color: var(--primary, #2563eb); }

.af-empty { padding: 24px 16px; color: #94a3b8; font-size: 13px; text-align: center; line-height: 1.6; }

.af-tabs { display: flex; gap: 6px; padding: 10px 14px 0; }
.af-tab { flex: 1; border: 1px solid #e2e8f0; background: #fff; color: #64748b; border-radius: 10px; padding: 9px; font-size: 14px; font-weight: 700; cursor: pointer; }
.af-tab.on { background: var(--primary, #2563eb); color: #fff; border-color: var(--primary, #2563eb); }

.af-groups {
  display: flex; gap: 8px; padding: 12px 14px; overflow-x: auto; flex-shrink: 0;
  background: #fff; border-bottom: 1px solid #eef2f6;
}
.af-chip {
  flex-shrink: 0; display: inline-flex; align-items: center; gap: 6px;
  border: 1.5px solid #e2e8f0; background: #fff; color: #334155;
  border-radius: 22px; padding: 9px 14px; font-size: 14px; font-weight: 700; cursor: pointer;
}
.af-chip.on { background: var(--primary, #2563eb); color: #fff; border-color: var(--primary, #2563eb); }
.af-chip-count { background: rgba(0,0,0,0.08); border-radius: 12px; padding: 1px 7px; font-size: 12px; }
.af-chip.on .af-chip-count { background: rgba(255,255,255,0.25); }
.af-chip.add { color: var(--primary, #2563eb); border-style: dashed; border-color: var(--primary-border, #bfdbfe); }
.af-chip-move { color: #94a3b8; padding: 0 2px; }
.af-chip-name { text-decoration: underline; }
.af-chip-del { color: #dc2626; font-weight: 800; padding-left: 2px; }

.af-hint { padding: 10px 14px; font-size: 13px; color: #475569; background: #fff; }
.af-hint b { color: var(--primary, #2563eb); }

.af-tools { display: flex; gap: 8px; padding: 8px 14px; }
.af-search { flex: 1; border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px 12px; font-size: 15px; }
.af-used { flex-shrink: 0; border: 1px solid #e2e8f0; background: #fff; color: #64748b; border-radius: 10px; font-size: 12px; font-weight: 700; padding: 0 12px; cursor: pointer; }
.af-used.on { background: #fffbeb; color: #b45309; border-color: #fde68a; }

.af-list { flex: 1; overflow-y: auto; padding: 4px 10px 24px; }
.af-item {
  width: 100%; display: flex; align-items: center; gap: 12px;
  background: #fff; border: 1px solid #eef2f6; border-radius: 12px;
  padding: 15px 14px; margin-bottom: 8px; cursor: pointer; text-align: left;
}
.af-item.disabled { opacity: 0.55; }
.af-item.in { background: #eff6ff; border-color: var(--primary-border, #bfdbfe); }
.af-check {
  width: 26px; height: 26px; flex-shrink: 0; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 15px; font-weight: 800; color: #cbd5e1; border: 1.5px solid #e2e8f0;
}
.af-item.in .af-check { background: var(--primary, #2563eb); color: #fff; border-color: var(--primary, #2563eb); }
.af-item-name { flex: 1; min-width: 0; font-size: 15px; font-weight: 600; color: #1e293b; }
.af-item-tags { display: flex; flex-wrap: wrap; gap: 4px; justify-content: flex-end; max-width: 45%; }
.af-item-tag { font-size: 10px; font-weight: 700; color: #64748b; background: #f1f5f9; border-radius: 6px; padding: 2px 7px; }
.af-item-tag.cur { color: #fff; background: var(--primary, #2563eb); }
</style>
