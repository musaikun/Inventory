<script setup>
/**
 * トップ（ホーム）。アプリを開いて最初の画面（User決定 2026-10-07・モック docs/mocks/home-top.html）。
 * - 上部: アイコンと同じ「暗い地に光る輪」に、あいさつ・日付・天気
 * - 今日のやることの要約（進み具合の輪・期限切れ・次の時刻のもの）。押すと「やること」画面
 * - 連絡（店のトーク・User決定 2026-10-26）: 未読の数と新しいメッセージ2件。押すと連絡の画面（TalkPage）
 * - 棚卸・発注が途中なら「続ける」の帯
 * - ショートカット: 棚卸／発注／在庫／日誌／レポート／スタッフ／取り込む／書き出す／設定（下のナビと同じ行き先＋始める）。
 *   管理者には「スタッフ」も（承認待ちの数。管理から移した・User決定 2026-10-14）
 * 棚卸・発注は在庫タブの今のボタンからも始められる（両方に置く・User決定）。
 */
import { ref, computed, onMounted } from 'vue'
import { tasksOn, overdueTasks, isAssignedToMe, isMarkedByMe, pullTasks } from '../composables/useTasks.js'
import { currentStaff, storeName, canSeeReport, isAuthenticated, isAdmin, can } from '../composables/useAuth.js'
import { aliveTasks } from '../composables/useTasks.js'
import { deviceName } from '../composables/useDeviceId.js'
import { useWeather } from '../composables/useWeather.js'
import { localDateKey } from '../utils/localDate.js'
import { APP_NAME } from '../appInfo.js'
import LiveSessionCard from './LiveSessionCard.vue'
import TalkPage from './TalkPage.vue'
import { handoffs, unreadHandoffs, pullHandoffs } from '../composables/useHandoffs.js'

const props = defineProps({
  activeSession:      { type: Object, default: null },
  activeOrderSession: { type: Object, default: null },
  stockCount:         { type: Number, default: 0 },    // 途中の棚卸の数えた品目
  orderCount:         { type: Number, default: 0 },
  orderDeadline:      { type: String, default: '' },   // 今日が発注日なら締切（'' は発注日でない）
  isOrderDay:         { type: Boolean, default: false },
  reorderCount:       { type: Number, default: 0 },
  startingKind:       { type: String, default: null },
  live:               { type: Object, default: null },   // 棚卸のルームの状態（このセッションのときだけ）
  liveOrder:          { type: Object, default: null },
})
const emit = defineEmits(['go', 'stock', 'order', 'resume', 'openTodo'])

onMounted(() => { pullTasks(); pullHandoffs() })

// ── 連絡 ──
const talkOpen = ref(false)
const talkPreview = computed(() => {
  const unread = unreadHandoffs.value
  return (unread.length ? unread : handoffs.value).slice(0, 2)   // 新しい順
})
const _hmAgo = iso => {
  const d = new Date(iso)
  const day = localDateKey(d)
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
  return day === localDateKey() ? hm : day === localDateKey(new Date(Date.now() - 86400_000)) ? `昨日 ${hm}` : `${d.getMonth() + 1}/${d.getDate()} ${hm}`
}

// ── あいさつ ──
const now = new Date()
const WEEK = ['日', '月', '火', '水', '木', '金', '土']
const dateLabel = `${now.getMonth() + 1}月${now.getDate()}日（${WEEK[now.getDay()]}）`
const hello = (() => {
  const h = now.getHours()
  if (h >= 4 && h < 11) return 'おはようございます'
  if (h >= 11 && h < 17) return 'こんにちは'
  return 'おつかれさまです'
})()
const who = computed(() => deviceName.value || '')

const { state: weatherState } = useWeather()
const today = localDateKey()
const wx = computed(() => {
  const w = weatherState.weather?.[today]
  if (!w) return ''
  const t = w.tempHi != null ? `${Math.round(w.tempHi)}°` : ''
  const pop = w.pop != null ? `降水 ${w.pop}%` : ''
  return [`${w.icon} ${t}`.trim(), weatherState.loc?.name || '', pop].filter(Boolean).join(' ・ ')
})

