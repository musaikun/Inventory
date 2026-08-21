<script setup>
import { ref, computed, onMounted } from 'vue'
import { getSessions, deleteSession, logout } from '../composables/useAuth.js'
import { isPro, FREE_HISTORY_COUNT } from '../utils/planLimits.js'
import { useHistory } from '../composables/useHistory.js'
import { useWeather, requestGeolocation } from '../composables/useWeather.js'
import { isSessionLocked, deleteConfirmMessage } from '../services/sessionLock.js'
import HistoryCalendar from './HistoryCalendar.vue'

// 履歴カレンダー専用ページ。
// 以前はホームのダッシュボードタブに埋まっていたが、日付を選ぶ・月を送る操作が
// タブのスワイプと競合し、カレンダーを見る目的で来た人が余分な導線を通っていた。
// ここでは「日付から履歴を開く」ことだけを行う。
const emit = defineEmits(['back', 'viewSession', 'deleteSession', 'openUpgrade'])

const { getSnapshotBySessionId } = useHistory()

// 天気（Open-Meteo・任意）。位置情報許可でカレンダーに気温・降水・天気を表示。
const { state: weatherState } = useWeather()
const weatherBusy = ref(false)
async function onEnableWeather() {
  weatherBusy.value = true
  try { await requestGeolocation() } catch (_) { /* 拒否/失敗は state.error に反映 */ }
  finally { weatherBusy.value = false }
}

const sessions   = ref([])
const loading    = ref(true)
const error      = ref('')
const deletingId = ref(null)

onMounted(_loadSessions)

async function _loadSessions() {
  loading.value = true
  error.value   = ''
  try {
    sessions.value = await getSessions()
  } catch (e) {
    if (e.message.includes('401') || e.message.toLowerCase().includes('unauthorized')) {
      await logout()
      emit('back')
      return
    }
    error.value = e.message
  } finally {
    loading.value = false
  }
}

const completedSessions = computed(() =>
  sessions.value.filter(s => s.status === 'completed' && (s.type ?? 'stock') !== 'order')
)

// Free プラン: 直近 FREE_HISTORY_COUNT 件のみ表示（新しい順）
const visibleCompletedSessions = computed(() => {
  if (isPro()) return completedSessions.value
  return [...completedSessions.value]
    .sort((a, b) => new Date(b.endedAt ?? b.startedAt) - new Date(a.endedAt ?? a.startedAt))
    .slice(0, FREE_HISTORY_COUNT)
})

const hiddenByPlanCount = computed(() =>
  completedSessions.value.length - visibleCompletedSessions.value.length
)

async function onDelete(session) {
  const locked = session.status === 'completed' && isSessionLocked(session, {
    snapshotLocked: !!getSnapshotBySessionId(session.id)?.locked,
    completedSessions: completedSessions.value,
  })
  if (!confirm(deleteConfirmMessage(session, locked))) return
  deletingId.value = session.id
  try {
    await deleteSession(session.id)
    sessions.value = sessions.value.filter(s => s.id !== session.id)
    emit('deleteSession', session.id)
  } catch (e) {
    error.value = e.message
  } finally {
    deletingId.value = null
  }
}
</script>

<template>
  <div class="hcp">
    <header class="hcp-header">
      <button class="hcp-back" @click="emit('back')">‹ 戻る</button>
      <span class="hcp-title">📅 履歴カレンダー</span>
      <span v-if="completedSessions.length > 0" class="hcp-count">{{ completedSessions.length }}回</span>
    </header>

    <div class="hcp-scroll">
      <div v-if="error" class="hcp-error">{{ error }}</div>

      <div class="wx-bar">
        <template v-if="weatherState.loc">
          <span class="wx-loc">🌤 天気表示中{{ weatherState.loading ? '（更新中…）' : '' }}</span>
          <span class="wx-coord">📍 {{ weatherState.loc.name || `${weatherState.loc.lat}, ${weatherState.loc.lon}` }}</span>
          <button class="wx-btn" :disabled="weatherBusy || weatherState.loading" @click="onEnableWeather">現在地で更新</button>
        </template>
        <template v-else>
          <span class="wx-hint">天気・気温・降水をカレンダーに表示できます</span>
          <button class="wx-btn primary" :disabled="weatherBusy" @click="onEnableWeather">{{ weatherBusy ? '取得中…' : '📍 現在地で天気を表示' }}</button>
        </template>
        <span v-if="weatherState.error" class="wx-err">{{ weatherState.error }}</span>
      </div>

      <div v-if="loading" class="hcp-loading">読み込み中...</div>
      <HistoryCalendar
        v-else
        :sessions="visibleCompletedSessions"
        :weather="weatherState.weather"
        @view-session="s => emit('viewSession', s)"
        @delete-session="onDelete"
      />

      <div v-if="!isPro() && hiddenByPlanCount > 0" class="plan-limit-notice">
        <span class="plan-limit-icon">🔒</span>
        <span class="plan-limit-text">過去 {{ hiddenByPlanCount }}件の履歴は無料プランでは表示されません</span>
        <button class="plan-limit-link" @click="emit('openUpgrade', `無料プランで閲覧できるのは直近${FREE_HISTORY_COUNT}回の棚卸です。上限の緩和は将来提供予定です。`)">詳しく</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.hcp {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: #f8fafc;
}

.hcp-header {
  position: sticky; top: 0; z-index: 2;
  display: flex; align-items: center; gap: 10px;
  padding: 12px 14px; background: #fff; border-bottom: 1px solid #e2e8f0;
}
.hcp-back { border: none; background: none; color: #059669; font-size: 14px; font-weight: 700; cursor: pointer; padding: 4px 2px; }
.hcp-title { font-size: 16px; font-weight: 800; color: #065f46; }
.hcp-count { margin-left: auto; font-size: 13px; font-weight: 800; color: #059669; }

.hcp-scroll { flex: 1; padding: 14px; max-width: 620px; margin: 0 auto; width: 100%; }

.hcp-loading { text-align: center; padding: 40px 0; color: #94a3b8; font-size: 14px; font-weight: 600; }
.hcp-error {
  background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c;
  border-radius: 10px; padding: 10px 12px; font-size: 13px; margin-bottom: 10px;
}

.wx-bar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
.wx-hint, .wx-loc { font-size: 12px; color: #64748b; font-weight: 600; }
.wx-coord { font-size: 11px; color: #0369a1; font-weight: 700; background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 2px 8px; }
.wx-btn { border: 1.5px solid #d1d5db; background: #fff; border-radius: 16px; padding: 5px 12px; font-size: 12px; font-weight: 700; color: #4b5563; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.wx-btn.primary { border-color: #38bdf8; background: #f0f9ff; color: #0369a1; }
.wx-btn:disabled { opacity: 0.5; cursor: default; }
.wx-err { font-size: 11px; color: #dc2626; }

.plan-limit-notice {
  display: flex; align-items: center; gap: 8px;
  margin-top: 6px; padding: 10px 14px;
  background: #fefce8; border: 1.5px solid #fde047; border-radius: 10px;
  font-size: 12px;
}
.plan-limit-icon { flex-shrink: 0; }
.plan-limit-text { flex: 1; color: #854d0e; font-weight: 600; }
.plan-limit-link {
  flex-shrink: 0; border: none; background: none; padding: 0;
  color: var(--primary); font-size: 12px; font-weight: 700; cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.plan-limit-link:active { opacity: 0.7; }
</style>
