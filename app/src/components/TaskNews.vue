<script setup>
/**
 * カレンダータブの一番上の知らせ：「○○さんがやることをN件追加しました」（User決定 2026-10-04）。
 * 在庫タブには出さない（ナビのバッジだけ）。「確認しました」で消え、この端末で確認した時刻を覚える。
 */
import { computed } from 'vue'
import { newTasks, markTasksSeen } from '../composables/useTasks.js'

const groups = computed(() => {
  const by = new Map()
  for (const t of newTasks.value) {
    const k = t.createdBy || 'だれか'
    if (!by.has(k)) by.set(k, [])
    by.get(k).push(t)
  }
  return [...by.entries()].map(([who, items]) => ({ who, items }))
})
const md = d => { const [, m, dd] = String(d).split('-').map(Number); return m && dd ? `${m}/${dd}` : '' }
</script>

<template>
  <section v-if="groups.length" class="tn" role="status" aria-label="新しく追加されたやること">
    <div v-for="g in groups" :key="g.who" class="tn-g">
      <div class="tn-h"><span class="tn-av" aria-hidden="true">{{ g.who.slice(0, 1) }}</span>{{ g.who }}さんがやることを{{ g.items.length }}件追加しました</div>
      <ul class="tn-ul">
        <li v-for="t in g.items.slice(0, 5)" :key="t.id">{{ md(t.date) }} {{ t.text }}</li>
        <li v-if="g.items.length > 5">ほか {{ g.items.length - 5 }}件</li>
      </ul>
    </div>
    <button type="button" class="tn-ok" @click="markTasksSeen">確認しました</button>
  </section>
</template>

<style scoped>
.tn { flex-shrink: 0; display: grid; gap: 8px; margin-bottom: 8px; padding: 10px 12px; border-radius: 14px; background: var(--surface); border: 1px solid #fdba74; }
.tn-h { display: flex; align-items: center; gap: 8px; font-size: 13.5px; font-weight: 800; color: var(--text); }
.tn-av { flex: none; width: 26px; height: 26px; border-radius: 50%; background: #fff7ed; color: #c2410c; display: grid; place-items: center; font-size: 12px; }
.tn-ul { margin: 2px 0 0; padding: 0 0 0 34px; font-size: 12.5px; color: var(--text-muted); line-height: 1.7; }
.tn-ok { justify-self: start; margin-left: 34px; min-height: 36px; border: none; border-radius: 9px; padding: 0 14px; background: var(--bg); color: var(--text); font: inherit; font-size: 12.5px; font-weight: 800; cursor: pointer; }
</style>
