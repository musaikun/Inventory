<script setup>
/**
 * 取り込んだ後の棚卸カードが「組み上がる」ところを見せる全画面プレビュー。
 *
 * これは飾りではなく説明で、**「列を決めると表が育つ」**という、このあとずっと
 * 使う言葉をここで一度だけ教える。だから初回は最後まで見せ、2回目以降は
 * いま決めた項目だけを短く見せる（5回目の取込で毎回待たされるのは説明ではなく邪魔）。
 *
 *   mode='build' … 項目を決めるたびにフワッと出て、組み上がって、自分で閉じる
 *   mode='stay'  … 「プレビュー」から開いたとき。居座って、並べ替えを実際に触れる
 *
 * 触ったら止めて居座る（読みたい人を追い出さない）。
 */
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'

const props = defineProps({
  // 取り込んだ後に入る品目そのもの。
  // 元がCSVかPDFかをここへ持ち込まない ── 経路ごとに読み方が枝分かれすると、
  // 「取り込んだ後どう見えるか」の答えが経路ごとに変わってしまう。
  rows:   { type: Array,  required: true },   // [{ name, code, unit, price, category, lotSize, prevMonth, axisA, axisB }]
  total:  { type: Number, default: null },    // 全件数（rows は先頭だけでよい）
  fields: { type: Array,  required: true },   // [{ key, label }] 画面に出る項目
  mode:   { type: String, default: 'build' }, // 'build' | 'stay'
  filled: { type: String, default: null },    // 直前に決めた項目
  title:  { type: String, default: '' },
})
const emit = defineEmits(['close', 'stay'])

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
const has = (k) => props.fields.some(f => f.key === k) && props.rows.some(r => r[k] !== undefined && r[k] !== '')
const totalCount = computed(() => props.total ?? props.rows.length)

// 並び替え。既定は「取込順」＝ファイルの並びのまま。直前まで見ていたファイルと
// 1行目が違うと、合っているかを確かめようがない。並べ替えは確かめ終わってから選ぶもの。
const sortMode = ref('file')
const sortTabs = computed(() => {
  const t = [{ k: 'file', label: '取込順' }]
  if (has('category')) t.push({ k: 'category', label: 'ジャンル' })
  if (has('axisA')) t.push({ k: 'axisA', label: props.fields.find(f => f.key === 'axisA')?.label ?? '並び替え①' })
  if (has('axisB')) t.push({ k: 'axisB', label: props.fields.find(f => f.key === 'axisB')?.label ?? '並び替え②' })
  t.push({ k: 'name', label: '五十音' })
  return t
})
watch(sortTabs, (tabs) => { if (!tabs.some(t => t.k === sortMode.value)) sortMode.value = 'file' })

const shown = computed(() => {
  const list = [...props.rows]
  if (sortMode.value === 'file') return list
  if (sortMode.value === 'name') return list.sort((a, b) => a.name.localeCompare(b.name, 'ja'))
  return list.sort((a, b) => String(a[sortMode.value]).localeCompare(String(b[sortMode.value]), 'ja'))
})

// ── 組み上がり ──────────────────────────────────────────────
// 伏せてある部品を、上から順に嵌めていく。ここに出ている項目だけを見せる。
const revealed = ref(null)      // Set | null（null = 全部出す）
const sticky   = ref(props.mode === 'stay')
const timers   = []
const clearAll = () => { for (const t of timers) clearTimeout(t); timers.length = 0 }

const visible = (key) => revealed.value === null || revealed.value.has(key)
const asmClass = (key) => (revealed.value !== null && revealed.value.has(key) && !reduced() ? 'asm' : '')

const cols = computed(() => props.fields.filter(f => has(f.key) && f.key !== 'name').map(f => f.key))