// ── 今日のやること ──
const todays = computed(() => tasksOn(today))
const late = computed(() => overdueTasks(today))
const doneOf = t => !!t.doneAt   // 「全員」は全員の印がそろったときにサーバーが doneAt を立てる
const doneCount = computed(() => todays.value.filter(doneOf).length)
const total = computed(() => todays.value.length)
const R = 30, C = 2 * Math.PI * R
const dash = computed(() => (total.value ? `${(doneCount.value / total.value) * C} ${C}` : `0 ${C}`))
/** 要約に出す3行: 期限切れ → 今日のまだのもの（自分の担当を先に） */
const preview = computed(() => {
  const open = todays.value.filter(t => !(t.assign === 'all' ? isMarkedByMe(t) : t.doneAt))
  const mine = open.filter(isAssignedToMe)
  const rest = open.filter(t => !isAssignedToMe(t))
  // 期限切れは1行にまとめる（溜まっていても今日の分が隠れないように）
  const lateLine = late.value.length === 1
    ? [{ t: late.value[0], tag: '期限切れ', late: true }]
    : late.value.length ? [{ t: { id: '_late', text: `${late.value.length}件（古い日から）` }, tag: '期限切れ', late: true }] : []
  return [
    ...lateLine,
    ...[...mine, ...rest].sort((a, b) => (a.dueTime || '99').localeCompare(b.dueTime || '99'))
      .map(t => ({ t, tag: t.dueTime || '今日', late: false })),
  ].slice(0, 3)
})

// 承認待ち（参加申請のやることのうち、まだ決まっていないもの）
const joinWaiting = computed(() => aliveTasks.value.filter(t => t.kind === 'staff_join' && !t.doneAt).length)

