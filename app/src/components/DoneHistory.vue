<script setup>
/**
 * 済んだ業務の履歴（全画面・User 2026-11-18）。期間・種類・ジャンル・人・遅れ・文字で絞る。
 * 1か月までは端末にある分で出し、3か月・1年はサーバーから取り寄せる（端末の一覧には足さない）。
 * 進行中だったものは押すと経過（ProgressSheet）を開ける。定期のチェック表は「定期の記録」へ。
 */
import { ref, computed, watch, onUnmounted } from 'vue'
import LineIcon from './LineIcon.vue'
import { aliveTasks } from '../composables/useTasks.js'
import { loadTasksFromD1 } from '../composables/useStore.js'
import { registerInnerLayerCloser } from '../composables/appMenuState.js'
import { useEscapeKey } from '../composables/useEscapeKey.js'
import { localDateKey } from '../utils/localDate.js'
import { PERIODS, KIND_LABEL, CATEGORY_LABEL, doneItems, filterDone, groupByDay, summarize, kindOf, lateness, whoDid, mergeById } from '../services/doneHistory.js'

const emit = defineEmits(['close', 'open-progress', 'routine'])
useEscapeKey(() => emit('close'))
onUnmounted(registerInnerLayerCloser(() => { emit('close'); return true }))

const days = ref(30)
const kind = ref(''), category = ref(''), who = ref(''), late = ref(''), q = ref('')

// 端末にあるのは直近120日ほど。それより前を見るときだけ取り寄せる
const LOCAL_DAYS = 120
const fetched = ref([])
const loading = ref(false), loadErr = ref('')
watch(days, async d => {
  if (d <= LOCAL_DAYS || fetched.value.length) return
  loading.value = true; loadErr.value = ''
  const r = await loadTasksFromD1(d).catch(() => null)
  loading.value = false
  if (Array.isArray(r)) fetched.value = r
  else loadErr.value = '前の記録を取り寄せられませんでした。端末にある分だけ出しています'
})

const all = computed(() => doneItems(mergeById(aliveTasks.value, fetched.value)))
const inPeriod = computed(() => filterDone(all.value, { days: days.value }))
// 絞り込みの選択肢は、その期間に実際にあるものだけ
const categories = computed(() => {
  const has = new Set(inPeriod.value.map(t => t.category || 'none'))
  return [...Object.keys(CATEGORY_LABEL), 'none'].filter(k => has.has(k))
})
const people = computed(() => [...new Set(inPeriod.value.map(whoDid).filter(Boolean).flatMap(n => n.split('・')))].sort())
const shown = computed(() => filterDone(inPeriod.value, { kind: kind.value, category: category.value, late: late.value, q: q.value })
  .filter(t => !who.value || whoDid(t).split('・').includes(who.value)))
const groups = computed(() => groupByDay(shown.value))
const sum = computed(() => summarize(shown.value))
const filtered = computed(() => !!(kind.value || category.value || who.value || late.value || q.value.trim()))
function clearFilters() { kind.value = ''; category.value = ''; who.value = ''; late.value = ''; q.value = '' }

