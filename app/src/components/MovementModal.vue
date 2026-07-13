<script setup>
import { ref, computed } from 'vue'
import { useConfig } from '../composables/useConfig.js'
import { useMovements } from '../composables/useMovements.js'

const emit = defineEmits(['close', 'saved'])
const { config } = useConfig()
const { saveMovement } = useMovements()

const type   = ref('in')
const date   = ref(new Date().toISOString().slice(0, 10))
const note   = ref('')
const search = ref('')
const lines  = ref([])

const hiddenSet = computed(() => new Set(config.hiddenItems || []))

const candidates = computed(() => {
  const q = search.value.trim()
  const inLines = new Set(lines.value.map(l => l.item))
  return (config.order || [])
    .filter(n => !hiddenSet.value.has(n) && !inLines.has(n))
    .filter(n => !q || n.includes(q))
    .slice(0, 24)
})

// マスタに無い名前でも行を追加できる（個人利用・未整備の店舗向け）
const canAddFree = computed(() => {
  const q = search.value.trim()
  return !!q && !lines.value.some(l => l.item === q) && !(config.order || []).includes(q)
})

function addLine(name) {
  lines.value.push({ item: name, qty: 1, unit: config.units?.[name] ?? '' })
  search.value = ''
}
function removeLine(i) { lines.value.splice(i, 1) }

const canSave = computed(() => lines.value.some(l => Number(l.qty) > 0))

function onSave() {
  const rec = saveMovement({ type: type.value, date: date.value, note: note.value, lines: lines.value })
  if (rec) emit('saved', rec)
  emit('close')
}
</script>

<template>
  <div class="mv-overlay" @click.self="emit('close')">
    <div class="mv-sheet">
      <div class="mv-handle"></div>
      <div class="mv-title">入出庫を記録</div>

      <div class="mv-toggle">
        <button :class="['mv-tg', 'in', { on: type === 'in' }]" @click="type = 'in'">📥 入庫</button>
        <button :class="['mv-tg', 'out', { on: type === 'out' }]" @click="type = 'out'">📤 出庫</button>
      </div>

      <div class="mv-row">
        <label class="mv-label">日付</label>
        <input v-model="date" type="date" class="mv-date" />
      </div>

      <div v-if="lines.length" class="mv-lines">
        <div v-for="(l, i) in lines" :key="l.item" class="mv-line">
          <span class="mv-line-name">{{ l.item }}</span>
          <input v-model="l.qty" type="number" inputmode="decimal" min="0" step="any" class="mv-qty" />
          <span class="mv-unit">{{ l.unit || '個' }}</span>
          <button class="mv-line-del" @click="removeLine(i)">✕</button>
        </div>
      </div>

      <div class="mv-pick">
        <input v-model="search" type="text" class="mv-search" placeholder="品目名で検索（なければ新規追加）" />
        <div v-if="candidates.length || canAddFree" class="mv-cands">
          <button v-for="n in candidates" :key="n" class="mv-cand" @click="addLine(n)">＋ {{ n }}</button>
          <button v-if="canAddFree" class="mv-cand free" @click="addLine(search.trim())">＋「{{ search.trim() }}」を追加</button>
        </div>
        <div v-else-if="!lines.length" class="mv-hint">品目マスタが空です。検索欄に品目名を入力すると追加できます。</div>
      </div>

      <input v-model="note" type="text" class="mv-note" placeholder="メモ（任意）例: 火曜納品分 / まかない使用" />

      <button :class="['mv-save', type]" :disabled="!canSave" @click="onSave">
        {{ type === 'in' ? '入庫を保存' : '出庫を保存' }}（{{ lines.length }}品目）
      </button>
      <button class="mv-cancel" @click="emit('close')">キャンセル</button>
    </div>
  </div>
</template>

<style scoped>
.mv-overlay { position: fixed; inset: 0; background: rgba(15,23,42,0.45); z-index: 100; display: flex; align-items: flex-end; }
.mv-sheet { background: #fff; width: 100%; border-radius: 18px 18px 0 0; padding: 10px 18px calc(18px + env(safe-area-inset-bottom)); max-height: 88dvh; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; }
.mv-handle { width: 40px; height: 4px; border-radius: 2px; background: #e2e8f0; margin: 0 auto; flex-shrink: 0; }
.mv-title { font-size: 16px; font-weight: 800; color: #1e293b; text-align: center; }

.mv-toggle { display: flex; gap: 8px; }
.mv-tg { flex: 1; border: 1.5px solid var(--border, #e2e8f0); background: #fff; border-radius: 12px; padding: 12px; font-size: 15px; font-weight: 800; color: #64748b; cursor: pointer; }
.mv-tg.in.on  { border-color: #10b981; color: #047857; background: #ecfdf5; }
.mv-tg.out.on { border-color: #ef4444; color: #b91c1c; background: #fef2f2; }

.mv-row { display: flex; align-items: center; gap: 10px; }
.mv-label { font-size: 13px; font-weight: 700; color: #64748b; flex-shrink: 0; }
.mv-date { flex: 1; border: 1.5px solid var(--border, #e2e8f0); border-radius: 10px; padding: 8px 10px; font-size: 14px; color: #1e293b; background: #fff; }

.mv-lines { display: flex; flex-direction: column; gap: 6px; }
.mv-line { display: flex; align-items: center; gap: 8px; border: 1.5px solid var(--border, #e2e8f0); border-radius: 10px; padding: 8px 10px; }
.mv-line-name { flex: 1; min-width: 0; font-size: 14px; font-weight: 700; color: #334155; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mv-qty { width: 72px; border: 1.5px solid var(--border, #e2e8f0); border-radius: 8px; padding: 6px 8px; font-size: 15px; font-weight: 700; text-align: right; color: #1e293b; }
.mv-unit { font-size: 12px; color: #64748b; flex-shrink: 0; min-width: 24px; }
.mv-line-del { border: none; background: none; color: #94a3b8; font-size: 14px; cursor: pointer; padding: 4px; }

.mv-search { width: 100%; border: 1.5px solid var(--border, #e2e8f0); border-radius: 10px; padding: 10px 12px; font-size: 14px; }
.mv-cands { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; max-height: 130px; overflow-y: auto; }
.mv-cand { border: 1px solid var(--primary-border, #bfdbfe); background: var(--primary-weak, #eff6ff); color: var(--primary, #2563eb); border-radius: 16px; padding: 6px 12px; font-size: 13px; font-weight: 700; cursor: pointer; }
.mv-cand.free { border-color: #a7f3d0; background: #ecfdf5; color: #047857; }
.mv-hint { font-size: 12px; color: #94a3b8; margin-top: 8px; line-height: 1.5; }

.mv-note { width: 100%; border: 1.5px solid var(--border, #e2e8f0); border-radius: 10px; padding: 10px 12px; font-size: 14px; }

.mv-save { border: none; border-radius: 12px; padding: 14px; font-size: 15px; font-weight: 800; color: #fff; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.mv-save.in  { background: linear-gradient(135deg, #34d399 0%, #059669 100%); }
.mv-save.out { background: linear-gradient(135deg, #f87171 0%, #dc2626 100%); }
.mv-save:disabled { opacity: 0.5; cursor: not-allowed; }
.mv-save:active { transform: scale(0.98); }
.mv-cancel { border: none; background: none; color: #64748b; font-size: 14px; font-weight: 700; padding: 6px; cursor: pointer; }
</style>
