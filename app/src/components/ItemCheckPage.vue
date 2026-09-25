<script setup>
/**
 * 品目の点検。入数・単位・単価・ジャンルが空の品目を出し、その場で埋める。
 * 設定済み品目一覧は確認専用なので、直す操作はこのページに分けている。
 */
import { ref, computed } from 'vue'
import { useConfig } from '../composables/useConfig.js'
import { ITEM_CHECKS, itemCheckRows } from '../utils/itemCheck.js'

const emit = defineEmits(['close'])
const { config, patchItem } = useConfig()

const LABEL = Object.fromEntries(ITEM_CHECKS.map(c => [c.key, c.label]))
const allRows = computed(() => itemCheckRows(config))
const counts = computed(() => {
  const c = Object.fromEntries(ITEM_CHECKS.map(k => [k.key, 0]))
  for (const r of allRows.value) for (const k of r.missing) c[k]++
  return c
})

const filter = ref('all')
const rows = computed(() => filter.value === 'all'
  ? allRows.value
  : allRows.value.filter(r => r.missing.includes(filter.value)))

const genres = computed(() => [...new Set(Object.values(config.categories ?? {}).filter(Boolean))])

// 開いている行と、その入力（保存するまで config へは書かない）
const openItem = ref('')
const draft = ref({})
function open(r) {
  if (openItem.value === r.item) { openItem.value = ''; return }
  openItem.value = r.item
  draft.value = {
    unit:     config.units?.[r.item] ?? '',
    lotSize:  config.lotSizes?.[r.item] ?? '',
    price:    config.prices?.[r.item] ?? '',
    category: config.categories?.[r.item] ?? '',
  }
}
const saved = ref('')
function save(item) {
  patchItem(item, { ...draft.value })
  openItem.value = ''
  saved.value = item
  setTimeout(() => { if (saved.value === item) saved.value = '' }, 1600)
}
</script>

<template>
  <div class="ic-page" role="dialog" aria-modal="true" aria-label="品目の点検">
    <header class="ic-header">
      <button class="ic-back" @click="emit('close')">‹ 戻る</button>
      <span class="ic-title">品目の点検</span>
      <span class="ic-count">{{ allRows.length }}件</span>
    </header>
    <div class="ic-scroll">
      <p class="ic-desc">
        入数・単位・単価・ジャンルが空の品目です。行を押すと、その場で埋められます。
        非表示の品目は数えていません。
      </p>

      <div class="ic-chips">
        <button type="button" :class="['ic-chip', { on: filter === 'all' }]" @click="filter = 'all'">すべて {{ allRows.length }}</button>
        <button
          v-for="c in ITEM_CHECKS" :key="c.key" type="button"
          :class="['ic-chip', { on: filter === c.key }]" :disabled="!counts[c.key]"
          @click="filter = c.key"
        >{{ c.label }}なし {{ counts[c.key] }}</button>
      </div>
      <p v-if="filter !== 'all'" class="ic-why">{{ ITEM_CHECKS.find(c => c.key === filter)?.why }}</p>

      <div v-if="allRows.length === 0" class="ic-empty">空欄のある品目はありません。</div>
      <div v-else-if="rows.length === 0" class="ic-empty">この条件の品目はありません。</div>

      <div v-if="saved" class="ic-toast" role="status">「{{ saved }}」を保存しました</div>

      <div v-for="r in rows" :key="r.item" :class="['ic-row', { open: openItem === r.item }]">
        <button type="button" class="ic-row-head" :aria-expanded="openItem === r.item ? 'true' : 'false'" @click="open(r)">
          <span class="ic-name">{{ r.item }}</span>
          <span class="ic-tags">
            <span v-for="k in r.missing" :key="k" class="ic-tag">{{ LABEL[k] }}</span>
          </span>
          <span class="ic-arrow">{{ openItem === r.item ? '▲' : '▼' }}</span>
        </button>
        <div v-if="openItem === r.item" class="ic-form">
          <label class="ic-field">
            <span class="ic-label">単位</span>
            <input v-model="draft.unit" class="ic-input" type="text" placeholder="個・kg・本 など" />
          </label>
          <label class="ic-field">
            <span class="ic-label">入数</span>
            <input v-model="draft.lotSize" class="ic-input" type="text" inputmode="numeric" placeholder="例: 24本・1" />
          </label>
          <label class="ic-field">
            <span class="ic-label">単価</span>
            <input v-model="draft.price" class="ic-input" type="number" inputmode="decimal" min="0" placeholder="円" />
          </label>
          <label class="ic-field">
            <span class="ic-label">ジャンル</span>
            <input v-model="draft.category" class="ic-input" type="text" list="ic-genres" placeholder="選ぶか入力" />
          </label>
          <button type="button" class="ic-save" @click="save(r.item)">保存</button>
        </div>
      </div>
      <datalist id="ic-genres">
        <option v-for="g in genres" :key="g" :value="g" />
      </datalist>
    </div>
  </div>
