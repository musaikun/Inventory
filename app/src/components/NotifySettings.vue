<script setup>
/**
 * 通知の設定（設定タブ・User決定 2026-10-05 → 2026-10-16）。
 * - 「この端末で通知を受け取る」1つだけ。ONにしたら全部届く（種類・日数・時刻は選ばない）
 * - 日付で知らせる通知は、その人がいつも最初にアプリを開く時刻ごろ（サーバーが開いた記録から決める）。発注の締切は1時間前
 * - ONにできないときは理由を出す（端末で通知がブロック・ブラウザが対応していない・サーバーの準備がない）
 */
import { ref, computed } from 'vue'
import {
  pushSubscribed, pushLoading, pushSupported, pushError,
  subscribePush, unsubscribePush, sendTestPush, isIosBrowserTab, isPushBlocked,
} from '../composables/usePush.js'
import { NOTIFY_LIST } from '../services/notifyPrefs.js'

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
const testMsg = ref('')
async function onTest() {
  testMsg.value = '送っています…'
  const r = await sendTestPush()
  testMsg.value = r === '' ? '送りました。数秒で届きます' : r
}
</script>

<template>
  <div class="ns">
    <div class="ns-master">
      <div class="ns-row">
        <div class="ns-t"><b>この端末で通知を受け取る</b><small>端末ごとの設定です</small></div>
        <button
          type="button" class="ns-sw" role="switch" :aria-checked="pushSubscribed ? 'true' : 'false'"
          aria-label="この端末で通知を受け取る" :disabled="!canToggle" @click="toggleMaster"
        ></button>
      </div>
      <p v-if="reason" class="ns-state warn" role="status">{{ reason }}</p>
      <p v-else class="ns-state" role="status">{{ pushLoading ? '設定しています…' : pushSubscribed ? 'この端末で受け取ります' : 'この端末では受け取りません' }}</p>
    </div>

    <div :class="['ns-body', { dim: !pushSubscribed }]">
      <p class="ns-lead">ONにすると、次のことを全部お知らせします</p>
      <div v-for="g in NOTIFY_LIST" :key="g.group" class="ns-item">
        <div class="ns-gh">{{ g.group }}</div>
        <ul class="ns-list"><li v-for="t in g.items" :key="t">{{ t }}</li></ul>
      </div>
      <p class="ns-lead">日付でお知らせするもの（月末・やることの日など）は、あなたがいつもアプリを最初に開く時刻ごろに届きます（使い始めは9時）。</p>
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
.ns-lead { margin: 0; padding: 0 4px; font-size: 12px; color: var(--text-muted, #4c6a72); line-height: 1.6; }
.ns-list { margin: 0; padding-left: 1.2em; display: grid; gap: 4px; font-size: 13px; color: var(--text, #12303a); line-height: 1.5; }
.ns-gh { font-size: 11.5px; font-weight: 800; color: var(--text-muted, #4c6a72); letter-spacing: .06em; }
.ns-item { display: grid; gap: 6px; padding: 12px 14px; background: var(--surface, #fff); border: 1px solid var(--border, #d6e6ea); border-radius: 14px; }
.ns-test { margin-top: 6px; min-height: 44px; border: 1px solid var(--primary-border, #a5f3fc); border-radius: 12px; background: var(--primary-weak, #ecfeff); color: var(--primary, #0e7490); font-size: 14px; font-weight: 800; cursor: pointer; }
.ns-test-msg { margin: 0; font-size: 12.5px; color: var(--text-muted, #4c6a72); text-align: center; }
@media (prefers-reduced-motion: reduce) { .ns-sw, .ns-sw::after { transition: none; } }
</style>
