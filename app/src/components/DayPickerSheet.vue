<script setup>
/**
 * 日誌の「1日」で日付を押したときの日付選び（User決定 2026-10-13・モック docs/mocks/journal-day-v2.html ④）。
 * 小さな月カレンダーに、その日にあったこと（棚卸・発注・入庫・出庫・やること）を月と同じ色のドットで出し、
 * 過去の日もすぐ選べるようにする。「今日」「昨日」「先週の同じ曜日」は一押し。
 */
import { ref, computed } from 'vue'
import { localDateKey } from '../utils/localDate.js'

const props = defineProps({
  date:  { type: String, required: true },                 // 今見ている日（YYYY-MM-DD）
  marks: { type: Function, default: () => ({}) },          // 日 → { stock, order, in, out, task }
})
const emit = defineEmits(['pick', 'close'])

const WEEK = ['日', '月', '火', '水', '木', '金', '土']
const KINDS = ['stock', 'order', 'in', 'out', 'task']
const today = localDateKey()
const ym = ref({ y: Number(props.date.slice(0, 4)), m: Number(props.date.slice(5, 7)) - 1 })
const label = computed(() => `${ym.value.y}年${ym.value.m + 1}月`)
function move(n) {
  const d = new Date(ym.value.y, ym.value.m + n, 1)
  ym.value = { y: d.getFullYear(), m: d.getMonth() }
}
const cells = computed(() => {
  const { y, m } = ym.value
  const first = new Date(y, m, 1).getDay()
  const days = new Date(y, m + 1, 0).getDate()
  const out = Array.from({ length: first }, () => null)
  for (let d = 1; d <= days; d++) {
    const key = localDateKey(new Date(y, m, d))
    const mk = props.marks(key) || {}
    out.push({ d, key, dow: (first + d - 1) % 7, kinds: KINDS.filter(k => mk[k]) })
  }
  return out
})
const ago = n => localDateKey(new Date(Date.now() - n * 86400_000))
</script>

<template>
  <div class="dp-bg" @click.self="emit('close')">
    <div class="dp" role="dialog" aria-label="日付を選ぶ">
      <div class="dp-h">
        <button type="button" aria-label="前の月" @click="move(-1)">‹</button>
        <b>{{ label }}</b>
        <button type="button" aria-label="次の月" @click="move(1)">›</button>
      </div>
      <div class="dp-grid">
        <span v-for="(w, i) in WEEK" :key="w" :class="['dp-w', { sun: i === 0, sat: i === 6 }]">{{ w }}</span>
        <template v-for="(c, i) in cells" :key="i">
          <span v-if="!c" class="dp-c empty"></span>
          <button
            v-else type="button"
            :class="['dp-c', { sel: c.key === date, td: c.key === today, sun: c.dow === 0, sat: c.dow === 6 }]"
            :aria-label="c.key" :aria-current="c.key === date ? 'date' : undefined" @click="emit('pick', c.key)"
          >
            {{ c.d }}
            <span class="dp-dots"><i v-for="k in c.kinds" :key="k" :class="'k-' + k"></i></span>
          </button>
        </template>
      </div>
      <div class="dp-quick">
        <button type="button" @click="emit('pick', today)">今日</button>
        <button type="button" @click="emit('pick', ago(1))">昨日</button>
        <button type="button" @click="emit('pick', ago(7))">先週の同じ曜日</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dp-bg { position: fixed; inset: 0; z-index: 120; background: rgba(6,34,43,.4); display: flex; align-items: flex-end; justify-content: center; }
.dp { width: 100%; max-width: 600px; background: var(--surface); border-radius: 20px 20px 0 0; padding: 14px 14px calc(16px + env(safe-area-inset-bottom)); display: grid; gap: 10px; }
.dp-h { display: flex; align-items: center; justify-content: space-between; }
.dp-h b { font-size: 15px; }
.dp-h button { width: 44px; height: 36px; border: none; background: none; font-size: 22px; color: var(--text-muted); cursor: pointer; }
.dp-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 3px; }
.dp-w { text-align: center; font-size: 10.5px; font-weight: 800; color: var(--text-muted); padding-bottom: 2px; }
.dp-w.sun, .dp-c.sun { color: #ef4444; } .dp-w.sat, .dp-c.sat { color: #0891b2; }
.dp-c { height: 44px; border: none; border-radius: 10px; background: none; font: inherit; font-size: 13px; font-weight: 800; color: var(--text); display: grid; place-items: center; align-content: center; gap: 3px; cursor: pointer; padding: 0; }
.dp-c.empty { cursor: default; }
.dp-c.td { box-shadow: inset 0 0 0 2px var(--primary); }
.dp-c.sel { background: var(--primary); color: #fff; }
.dp-dots { display: flex; gap: 2px; height: 5px; }
.dp-dots i { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
.k-stock { color: #0e7490; } .k-order { color: #ea580c; } .k-in { color: #16a34a; } .k-out { color: #dc2626; } .k-task { color: #f59e0b; }
.dp-c.sel .dp-dots i { color: #fff; }
.dp-quick { display: flex; gap: 6px; }
.dp-quick button { flex: 1; min-height: 40px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); color: var(--primary-deep, #155e75); font: inherit; font-size: 12.5px; font-weight: 800; cursor: pointer; }
</style>