</template>

<style scoped>
.ic-page { position: fixed; inset: 0; z-index: 30; background: #f8fafc; overflow-y: auto; }
.ic-header {
  position: sticky; top: 0; z-index: 2;
  display: flex; align-items: center; gap: 10px;
  padding: 12px 14px; background: #fff; border-bottom: 1px solid #e2e8f0;
}
.ic-back { border: none; background: none; color: var(--primary, #2563eb); font-size: 14px; font-weight: 700; cursor: pointer; padding: 4px 2px; }
.ic-title { font-size: 16px; font-weight: 800; color: #1e293b; }
.ic-count { margin-left: auto; font-size: 13px; font-weight: 800; color: #b45309; }
.ic-scroll { padding: 14px; max-width: 620px; margin: 0 auto; }
.ic-desc { font-size: 12px; color: #64748b; line-height: 1.6; margin: 0 0 10px; }
.ic-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }
.ic-chip {
  min-height: 36px; padding: 4px 12px; border: 1.5px solid #cbd5e1; border-radius: 16px;
  background: #fff; color: #475569; font-size: 12.5px; font-weight: 700; cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.ic-chip.on { border-color: #f59e0b; background: #fffbeb; color: #b45309; }
.ic-chip:disabled { opacity: 0.45; cursor: default; }
.ic-why { font-size: 11.5px; color: #92400e; margin: 2px 0 8px; }
.ic-empty { padding: 28px 8px; text-align: center; color: #94a3b8; font-size: 13px; }
.ic-toast { position: sticky; top: 56px; z-index: 3; margin-bottom: 8px; padding: 8px 12px; border-radius: 10px; background: #1e293b; color: #fff; font-size: 12.5px; font-weight: 700; }
.ic-row { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; margin-bottom: 8px; overflow: hidden; }
.ic-row.open { border-color: #fcd34d; }
.ic-row-head {
  width: 100%; display: flex; align-items: center; gap: 8px; min-height: 48px; padding: 8px 12px;
  border: none; background: none; text-align: left; cursor: pointer; font: inherit;
  -webkit-tap-highlight-color: transparent;
}
.ic-name { flex: 1; min-width: 0; font-size: 14px; font-weight: 700; color: #1e293b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ic-tags { display: flex; gap: 4px; flex-shrink: 0; }
.ic-tag { font-size: 10.5px; font-weight: 800; color: #b45309; background: #fef3c7; border-radius: 6px; padding: 1px 5px; }
.ic-arrow { font-size: 10px; color: #94a3b8; flex-shrink: 0; }
.ic-form { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding: 4px 12px 12px; }
.ic-field { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.ic-label { font-size: 11px; font-weight: 700; color: #64748b; }
.ic-input {
  min-height: 44px; border: 1.5px solid #cbd5e1; border-radius: 9px; padding: 6px 10px;
  font-size: 15px; color: #1e293b; background: #fff; min-width: 0;
}
.ic-input:focus { outline: none; border-color: #2563eb; }
.ic-save {
  grid-column: 1 / -1; min-height: 44px; border: none; border-radius: 10px;
  background: var(--primary, #2563eb); color: #fff; font-size: 14px; font-weight: 800; cursor: pointer;
}
</style>
