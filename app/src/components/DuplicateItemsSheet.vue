<script setup>
/**
 * 重複の候補と品目の統合（ITEM-001 I-5・User 決定 2026-11-28・モック https://claude.ai/artifact/TARkmMdMB8v7Ucxut732oq）。
 * - 候補の一覧: 同じと見た理由の札（コードが同じ／名前と単位が同じ／名前が似ている）。「別の品目」で次から出さない
 * - まとめる: 残す方と名前を選ぶ。まとめた後の在庫を先に見せる（同じ棚卸で両方を数えていた日は足す）。単位が違えば止める
 * - start を渡すと、その品目とまとめる相手を選ぶところから始める（品目の情報の「ほかの品目とまとめる…」）
 * 記録の行は書き換えない（useConfig.mergeItems が ID の付け替えを足すだけ）。元に戻すは親がお知らせで出す。
 */
import { ref, computed } from 'vue'
import { useConfig, itemIdOf } from '../composables/useConfig.js'
import { findDuplicatePairs } from '../services/duplicateItems.js'
import { theoreticalStock } from '../services/theoreticalStock.js'

const props = defineProps({
  start:     { type: String, default: '' },
  stockOf:   { type: Function, required: true },
  baseShort: { type: Function, required: true },
  unitOf:    { type: Function, required: true },
  snaps:     { type: Array, default: () => [] },
  moves:     { type: Array, default: () => [] },
})
const emit = defineEmits(['close', 'merged'])
const { config, mergeItems, markNotDuplicate } = useConfig()

const pairs = computed(() => findDuplicatePairs({
  order: config.order, units: config.units, codes: config.codes, hidden: config.hiddenItems,
  notDuplicates: config.notDuplicates, idOf: itemIdOf,
}))
const WHY = { code: p => `コード ${p.code} が同じ`, name: () => '名前と単位が同じ', like: () => '名前が似ている' }

// まとめる画面: { a, b }。keep は 'a' | 'b'
const merging = ref(null)
const keepSide = ref('a')
const newName = ref('')
const error = ref('')
// 相手を選ぶ画面（start から）
const query = ref('')
const pickList = computed(() => {
  const q = query.value.trim()
  return config.order.filter(n => n !== props.start && !(config.hiddenItems ?? []).includes(n) && (!q || n.includes(q))).slice(0, 50)
})

function openMerge(a, b) {
  merging.value = { a, b }
  // 残す方の既定: 棚卸の記録がある方・単価がある方
  const score = n => (props.baseShort(n)?.includes('棚卸') ? 2 : 0) + (config.prices?.[n] != null ? 1 : 0)
  keepSide.value = score(b) > score(a) ? 'b' : 'a'
  newName.value = keepSide.value === 'a' ? a : b
  error.value = ''
}
function setKeep(side) {
  const { a, b } = merging.value
  if (newName.value === (keepSide.value === 'a' ? a : b)) newName.value = side === 'a' ? a : b
  keepSide.value = side
}
const keep = computed(() => merging.value && (keepSide.value === 'a' ? merging.value.a : merging.value.b))
const drop = computed(() => merging.value && (keepSide.value === 'a' ? merging.value.b : merging.value.a))
const unitClash = computed(() => {
  if (!merging.value) return false
  const ua = (config.units[merging.value.a] ?? '').trim(), ub = (config.units[merging.value.b] ?? '').trim()
  return !!(ua && ub && ua !== ub)
})
const preview = computed(() => {
  if (!merging.value || unitClash.value) return null
  return theoreticalStock([keep.value, drop.value], props.snaps, props.moves)
})
const unit = computed(() => (merging.value ? (props.unitOf(keep.value) || props.unitOf(drop.value)) : ''))
const fmt = v => String(Math.round(v * 1000) / 1000)
const previewText = computed(() => {
  const t = preview.value
  if (!t) return ''
  const parts = [t.baseDate ? `${Number(t.baseDate.slice(5, 7))}/${Number(t.baseDate.slice(8, 10))} 棚卸 ${fmt(t.baseQty)}` : '棚卸なし']
  if (t.inQty) parts.push(`＋入庫 ${fmt(t.inQty)}`)
  if (t.outQty) parts.push(`−出庫 ${fmt(t.outQty)}`)
  return parts.join(' ')
})

