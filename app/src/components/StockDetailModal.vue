<script setup>
/**
 * 在庫タブの品目詳細シート。
 *
 * 3タブ（在庫 / 入庫 / 出庫）で「行タップ → シート」に導線をそろえるため、
 * 従来の行アコーディオンからモーダルへ移した。行に内訳を出さないぶん一覧の
 * 情報密度が上がり、棚卸・発注の一覧と同じ見え方になる。
 *
 * 表示だけの画面ではなく、発注点はここで編集する（部分利用のユーザーにとっては
 * 学習より発注点が主役になるため、在庫を見た流れでそのまま直せる位置に置く）。
 */
import { computed } from 'vue'
import { useEscapeKey } from '../composables/useEscapeKey.js'

const props = defineProps({
  item:      { type: String, required: true },
  unit:      { type: String, default: '' },
  theo:      { type: Number, default: null },   // 理論在庫（記録なしは null）
  basis:     { type: String, default: '' },     // 内訳（例: 8/1棚卸 10 ＋入庫3 −出庫2）
  reorder:   { type: Number, default: null },   // 発注点（未設定は null）
  suggested: { type: Number, default: null },   // 発注点の目安（算出できないときは null）
  suggestBasis: { type: String, default: '' },  // 目安の根拠（推定消費 × 発注間隔）
  hint:      { type: String, default: '' },     // 算出できない理由
  lot:       { type: Number, default: null },
  price:     { type: [Number, String], default: null },
  category:  { type: String, default: '' },
  movements: { type: Array, default: () => [] }, // [{ id, date, type, qty, unit, note }]
})
const emit = defineEmits(['update-reorder', 'close'])
useEscapeKey(() => emit('close'))

const needsReorder = computed(() => {
  if (props.theo == null) return false
  return props.reorder != null ? props.theo <= props.reorder : props.theo <= 0
})

function onReorderInput(e) { emit('update-reorder', e.target.value) }
function _md(d) {
  const [, mo, dd] = String(d || '').split('-').map(Number)
  return mo && dd ? `${mo}/${dd}` : ''
}
</script>

<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <div class="modal-sheet sd-sheet" role="dialog" aria-modal="true">
      <div class="sheet-handle"></div>

      <div class="sd-head">
        <span class="sd-item">{{ item }}</span>
        <span v-if="needsReorder" class="sd-badge">要補充</span>
      </div>

      <div class="sd-stock">
        <span class="sd-label">理論在庫</span>
        <span :class="['sd-qty', { low: needsReorder }]">
          <template v-if="theo != null">{{ theo }}<span class="sd-unit">{{ unit }}</span></template>
          <template v-else>—</template>
        </span>
      </div>
      <div v-if="basis" class="sd-basis">{{ basis }}</div>
      <p class="sd-caveat">記録していない使用・ロス・納品の分だけ実際とずれます。正確な数は棚卸で確定します。</p>

      <!-- 発注点（手動＝床）。部分利用では推奨の主役になる -->
      <div class="sd-block">
        <div class="sd-block-title">発注点</div>
        <div class="sd-reorder">
          <input
            class="sd-rp-input" type="number" inputmode="numeric" min="0" placeholder="未設定"
            :value="reorder != null ? reorder : ''"
            @input="onReorderInput"
          />
          <span class="sd-rp-unit">{{ unit || '個' }}以下で要補充</span>
        </div>
        <div v-if="suggested != null" class="sd-suggest">
          <button class="sd-suggest-btn" @click="emit('update-reorder', suggested)">目安 {{ suggested }} を採用</button>
          <span v-if="suggestBasis" class="sd-suggest-basis">{{ suggestBasis }}</span>
        </div>
        <div v-else-if="hint" class="sd-hint">{{ hint }}</div>
      </div>

      <div v-if="lot || price || category" class="sd-meta">
        <span v-if="lot">入数{{ lot }}</span>
        <span v-if="price">単価¥{{ price }}</span>
        <span v-if="category">{{ category }}</span>
      </div>

      <div class="sd-block">
        <div class="sd-block-title">直近の入出庫</div>
        <div v-if="movements.length" class="sd-mv-list">
          <div v-for="mv in movements" :key="mv.id" class="sd-mv">
            <span class="sd-mv-date">{{ _md(mv.date) }}</span>
            <span :class="['sd-mv-type', mv.type]">{{ mv.type === 'out' ? '出庫' : '入庫' }}</span>
            <span class="sd-mv-qty">{{ mv.qty }}{{ mv.unit }}</span>
            <span v-if="mv.note" class="sd-mv-note">{{ mv.note }}</span>
          </div>
        </div>
        <div v-else class="sd-mv-empty">入出庫の記録はまだありません</div>
      </div>

      <button class="btn btn-secondary sd-close" @click="emit('close')">閉じる</button>
    </div>
  </div>