const WEEK = ['日', '月', '火', '水', '木', '金', '土']
const today = localDateKey()
function dayLabel(k) {
  const d = new Date(k + 'T00:00:00')
  const base = `${d.getMonth() + 1}/${d.getDate()}（${WEEK[d.getDay()]}）`
  return k === today ? `今日 ${base}` : base
}
const hm = iso => { const d = new Date(iso); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}` }
const md = k => `${Number(k.slice(5, 7))}/${Number(k.slice(8, 10))}`
function sub(t) {
  const k = kindOf(t)
  const span = k === 'progress' ? `${md(t.date)}〜${t.deadline ? ` 締め切り${md(t.deadline)}` : ' 締め切り未定'}` : ''
  return [whoDid(t) || 'だれか', hm(t.doneAt), span].filter(Boolean).join(' ・ ')
}
function tagOf(t) {
  const l = lateness(t)
  if (!l) return null
  return l.late ? { cls: 'late', text: l.days > 0 ? `${l.days}日遅れ` : '時刻より遅れ' } : { cls: 'ok', text: '期限内' }
}
function open(t) { if (kindOf(t) === 'progress') emit('open-progress', t) }
</script>

<template>
  <Teleport to="body">
    <div class="dh" role="dialog" aria-modal="true" aria-label="済んだ業務">
      <header class="dh-h">
        <button type="button" class="dh-x" aria-label="閉じる" @click="emit('close')">‹</button>
        <b>済んだ業務</b>
        <button type="button" class="dh-rt" @click="emit('routine')"><LineIcon name="repeat" /> 定期の記録</button>
      </header>

      <div class="dh-f">
        <div class="dh-seg" role="tablist" aria-label="期間">
          <button v-for="p in PERIODS" :key="p.days" type="button" role="tab" :aria-selected="days === p.days" :class="{ on: days === p.days }" @click="days = p.days">{{ p.label }}</button>
        </div>
        <input v-model="q" class="dh-q" type="search" placeholder="名前・メモで探す" aria-label="名前・メモで探す" />
        <div class="dh-chips">
          <select v-model="kind" aria-label="種類" :class="{ on: kind }">
            <option value="">種類</option>
            <option v-for="(l, k) in KIND_LABEL" :key="k" :value="k">{{ l }}</option>
          </select>
          <select v-if="categories.length > 1" v-model="category" aria-label="ジャンル" :class="{ on: category }">
            <option value="">ジャンル</option>
            <option v-for="c in categories" :key="c" :value="c">{{ c === 'none' ? 'ジャンルなし' : CATEGORY_LABEL[c] }}</option>
          </select>
          <select v-if="people.length > 1" v-model="who" aria-label="済ませた人" :class="{ on: who }">
            <option value="">人</option>
            <option v-for="n in people" :key="n" :value="n">{{ n }}</option>
          </select>
          <select v-model="late" aria-label="期限" :class="{ on: late }">
            <option value="">期限</option>
            <option value="ok">期限内</option>
            <option value="late">遅れ</option>
          </select>
          <button v-if="filtered" type="button" class="dh-clear" @click="clearFilters">戻す</button>
        </div>
        <p class="dh-sum" aria-live="polite">
          <b>{{ sum.total }}</b>件<template v-if="sum.late"> ・ 遅れ <b class="late">{{ sum.late }}</b>件</template>
          <span v-for="(l, k) in KIND_LABEL" v-show="sum.byKind[k]" :key="k"> ・ {{ l }} {{ sum.byKind[k] }}</span>
        </p>
        <p v-if="loading" class="dh-note">前の記録を取り寄せています…</p>
        <p v-else-if="loadErr" class="dh-note warn" role="status">{{ loadErr }}</p>
      </div>

      <div class="dh-list">
        <section v-for="g in groups" :key="g.day" class="dh-day">
          <h3>{{ dayLabel(g.day) }}<small>{{ g.items.length }}件</small></h3>
          <component
            :is="kindOf(t) === 'progress' ? 'button' : 'div'" v-for="t in g.items" :key="t.id"
            :type="kindOf(t) === 'progress' ? 'button' : undefined"
            :class="['dh-it', { tap: kindOf(t) === 'progress' }]" :data-id="t.id" @click="open(t)"
          >
            <span class="dh-ck" aria-hidden="true">✓</span>
            <span class="dh-tx">
              <b>{{ t.text }}</b>
              <small>{{ sub(t) }}</small>
              <small v-if="t.note" class="dh-memo">{{ t.note }}</small>
            </span>
            <span class="dh-tags">
              <em :class="['k', kindOf(t)]">{{ KIND_LABEL[kindOf(t)] }}</em>
              <em v-if="t.category" class="c">{{ CATEGORY_LABEL[t.category] }}</em>
              <em v-if="tagOf(t)" :class="tagOf(t).cls">{{ tagOf(t).text }}</em>
            </span>
            <span v-if="kindOf(t) === 'progress'" class="dh-go" aria-hidden="true">›</span>
          </component>
        </section>
        <p v-if="!groups.length && !loading" class="dh-empty">{{ filtered ? '当てはまる業務はありません' : 'この期間に済んだ業務はありません' }}</p>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.dh { position: fixed; inset: 0; z-index: 116; display: flex; flex-direction: column; background: var(--bg, #f6fafb); }
.dh-h { display: flex; align-items: center; gap: 8px; padding: 10px 12px; background: var(--surface); border-bottom: 1px solid var(--border); }
.dh-h b { flex: 1; font-size: 17px; font-weight: 900; color: var(--text); }
.dh-x { width: 40px; height: 40px; border: none; border-radius: 12px; background: #eef4f6; font: inherit; font-size: 22px; font-weight: 800; color: var(--text); cursor: pointer; }
.dh-rt { display: inline-flex; align-items: center; gap: 4px; min-height: 36px; padding: 0 12px; border: 1px solid var(--border); border-radius: 999px; background: var(--surface); font: inherit; font-size: 12.5px; font-weight: 800; color: var(--primary, #0e7490); cursor: pointer; }
.dh-f { display: grid; gap: 8px; padding: 10px 12px; background: var(--surface); border-bottom: 1px solid var(--border); }
.dh-seg { display: grid; grid-template-columns: repeat(4, 1fr); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
.dh-seg button { min-height: 38px; border: none; background: var(--surface); font: inherit; font-size: 13px; font-weight: 800; color: var(--text-muted); cursor: pointer; }
.dh-seg button + button { border-left: 1px solid var(--border); }
.dh-seg button.on { background: var(--primary, #0e7490); color: #fff; }
.dh-q { min-height: 40px; padding: 0 12px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); font: inherit; font-size: 14px; color: var(--text); }
.dh-chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.dh-chips select { min-height: 34px; padding: 0 8px; border: 1px solid var(--border); border-radius: 999px; background: var(--surface); font: inherit; font-size: 12.5px; font-weight: 800; color: var(--text); }
.dh-chips select.on { border-color: var(--primary, #0e7490); background: #e6f5f8; color: var(--primary, #0e7490); }
.dh-clear { min-height: 34px; padding: 0 10px; border: none; background: none; font: inherit; font-size: 12.5px; font-weight: 800; color: #b91c1c; cursor: pointer; }
.dh-sum { margin: 0; font-size: 12.5px; font-weight: 700; color: var(--text-muted); }
.dh-sum b { font-size: 16px; font-weight: 900; color: var(--text); margin-right: 1px; }
.dh-sum b.late { color: #b91c1c; }
.dh-note { margin: 0; font-size: 12px; font-weight: 700; color: var(--text-muted); }
.dh-note.warn { color: #b45309; }
.dh-list { flex: 1; min-height: 0; overflow-y: auto; padding: 6px 12px 24px; }
.dh-day h3 { display: flex; align-items: baseline; gap: 6px; margin: 12px 2px 6px; font-size: 13px; font-weight: 900; color: var(--text); }
.dh-day h3 small { font-size: 11px; font-weight: 700; color: var(--text-muted); }
.dh-it { width: 100%; display: flex; align-items: flex-start; gap: 10px; padding: 10px; margin-bottom: 6px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); font: inherit; text-align: left; color: var(--text); }
.dh-it.tap { cursor: pointer; }
.dh-ck { flex: none; width: 24px; height: 24px; border-radius: 7px; display: grid; place-items: center; background: var(--grad-btn); color: var(--on-grad); font-size: 12px; font-weight: 900; }
.dh-tx { flex: 1; min-width: 0; display: grid; gap: 2px; overflow-wrap: anywhere; }
.dh-tx b { font-size: 14px; font-weight: 800; }
.dh-tx small { font-size: 11.5px; font-weight: 600; color: var(--text-muted); }
.dh-memo { white-space: pre-line; }
.dh-tags { flex: none; display: flex; flex-direction: column; align-items: flex-end; gap: 3px; }
.dh-tags em { font-style: normal; font-size: 10.5px; font-weight: 900; padding: 2px 8px; border-radius: 999px; white-space: nowrap; background: #eef2f4; color: #4c6a72; }
.dh-tags em.k.progress { background: #fef9c3; color: #a16207; }
.dh-tags em.k.someday { background: #eef2ff; color: #4338ca; }
.dh-tags em.ok { background: #dcfce7; color: #047857; }
.dh-tags em.late { background: #fee2e2; color: #b91c1c; }
.dh-go { flex: none; align-self: center; font-size: 18px; font-weight: 800; color: var(--text-muted); }
.dh-empty { margin: 32px 0; text-align: center; font-size: 13.5px; font-weight: 700; color: var(--text-muted); }
</style>
