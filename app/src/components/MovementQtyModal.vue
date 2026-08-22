<script setup>
/**
 * 入出庫の数量入力シート。
 *
 * 棚卸・発注は行をタップして NumPad で打つ。入出庫だけ行内の数値入力欄で、
 * スマホでは OS キーボードが画面の半分を隠していた。打鍵感を3画面でそろえるため、
 * 同じ `NumPad` を使う軽いシートを用意する。
 *
 * 棚卸の `ConfirmModal` は流用しない。あちらは単位・ジャンル・監査ログ・
 * 「あとで数える」・新規品目登録まで抱えており、入出庫には無い概念が付いてくる。
 * ここで扱うのは**今回記録する数量だけ**（保存は従来どおりバラ換算後の個数）。
 */
import { ref, computed } from 'vue'
import NumPad from './NumPad.vue'
import { useEscapeKey } from '../composables/useEscapeKey.js'

const props = defineProps({
  item: { type: String, required: true },
  mode: { type: String, default: 'in' },        // 'in' | 'out'
  qty:  { type: Number, default: 0 },           // 現在の入力値（バラ）
  unit: { type: String, default: '' },
  lot:  { type: Number, default: null },        // 入数（1超のときだけ「＋箱」を出す）
  theo: { type: Number, default: null },        // 記録前の理論在庫
})
const emit = defineEmits(['confirm', 'cancel'])
useEscapeKey(() => emit('cancel'))

const isOut = computed(() => props.mode === 'out')
const hasLot = computed(() => (props.lot ?? 1) > 1)

// NumPad は文字列で編集する（先頭0や打ち途中の "1." を壊さない）。
const buf = ref(props.qty > 0 ? String(props.qty) : '')
const value = computed(() => {
  const n = Number(buf.value)
  return Number.isFinite(n) && n > 0 ? n : 0
})

function digit(d) { buf.value = (buf.value === '0' ? '' : buf.value) + d }
function dot()     { if (!buf.value.includes('.')) buf.value = (buf.value || '0') + '.' }
function back()    { buf.value = buf.value.slice(0, -1) }
function clear()   { buf.value = '' }

function add(n) {
  const next = Math.round((value.value + n) * 1000) / 1000
  buf.value = next > 0 ? String(next) : ''
}

// 記録後の理論在庫。入庫は増え、出庫は減る（画面の意味を打ちながら確認できる）。
const after = computed(() => {
  if (props.theo == null || value.value === 0) return null
  return Math.round((props.theo + (isOut.value ? -value.value : value.value)) * 1000) / 1000
})

// 入数がある品目は「◯ケース＋端数」を添える（＋箱の押し過ぎに気づける）。
const cases = computed(() => {
  if (!hasLot.value || value.value === 0) return ''
  const c = Math.floor(value.value / props.lot)
  const rem = Math.round((value.value - c * props.lot) * 1000) / 1000
  if (c === 0) return ''
  return rem > 0 ? `${c}ケース＋${rem}` : `${c}ケース`
})
</script>

<template>
  <div class="modal-overlay" @click.self="emit('cancel')">
    <div :class="['modal-sheet', 'mq-sheet', mode]" role="dialog" aria-modal="true">
      <div class="sheet-handle"></div>

      <div class="mq-head">
        <span :class="['mq-badge', mode]">{{ isOut ? '📤 出庫' : '📥 入庫' }}</span>
        <span class="mq-item">{{ item }}</span>
      </div>

      <div class="mq-theo">
        理論 {{ theo != null ? theo : '—' }}{{ unit }}
        <template v-if="after != null"> → <b :class="isOut ? 'down' : 'up'">{{ after }}{{ unit }}</b></template>
        <span v-if="hasLot" class="mq-lot">入数{{ lot }}</span>
      </div>

      <div class="mq-value" :class="{ on: value > 0 }">
        <span class="mq-num">{{ buf || '0' }}</span>
        <span v-if="unit" class="mq-unit">{{ unit }}</span>
        <span v-if="cases" class="mq-cases">{{ cases }}</span>
      </div>

      <div class="mq-quick">
        <button v-if="!isOut && hasLot" class="mq-q lot" type="button" @click="add(lot)">＋箱（{{ lot }}）</button>
        <button class="mq-q" type="button" @click="add(1)">＋1</button>
        <button class="mq-q" type="button" :disabled="value <= 0" @click="add(-1)">−1</button>
        <button class="mq-q ghost" type="button" :disabled="!buf" @click="clear">クリア</button>
      </div>

      <NumPad @digit="digit" @dot="dot" @backspace="back" @clear="clear" />

      <div class="mq-actions">
        <button class="btn btn-secondary" @click="emit('cancel')">キャンセル</button>
        <button :class="['btn', 'btn-primary', mode]" @click="emit('confirm', value)">
          {{ value > 0 ? 'この数量にする' : '入力を取り消す' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mq-sheet { max-height: 92vh; overflow-y: auto; }

.mq-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.mq-badge { flex-shrink: 0; font-size: 11px; font-weight: 800; border-radius: 8px; padding: 3px 8px; }
.mq-badge.in  { background: #ecfdf5; color: #047857; }
.mq-badge.out { background: #fef2f2; color: #b91c1c; }
.mq-item { font-size: 17px; font-weight: 800; color: #1e293b; line-height: 1.3; }

.mq-theo { font-size: 12px; color: #64748b; font-weight: 600; margin-bottom: 10px; }
.mq-theo .up   { color: #047857; }
.mq-theo .down { color: #b91c1c; }
.mq-lot { margin-left: 6px; font-size: 10.5px; font-weight: 700; color: #64748b; background: #f1f5f9; border-radius: 8px; padding: 1px 6px; }

.mq-value {
  display: flex; align-items: baseline; gap: 6px;
  border: 1.5px solid #e2e8f0; border-radius: 12px;
  padding: 12px 14px; margin-bottom: 10px; background: #f8fafc;
}
.mq-value.on { border-color: #10b981; background: #ecfdf5; }
.mq-sheet.out .mq-value.on { border-color: #ef4444; background: #fef2f2; }
.mq-num  { font-size: 30px; font-weight: 800; color: #1e293b; line-height: 1; }
.mq-unit { font-size: 14px; font-weight: 700; color: #64748b; }
.mq-cases { margin-left: auto; font-size: 11.5px; font-weight: 700; color: #475569; }

.mq-quick { display: flex; gap: 6px; margin-bottom: 10px; }
.mq-q {
  flex: 1; min-height: 44px; border: 1.5px solid #e2e8f0; border-radius: 10px;
  background: #fff; color: #334155; font-size: 13px; font-weight: 800; cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.mq-q.lot { border-color: #a7f3d0; background: #ecfdf5; color: #047857; }
.mq-q.ghost { color: #94a3b8; }
.mq-q:disabled { opacity: 0.45; cursor: default; }
.mq-q:active { transform: scale(0.97); }

.mq-actions { display: flex; gap: 10px; margin-top: 12px; }
.btn { flex: 1; border: none; border-radius: 10px; padding: 13px; font-size: 14px; font-weight: 800; cursor: pointer; }
.btn-secondary { background: #f1f5f9; color: #475569; }
.btn-primary { color: #fff; background: #10b981; }
.btn-primary.out { background: #ef4444; }
</style>