function run() {
  clearAll()
  if (sticky.value) { revealed.value = null; return }
  if (reduced()) {
    // 演出を減らす設定では組み上げない。出す→読める間だけ置く→閉じる
    revealed.value = null
    timers.push(setTimeout(() => emit('close'), 1400))
    return
  }
  // 初回（filled 無し）は最後まで、2回目以降はいま決めた項目だけ
  const full = !props.filled
  const GAP = 300, LEAD = 360, HOLD = 1500
  const steps = full ? cols.value.slice(0, 6) : [props.filled].filter(k => k && k !== 'name')
  revealed.value = new Set(['name'])
  steps.forEach((k, i) => {
    timers.push(setTimeout(() => {
      const next = new Set(revealed.value); next.add(k); revealed.value = next
    }, LEAD + i * GAP))
  })
  const done = (steps.length ? LEAD + (steps.length - 1) * GAP : 0) + 620
  timers.push(setTimeout(() => { revealed.value = null }, done))
  timers.push(setTimeout(() => emit('close'), done + HOLD))
}

/** 触ったら止めて居座る */
function onTouch() {
  if (sticky.value) return
  clearAll()
  sticky.value = true
  revealed.value = null
  emit('stay')
}

onMounted(run)
onBeforeUnmount(clearAll)
watch(() => props.mode, (m) => { sticky.value = m === 'stay'; run() })
</script>

<template>
  <div class="bpv" @pointerdown="onTouch">
    <div class="bpv-card">
      <div class="bpv-head">
        <span class="bpv-t">{{ title || (sticky ? '取り込んだ後の棚卸カード'
                                                : filled ? `${fields.find(f => f.key === filled)?.label ?? ''}が入りました`
                                                         : '取り込んだ後の棚卸カード') }}</span>
        <button v-if="sticky" class="bpv-x" @click.stop="emit('close')" aria-label="閉じる">✕</button>
      </div>

      <div class="bpv-sorts" :class="{ locked: !sticky }">
        <button v-for="t in sortTabs" :key="t.k" class="bpv-seg" :class="{ on: sortMode === t.k }"
                @click.stop="sticky && (sortMode = t.k)">{{ t.label }}</button>
      </div>

      <div class="bpv-body">
        <table class="bpv-tbl">
          <thead>
            <tr>
              <th v-if="visible('code')" class="c-code">コード</th>
              <th>品目</th>
              <th v-if="visible('axisA') || visible('axisB')" class="c-mid">振り分け</th>
              <th v-if="visible('price')" class="c-amt">単価</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in shown" :key="i">
              <td v-if="visible('code')" class="c-code"><span :class="asmClass('code')">{{ r.code }}</span></td>
              <td class="c-name">
                <div class="nm">{{ r.name }}</div>
                <div v-if="visible('unit') || visible('lotSize') || visible('prevMonth') || visible('category')" class="hints">
                  <span v-if="visible('category') && r.category" class="hint" :class="asmClass('category')">{{ r.category }}</span>
                  <span v-if="visible('unit') && r.unit" class="hint" :class="asmClass('unit')">単位: {{ r.unit }}</span>
                  <span v-if="visible('lotSize') && r.lotSize" class="hint" :class="asmClass('lotSize')">入数: {{ r.lotSize }}</span>
                  <span v-if="visible('prevMonth') && r.prevMonth" class="hint" :class="asmClass('prevMonth')">前月: {{ r.prevMonth }}</span>
                </div>
              </td>
              <td v-if="visible('axisA') || visible('axisB')" class="c-mid">
                <span class="pg" :class="asmClass(visible('axisA') ? 'axisA' : 'axisB')">
                  <span v-if="visible('axisA') && r.axisA" class="pgchip">{{ r.axisA }}</span>
                  <span v-if="visible('axisB') && r.axisB" class="pgchip">{{ r.axisB }}</span>
                  <span v-if="!(visible('axisA') && r.axisA) && !(visible('axisB') && r.axisB)" class="pgnone">未振り分け</span>
                </span>
              </td>
              <td v-if="visible('price')" class="c-amt"><span :class="asmClass('price')">{{ r.price }}</span></td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="bpv-foot">
        <b>{{ totalCount.toLocaleString() }}</b>件が入ります
        <span v-if="totalCount > shown.length" class="bpv-more">（先頭{{ shown.length }}件を表示）</span>
        <span v-if="!sticky" class="bpv-tap">触ると止まります</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.bpv { position: fixed; inset: 0; z-index: 1200; background: rgba(15, 23, 42, .45);
  display: flex; align-items: center; justify-content: center; padding: 14px;
  animation: bpv-in .22s ease-out; }
