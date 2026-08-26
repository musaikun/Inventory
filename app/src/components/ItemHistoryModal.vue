<script setup>
import { computed } from 'vue'
import { useEscapeKey } from '../composables/useEscapeKey.js'
import { itemHistory } from '../services/participantStats.js'

const props = defineProps({
  snapshot: { type: Object, required: true },
  item:     { type: String, required: true },
})
const emit = defineEmits(['close'])

useEscapeKey(() => emit('close'))

// 新しい順。タイムスタンプのベタ書きでは追えない「この品目に何が起きたか」を1画面にする。
const rows = computed(() => itemHistory(props.snapshot, props.item))

// 何人が触ったか（1人なら重複なし）
const people = computed(() => new Set(rows.value.map(r => r.byId)).size)

function fmtWhen(ms) {
  if (ms == null) return ''
  const d = new Date(ms)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const LABEL = {
  new: '新規', add: '追加', overwrite: '上書き', remove: '削除',
  set: '入力', flag_recount: '🔖 あとで数える', unflag_recount: 'フラグ解除',
  order_set: '発注', order_clear: '発注取消',
}
const actionLabel = (a) => LABEL[a] ?? a ?? ''
function actionClass(a) {
  if (a === 'remove') return 'act-remove'
  if (a === 'new')    return 'act-new'
  if (a === 'add')    return 'act-add'
  if (a === 'overwrite') return 'act-over'
  return ''
}
</script>

<template>
  <div class="ih-overlay" @click.self="emit('close')">
    <div class="ih-sheet" role="dialog" aria-modal="true" aria-labelledby="ih-title">
      <div class="ih-handle"></div>
      <div id="ih-title" class="ih-title">{{ item }}</div>
      <div class="ih-sub">
        <template v-if="rows.length">
          {{ rows.length }}件の記録<template v-if="people > 1"> ・ <b class="ih-shared">{{ people }}人が変更</b></template>
        </template>
        <template v-else>この品目の変更履歴は残っていません</template>
      </div>

      <div v-if="rows.length" class="ih-list">
        <div v-for="r in rows" :key="r.id" class="ih-row">
          <span class="ih-when">{{ fmtWhen(r.at) }}</span>
          <span class="ih-by">{{ r.by }}</span>
          <span class="ih-act" :class="actionClass(r.action)">{{ actionLabel(r.action) }}</span>
          <span class="ih-qty">{{ r.qty }}{{ r.unit }}</span>
        </div>
      </div>

      <button class="ih-close" @click="emit('close')">閉じる</button>
    </div>
  </div>
</template>

<style scoped>
.ih-overlay { position: fixed; inset: 0; background: rgba(15,23,42,0.45); z-index: 120; display: flex; align-items: flex-end; }
.ih-sheet { background: #fff; width: 100%; border-radius: 18px 18px 0 0; padding: 10px 18px calc(18px + env(safe-area-inset-bottom)); max-height: 80dvh; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }
.ih-handle { width: 40px; height: 4px; border-radius: 2px; background: #e2e8f0; margin: 0 auto; flex-shrink: 0; }
.ih-title { font-size: 17px; font-weight: 800; color: #1e293b; text-align: center; }
.ih-sub { font-size: 12px; color: #64748b; text-align: center; }
.ih-shared { color: #c2410c; }

.ih-list { display: flex; flex-direction: column; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; }
.ih-row { display: flex; align-items: center; gap: 8px; padding: 9px 12px; font-size: 13px; border-bottom: 1px solid #f1f5f9; }
.ih-row:last-child { border-bottom: none; }
.ih-when { font-size: 11.5px; color: #94a3b8; font-variant-numeric: tabular-nums; flex-shrink: 0; }
.ih-by { flex: 1; min-width: 0; color: #1e293b; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ih-act { font-size: 11px; font-weight: 800; color: #64748b; flex-shrink: 0; }
.ih-act.act-new { color: #059669; }
.ih-act.act-add { color: #2563eb; }
.ih-act.act-over { color: #b45309; }
.ih-act.act-remove { color: #b91c1c; }
.ih-qty { font-weight: 800; color: #1e293b; flex-shrink: 0; font-variant-numeric: tabular-nums; }

.ih-close { border: none; border-radius: 12px; padding: 13px; font-size: 15px; font-weight: 800; color: #475569; background: #f1f5f9; cursor: pointer; }
</style>
