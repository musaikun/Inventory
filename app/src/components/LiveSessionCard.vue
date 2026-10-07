<script setup>
/**
 * トップの「進行中」のカード（棚卸・発注。User 2026-10-07）。
 * - 進み具合（数えた品目／全品目）のバー、つないでいる人の丸
 * - ルームで誰かが数を入れるたびに、その1行（だれが・何を・いくつ）が上から流れて入る
 *   （棚卸の画面で出るポップの知らせと同じ中身。ホームは5秒ごとにルームの状態を読み直す）
 * - 新しい変更が届いたら、棚卸の画面のポップと同じ文面（「山田: 「トマト」3個」）をカードの上に小さく出す
 * - 押すと続きから
 */
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  kind:      { type: String, default: 'stock' },   // 'stock' | 'order'
  session:   { type: Object, required: true },
  live:      { type: Object, default: null },      // /room/:code/status（このセッションのルームのときだけ）
  count:     { type: Number, default: 0 },
})
const emit = defineEmits(['resume'])

const now = ref(Date.now())
let timer = null
onMounted(() => { timer = setInterval(() => { now.value = Date.now() }, 15000) })
onUnmounted(() => clearInterval(timer))

const label = computed(() => (props.kind === 'order' ? '発注の途中' : '棚卸の途中'))
const total = computed(() => props.live?.totalItems ?? null)
const pct = computed(() => (total.value ? Math.min(100, Math.round((props.count / total.value) * 100)) : null))
const people = computed(() => props.live?.participants ?? [])
const recent = computed(() => (props.live?.recent ?? []).slice(0, 3))