// ── ショートカット ──
const shortcuts = computed(() => [
  { key: 'stock', label: '棚卸', sub: props.activeSession ? `途中 ${props.stockCount}品目` : '数える', hot: !!props.activeSession,
    badge: props.activeSession ? { text: '途中', kind: 'cy' } : null,
    d: ['M9 4h6v3H9zM7 5H5v15h14V5h-2', 'M8 12l2.5 2.5L16 9'] },
  { key: 'order', label: '発注', sub: props.activeOrderSession ? `途中 ${props.orderCount}品目` : (props.isOrderDay ? '今日が発注日' : '発注数を入れる'), ord: true,
    badge: props.activeOrderSession ? { text: '途中', kind: 'or' } : (props.orderDeadline ? { text: props.orderDeadline, kind: 'or' } : null),
    d: ['M6 3h12v18l-3-2-3 2-3-2-3 2z', 'M9 8h6M9 12h6'] },
  { key: 'sessions', label: '在庫', sub: props.reorderCount ? `要補充 ${props.reorderCount}` : '見込みと品目',
    badge: props.reorderCount ? { text: String(props.reorderCount), kind: 'red' } : null,
    d: ['M3 8l9-5 9 5v8l-9 5-9-5z', 'M3 8l9 5 9-5M12 13v8'] },
  { key: 'calendar', label: '日誌', sub: 'やること・記録',
    d: ['M9 6h11M9 12h11M9 18h11', 'M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2'] },
  ...(canSeeReport.value ? [{ key: 'report', label: 'レポート', sub: '金額・推移', d: ['M5 20V10M12 20V4M19 20v-7'] }] : []),
  ...(isAuthenticated.value && isAdmin.value ? [{
    key: 'staff', label: 'スタッフ', sub: joinWaiting.value ? `承認待ち ${joinWaiting.value}` : '招待・承認・役割',
    badge: joinWaiting.value ? { text: String(joinWaiting.value), kind: 'red' } : null, hot: !!joinWaiting.value,
    d: ['M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M2 21v-1a6 6 0 0 1 12 0v1', 'M16 3.5a4 4 0 0 1 0 7M22 21v-1a6 6 0 0 0-4-5.6'],
  }] : []),
  // 取り込む・書き出す（管理から移した・User決定 2026-10-14）
  ...(can('item.admin') ? [{ key: 'import', label: '取り込む', sub: '品目・納品・棚卸', d: ['M12 3v12', 'M7 10l5 5 5-5', 'M4 19h16'] }] : []),
  ...(can('item.admin') ? [{ key: 'export', label: '書き出す', sub: '品目・棚卸結果', d: ['M12 15V3', 'M7 8l5-5 5 5', 'M4 19h16'] }] : []),
  { key: 'dashboard', label: '設定', sub: '発注・端末・通知',
    d: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z'] },
])
function onShortcut(k) {
  if (k === 'stock') { props.activeSession ? emit('resume', props.activeSession) : emit('stock'); return }
  if (k === 'order') { props.activeOrderSession ? emit('resume', props.activeOrderSession) : emit('order'); return }
  emit('go', k)
}
const gid = `ht-${Math.random().toString(36).slice(2, 8)}`
</script>

<template>
  <div class="ht">
    <section class="ht-hero">
      <div class="ht-glow" aria-hidden="true"></div>
      <svg class="ht-ring" width="300" height="230" viewBox="0 0 300 230" aria-hidden="true">
        <defs>
          <linearGradient :id="gid" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#2563eb" /><stop offset=".55" stop-color="#22d3ee" /><stop offset="1" stop-color="#34d399" /></linearGradient>
          <filter :id="`${gid}-b`"><feGaussianBlur stdDeviation="3" /></filter>
        </defs>
        <ellipse cx="150" cy="120" rx="120" ry="58" transform="rotate(-18 150 120)" fill="none" :stroke="`url(#${gid})`" stroke-width="9" opacity=".55" :filter="`url(#${gid}-b)`" />
        <ellipse cx="150" cy="120" rx="120" ry="58" transform="rotate(-18 150 120)" fill="none" :stroke="`url(#${gid})`" stroke-width="3.5" />
        <!-- 輪の上を光が流れる（短い明るい線を輪に沿って回す） -->
        <ellipse class="ht-spark" cx="150" cy="120" rx="120" ry="58" transform="rotate(-18 150 120)" fill="none" stroke="#e0fdff" stroke-width="3.5" stroke-linecap="round" pathLength="100" :filter="`url(#${gid}-b)`" />
        <ellipse class="ht-spark core" cx="150" cy="120" rx="120" ry="58" transform="rotate(-18 150 120)" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" pathLength="100" />
        <!-- 重なったカードがゆっくり浮き沈みする（少しずつずらして） -->
        <g opacity=".85">
          <g class="ht-card c1"><rect x="150" y="56" width="34" height="48" rx="6" transform="skewY(-12)" fill="rgba(165,243,252,.22)" stroke="rgba(165,243,252,.7)" stroke-width="1.2" /></g>
          <g class="ht-card c2"><rect x="172" y="44" width="34" height="48" rx="6" transform="skewY(-12)" fill="rgba(110,231,183,.25)" stroke="rgba(110,231,183,.8)" stroke-width="1.2" /></g>
          <g class="ht-card c3"><rect x="194" y="32" width="34" height="48" rx="6" transform="skewY(-12)" fill="rgba(52,211,153,.3)" stroke="rgba(167,243,208,.9)" stroke-width="1.2" /></g>
        </g>
      </svg>
      <div class="ht-top">
        <svg width="24" height="24" viewBox="0 0 40 40" aria-hidden="true"><ellipse cx="20" cy="20" rx="16" ry="10" transform="rotate(-18 20 20)" fill="none" :stroke="`url(#${gid})`" stroke-width="3.4" /></svg>
        <span class="ht-brand">{{ APP_NAME }}</span>
        <span v-if="storeName" class="ht-store">{{ storeName }}</span>
      </div>
      <div class="ht-hi">
        <small>{{ dateLabel }}</small>
        <b>{{ hello }}<template v-if="who">、<br>{{ who }}さん</template></b>
        <span v-if="wx" class="ht-wx">{{ wx }}</span>
      </div>
    </section>

    <button type="button" class="ht-today" aria-label="やることを開く" @click="emit('openTodo')">
      <span class="ht-pr" aria-hidden="true">
        <svg width="72" height="72" viewBox="0 0 72 72">
          <circle cx="36" cy="36" :r="R" fill="none" stroke="#e2eef1" stroke-width="7" />
          <circle cx="36" cy="36" :r="R" fill="none" :stroke="`url(#${gid})`" stroke-width="7" stroke-linecap="round" :stroke-dasharray="dash" transform="rotate(-90 36 36)" />
        </svg>
        <span>{{ doneCount }}/{{ total }}<small>完了</small></span>
      </span>
      <span class="ht-tx">
        <span class="ht-tt">今日のやること<i>すべて見る ›</i></span>
        <span v-for="p in preview" :key="p.t.id" :class="['ht-ln', { late: p.late, mine: isAssignedToMe(p.t) }]">
          <em>{{ p.tag }}</em><span>{{ p.t.text }}<template v-if="isAssignedToMe(p.t)">（あなた）</template></span>
        </span>
        <span v-if="!preview.length" class="ht-ln none">{{ total ? 'ぜんぶ終わりました' : '今日のやることはありません' }}</span>
      </span>
    </button>

    <button type="button" :class="['ht-talk', { unread: unreadHandoffs.length }]" aria-label="連絡を開く" @click="talkOpen = true">
      <span class="ht-talk-h">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1.1-4.6A8 8 0 1 1 21 12z" /></svg>
        <b>連絡</b>
        <em v-if="unreadHandoffs.length">未読 {{ unreadHandoffs.length }}</em>
        <i>›</i>
      </span>
      <span v-for="h in talkPreview" :key="h.id" class="ht-talk-m">
        <span class="av">{{ (h.by || '?').slice(0, 1) }}</span>
        <span class="tx"><small>{{ h.by }} ・ {{ _hmAgo(h.createdAt) }}</small>{{ h.body }}</span>
      </span>
      <span v-if="!talkPreview.length" class="ht-talk-none">まだありません</span>
    </button>
    <TalkPage v-if="talkOpen" @close="talkOpen = false" />

    <LiveSessionCard v-if="activeSession" kind="stock" :session="activeSession" :live="live" :count="stockCount" @resume="s => emit('resume', s)" />
    <LiveSessionCard v-if="activeOrderSession" kind="order" :session="activeOrderSession" :live="liveOrder" :count="orderCount" @resume="s => emit('resume', s)" />

    <div class="ht-sec">ショートカット</div>
    <div class="ht-grid">
      <button
        v-for="s in shortcuts" :key="s.key" type="button" :class="['ht-sc', { hot: s.hot, ord: s.ord }]"
        :disabled="(s.key === 'stock' && startingKind === 'stock') || (s.key === 'order' && startingKind === 'order')"
        @click="onShortcut(s.key)"
      >
        <span v-if="s.badge" :class="['ht-bd', s.badge.kind]">{{ s.badge.text }}</span>
        <span class="ht-ic" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path v-for="d in s.d" :key="d" :d="d" /></svg>
        </span>
        <b>{{ s.label }}</b><small>{{ s.sub }}</small>
      </button>
    </div>
  </div>
</template>

<style scoped>
.ht { padding-bottom: 24px; }
.ht-hero { position: relative; min-height: 236px; padding: 16px 18px 76px; color: #e6fbff; overflow: hidden;
  background: radial-gradient(120% 90% at 85% 10%, #0f4c5c 0%, #0a3340 45%, #06222b 100%); }
.ht-ring { position: absolute; right: -80px; top: 40px; opacity: .9; pointer-events: none; }
.ht-glow { position: absolute; right: 10px; top: 30px; width: 140px; height: 140px; border-radius: 50%; background: radial-gradient(circle, rgba(34,211,238,.35), transparent 70%); filter: blur(6px); pointer-events: none;
  animation: ht-breathe 5s ease-in-out infinite; }
/* 上部のイメージの動き（アイコンの光る輪）。動きを減らす設定の端末では止める */
.ht-spark { stroke-dasharray: 7 93; animation: ht-orbit 6s linear infinite; opacity: .9; }
.ht-spark.core { opacity: 1; }
.ht-card { transform-box: fill-box; transform-origin: center; animation: ht-float 4.8s ease-in-out infinite; }
.ht-card.c2 { animation-delay: -1.6s; }
.ht-card.c3 { animation-delay: -3.2s; }
@keyframes ht-orbit { from { stroke-dashoffset: 100; } to { stroke-dashoffset: 0; } }
@keyframes ht-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
@keyframes ht-breathe { 0%, 100% { opacity: .75; transform: scale(1); } 50% { opacity: 1; transform: scale(1.12); } }
@media (prefers-reduced-motion: reduce) {
  .ht-spark, .ht-card, .ht-glow { animation: none; }
  .ht-spark { display: none; }
}
.ht-top { position: relative; display: flex; align-items: center; gap: 8px; }
.ht-brand { font-weight: 900; letter-spacing: .08em; font-size: 15px; }
.ht-store { font-size: 11px; font-weight: 700; padding: 3px 9px; border-radius: 999px; background: rgba(255,255,255,.1); border: 1px solid rgba(255,255,255,.18); max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ht-hi { position: relative; margin-top: 24px; }
.ht-hi small { display: block; font-size: 12px; color: #9fd8e3; letter-spacing: .04em; }
.ht-hi b { display: block; font-size: 23px; font-weight: 800; margin-top: 4px; letter-spacing: .02em; line-height: 1.35; }
.ht-wx { display: inline-block; margin-top: 8px; font-size: 12px; color: #bfeaf2; }

.ht-talk { position: relative; z-index: 1; width: calc(100% - 28px); margin: 12px 14px 0; border: 2px solid transparent; border-radius: 20px; background: var(--surface); box-shadow: 0 8px 22px rgba(6,34,43,.1); padding: 12px 14px; display: grid; gap: 8px; text-align: left; font: inherit; color: var(--text); cursor: pointer; }
.ht-talk.unread { border-color: #f2c94c; }
.ht-talk-h { display: flex; align-items: center; gap: 8px; color: #b7791f; }
.ht-talk-h b { flex: 1; font-size: 15px; color: var(--text); }
.ht-talk-h em { font-style: normal; font-size: 11.5px; font-weight: 900; color: #fff; background: #d9480f; border-radius: 999px; padding: 2px 9px; }
.ht-talk-h i { font-style: normal; color: var(--primary, #0e7490); font-weight: 800; }
.ht-talk-m { display: flex; gap: 10px; align-items: flex-start; }
.ht-talk-m .av { flex: none; width: 28px; height: 28px; border-radius: 50%; background: #b45309; color: #fff; display: grid; place-items: center; font-size: 12px; font-weight: 900; }
.ht-talk-m .tx { display: grid; gap: 1px; min-width: 0; font-size: 13.5px; font-weight: 700; line-height: 1.45; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; }
.ht-talk-m .tx small { display: block; font-size: 11px; font-weight: 800; color: var(--text-muted); }
.ht-talk-none { font-size: 12.5px; font-weight: 700; color: var(--text-muted); }
.ht-today { position: relative; z-index: 1; width: calc(100% - 28px); margin: -64px 14px 0; border: none; text-align: left; font: inherit; color: var(--text);
  background: rgba(255,255,255,.97); border-radius: 20px; padding: 14px; box-shadow: 0 10px 28px rgba(6,34,43,.18); display: flex; gap: 14px; align-items: center; cursor: pointer; }
.ht-pr { flex: none; position: relative; width: 72px; height: 72px; }
.ht-pr > span { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; font-weight: 900; font-size: 17px; line-height: 1.1; }
.ht-pr small { font-size: 9.5px; color: var(--text-muted); font-weight: 700; }
.ht-tx { flex: 1; min-width: 0; display: grid; gap: 4px; }
.ht-tt { font-size: 13px; font-weight: 800; color: var(--text-muted); display: flex; justify-content: space-between; gap: 6px; }
.ht-tt i { font-style: normal; color: var(--primary); white-space: nowrap; }
.ht-ln { font-size: 13px; display: flex; gap: 6px; align-items: baseline; min-width: 0; }
.ht-ln > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ht-ln em { font-style: normal; font-weight: 800; font-size: 11px; flex: none; color: var(--primary); }
.ht-ln.late em { color: #b91c1c; }
.ht-ln.mine > span { color: var(--primary); font-weight: 800; }
.ht-ln.none { color: var(--text-muted); }


.ht-sec { margin: 16px 18px 8px; font-size: 11px; font-weight: 800; letter-spacing: .1em; color: var(--text-muted); }
.ht-grid { margin: 0 14px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.ht-sc { position: relative; border: none; font: inherit; color: var(--text); background: var(--surface); border-radius: 18px; padding: 14px 4px 11px; text-align: center; box-shadow: 0 1px 4px rgba(0,0,0,.05); cursor: pointer; min-width: 0; }
.ht-sc:disabled { opacity: .6; }
.ht-ic { width: 44px; height: 44px; margin: 0 auto 7px; border-radius: 14px; display: grid; place-items: center; color: var(--primary); background: linear-gradient(145deg, #ecfeff, #e0f2fe); }
.ht-sc.hot .ht-ic { color: #fff; background: linear-gradient(145deg, #0e7490, #0b3b48); box-shadow: 0 0 0 2px rgba(34,211,238,.35), 0 6px 14px rgba(14,116,144,.35); }
.ht-sc.ord .ht-ic { color: #c2410c; background: linear-gradient(145deg, #fff7ed, #ffedd5); }
.ht-sc b { font-size: 12.5px; display: block; }
.ht-sc small { display: block; font-size: 10px; color: var(--text-muted); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ht-bd { position: absolute; top: 8px; right: 8px; font-size: 9.5px; font-weight: 800; border-radius: 999px; padding: 1px 6px; }
.ht-bd.red { background: #fee2e2; color: #b91c1c; }
.ht-bd.cy { background: #cffafe; color: var(--primary-deep); }
.ht-bd.or { background: #ffedd5; color: #c2410c; }
</style>
