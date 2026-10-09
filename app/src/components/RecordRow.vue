<script setup>
/**
 * 日誌の「記録」1件（棚卸・発注・入出庫。User決定 2026-10-09）。
 * - 棚卸: 始め〜終わり・実働（中断の回数）・人・金額（見られる人だけ）。押すと棚卸の詳細へ
 * - 発注・入出庫: 押すと品目と数を開く
 */
import { ref, computed } from 'vue'
import { canSeeMoney } from '../composables/useAuth.js'
import { fmtHm, fmtDuration } from '../services/journalRecords.js'

const props = defineProps({ rec: { type: Object, required: true } })
const emit = defineEmits(['view-session'])
const open = ref(false)

const ICON = { stock: '📦', order: '🧾', in: '📥', out: '📤' }
const r = computed(() => props.rec)
const sub = computed(() => {
  const x = r.value
  const parts = []
  if (x.kind === 'stock') {
    if (x.imported) parts.push('取り込んだ記録')
    else if (x.at != null && x.end != null) parts.push(`${fmtHm(x.at)}〜${fmtHm(x.end)}`)
    if (x.activeMs != null && !x.imported) parts.push(`実働 ${fmtDuration(x.activeMs)}${x.pauses?.length ? `（中断${x.pauses.length}回）` : ''}`)
    if (x.by) parts.push(x.by)
    if (canSeeMoney.value && x.total != null) parts.push(`¥${Math.round(x.total).toLocaleString('ja-JP')}`)
  } else {
    const names = x.lines.slice(0, 3).map(l => `${l.item} ${x.kind === 'out' ? '−' : x.kind === 'in' ? '+' : ''}${l.qty}${l.unit || ''}`)
    parts.push(names.join('・') + (x.lines.length > 3 ? ` ほか${x.lines.length - 3}` : ''))
    if (x.note) parts.push(x.note)
    if (x.by) parts.push(x.by)
  }
  return parts.join(' ・ ')
})
function onTap() {
  if (r.value.kind === 'stock') emit('view-session', r.value.session)
  else open.value = !open.value
}
</script>

<template>
  <div class="rr">
    <button type="button" class="rr-main" :aria-expanded="rec.kind === 'stock' ? undefined : open" @click="onTap">
      <span :class="['rr-ic', rec.kind]" aria-hidden="true">{{ ICON[rec.kind] }}</span>
      <span class="rr-tm">{{ fmtHm(rec.at) }}</span>
      <span class="rr-tx"><b>{{ rec.title }}</b><small>{{ sub }}</small></span>
      <span class="rr-go" aria-hidden="true">{{ rec.kind === 'stock' ? '›' : (open ? '▲' : '▼') }}</span>
    </button>
    <div v-if="open && rec.lines" class="rr-lines">
      <div v-for="(l, i) in rec.lines" :key="i" class="rr-line">
        <span>{{ l.item }}<small v-if="l.supplier"> {{ l.supplier }}</small></span>
        <span>{{ rec.kind === 'out' ? '−' : rec.kind === 'in' ? '+' : '' }}{{ l.qty }}{{ l.unit || '' }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rr { border-top: 1px solid var(--border); }
.rr:first-child { border-top: none; }
.rr-main { width: 100%; display: flex; align-items: center; gap: 10px; padding: 9px 6px; border: none; background: none; font: inherit; color: var(--text); text-align: left; cursor: pointer; }
.rr-ic { flex: none; width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; font-size: 14px; }
.rr-ic.stock { background: #cffafe; } .rr-ic.order { background: #ffedd5; } .rr-ic.in { background: #dcfce7; } .rr-ic.out { background: #fee2e2; }
.rr-tm { flex: none; width: 40px; font-size: 12px; font-weight: 800; color: var(--text-muted); font-variant-numeric: tabular-nums; }
.rr-tx { flex: 1; min-width: 0; display: grid; }
.rr-tx b { font-size: 14px; }
.rr-tx small { font-size: 11px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rr-go { flex: none; color: #94a3b8; font-size: 12px; }
.rr-lines { padding: 0 6px 10px 84px; display: grid; gap: 3px; }
.rr-line { display: flex; justify-content: space-between; gap: 8px; font-size: 12.5px; }
.rr-line small { color: var(--text-muted); font-size: 10.5px; }
</style>