function notSame(p) { markNotDuplicate(p.a, p.b) }
function doMerge() {
  const r = mergeItems({ keep: keep.value, drop: drop.value, name: newName.value })
  if (!r.ok) {
    error.value = r.reason === 'unit' ? '単位が違うのでまとめられません'
      : r.reason === 'name' ? 'その名前は使えません（空・ほかの品目と同じ）' : 'まとめられませんでした'
    return
  }
  emit('merged', { keep: r.keep, drop: drop.value, undo: r.undo })
}
function back() {
  if (merging.value && !props.start) { merging.value = null; return }
  if (merging.value && props.start) { merging.value = null; return }
  emit('close')
}
</script>

<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <div class="modal-sheet dup-sheet" role="dialog" aria-modal="true" :aria-label="merging ? '1つにまとめる' : start ? 'まとめる相手を選ぶ' : '重複かも'">
      <div class="sheet-handle"></div>
      <div class="dup-head">
        <button v-if="merging" type="button" class="dup-back" aria-label="戻る" @click="back">‹</button>
        <b>{{ merging ? '1つにまとめる' : start ? `「${start}」とまとめる品目` : `重複かも（${pairs.length}組）` }}</b>
        <button type="button" class="dup-x" aria-label="閉じる" @click="emit('close')">✕</button>
      </div>

      <!-- まとめる -->
      <template v-if="merging">
        <div class="dup-pick" role="radiogroup" aria-label="残す方">
          <label v-for="side in ['a', 'b']" :key="side" :class="['dup-opt', { on: keepSide === side }]">
            <input type="radio" name="dup-keep" :value="side" :checked="keepSide === side" @change="setKeep(side)" />
            <span class="n">{{ merging[side] }}<small>{{ baseShort(merging[side]) || '記録なし' }}{{ config.prices?.[merging[side]] != null ? ` ・ 単価 ${config.prices[merging[side]]}円` : '' }}{{ config.images?.[merging[side]] ? ' ・ 写真あり' : '' }}</small></span>
          </label>
        </div>
        <label class="dup-lbl" for="dup-name">まとめた後の名前</label>
        <input id="dup-name" v-model="newName" class="dup-input" maxlength="60" />
        <div v-if="unitClash" class="dup-warn">単位が違う（{{ config.units[merging.a] }} と {{ config.units[merging.b] }}）ので、まとめられません。</div>
        <div v-else class="dup-sum">まとめた後の在庫 <b>{{ preview ? fmt(preview.qty) : '—' }}{{ unit }}</b><small v-if="previewText">{{ previewText }}（両方の記録を合わせて）</small></div>
        <div v-if="error" class="dup-warn">{{ error }}</div>
        <div class="dup-acts">
          <button type="button" class="dup-btn" @click="back">やめる</button>
          <button type="button" class="dup-btn pri" :disabled="unitClash" @click="doMerge">まとめる</button>
        </div>
      </template>

      <!-- 相手を選ぶ -->
      <template v-else-if="start">
        <input v-model="query" class="dup-input" placeholder="品目名で絞り込み" aria-label="品目名で絞り込み" />
        <div class="dup-list">
          <button v-for="n in pickList" :key="n" type="button" class="dup-row" @click="openMerge(start, n)">
            <span class="n">{{ n }}<small>{{ unitOf(n) || '単位なし' }} ・ {{ baseShort(n) || '記録なし' }}</small></span><span class="q">{{ stockOf(n) ?? '—' }}</span>
          </button>
        </div>
      </template>

      <!-- 候補の一覧 -->
      <template v-else>
        <p v-if="!pairs.length" class="dup-none">重複らしい品目はありません。</p>
        <div v-else class="dup-list">
          <div v-for="p in pairs" :key="`${p.a}|${p.b}`" class="dup-grp" :data-pair="`${p.a}|${p.b}`">
            <span :class="['dup-why', p.why]">{{ WHY[p.why](p) }}</span>
            <div v-for="n in [p.a, p.b]" :key="n" class="dup-it">
              <span class="n">{{ n }}<small>{{ unitOf(n) || '単位なし' }} ・ {{ baseShort(n) || '記録なし' }}</small></span><span class="q">{{ stockOf(n) ?? '—' }}</span>
            </div>
            <div class="dup-acts">
              <button type="button" class="dup-btn ghost" @click="notSame(p)">別の品目</button>
              <button type="button" class="dup-btn pri" @click="openMerge(p.a, p.b)">まとめる</button>
            </div>
          </div>
        </div>
        <p class="dup-hint">候補に出ない品目も、品目の情報の「ほかの品目とまとめる」からまとめられます。</p>
      </template>
    </div>
  </div>
