<script setup>
/**
 * 日誌のその日の申し送り（前の日と当日に書いたもの・User決定 2026-10-25）。
 * 1件＝絵（📣/🙏）・中身・名前と時刻（頼んだものは「→ 相手」）・右に［確認］か「✓ やることへ」。
 * 自分が確認した📣はたたむ。押すと「やることにする」「消す」
 * who: 担当者の絞り（all | me | none | p:<id>）。人を選んだら、その人に頼んだものだけ
 */
import { ref, computed } from 'vue'
import { handoffsFor, isReadByMe, isMine, readHandoff, removeHandoff, canRemoveHandoff } from '../composables/useHandoffs.js'
import { isMeId } from '../composables/useDeviceId.js'

const props = defineProps({
  date: { type: String, required: true },
  who: { type: String, default: 'all' },
})
const emit = defineEmits(['convert'])
const all = computed(() => handoffsFor(props.date).filter(h => {
  if (props.who === 'all') return true
  if (props.who === 'me') return h.kind === 'tell' || isMeId(h.toId)
  if (props.who === 'none') return h.kind === 'ask' && !h.toId
  return h.kind === 'ask' && h.toId === props.who.slice(2)
}))
const done = h => h.kind === 'tell' && !h.taskId && isReadByMe(h)
const open = computed(() => all.value.filter(h => !done(h)))
const folded = computed(() => all.value.filter(done))
const foldOpen = ref(false)
const hm = iso => { const d = new Date(iso); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}` }
const meta = h => (h.kind === 'ask' ? `${h.by}${h.toName ? ` → ${h.toName}` : ''}` : `${h.by} ${hm(h.createdAt)}`)
const menu = ref(null)
const err = ref('')
async function del(h) { menu.value = null; err.value = ''; try { await removeHandoff(h) } catch (e) { err.value = e?.message || '消せませんでした' } }
</script>

<template>
  <div v-if="all.length" class="hb">
    <div v-for="h in [...open, ...(foldOpen ? folded : [])]" :key="h.id" :class="['hb-i', h.kind, { dim: done(h) }]">
      <em aria-hidden="true">{{ h.kind === 'ask' ? '🙏' : '📣' }}</em>
      <button type="button" class="hb-tx" :aria-expanded="menu === h.id" @click="menu = menu === h.id ? null : h.id">
        <b>{{ h.body }}</b><small>{{ meta(h) }}<template v-if="h.kind === 'tell' && h.reads?.length"> ・ 👀 {{ h.reads.length }}</template></small>
      </button>
      <span v-if="h.taskId" class="hb-ok">✓ やることへ</span>
      <button v-else-if="h.kind === 'tell' && !isReadByMe(h) && !isMine(h)" type="button" class="hb-read" @click="readHandoff(h)">確認</button>
      <div v-if="menu === h.id" class="hb-menu">
        <button v-if="h.kind === 'tell' && !h.taskId" type="button" @click="menu = null; emit('convert', h)">📣 → ✓ やることにする</button>
        <button v-if="canRemoveHandoff(h)" type="button" class="del" @click="del(h)">消す</button>
        <span v-if="h.reads?.length" class="hb-reads">👀 {{ h.reads.map(r => r.name).filter(Boolean).join('・') }}</span>
      </div>
    </div>
    <button v-if="folded.length" type="button" class="hb-fold" :aria-expanded="foldOpen" @click="foldOpen = !foldOpen">✓ {{ folded.length }} {{ foldOpen ? '▲' : '▼' }}</button>
    <p v-if="err" class="hb-err" role="alert">{{ err }}</p>
  </div>
</template>

<style scoped>
.hb { background: #fffbeb; border: 1px solid #fde68a; border-radius: 16px; padding: 6px; display: grid; gap: 6px; }
.hb-i { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 8px; background: #fff; border-radius: 12px; padding: 8px 10px; }
.hb-i.dim { opacity: .6; }
.hb-i em { font-style: normal; font-size: 17px; }
.hb-tx { border: none; background: none; font: inherit; text-align: left; padding: 0; cursor: pointer; display: grid; gap: 2px; color: var(--text); min-width: 0; }
.hb-tx b { font-size: 13.5px; font-weight: 700; line-height: 1.45; overflow-wrap: anywhere; }
.hb-tx small { font-size: 11px; color: var(--text-muted); font-weight: 800; }
.hb-read { border: none; background: #0e7490; color: #fff; border-radius: 999px; padding: 6px 12px; font: inherit; font-size: 12px; font-weight: 900; cursor: pointer; }
.hb-ok { font-size: 11.5px; font-weight: 900; color: #16a34a; white-space: nowrap; }
.hb-menu { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding-top: 4px; }
.hb-menu button { border: 1px solid var(--border); background: #f8fafc; border-radius: 999px; padding: 6px 12px; font: inherit; font-size: 12.5px; font-weight: 800; color: var(--text); cursor: pointer; }
.hb-menu button.del { color: #b91c1c; }
.hb-reads { font-size: 11.5px; color: var(--text-muted); font-weight: 700; }
.hb-fold { justify-self: start; border: none; background: none; font: inherit; font-size: 12px; font-weight: 800; color: #92400e; cursor: pointer; padding: 2px 6px; }
.hb-err { margin: 0; font-size: 12px; color: #b91c1c; font-weight: 700; }
</style>