</template>

<style scoped>
.sd-sheet { max-height: 88vh; overflow-y: auto; }

.sd-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.sd-item { font-size: 17px; font-weight: 800; color: #1e293b; line-height: 1.3; }
.sd-badge {
  flex-shrink: 0; font-size: 10px; font-weight: 800; color: #b91c1c;
  background: #fee2e2; border: 1px solid #fecaca; border-radius: 9px; padding: 2px 7px;
}

.sd-stock { display: flex; align-items: baseline; gap: 10px; }
.sd-label { font-size: 12px; font-weight: 700; color: #94a3b8; }
.sd-qty { font-size: 28px; font-weight: 800; color: #0f766e; line-height: 1.1; }
.sd-qty.low { color: #b91c1c; }
.sd-unit { font-size: 14px; font-weight: 700; color: #64748b; margin-left: 2px; }
.sd-basis { font-size: 12px; color: #475569; margin-top: 4px; }
.sd-caveat { font-size: 11px; color: #94a3b8; line-height: 1.6; margin: 6px 0 14px; }

.sd-block { border-top: 1px solid #f1f5f9; padding-top: 12px; margin-bottom: 12px; }
.sd-block-title { font-size: 12px; font-weight: 800; color: #94a3b8; margin-bottom: 8px; }

.sd-reorder { display: flex; align-items: center; gap: 8px; }
.sd-rp-input {
  width: 88px; border: 1.5px solid #fecaca; border-radius: 9px; padding: 9px 10px;
  font-size: 15px; font-weight: 700; text-align: right; color: #b91c1c; background: #fff;
}
.sd-rp-input:focus { outline: none; border-color: #ef4444; }
.sd-rp-unit { font-size: 12px; color: #94a3b8; }

.sd-suggest { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
.sd-suggest-btn {
  border: 1.5px solid #bfdbfe; background: #eff6ff; color: #1d4ed8;
  border-radius: 9px; min-height: 40px; padding: 6px 12px;
  font-size: 13px; font-weight: 800; cursor: pointer; -webkit-tap-highlight-color: transparent;
}
.sd-suggest-btn:active { background: #dbeafe; }
.sd-suggest-basis { font-size: 11px; color: #94a3b8; }
.sd-hint { font-size: 12px; color: #b45309; background: #fffbeb; border: 1px solid #fde68a; border-radius: 9px; padding: 8px 10px; line-height: 1.6; }

.sd-meta { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
.sd-meta span { font-size: 11px; font-weight: 700; color: #475569; background: #f1f5f9; border-radius: 8px; padding: 2px 8px; }

.sd-mv-list { display: flex; flex-direction: column; gap: 5px; }
.sd-mv { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.sd-mv-date { color: #94a3b8; font-weight: 700; flex-shrink: 0; }
.sd-mv-type { font-weight: 800; flex-shrink: 0; }
.sd-mv-type.in  { color: #047857; }
.sd-mv-type.out { color: #b91c1c; }
.sd-mv-qty { font-weight: 700; color: #334155; flex-shrink: 0; }
.sd-mv-note { color: #94a3b8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sd-mv-empty { font-size: 12px; color: #94a3b8; }

.btn { width: 100%; border: none; border-radius: 10px; padding: 13px; font-size: 14px; font-weight: 800; cursor: pointer; }
.btn-secondary { background: #f1f5f9; color: #475569; }
.sd-close { margin-top: 4px; }
</style>
