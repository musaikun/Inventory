<script setup>
import { can } from '../composables/useAuth.js'
import { ref, computed, onMounted } from 'vue'
import { getSessions, logout } from '../composables/useAuth.js'
import { isPro, FREE_HISTORY_COUNT, historyLimit } from '../utils/planLimits.js'
import LoadingSpinner from './LoadingSpinner.vue'
import { useWeather } from '../composables/useWeather.js'
import HistoryCalendar from './HistoryCalendar.vue'
import TaskNews from './TaskNews.vue'
import WeatherAsk from './WeatherAsk.vue'
import { pullTasks, tasksOn } from '../composables/useTasks.js'
import { localDateKey } from '../utils/localDate.js'

// 履歴カレンダー専用ページ。
// 以前はホームのダッシュボードタブに埋まっていたが、日付を選ぶ・月を送る操作が
// タブのスワイプと競合し、カレンダーを見る目的で来た人が余分な導線を通っていた。
// ここでは「日付から履歴を開く」ことだけを行う。
// embedded: ホームの「履歴」タブに置くとき。見出しと戻るを出さず、高さはホームの見出しと下部ナビを除いた分
// inJournal: 日誌の「月」として置くとき（2026-10-09）。今日の行・新着の知らせ・カレンダー／一覧の切り替えは日誌側にあるので出さない
const props = defineProps({ embedded: { type: Boolean, default: false }, inJournal: { type: Boolean, default: false } })
const emit = defineEmits(['back', 'viewSession', 'openUpgrade'])

// 天気（Open-Meteo・任意）。位置情報許可でカレンダーに気温・降水・天気を表示。
// 表示するかは初めて開いたときに一度だけ訊き（WeatherAsk）、変更は各種設定から。ここには取得ボタンを出さない
const { state: weatherState } = useWeather()

const sessions   = ref([])
const loading    = ref(true)
const error      = ref('')

onMounted(() => { _loadSessions(); pullTasks() })

// 「今日」の行：今日のやること（未完了）を短く見せ、押すと今日の詳細を開く
const calRef = ref(null)
const todayKey = localDateKey()
const todayOpen = computed(() => tasksOn(todayKey).filter(t => !t.doneAt))
function openToday() { calRef.value?.openDay(todayKey) }

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

// Free プラン: 直近 historyLimit() 件のみ表示（新しい順）。上限が無ければ全件。
const visibleCompletedSessions = computed(() => {
  const limit = historyLimit()
  if (!Number.isFinite(limit)) return completedSessions.value
  return [...completedSessions.value]
    .sort((a, b) => new Date(b.endedAt ?? b.startedAt) - new Date(a.endedAt ?? a.startedAt))
    .slice(0, limit)
})

const hiddenByPlanCount = computed(() =>
  completedSessions.value.length - visibleCompletedSessions.value.length
)

</script>

<template>
  <div :class="['hcp', { embedded }]">
    <header v-if="!embedded" class="hcp-header">
      <button class="hcp-back" @click="emit('back')">‹ 戻る</button>
      <span class="hcp-title">📅 履歴カレンダー</span>
      <span v-if="completedSessions.length > 0" class="hcp-count">{{ completedSessions.length }}回</span>
    </header>

    <div class="hcp-scroll">
      <div v-if="error" class="hcp-error">{{ error }}</div>

      <WeatherAsk />

      <TaskNews v-if="!inJournal" />
      <button v-if="!inJournal" type="button" class="hcp-today" @click="openToday">
        <span class="hcp-today-l">今日</span>
        <span class="hcp-today-t">{{ todayOpen.length ? todayOpen.map(t => t.text).join(' ・ ') : (can('task.create') ? 'やることを追加する' : '今日のやることはありません') }}</span>
        <span v-if="todayOpen.length" class="hcp-today-n">{{ todayOpen.length }}件</span>
        <span aria-hidden="true">›</span>
      </button>

      <LoadingSpinner v-if="loading" />
      <HistoryCalendar
        v-else
        ref="calRef"
        :sessions="visibleCompletedSessions"
        :weather="weatherState.weather"
        :calendar-only="inJournal"
        @view-session="s => emit('viewSession', s)"
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
/* この画面は1画面で完結させる（下にスクロールする余白を作らない）。
   高さを 100dvh に固定し、余った高さはカレンダー自身が吸う。
   → #app の padding-bottom(80px) も style.css 側で 0 にしてある */
.hcp.embedded { height: auto; flex: 1 1 auto !important; min-height: 0; }
.hcp {
  /* 下部ナビ（全画面共通）の分だけ縮める */
  height: calc(100dvh - var(--app-footer-h, 0px));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #f6fafb;
}

.hcp-header {
  z-index: 2; flex-shrink: 0;
  display: flex; align-items: center; gap: 10px;
  padding: 12px 14px; background: #fff; border-bottom: 1px solid #d6e6ea;
}
.hcp-back { border: none; background: none; color: #059669; font-size: 14px; font-weight: 700; cursor: pointer; padding: 4px 2px; }
.hcp-title { font-size: 16px; font-weight: 800; color: #065f46; }
.hcp-count { margin-left: auto; font-size: 13px; font-weight: 800; color: #059669; }

/* 通常は overflow が出ない（カレンダーが余りを吸う）。横画面など極端に低いときだけ
   スクロールへ逃がす＝マスを 44px 未満に潰さないための保険 */
.hcp-scroll {
  flex: 1; min-height: 0; overflow-y: auto;
  display: flex; flex-direction: column;
  padding: 14px; max-width: 620px; margin: 0 auto; width: 100%;
}

.hcp-today {
  flex-shrink: 0; display: flex; align-items: center; gap: 8px; width: 100%; min-height: 44px; padding: 8px 12px; margin-bottom: 8px;
  border: 1px solid var(--border); border-radius: 12px; background: var(--surface); color: var(--text); font: inherit; text-align: left; cursor: pointer;
}
.hcp-today-l { flex: none; font-size: 11.5px; font-weight: 800; color: var(--primary); }
.hcp-today-t { flex: 1; min-width: 0; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hcp-today-n { flex: none; font-size: 11.5px; font-weight: 800; color: #a16207; background: #fef3c7; border-radius: 999px; padding: 1px 8px; }
.hcp-error {
  flex-shrink: 0;
  background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c;
  border-radius: 10px; padding: 10px 12px; font-size: 13px; margin-bottom: 10px;
}


.plan-limit-notice {
  flex-shrink: 0;
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
