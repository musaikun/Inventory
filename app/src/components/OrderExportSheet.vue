<script setup>
/**
 * 発注の書き出し（User決定 2026-10-07）。発注を終えたとき・カレンダーの発注から開く。
 * 文面は送る人に任せ、品目名と数量だけを仕入先ごとに出す。端末の共有（LINE・メールなど）かコピーで送る。
 */
import { ref, computed, onUnmounted } from 'vue'
import { useConfig } from '../composables/useConfig.js'
import { useEscapeKey } from '../composables/useEscapeKey.js'
import { registerInnerLayerCloser } from '../composables/appMenuState.js'
import { buildOrderExport, defaultExportAxis } from '../services/orderExport.js'

const props = defineProps({
  order: { type: Object, required: true },   // 発注の記録
  title: { type: String, default: '発注を書き出す' },
})
const emit = defineEmits(['close'])
useEscapeKey(() => emit('close'))
onUnmounted(registerInnerLayerCloser(() => { emit('close'); return true }))

const { config } = useConfig()
const axes = computed(() => [0, 1].filter(i => (config.axisNames?.[i] || '').trim()).map(i => ({ i, name: config.axisNames[i] })))
const axis = ref(defaultExportAxis(config.axisNames ?? ['', '']))
const hasCodes = computed(() => (props.order?.lines ?? []).some(l => config.codes?.[l.item]))
const withCode = ref(false)
const groups = computed(() => buildOrderExport(props.order, config, { axis: axis.value, withCode: withCode.value }))
const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

const dateLabel = computed(() => {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(props.order?.date || '')
  return m ? `${Number(m[1])}/${Number(m[2])}` : ''
})

const done = ref({})   // グループ名 → 'copied' | 'shared'
async function copy(g) {
  try {
    await navigator.clipboard.writeText(g.text)
    done.value = { ...done.value, [g.name]: 'コピーしました' }
  } catch (_) {
    done.value = { ...done.value, [g.name]: 'コピーできませんでした。文字を長押しして選んでください' }
  }
}
async function share(g) {
  try {
    await navigator.share({ text: g.text })
    done.value = { ...done.value, [g.name]: '共有しました' }
  } catch (e) {
    if (e?.name !== 'AbortError') copy(g)   // 共有できない端末ではコピーへ
  }
}
</script>

<template>
  <Teleport to="body">
    <div class="modal-overlay" @click.self="emit('close')">
      <div class="modal-sheet oe" role="dialog" aria-modal="true" :aria-label="title">
        <div class="oe-head">
          <div class="oe-title">{{ title }}<small v-if="dateLabel">{{ dateLabel }}の発注</small></div>
          <button type="button" class="oe-x" aria-label="閉じる" @click="emit('close')">✕</button>
        </div>
        <p class="oe-note">品目名と数量だけを出します。文面は送るときに添えてください。</p>

        <div v-if="axes.length || hasCodes" class="oe-opts">
          <label v-if="axes.length" class="oe-opt">分け方
            <select v-model.number="axis" aria-label="分け方">
              <option :value="-1">分けない</option>
              <option v-for="a in axes" :key="a.i" :value="a.i">{{ a.name }}ごと</option>
            </select>
          </label>
          <label v-if="hasCodes" class="oe-opt oe-check"><input v-model="withCode" type="checkbox" />商品コードを付ける</label>
        </div>

        <div class="oe-list">
          <section v-for="g in groups" :key="g.name" class="oe-grp">
            <div class="oe-grp-h">
              <b>{{ g.name || 'すべて' }}</b><span>{{ g.lines.length }}品目</span>
            </div>
            <pre class="oe-text">{{ g.text }}</pre>
            <div class="oe-acts">
              <button v-if="canShare" type="button" class="oe-btn pri" @click="share(g)">LINE・メールで送る</button>
              <button type="button" :class="['oe-btn', canShare ? 'sec' : 'pri']" @click="copy(g)">コピー</button>
            </div>
            <p v-if="done[g.name]" class="oe-done" role="status">{{ done[g.name] }}</p>
          </section>
          <p v-if="!groups.length" class="oe-empty">発注数の入った品目がありません。</p>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.oe { max-height: 90vh; display: flex; flex-direction: column; gap: 10px; }
.oe-head { display: flex; align-items: flex-start; gap: 8px; }
.oe-title { flex: 1; font-size: 17px; font-weight: 800; color: var(--text, #12303a); }
.oe-title small { display: block; font-size: 12px; font-weight: 700; color: var(--text-muted, #4c6a72); margin-top: 2px; }
.oe-x { width: 36px; height: 36px; border: none; background: none; color: var(--text-muted, #4c6a72); font-size: 16px; cursor: pointer; }
.oe-note { margin: 0; font-size: 12.5px; color: var(--text-muted, #4c6a72); line-height: 1.6; }
.oe-opts { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; }
.oe-opt { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 700; color: var(--text, #12303a); }
.oe-opt select { min-height: 36px; border: 1px solid var(--border, #d6e6ea); border-radius: 10px; background: var(--surface, #fff); padding: 0 8px; font-size: 13px; font-weight: 700; }
.oe-check input { width: 18px; height: 18px; }
.oe-list { flex: 1; min-height: 0; overflow-y: auto; display: grid; gap: 10px; align-content: start; }
.oe-grp { border: 1px solid var(--border, #d6e6ea); border-radius: 14px; padding: 10px 12px; display: grid; gap: 8px; background: var(--surface, #fff); }
.oe-grp-h { display: flex; justify-content: space-between; align-items: baseline; }
.oe-grp-h b { font-size: 14.5px; color: var(--text, #12303a); }
.oe-grp-h span { font-size: 12px; font-weight: 700; color: var(--text-muted, #4c6a72); }
.oe-text { margin: 0; padding: 10px; border-radius: 10px; background: var(--bg, #f6fafb); font: inherit; font-size: 14px; line-height: 1.7; white-space: pre-wrap; word-break: break-word; user-select: text; -webkit-user-select: text; }
.oe-acts { display: flex; gap: 8px; }
.oe-btn { flex: 1; min-height: 44px; border-radius: 12px; font-size: 14px; font-weight: 800; cursor: pointer; }
.oe-btn.pri { border: none; background: var(--grad-btn); color: var(--on-grad); }
.oe-btn.sec { border: 1px solid var(--border, #d6e6ea); background: var(--surface, #fff); color: var(--text, #12303a); }
.oe-done { margin: 0; font-size: 12.5px; font-weight: 700; color: var(--primary, #0e7490); text-align: center; }
.oe-empty { margin: 0; font-size: 13px; color: var(--text-muted, #4c6a72); text-align: center; padding: 20px 0; }
</style>
