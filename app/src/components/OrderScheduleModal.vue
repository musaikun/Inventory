<script setup>
import { ref, computed } from 'vue'
import { useConfig } from '../composables/useConfig.js'
import { useEscapeKey } from '../composables/useEscapeKey.js'
import {
  weekdayLabel, scheduleSummary, scheduleName, MAX_ORDER_SCHEDULES,
} from '../services/orderScheduleUtil.js'

const emit = defineEmits(['close', 'saved'])
const { config, setOrderSchedules } = useConfig()

// デスクトップの ESC で閉じる（スマホの戻るは App の _closeTopLayer → showOrderSchedule 経由）
useEscapeKey(() => emit('close'))

// 月火…の順で表示するため 1..6,0 の並び
const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0]

let _seq = 0
const newRow = () => ({ id: `new_${_seq++}`, name: '', days: [], deadline: '' })

// 既存値を編集用にコピー（保存するまで config へは書かない）
const rows = ref(
  (config.orderSchedules ?? []).map(s => ({
    id: s.id, name: s.name ?? '', days: [...(s.days ?? [])], deadline: s.deadline ?? '',
  }))
)
// 1件も無いときは空の1行から始める（「追加」を押させない）
if (rows.value.length === 0) rows.value.push(newRow())

const canAdd = computed(() => rows.value.length < MAX_ORDER_SCHEDULES)

function addRow() {
  if (!canAdd.value) return
  rows.value.push(newRow())
}
function removeRow(i) {
  rows.value.splice(i, 1)
  if (rows.value.length === 0) rows.value.push(newRow())
}
function toggle(row, d) {
  const i = row.days.indexOf(d)
  if (i >= 0) row.days.splice(i, 1)
  else row.days.push(d)
}
function summaryOf(row) {
  return scheduleSummary({ days: row.days, deadline: row.deadline }) || '曜日が未選択'
}
function placeholderOf(i) {
  return scheduleName(null, i)   // 発注1・発注2…
}

// 曜日が1つも無い行は保存されない（normalizeSchedules が捨てる）ので、その旨を出す
const droppedCount = computed(() => rows.value.filter(r => r.days.length === 0).length)

function onSave() {
  setOrderSchedules(rows.value)
  emit('saved')
  emit('close')
}
</script>

<template>
  <div class="os-overlay" @click.self="emit('close')">
    <div class="os-sheet">
      <div class="os-handle"></div>
      <div class="os-title">🗓 発注スケジュール</div>
      <div class="os-desc">
        発注する曜日と締め切り時間を設定します。仕入先ごとに分けたい場合は{{ MAX_ORDER_SCHEDULES }}件まで登録できます。
        発注セッションの位置づけ表示や締切の目安に使います。
      </div>

      <div v-for="(row, i) in rows" :key="row.id" class="os-card">
        <div class="os-card-head">
          <input
            v-model="row.name"
            class="os-name"
            type="text"
            maxlength="20"
            :placeholder="placeholderOf(i)"
            :aria-label="`スケジュール${i + 1}の名前`"
          />
          <button class="os-remove" type="button" :aria-label="`スケジュール${i + 1}を削除`" @click="removeRow(i)">削除</button>
        </div>

        <div class="os-dows">
          <button
            v-for="d in DOW_ORDER" :key="d"
            :class="['os-dow', { on: row.days.includes(d), sun: d === 0, sat: d === 6 }]"
            type="button"
            :aria-pressed="String(row.days.includes(d))"
            @click="toggle(row, d)"
          >{{ weekdayLabel(d) }}</button>
        </div>

        <div class="os-row">
          <span class="os-row-label">締め切り時間（任意）</span>
          <input v-model="row.deadline" type="time" class="os-time" :aria-label="`スケジュール${i + 1}の締め切り時間`" />
        </div>

        <div class="os-card-sum">{{ summaryOf(row) }}</div>
      </div>

      <button v-if="canAdd" class="os-add" type="button" @click="addRow">＋ 発注スケジュールを追加</button>
      <p v-else class="os-max">登録できるのは{{ MAX_ORDER_SCHEDULES }}件までです。</p>

      <p v-if="droppedCount" class="os-note">曜日を選んでいない{{ droppedCount }}件は保存されません。</p>

      <button class="os-save" @click="onSave">保存</button>
      <div class="os-sub-actions">
        <button class="os-cancel" @click="emit('close')">キャンセル</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.os-overlay { position: fixed; inset: 0; background: rgba(15,23,42,0.45); z-index: 100; display: flex; align-items: flex-end; }
.os-sheet { background: #fff; width: 100%; border-radius: 18px 18px 0 0; padding: 10px 18px calc(18px + env(safe-area-inset-bottom)); max-height: 88dvh; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }
.os-handle { width: 40px; height: 4px; border-radius: 2px; background: #e2e8f0; margin: 0 auto; flex-shrink: 0; }
.os-title { font-size: 17px; font-weight: 800; color: #1e293b; text-align: center; }
.os-desc { font-size: 12px; color: #64748b; line-height: 1.6; }

.os-card { border: 1.5px solid #e2e8f0; border-radius: 12px; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
.os-card-head { display: flex; align-items: center; gap: 8px; }
.os-name { flex: 1; min-width: 0; border: 1.5px solid var(--border, #e2e8f0); border-radius: 10px; padding: 9px 11px; font-size: 15px; font-weight: 700; color: #1e293b; background: #fff; }
.os-remove { border: none; background: none; color: #94a3b8; font-size: 13px; font-weight: 700; padding: 6px; cursor: pointer; flex-shrink: 0; }
.os-card-sum { font-size: 12.5px; color: #c2410c; font-weight: 700; }

.os-dows { display: flex; gap: 6px; }
.os-dow {
  flex: 1; height: 44px; border: 1.5px solid var(--border, #e2e8f0); background: #fff;
  border-radius: 10px; font-size: 15px; font-weight: 800; color: #64748b; cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.os-dow.sun { color: #dc2626; }
.os-dow.sat { color: #2563eb; }
.os-dow.on { border-color: #ea580c; background: #fff7ed; color: #c2410c; }

.os-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.os-row-label { font-size: 13px; font-weight: 700; color: #475569; }
.os-time { border: 1.5px solid var(--border, #e2e8f0); border-radius: 10px; padding: 9px 11px; font-size: 16px; color: #1e293b; background: #fff; }

.os-add { border: 1.5px dashed #cbd5e1; background: #f8fafc; border-radius: 12px; padding: 12px; font-size: 14px; font-weight: 800; color: #475569; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.os-max { font-size: 11.5px; color: #94a3b8; margin: 0; }
.os-note { font-size: 11.5px; color: #94a3b8; line-height: 1.6; margin: 0; }

.os-save { border: none; border-radius: 12px; padding: 14px; font-size: 15px; font-weight: 800; color: #fff; cursor: pointer; background: linear-gradient(135deg, #fb923c 0%, #ea580c 100%); -webkit-tap-highlight-color: transparent; }
.os-save:active { transform: scale(0.98); }
.os-sub-actions { display: flex; justify-content: flex-end; }
.os-cancel { border: none; background: none; color: #64748b; font-size: 14px; font-weight: 700; padding: 6px; cursor: pointer; }
</style>
