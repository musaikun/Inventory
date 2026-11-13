<script setup>
/**
 * 棚卸を終えた直後のまとめ（User 2026-11-13）。発注は終えると書き出しが開くのに、
 * 棚卸はトーストだけでホームへ戻り、何を得たのかが画面に残らなかった。
 * 数字は履歴詳細のレポートと同じ buildSessionReport から出す（別の数え方を作らない）。
 */
import { computed, onUnmounted } from 'vue'
import { useEscapeKey } from '../composables/useEscapeKey.js'
import { registerInnerLayerCloser } from '../composables/appMenuState.js'
import { canSeeMoney } from '../composables/useAuth.js'
import { buildSessionReport } from '../services/sessionReport.js'

const props = defineProps({
  snapshot: { type: Object, required: true },   // 完了した棚卸
  prev:     { type: Object, default: null },    // 直前に完了した棚卸（無ければ比べない）
})
const emit = defineEmits(['close', 'detail'])
useEscapeKey(() => emit('close'))
onUnmounted(registerInnerLayerCloser(() => { emit('close'); return true }))

const report = computed(() => buildSessionReport(props.snapshot, props.prev))
const showMoney = computed(() => canSeeMoney.value)
const fmtYen = n => '¥' + Math.round(n).toLocaleString('ja-JP')
const diffText = computed(() => {
  const d = report.value.prev?.valueDiff
  if (d == null || !showMoney.value) return ''
  return `前回より ${d > 0 ? '+' : d < 0 ? '−' : '±'}${fmtYen(Math.abs(d))}`
})
const minutes = computed(() => {
  const ms = report.value.durationMs
  return ms != null ? Math.max(1, Math.round(ms / 60000)) : null
})
</script>

<template>
  <Teleport to="body">
    <div class="modal-overlay" @click.self="emit('close')">
      <div class="modal-sheet sd" role="dialog" aria-modal="true" aria-label="棚卸のまとめ">
        <div class="sd-title">棚卸が終わりました</div>

        <div class="sd-main">
          <div class="sd-num">{{ report.items.filled }}<small>品目を数えました</small></div>
          <div v-if="showMoney && report.value.total != null" class="sd-yen">
            在庫金額 <b>{{ fmtYen(report.value.total) }}</b>
            <span v-if="diffText" class="sd-diff">{{ diffText }}</span>
          </div>
        </div>

        <ul class="sd-list">
          <li v-if="report.items.missing > 0" class="warn">数えていない品目 <b>{{ report.items.missing }}</b></li>
          <li v-if="showMoney && report.value.unpricedCount > 0" class="warn">
            単価のない品目 <b>{{ report.value.unpricedCount }}</b><small>金額に入っていません</small>
          </li>
          <li v-if="report.people.count > 1">数えた人 <b>{{ report.people.count }}人</b></li>
          <li v-if="minutes != null">かかった時間 <b>{{ minutes }}分</b></li>
        </ul>

        <div class="sd-acts">
          <button type="button" class="sd-btn sec" @click="emit('close')">閉じる</button>
          <button type="button" class="sd-btn pri" @click="emit('detail')">結果を見る</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.sd { display: grid; gap: 14px; }
.sd-title { font-size: 17px; font-weight: 800; color: var(--text, #12303a); }
.sd-main { border-radius: 16px; padding: 16px; background: var(--bg, #f6fafb); display: grid; gap: 6px; }
.sd-num { font-size: 40px; font-weight: 800; line-height: 1.1; color: var(--primary, #0e7490); }
.sd-num small { font-size: 14px; font-weight: 700; margin-left: 8px; color: var(--text, #12303a); }
.sd-yen { font-size: 14px; font-weight: 700; color: var(--text-muted, #4c6a72); }
.sd-yen b { font-size: 18px; color: var(--text, #12303a); margin: 0 6px 0 4px; }
.sd-diff { white-space: nowrap; }
.sd-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.sd-list li { display: flex; align-items: baseline; gap: 8px; font-size: 14px; color: var(--text, #12303a); }
.sd-list li b { font-weight: 800; }
.sd-list li small { font-size: 12px; color: var(--text-muted, #4c6a72); }
.sd-list li.warn b { color: #b45309; }
.sd-acts { display: flex; gap: 8px; }
.sd-btn { flex: 1; min-height: 48px; border-radius: 12px; font-size: 15px; font-weight: 800; cursor: pointer; }
.sd-btn.pri { border: none; background: var(--grad-btn); color: var(--on-grad); }
.sd-btn.sec { border: 1px solid var(--border, #d6e6ea); background: var(--surface, #fff); color: var(--text, #12303a); }
</style>
