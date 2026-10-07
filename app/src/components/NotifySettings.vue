<script setup>
/**
 * 通知の設定（各種設定の中・User決定 2026-10-05）。以前の「棚卸リマインダー通知」を置き換える。
 * - 「この端末で通知を受け取る」1つで受け取る／受け取らない。中身は種類ごとに選ぶ（端末ごと）
 * - 日付で知らせる通知は選んだ時刻に届く。発注の締切は締切の○時間前（サーバーの cron は毎時）
 * - ONにできないときは理由を出す（端末で通知がブロック・ブラウザが対応していない・サーバーの準備がない）
 */
import { ref, computed } from 'vue'
import {
  pushSubscribed, pushLoading, pushSupported, pushError, pushPrefs,
  subscribePush, unsubscribePush, updatePushPrefs, sendTestPush, isIosBrowserTab, isPushBlocked,
} from '../composables/usePush.js'
import { NOTIFY_DAY_OPTIONS, ORDER_LEAD_OPTIONS, GAP_MIN, GAP_MAX, dayLabel, leadLabel } from '../services/notifyPrefs.js'

const HOURS = Array.from({ length: 18 }, (_, i) => i + 6)   // 6時〜23時
const p = computed(() => pushPrefs.value)

const reason = computed(() => {
  if (!pushSupported || isIosBrowserTab()) {
    return isIosBrowserTab()
      ? 'iPhone・iPadでは、ホーム画面に追加したタナオロから開くと通知を受け取れます'
      : 'このブラウザは通知に対応していません'
  }
  if (pushError.value === 'blocked' || (!pushSubscribed.value && isPushBlocked())) {
    return 'この端末で通知がブロックされています。ブラウザ（またはホーム画面のアプリ）のサイト設定で、タナオロの通知を「許可」にしてから、もう一度ONにしてください'
  }
  if (pushError.value === 'server') return '通知を送る準備がサーバーでまだできていません。時間をおいて、もう一度ONにしてください'
  if (pushError.value === 'timeout-permission') return '通知の許可の確認が出ませんでした。端末の設定でタナオロの通知を「許可」にしてから、もう一度ONにしてください'
  if (pushError.value === 'timeout-sw') return 'アプリの準備が終わっていませんでした。タナオロを一度閉じて開き直してから、もう一度ONにしてください'
  if (pushError.value === 'timeout-subscribe') return '端末の通知の受け付けが返ってきませんでした。時間をおいて、もう一度ONにしてください'
  if (pushError.value === 'timeout-network') return 'サーバーから返事がありませんでした。通信を確かめて、もう一度ONにしてください'
  if (pushError.value === 'failed') return '通知をONにできませんでした。通信を確かめて、もう一度ONにしてください'
  return ''
})
const canToggle = computed(() => pushSupported && !isIosBrowserTab() && !pushLoading.value)

function toggleMaster() {
  if (!canToggle.value) return
  if (pushSubscribed.value) unsubscribePush()
  else subscribePush()
}
function set(path, value) {
  const next = JSON.parse(JSON.stringify(p.value))
  const [a, b] = path.split('.')
  if (b) next[a][b] = value
  else next[a] = value
  updatePushPrefs(next)
}
function toggleIn(path, n) {
  const [a, b] = path.split('.')
  const cur = p.value[a][b]
  set(path, cur.includes(n) ? cur.filter(x => x !== n) : [...cur, n])
}
function stepGap(d) { set('gap.days', Math.min(GAP_MAX, Math.max(GAP_MIN, p.value.gap.days + d))) }

const testMsg = ref('')
async function onTest() {
  testMsg.value = '送っています…'
  const r = await sendTestPush()
  testMsg.value = r === '' ? '送りました。数秒で届きます' : r
}

const ROWS = [
  { group: '棚卸' },
  { key: 'monthEnd', title: '月末の棚卸', sub: '月末の何日前に知らせるか', days: true },
  { key: 'gap', title: 'しばらく棚卸していないとき', sub: '前回の棚卸から日数が空いたら1回だけ', gap: true },
  { key: 'stale', title: '途中のままの棚卸', sub: '始めてから1日たっても終わっていないとき' },
  { group: 'やること（カレンダー）' },
  { key: 'taskDay', title: 'やることの日', sub: 'その日の何日前に知らせるか', days: true },
  { key: 'taskAdded', title: 'だれかがやることを追加したとき', sub: '自分が追加したものは知らせない' },
  { key: 'taskAssigned', title: '自分が担当になったとき', sub: 'スタッフとしてログインしている端末だけ' },
  { group: '発注' },
  { key: 'orderDeadline', title: '発注の締切', sub: '「発注日・締切」で決めた締切の何時間前か', lead: true },
]
</script>

