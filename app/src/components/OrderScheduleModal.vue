<script setup>
import { ref, computed } from 'vue'
import { useConfig } from '../composables/useConfig.js'
import { useEscapeKey } from '../composables/useEscapeKey.js'
import { weekdayLabel, scheduleSummary } from '../services/orderScheduleUtil.js'

const emit = defineEmits(['close', 'saved'])
const { config, setOrderSchedule, setOrderInputMode } = useConfig()

// デスクトップの ESC で閉じる（スマホの戻るは App の _closeTopLayer → showOrderSchedule 経由）
useEscapeKey(() => emit('close'))

// 既存値で初期化（月火…の順で表示するため 1..6,0 の並び）
const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0]  // 月火水木金土日
const selected = ref(new Set(config.orderSchedule?.days ?? []))
const deadline = ref(config.orderSchedule?.deadline ?? '')
// 発注数の決め方（店舗の既定）。品目ごとの補充目標は在庫タブの詳細で設定する。
const inputMode = ref(config.orderInputMode === 'manual' ? 'manual' : 'auto')

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
  setOrderInputMode(inputMode.value)
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

      <div class="os-label">発注数の決め方</div>
      <label class="os-mode" :class="{ on: inputMode === 'auto' }">
        <input type="radio" value="auto" v-model="inputMode" />
        <span class="os-mode-body">
          <span class="os-mode-name">不足分を自動で入れる</span>
          <span class="os-mode-desc">在庫を入力すると「補充目標 − 在庫」から発注数が入ります。あとから直せます。</span>
        </span>
      </label>
      <label class="os-mode" :class="{ on: inputMode === 'manual' }">
        <input type="radio" value="manual" v-model="inputMode" />
        <span class="os-mode-body">
          <span class="os-mode-name">自分で入力する</span>
          <span class="os-mode-desc">推奨は参考として出すだけ。発注数は自分で決めます。</span>
        </span>
      </label>
      <p class="os-mode-note">補充目標は品目ごとに、在庫タブ → 品目をタップ → 詳細で設定できます。未設定なら発注点から自動で決まります。</p>

      <button class="os-save" @click="onSave">保存</button>
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

.os-mode {
  display: flex; align-items: flex-start; gap: 10px;
  border: 1.5px solid #e2e8f0; border-radius: 10px; padding: 10px 12px; cursor: pointer;
}
.os-mode.on { border-color: #ea580c; background: #fff7ed; }
.os-mode-body { display: flex; flex-direction: column; gap: 2px; }
.os-mode-name { font-size: 13.5px; font-weight: 800; color: #1e293b; }
.os-mode-desc { font-size: 11.5px; color: #64748b; line-height: 1.5; }
.os-mode-note { font-size: 11px; color: #94a3b8; line-height: 1.6; margin: 0; }

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
