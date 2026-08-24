<script setup>
/**
 * 発注点の一括設定。
 *
 * 部分利用（週1回・不定期）のユーザーは曜日別の学習も消費推定も貯まらない。
 * そのあいだ推奨発注数を支えるのは手動の発注点なので、**入力の手間を下げる**ことが
 * 分析の高度化より先に効く（D-024）。1品目ずつ詳細シートを開かずにまとめて入れる画面。
 *
 * 提案は出せるものだけ出す。出せない品目は空欄のままにして、推測で埋めない。
 */
import { ref, computed } from 'vue'
import { useEscapeKey } from '../composables/useEscapeKey.js'

const props = defineProps({
  // [{ item, current, suggested, source, basis }]
  rows: { type: Array, default: () => [] },
  unitOf: { type: Function, default: () => '' },
})
const emit = defineEmits(['update', 'close'])
useEscapeKey(() => emit('close'))

const onlyUnset = ref(true)
const visible = computed(() =>
  onlyUnset.value ? props.rows.filter(r => r.current == null) : props.rows)

const suggestable = computed(() =>
  props.rows.filter(r => r.suggested != null && r.current == null))

function onInput(item, e) { emit('update', item, e.target.value) }
function adopt(row) { emit('update', row.item, row.suggested) }
function adoptAll() {
  for (const r of suggestable.value) emit('update', r.item, r.suggested)
}

const unsetCount = computed(() => props.rows.filter(r => r.current == null).length)
</script>

<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <div class="modal-sheet rb-sheet" role="dialog" aria-modal="true">
      <div class="sheet-handle"></div>
      <div class="sheet-title">発注点をまとめて設定</div>

      <p class="rb-desc">
        発注点は「この在庫を下回ったら発注する」水準です。入れておくと、学習が貯まる前でも
        発注数の推奨が出せます。
      </p>

      <div class="rb-bar">
        <label class="rb-filter">
          <input type="checkbox" v-model="onlyUnset" />
          未設定のみ（{{ unsetCount }}件）
        </label>
        <button
          class="rb-adopt-all"
          :disabled="suggestable.length === 0"
          @click="adoptAll"
        >提案をまとめて採用（{{ suggestable.length }}件）</button>
      </div>

      <div v-if="visible.length === 0" class="rb-empty">
        {{ onlyUnset ? 'すべての品目に発注点が入っています。' : '表示できる品目がありません。' }}
      </div>

      <div v-else class="rb-list">
        <div v-for="row in visible" :key="row.item" class="rb-row">
          <div class="rb-main">
            <span class="rb-item">{{ row.item }}</span>
            <span v-if="row.basis" class="rb-basis">{{ row.basis }}</span>
            <span v-else class="rb-basis none">目安を出せません（棚卸が2回以上あると出せます）</span>
          </div>
          <button
            v-if="row.suggested != null"
            class="rb-suggest"
            :title="row.basis"
            @click="adopt(row)"
          >目安 {{ row.suggested }}</button>
          <input
            class="rb-input"
            type="number" inputmode="numeric" min="0" placeholder="未設定"
            :value="row.current != null ? row.current : ''"
            :aria-label="`${row.item} の発注点`"
            @input="e => onInput(row.item, e)"
          />
          <span class="rb-unit">{{ unitOf(row.item) || '個' }}</span>
        </div>
      </div>

      <button class="btn btn-primary rb-close" @click="emit('close')">閉じる</button>
    </div>
  </div>
</template>

<style scoped>
.rb-sheet { max-height: 88vh; overflow-y: auto; }
.rb-desc { font-size: 12px; color: #64748b; line-height: 1.6; margin: 0 0 12px; }

.rb-bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
.rb-filter { display: flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 700; color: #475569; }
.rb-adopt-all {
  margin-left: auto; border: 1.5px solid #bfdbfe; background: #eff6ff; color: #1d4ed8;
  border-radius: 9px; min-height: 40px; padding: 6px 12px;
  font-size: 12.5px; font-weight: 800; cursor: pointer; -webkit-tap-highlight-color: transparent;
}
.rb-adopt-all:disabled { opacity: 0.45; cursor: default; }
.rb-adopt-all:active:not(:disabled) { background: #dbeafe; }

.rb-empty { padding: 24px 8px; text-align: center; color: #94a3b8; font-size: 13px; }

.rb-list { display: flex; flex-direction: column; }
.rb-row { display: flex; align-items: center; gap: 8px; padding: 9px 2px; border-top: 1px solid #f1f5f9; }
.rb-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.rb-item { font-size: 13.5px; font-weight: 700; color: #334155; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rb-basis { font-size: 10.5px; color: #94a3b8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rb-basis.none { color: #cbd5e1; }
.rb-suggest {
  flex-shrink: 0; border: 1.5px solid #bfdbfe; background: #eff6ff; color: #1d4ed8;
  border-radius: 8px; min-height: 40px; padding: 4px 8px;
  font-size: 12px; font-weight: 800; cursor: pointer; white-space: nowrap;
  -webkit-tap-highlight-color: transparent;
}
.rb-input {
  flex-shrink: 0; width: 72px; min-height: 44px;
  border: 1.5px solid #fecaca; border-radius: 9px; padding: 6px 8px;
  font-size: 15px; font-weight: 700; text-align: right; color: #b91c1c; background: #fff;
}
.rb-input:focus { outline: none; border-color: #ef4444; }
.rb-unit { flex-shrink: 0; font-size: 11px; color: #94a3b8; width: 22px; }

.btn { width: 100%; border: none; border-radius: 10px; padding: 13px; font-size: 14px; font-weight: 800; cursor: pointer; }
.btn-primary { background: var(--primary, #2563eb); color: #fff; }
.rb-close { margin-top: 14px; }
</style>