</template>

<style scoped>
.dup-sheet { display: grid; gap: 10px; max-height: 88vh; overflow-y: auto; }
.dup-head { display: flex; align-items: center; gap: 8px; }
.dup-head b { flex: 1; font-size: 16px; }
.dup-x, .dup-back { width: 34px; height: 34px; border: none; background: none; font: inherit; font-size: 18px; color: var(--text-muted); cursor: pointer; }
.dup-list { display: grid; gap: 8px; }
.dup-grp { display: grid; gap: 7px; padding: 10px; border: 1px solid var(--border, #e3ecef); border-radius: 12px; background: var(--surface, #fff); }
.dup-why { justify-self: start; font-size: 11px; font-weight: 800; padding: 2px 8px; border-radius: 6px; }
.dup-why.code { background: #e0f2fe; color: #075985; }
.dup-why.name { background: #ecfdf5; color: #047857; }
.dup-why.like { background: #f1f5f9; color: #475569; }
.dup-it, .dup-row { display: flex; align-items: center; gap: 8px; }
.dup-row { width: 100%; padding: 10px; border: 1px solid var(--border, #e3ecef); border-radius: 10px; background: var(--surface, #fff); font: inherit; color: var(--text); text-align: left; cursor: pointer; }
.n { flex: 1; min-width: 0; font-weight: 800; overflow: hidden; text-overflow: ellipsis; }
.n small { display: block; font-size: 11px; font-weight: 500; color: var(--text-muted); }
.q { font-weight: 800; font-size: 16px; }
.dup-acts { display: flex; gap: 8px; }
.dup-btn { flex: 1; padding: 10px; border-radius: 10px; border: 1px solid var(--border, #d6e2e5); background: var(--surface, #fff); font: inherit; font-weight: 800; color: var(--text); cursor: pointer; }
.dup-btn.pri { background: var(--primary, #0e7490); border-color: var(--primary, #0e7490); color: #fff; }
.dup-btn.pri:disabled { opacity: .45; cursor: default; }
.dup-btn.ghost { flex: none; border: none; background: none; color: var(--text-muted); }
.dup-pick { display: grid; gap: 6px; }
.dup-opt { display: flex; gap: 9px; align-items: center; padding: 10px; border: 1.5px solid var(--border, #d6e2e5); border-radius: 10px; cursor: pointer; }
.dup-opt.on { border-color: var(--primary, #0e7490); background: #f0f9fb; }
.dup-opt input { accent-color: var(--primary, #0e7490); }
.dup-lbl { font-size: 12px; font-weight: 700; color: var(--text-muted); }
.dup-input { font: inherit; font-size: 15px; padding: 9px 10px; border: 1px solid #b9ccd1; border-radius: 10px; background: var(--surface, #fff); color: var(--text); }
.dup-sum { display: grid; gap: 2px; padding: 10px; border-radius: 10px; background: var(--bg, #f4f8f9); font-size: 13px; }
.dup-sum b { font-size: 17px; }
.dup-sum small { font-size: 12px; color: var(--text-muted); }
.dup-warn { padding: 9px 10px; border-radius: 10px; background: #fff7ed; color: #9a3412; font-size: 12.5px; }
.dup-none, .dup-hint { margin: 0; font-size: 12.5px; color: var(--text-muted); }
</style>
