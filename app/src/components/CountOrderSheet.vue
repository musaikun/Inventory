<script setup>
/**
 * 前回の棚卸の「数えた順」で並べる（User決定 2026-10-04）。振り分けの画面から開く。
 *
 * - mode 'create'（まだ振り分けていない）: 数えた順に品目を並べ、人が区切って場所を作る。
 *   複数人なら担当者ごとの順で、人の切れ目は最初から区切っておく。
 *   区切りは時間では決めない。品目をタップ →「ここから別の場所にする」
 * - mode 'reorder'（振り分け済み）: 割り当てはそのまま、各場所の中だけを数えた順にする。
 *   押す前に、場所ごとの「今 → 後」を変わる場所だけ見せる（動く品目に色）。変わらなければ押せない
 *   （User要望 2026-10-10: 何が変わったか分からない・押し間違えても気づかない を防ぐ）
 * 実際の書き換えと「元に戻す」は親（AxisAssignFocus）が行う。
 */
import { ref, reactive, computed } from 'vue'
import { countRows, splitRows } from '../services/countOrder.js'

const props = defineProps({
  mode:     { type: String, required: true },     // 'create' | 'reorder'
  seqs:     { type: Array,  required: true },     // countSequences の戻り値
  date:     { type: String, default: '' },        // YYYY-MM-DD
  axisName: { type: String, default: '' },
  preview:  { type: Object, default: null },        // reorder: { changed: [{ group, before, after, moved }], same: [] }
})
const emit = defineEmits(['close', 'apply', 'switch-create'])

const dateLabel = computed(() => {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(props.date || '')
  return m ? `${Number(m[1])}/${Number(m[2])}` : '前回'
})
const team = computed(() => props.seqs.length > 1)
const countedTotal = computed(() => new Set(props.seqs.flatMap(s => s.items)).size)

const built = computed(() => countRows(props.seqs))
const fixedCuts = computed(() => new Set(built.value.personCuts))
const cuts = ref(new Set(built.value.personCuts))
const names = reactive({})           // 区切りの位置 → 場所の名前
const sel = ref(null)

const places = computed(() => splitRows(built.value.rows, cuts.value))

function tapRow(i) { sel.value = sel.value === i ? null : i }
function cutAt(i) { cuts.value = new Set([...cuts.value, i]); sel.value = null }
function join(at) {
  const next = new Set(cuts.value); next.delete(at); cuts.value = next
  delete names[at]
}

function apply() {
  if (props.mode === 'reorder') { emit('apply', null); return }
  const out = places.value.map((p, n) => ({
    name: (names[p.at] || '').trim() || `場所${n + 1}`,
    items: p.rows.map(r => r.item),
  }))
  emit('apply', out)
}
</script>