function since(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}〜`
}
function ago(ms) {
  const s = Math.max(0, Math.floor((now.value - ms) / 1000))
  if (s < 60) return 'たった今'
  if (s < 3600) return `${Math.floor(s / 60)}分前`
  return `${Math.floor(s / 3600)}時間前`
}
/** 1行の中身（棚卸の画面のポップの知らせと同じ言い方） */
function line(e) {
  const q = `${e.qty ?? ''}${e.unit || ''}`
  switch (e.action) {
    case 'add':            return `${e.item} ${q}（${e.delta > 0 ? '+' : ''}${e.delta}）`
    case 'remove':         return `${e.item} を消しました`
    case 'flag_recount':   return `${e.item} に数え直しの印`
    case 'unflag_recount': return `${e.item} の数え直しの印を外しました`
    case 'order_set':      return `${e.item} 発注 ${q}`
    case 'order_clear':    return `${e.item} の発注を取り消し`
    default:               return `${e.item} ${q}`
  }
}
const initial = n => (n || '・').slice(0, 1)

// ── ポップ（新しい変更が届いたときだけ・User 2026-10-07）──
// 最初に読んだ分は「もう見た」扱い。以降に増えた分のうち一番新しい1件を出し、ほかは「ほか N件」
const pop = ref(null)      // { key, text, more }
let _seen = null
let _popT = null
function popText(e) {
  const who = e.by || '他のメンバー'
  const q = `${e.qty ?? ''}${e.unit || ''}`
  if (e.action === 'remove') return `${who}: 「${e.item}」を削除`
  if (e.action === 'order_set') return `${who}: 「${e.item}」発注 ${q}`
  if (e.action === 'order_clear') return `${who}: 「${e.item}」の発注を取り消し`
  if (e.action === 'flag_recount') return `${who}: 「${e.item}」に数え直しの印`
  if (e.action === 'unflag_recount') return `${who}: 「${e.item}」の印を外した`
  return `${who}: 「${e.item}」${q}`
}
watch(() => props.live?.recent, list => {
  if (!Array.isArray(list)) return            // まだ読めていない（ルームの状態を読む前）
  const items = list
  if (_seen === null) { _seen = new Set(items.map(e => e.id)); return }
  const fresh = items.filter(e => !_seen.has(e.id))
  for (const e of items) _seen.add(e.id)
  if (!fresh.length) return
  pop.value = { key: fresh[0].id, text: popText(fresh[0]), more: fresh.length - 1 }
  clearTimeout(_popT)
  _popT = setTimeout(() => { pop.value = null }, 2800)
}, { immediate: true })
onUnmounted(() => clearTimeout(_popT))
</script>

<template>
  <button type="button" :class="['lc', kind]" @click="emit('resume', session)">
    <Transition name="lc-pop">
      <span v-if="pop" :key="pop.key" class="lc-pop" role="status">{{ pop.text }}<small v-if="pop.more"> ほか{{ pop.more }}件</small></span>
    </Transition>
    <span class="lc-head">
      <span class="lc-dot" aria-hidden="true"></span>
      <b>{{ label }}</b>
      <small>{{ since(session.startedAt) }}</small>
      <span class="lc-go">続ける ›</span>
    </span>

    <span class="lc-prog">
      <span class="lc-num"><b>{{ count }}</b><template v-if="total"> / {{ total }}</template> 品目</span>
      <span v-if="people.length" class="lc-people" :aria-label="`${people.length}人がつないでいます`">
        <span v-for="(p, i) in people.slice(0, 4)" :key="i" class="lc-av" :title="p.name">{{ initial(p.name) }}</span>
        <span v-if="people.length > 4" class="lc-av more">+{{ people.length - 4 }}</span>
      </span>
    </span>
    <span v-if="pct != null" class="lc-bar" aria-hidden="true"><i :style="{ width: pct + '%' }"></i></span>

    <TransitionGroup v-if="recent.length" name="lc-feed" tag="span" class="lc-feed" aria-live="polite">
      <span v-for="e in recent" :key="e.id" class="lc-ev">
        <span class="lc-ev-who">{{ e.by || 'だれか' }}</span>
        <span class="lc-ev-what">{{ line(e) }}</span>
        <span class="lc-ev-at">{{ ago(e.at) }}</span>
      </span>
    </TransitionGroup>
  </button>
</template>

<style scoped>
.lc { position: relative; width: calc(100% - 28px); margin: 12px 14px 0; display: grid; gap: 8px; padding: 12px 14px; border-radius: 18px; border: none; cursor: pointer; text-align: left; font: inherit; color: var(--text);
  background: linear-gradient(var(--surface), var(--surface)) padding-box, var(--grad-ring) border-box; border: 1.5px solid transparent; box-shadow: 0 6px 18px rgba(14,116,144,.12); }
.lc.order { background: linear-gradient(var(--surface), var(--surface)) padding-box, linear-gradient(90deg, #fb923c, #fbbf24) border-box; box-shadow: 0 6px 18px rgba(234,88,12,.12); }
.lc-head { display: flex; align-items: center; gap: 8px; }
.lc-head b { font-size: 14px; }
.lc-head small { font-size: 11.5px; color: var(--text-muted); }
.lc-dot { width: 8px; height: 8px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 0 0 rgba(34,197,94,.6); animation: lc-pulse 1.8s ease-out infinite; }
.lc.order .lc-dot { background: #f97316; box-shadow: 0 0 0 0 rgba(249,115,22,.6); }
@keyframes lc-pulse { 0% { box-shadow: 0 0 0 0 rgba(34,197,94,.55); } 100% { box-shadow: 0 0 0 8px rgba(34,197,94,0); } }
.lc-go { margin-left: auto; font-size: 12.5px; font-weight: 800; color: #08323c; background: var(--grad-btn); padding: 5px 12px; border-radius: 999px; }
.lc.order .lc-go { background: #fff7ed; color: #c2410c; border: 1px solid #fdba74; }
.lc-prog { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.lc-num { font-size: 12px; color: var(--text-muted); }
.lc-num b { font-size: 20px; color: var(--text); font-variant-numeric: tabular-nums; }
.lc-people { display: flex; }
.lc-av { width: 24px; height: 24px; margin-left: -6px; border-radius: 50%; display: grid; place-items: center; font-size: 11px; font-weight: 800; color: #08323c; background: var(--grad-btn); border: 2px solid var(--surface); }
.lc-av.more { background: #e2eef1; color: var(--text-muted); font-size: 10px; }
.lc-bar { height: 6px; border-radius: 999px; background: #e2eef1; overflow: hidden; }
.lc-bar i { display: block; height: 100%; border-radius: 999px; background: var(--grad-ring); transition: width .6s ease; }
.lc.order .lc-bar i { background: linear-gradient(90deg, #fb923c, #fbbf24); }
.lc-feed { position: relative; display: grid; gap: 4px; padding-top: 6px; border-top: 1px dashed var(--border); }
.lc-ev { display: flex; align-items: baseline; gap: 8px; font-size: 12.5px; min-width: 0; }
.lc-ev:first-child { font-weight: 700; }
.lc-ev-who { flex: none; font-weight: 800; color: var(--primary); max-width: 6em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lc.order .lc-ev-who { color: #c2410c; }
.lc-ev-what { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lc-ev-at { flex: none; font-size: 10.5px; color: var(--text-muted); }
.lc-ev:not(:first-child) { opacity: .7; }
/* 新しい1行は上から流れて入り、古い行は下へ押し出される */
.lc-feed-enter-active { transition: transform .45s cubic-bezier(.2,.8,.2,1), opacity .45s; }
.lc-feed-enter-from { transform: translateY(-10px); opacity: 0; }
.lc-feed-leave-active { transition: opacity .3s; position: absolute; }
.lc-feed-leave-to { opacity: 0; }
.lc-feed-move { transition: transform .45s cubic-bezier(.2,.8,.2,1); }
/* 新しい変更のポップ: カードの上の縁に小さく重ねて出し、少しして消える */
.lc-pop { position: absolute; top: -13px; left: 14px; max-width: calc(100% - 28px); z-index: 2; padding: 5px 11px; border-radius: 999px;
  font-size: 11.5px; font-weight: 800; color: #fff; background: #0b3b48; box-shadow: 0 6px 16px rgba(6,34,43,.28);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; pointer-events: none; }
.lc.order .lc-pop { background: #9a3412; }
.lc-pop small { font-weight: 700; opacity: .8; }
.lc-pop-enter-active { transition: transform .35s cubic-bezier(.2,.9,.3,1.3), opacity .25s; }
.lc-pop-enter-from { transform: translateY(8px) scale(.9); opacity: 0; }
.lc-pop-leave-active { transition: opacity .4s, transform .4s; }
.lc-pop-leave-to { opacity: 0; transform: translateY(-6px); }
@media (prefers-reduced-motion: reduce) {
  .lc-pop-enter-active, .lc-pop-leave-active { transition: opacity .2s; }
  .lc-pop-enter-from, .lc-pop-leave-to { transform: none; }
  .lc-dot { animation: none; }
  .lc-feed-enter-active, .lc-feed-move, .lc-bar i { transition: none; }
}
</style>