<template>
  <div class="ns">
    <div class="ns-master">
      <div class="ns-row">
        <div class="ns-t"><b>この端末で通知を受け取る</b><small>受け取る内容は下で選べます。端末ごとの設定です</small></div>
        <button
          type="button" class="ns-sw" role="switch" :aria-checked="pushSubscribed ? 'true' : 'false'"
          aria-label="この端末で通知を受け取る" :disabled="!canToggle" @click="toggleMaster"
        ></button>
      </div>
      <p v-if="reason" class="ns-state warn" role="status">{{ reason }}</p>
      <p v-else class="ns-state" role="status">{{ pushLoading ? '設定しています…' : pushSubscribed ? 'この端末で受け取ります' : 'この端末では受け取りません' }}</p>
    </div>

    <div :class="['ns-body', { dim: !pushSubscribed }]">
      <label class="ns-row ns-hour">
        <span class="ns-t"><b>知らせる時刻</b><small>日付で知らせる通知はこの時刻に届きます</small></span>
        <select :value="p.hour" aria-label="知らせる時刻" @change="set('hour', Number($event.target.value))">
          <option v-for="h in HOURS" :key="h" :value="h">{{ h }}:00</option>
        </select>
      </label>

      <template v-for="r in ROWS" :key="r.group || r.key">
        <div v-if="r.group" class="ns-gh">{{ r.group }}</div>
        <div v-else class="ns-item">
          <div class="ns-row">
            <div class="ns-t"><b>{{ r.title }}</b><small>{{ r.sub }}</small></div>
            <button
              type="button" class="ns-sw" role="switch" :aria-checked="p[r.key].on ? 'true' : 'false'"
              :aria-label="r.title" @click="set(`${r.key}.on`, !p[r.key].on)"
            ></button>
          </div>
          <div v-if="r.days && p[r.key].on" class="ns-chips">
            <button
              v-for="n in NOTIFY_DAY_OPTIONS" :key="n" type="button" class="ns-chip"
              :aria-pressed="p[r.key].days.includes(n) ? 'true' : 'false'" @click="toggleIn(`${r.key}.days`, n)"
            >{{ dayLabel(n) }}</button>
          </div>
          <div v-if="r.lead && p[r.key].on" class="ns-chips">
            <button
              v-for="m in ORDER_LEAD_OPTIONS" :key="m" type="button" class="ns-chip"
              :aria-pressed="p[r.key].mins.includes(m) ? 'true' : 'false'" @click="toggleIn(`${r.key}.mins`, m)"
            >{{ leadLabel(m) }}</button>
          </div>
          <div v-if="r.gap && p.gap.on" class="ns-step">
            <button type="button" aria-label="日数を減らす" @click="stepGap(-1)">−</button>
            <b>{{ p.gap.days }}</b>日空いたら
            <button type="button" aria-label="日数を増やす" @click="stepGap(1)">＋</button>
          </div>
        </div>
      </template>

      <button v-if="pushSubscribed" type="button" class="ns-test" @click="onTest">テストの通知を送る</button>
      <p v-if="testMsg" class="ns-test-msg" role="status">{{ testMsg }}</p>
    </div>
  </div>
</template>

<style scoped>
.ns { display: grid; gap: 12px; }
.ns-master { background: var(--surface, #fff); border: 1.5px solid var(--primary-border, #a5f3fc); border-radius: 14px; padding: 12px 14px; display: grid; gap: 8px; }
.ns-row { display: flex; align-items: center; gap: 12px; }
.ns-t { flex: 1; min-width: 0; }
.ns-t b { display: block; font-size: 14.5px; color: var(--text, #12303a); }
.ns-t small { display: block; color: var(--text-muted, #4c6a72); font-size: 12px; line-height: 1.5; margin-top: 2px; }
.ns-sw { flex: none; width: 50px; height: 30px; border-radius: 999px; border: none; background: #c3d3d8; position: relative; cursor: pointer; transition: background .2s; }
.ns-sw::after { content: ''; position: absolute; top: 3px; left: 3px; width: 24px; height: 24px; border-radius: 50%; background: #fff; transition: left .2s; box-shadow: 0 1px 3px rgba(0, 0, 0, .25); }
.ns-sw[aria-checked="true"] { background: var(--primary, #0e7490); }
.ns-sw[aria-checked="true"]::after { left: 23px; }
.ns-sw:disabled { opacity: .5; cursor: not-allowed; }
.ns-state { margin: 0; font-size: 12px; font-weight: 700; padding: 6px 10px; border-radius: 10px; background: var(--primary-weak, #ecfeff); color: var(--primary, #0e7490); line-height: 1.5; }
.ns-state.warn { background: #fef3c7; color: #92400e; }
.ns-body { display: grid; gap: 8px; }
.ns-body.dim { opacity: .45; pointer-events: none; }
.ns-hour { padding: 0 4px; }
.ns-hour select { min-height: 38px; border: 1px solid var(--border, #d6e6ea); border-radius: 10px; background: var(--surface, #fff); padding: 0 10px; font-size: 14px; font-weight: 700; }
.ns-gh { margin-top: 6px; padding: 0 4px; font-size: 11.5px; font-weight: 800; color: var(--text-muted, #4c6a72); letter-spacing: .06em; }
.ns-item { display: grid; gap: 10px; padding: 12px 14px; background: var(--surface, #fff); border: 1px solid var(--border, #d6e6ea); border-radius: 14px; }
.ns-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.ns-chip { min-height: 34px; padding: 0 12px; border-radius: 999px; border: 1px solid var(--border, #d6e6ea); background: var(--bg, #f6fafb); color: var(--text, #12303a); font-size: 12.5px; font-weight: 700; cursor: pointer; }
.ns-chip[aria-pressed="true"] { background: var(--primary, #0e7490); border-color: var(--primary, #0e7490); color: #fff; }
.ns-step { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-muted, #4c6a72); }
.ns-step button { width: 36px; height: 36px; border-radius: 10px; border: 1px solid var(--border, #d6e6ea); background: var(--bg, #f6fafb); font-size: 16px; font-weight: 800; cursor: pointer; }
.ns-step b { min-width: 2.5em; text-align: center; color: var(--text, #12303a); font-size: 15px; }
.ns-test { margin-top: 6px; min-height: 44px; border: 1px solid var(--primary-border, #a5f3fc); border-radius: 12px; background: var(--primary-weak, #ecfeff); color: var(--primary, #0e7490); font-size: 14px; font-weight: 800; cursor: pointer; }
.ns-test-msg { margin: 0; font-size: 12.5px; color: var(--text-muted, #4c6a72); text-align: center; }
@media (prefers-reduced-motion: reduce) { .ns-sw, .ns-sw::after { transition: none; } }
</style>