<template>
  <div class="co" role="dialog" aria-modal="true" aria-label="数えた順で並べる">
    <header class="co-head">
      <button type="button" class="co-back" @click="emit('close')">‹ やめる</button>
      <span class="co-title">{{ dateLabel }}の数えた順</span>
    </header>

    <div v-if="mode === 'reorder'" class="co-body">
      <p class="co-lock">✓ どの品目がどの場所に入っているかは<b>変わりません</b>。場所の中の順番だけが、{{ dateLabel }}に数えた順になります。</p>
      <p class="co-card-n">数えた品目 {{ countedTotal }}<template v-if="team">（{{ seqs.length }}人）</template> ・ 数えていない品目は各場所の末尾に今の順のまま</p>
      <section v-for="c in preview?.changed ?? []" :key="c.group" class="co-cmp">
        <div class="co-cmp-h"><b>{{ c.group }}</b><small>{{ c.moved }}品目が動く</small></div>
        <div class="co-cmp-cols"><span>今</span><span></span><span>並べ直した後</span></div>
        <div v-for="(x, k) in c.after" :key="k" class="co-cmp-r">
          <span>{{ c.before[k] }}</span><span class="co-ar" aria-hidden="true">→</span>
          <span :class="{ mv: c.before[k] !== x }">{{ x }}</span>
        </div>
      </section>
      <p v-if="preview?.same?.length" class="co-same">{{ preview.same.join('・') }} は今と同じ順です</p>
      <button v-if="preview?.changed?.length" type="button" class="co-go" @click="apply">{{ preview.changed.length }}つの場所を並べ直す</button>
      <button v-else type="button" class="co-go" disabled>今と同じ順です（変わる場所はありません）</button>
      <button type="button" class="co-alt" @click="emit('switch-create')">場所の分け方から作り直す（今の振り分けは上書き）</button>
    </div>

    <template v-else>
      <div class="co-body">
        <p class="co-hint">
          {{ team ? '担当者ごとの数えた順です。人ごとに分けてあります。' : '数量を入れた順です。' }}
          品目をタップすると、そこから別の場所に分けられます。
        </p>
        <template v-for="(p, n) in places" :key="p.at">
          <button v-if="n > 0 && !fixedCuts.has(p.at)" type="button" class="co-join" @click="join(p.at)">↕ 上とつなげる</button>
          <section :class="['co-grp', `g${n % 4}`]">
            <div class="co-grp-h">
              <input
                v-model="names[p.at]" class="co-name" type="text" maxlength="30"
                :placeholder="`場所${n + 1}の名前（例：冷蔵庫）`" :aria-label="`場所${n + 1}の名前`"
              />
              <span v-if="team" class="co-who">{{ p.rows[0].who }}</span>
              <small>{{ p.rows.length }}品目</small>
            </div>
            <template v-for="(r, k) in p.rows" :key="r.i">
              <button type="button" :class="['co-row', { sel: sel === r.i }]" :data-row="r.i" @click="tapRow(r.i)">
                <span class="co-n">{{ k + 1 }}</span>
                <span class="co-item">{{ r.item }}</span>
                <span v-if="r.multi" class="co-multi">2か所にある</span>
              </button>
              <div v-if="sel === r.i" class="co-cutbar">
                <button v-if="k > 0" type="button" class="co-cut" @click="cutAt(r.i)">✂ 「{{ r.item }}」から別の場所にする</button>
                <span v-else class="co-cut-note">この場所の先頭です</span>
                <button type="button" class="co-cut-x" aria-label="やめる" @click="sel = null">✕</button>
              </div>
            </template>
          </section>
        </template>
      </div>
      <footer class="co-foot">
        <button type="button" class="co-cancel" @click="emit('close')">やめる</button>
        <button type="button" class="co-go" @click="apply">{{ places.length }}つの場所で決める</button>
      </footer>
    </template>
  </div>
</template>

