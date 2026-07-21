<script setup>
import { ref, computed } from 'vue'
import { useConfig } from '../composables/useConfig.js'
import { useEscapeKey } from '../composables/useEscapeKey.js'
import { weekdayLabel, scheduleSummary } from '../services/orderScheduleUtil.js'

const emit = defineEmits(['close', 'saved'])
const { config, setOrderSchedule } = useConfig()

// デスクトップの ESC で閉じる（スマホの戻るは App の _closeTopLayer → showOrderSchedule 経由）
useEscapeKey(() => emit('close'))

// 既存値で初期化（月火…の順で表示するため 1..6,0 の並び）
const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0]  // 月火水木金土日
const selected = ref(new Set(config.orderSchedule?.days ?? []))
const deadline = ref(config.orderSchedule?.deadline ?? '')

function toggle(d) {
  if (selected.value.has(d)) selected.value.delete(d)
  else selected.value.add(d)
  // Set の変更を検知させる
  selected.value = new Set(selected.value)
}

const preview = computed(() =>
  scheduleSummary({ days: [...selected.value], deadline: deadline.value }) || '未設定'
)

function onSave() {
  setOrderSchedule({ days: [...selected.value], deadline: deadline.value })
  emit('saved')
  emit('close')
}
function onClear() {
  selected.value = new Set()
  deadline.value = ''
}
</script>

<template>
  <div class="os-overlay" @click.self="emit('close')">
    <div class="os-sheet">
      <div class="os-handle"></div>
      <div class="os-title">🗓 発注スケジュール</div>
      <div class="os-desc">発注する曜日と締め切り時間を設定します。発注セッションの位置づけ表示や締切の目安に使います。</div>

      <div class="os-label">発注する曜日（頻度）</div>
      <div class="os-dows">
        <button
          v-for="d in DOW_ORDER" :key="d"
          :class="['os-dow', { on: selected.has(d), sun: d === 0, sat: d === 6 }]"
          type="button"
          @click="toggle(d)"
        >{{ weekdayLabel(d) }}</button>
      </div>

      <div class="os-label">締め切り時間（任意）</div>
      <input v-model="deadline" type="time" class="os-time" />

      <div class="os-preview">現在の設定：<b>{{ preview }}</b></div>

      <button class="os-save" :disabled="selected.size === 0" @click="onSave">保存</button>
      <div class="os-sub-actions">
        <button class="os-clear" @click="onClear">クリア</button>
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
.os-label { font-size: 13px; font-weight: 700; color: #475569; margin-top: 4px; }

.os-dows { display: flex; gap: 6px; }
.os-dow {
  flex: 1; height: 46px; border: 1.5px solid var(--border, #e2e8f0); background: #fff;
  border-radius: 10px; font-size: 15px; font-weight: 800; color: #64748b; cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.os-dow.sun { color: #dc2626; }
.os-dow.sat { color: #2563eb; }
.os-dow.on { border-color: #ea580c; background: #fff7ed; color: #c2410c; }

.os-time { border: 1.5px solid var(--border, #e2e8f0); border-radius: 10px; padding: 10px 12px; font-size: 16px; color: #1e293b; background: #fff; }

.os-preview { font-size: 13px; color: #475569; background: #f8fafc; border-radius: 10px; padding: 10px 12px; }
.os-preview b { color: #c2410c; }

.os-save { border: none; border-radius: 12px; padding: 14px; font-size: 15px; font-weight: 800; color: #fff; cursor: pointer; background: linear-gradient(135deg, #fb923c 0%, #ea580c 100%); -webkit-tap-highlight-color: transparent; }
.os-save:disabled { opacity: 0.5; cursor: not-allowed; }
.os-save:active { transform: scale(0.98); }
.os-sub-actions { display: flex; justify-content: space-between; }
.os-clear { border: none; background: none; color: #94a3b8; font-size: 13px; font-weight: 700; padding: 6px; cursor: pointer; }
.os-cancel { border: none; background: none; color: #64748b; font-size: 14px; font-weight: 700; padding: 6px; cursor: pointer; }
</style>