@keyframes bpv-in { from { opacity: 0 } to { opacity: 1 } }
.bpv-card { width: 100%; max-width: 460px; max-height: 88vh; background: var(--surface);
  border-radius: 16px; overflow: hidden; display: flex; flex-direction: column;
  box-shadow: 0 20px 60px rgba(15, 23, 42, .35); animation: bpv-up .26s cubic-bezier(.22,.61,.36,1); }
@keyframes bpv-up { from { transform: translateY(10px) scale(.98); opacity: .5 } to { transform: none; opacity: 1 } }

.bpv-head { display: flex; align-items: center; gap: 8px; padding: 11px 13px;
  border-bottom: 1px solid var(--border); }
.bpv-t { flex: 1; font-size: 13px; font-weight: 800; color: var(--text); }
.bpv-x { border: 1px solid var(--border); background: var(--surface); color: var(--text-muted);
  border-radius: 7px; width: 28px; height: 28px; font-size: 13px; cursor: pointer; }

.bpv-sorts { display: flex; gap: 5px; padding: 8px 12px; overflow-x: auto; flex-shrink: 0; }
.bpv-sorts.locked { opacity: .55; pointer-events: none; }
.bpv-seg { border: 1px solid var(--border); background: var(--surface); color: var(--text-muted);
  border-radius: 999px; padding: 5px 11px; font-size: 11.5px; font-weight: 700;
  white-space: nowrap; cursor: pointer; }
.bpv-seg.on { background: var(--primary); border-color: var(--primary); color: #fff; }

.bpv-body { overflow: auto; -webkit-overflow-scrolling: touch; }
.bpv-tbl { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.bpv-tbl th { position: sticky; top: 0; background: var(--primary); color: #fff;
  font-size: 10.5px; font-weight: 800; padding: 6px 8px; text-align: left; }
.bpv-tbl td { padding: 8px; border-bottom: 1px solid var(--border); vertical-align: middle; }
.c-code { width: 74px; color: var(--text-muted); font-size: 11px; font-variant-numeric: tabular-nums; }
.c-mid  { width: 96px; text-align: center; }
.c-amt  { width: 78px; text-align: right; font-weight: 800; font-variant-numeric: tabular-nums; }
.nm { font-size: 13.5px; color: var(--text); }
.hints { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 3px; }
.hint { font-size: 10px; color: var(--text-muted); background: var(--bg);
  border-radius: 4px; padding: 1px 5px; }
.pg { display: flex; flex-wrap: wrap; gap: 3px; justify-content: center; }
.pgchip { font-size: 9.5px; background: var(--primary-weak); color: var(--primary);
  border: 1px solid var(--primary-border); border-radius: 5px; padding: 1px 5px; }
.pgnone { font-size: 10.5px; color: #94a3b8; }

.bpv-foot { padding: 9px 13px calc(9px + env(safe-area-inset-bottom));
  border-top: 1px solid var(--border); font-size: 11.5px; color: var(--text-muted); }
.bpv-foot b { font-size: 14px; color: var(--text); font-variant-numeric: tabular-nums; }
.bpv-more { margin-left: 6px; }
.bpv-tap { float: right; color: #94a3b8; }

/* 部品が1つずつ噛み合って嵌まる。詰めると「入れ替わった」に見えて組み立てにならない */
@keyframes asm-cell {
  0%   { opacity: 0; transform: perspective(460px) rotateY(-54deg) translateX(22px) scale(.9); }
  55%  { opacity: 1; transform: perspective(460px) rotateY(7deg) translateX(-3px) scale(1.02); }
  78%  { opacity: 1; transform: perspective(460px) rotateY(-2.5deg) translateX(1px) scale(.995); }
  100% { opacity: 1; transform: none; }
}
.asm { animation: asm-cell 460ms cubic-bezier(.2,.7,.3,1) both;
  transform-origin: right center; display: inline-block; }
/* 自前の並びを持つものは display を戻す（inline-block にすると崩れる） */
.pg.asm { display: flex; }

@media (prefers-reduced-motion: reduce) {
  .bpv, .bpv-card, .asm { animation: none; }
}
</style>