<style scoped>
.co { position: fixed; inset: 0; z-index: 66; background: var(--bg, #f6fafb); display: flex; flex-direction: column; }
.co-head { flex: none; display: flex; align-items: center; gap: 8px; padding: 10px 12px; padding-top: calc(10px + env(safe-area-inset-top)); background: var(--surface, #fff); border-bottom: 1px solid var(--border, #d6e6ea); }
.co-back { min-height: 40px; border: none; background: none; color: var(--primary); font-size: 14px; font-weight: 700; cursor: pointer; }
.co-title { font-size: 15px; font-weight: 800; color: var(--text, #12303a); }
.co-body { flex: 1; min-height: 0; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
.co-body > * { flex: none; }
.co-hint { margin: 0; font-size: 12.5px; line-height: 1.6; color: var(--text-muted, #4c6a72); }
.co-card-n { margin: 0; font-size: 12px; font-weight: 700; color: var(--text-muted, #4c6a72); }
.co-lock { margin: 0; font-size: 12.5px; line-height: 1.6; color: #047857; background: #ecfdf5; border-radius: 10px; padding: 8px 10px; }
.co-cmp { background: var(--surface, #fff); border: 1px solid var(--border, #d6e6ea); border-radius: 12px; overflow: hidden; }
.co-cmp-h { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; padding: 7px 10px; background: #f1f8fa; }
.co-cmp-h b { font-size: 13.5px; color: var(--text, #12303a); }
.co-cmp-h small { font-size: 11.5px; font-weight: 800; color: #b45309; }
.co-cmp-cols, .co-cmp-r { display: grid; grid-template-columns: 1fr 18px 1fr; gap: 4px; padding: 3px 10px; align-items: center; }
.co-cmp-cols { font-size: 10.5px; font-weight: 800; color: #7d969c; }
.co-cmp-r { font-size: 13px; color: var(--text, #12303a); }
.co-cmp-r span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.co-cmp-r .mv { background: #fef3c7; border-radius: 5px; padding: 1px 5px; font-weight: 800; }
.co-ar { color: #94a3b8; text-align: center; }
.co-same { margin: 0; font-size: 12px; color: var(--text-muted, #4c6a72); }
.co-go:disabled { background: #e2e8f0; color: #7d969c; cursor: default; }
.co-alt { align-self: center; min-height: 40px; border: none; background: none; color: var(--text-muted, #4c6a72); font-size: 12.5px; text-decoration: underline; cursor: pointer; }
.co-grp { background: var(--surface, #fff); border: 1px solid var(--border, #d6e6ea); border-radius: 14px; overflow: hidden; }
.co-grp-h { display: flex; align-items: center; gap: 8px; padding: 8px 10px; background: #dbeafe; }
.co-grp.g1 .co-grp-h { background: #cffafe; }
.co-grp.g2 .co-grp-h { background: #d1fae5; }
.co-grp.g3 .co-grp-h { background: #fce7f3; }
.co-grp-h small { flex: none; font-size: 11.5px; font-weight: 700; color: #4c6a72; }
.co-name { flex: 1; min-width: 0; border: 1px dashed #4c6a72; background: #fff; color: #12303a; border-radius: 8px; padding: 6px 8px; font-size: 14px; font-weight: 800; }
.co-who { flex: none; font-size: 11px; font-weight: 800; padding: 2px 8px; border-radius: 999px; background: #fff7ed; color: #c2410c; }
.co-row { width: 100%; display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 0 12px; border: none; border-top: 1px solid var(--border, #d6e6ea); background: none; color: var(--text, #12303a); font-size: 14px; text-align: left; cursor: pointer; }
.co-row.sel { background: var(--primary-weak, #ecfeff); }
.co-n { flex: none; width: 20px; text-align: right; font-size: 11.5px; color: #7d969c; }
.co-item { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.co-multi { flex: none; font-size: 11px; font-weight: 800; color: #a16207; background: #fef3c7; padding: 2px 8px; border-radius: 999px; }
.co-cutbar { display: flex; align-items: center; gap: 8px; padding: 6px 10px; background: var(--primary-weak, #ecfeff); border-top: 1px dashed var(--primary); }
.co-cut { flex: 1; min-height: 40px; border: none; border-radius: 10px; background: var(--primary); color: #fff; font-size: 13px; font-weight: 800; cursor: pointer; }
.co-cut-note { flex: 1; font-size: 12px; color: #4c6a72; text-align: center; }
.co-cut-x { flex: none; width: 40px; min-height: 40px; border: none; background: none; color: #4c6a72; cursor: pointer; }
.co-join { align-self: center; border: 1px dashed var(--border, #d6e6ea); background: var(--bg, #f6fafb); color: #4c6a72; border-radius: 999px; font-size: 12px; padding: 4px 14px; min-height: 32px; cursor: pointer; }
.co-foot { flex: none; display: grid; grid-template-columns: 1fr 2fr; gap: 8px; padding: 10px 12px; padding-bottom: calc(10px + env(safe-area-inset-bottom)); background: var(--surface, #fff); border-top: 1px solid var(--border, #d6e6ea); }
.co-go { min-height: 46px; border: none; border-radius: 12px; background: var(--grad-btn); color: var(--on-grad); font-size: 14.5px; font-weight: 800; cursor: pointer; }
.co-cancel { min-height: 46px; border: 1px solid var(--border, #d6e6ea); border-radius: 12px; background: var(--surface, #fff); color: var(--text, #12303a); font-weight: 700; cursor: pointer; }
</style>
