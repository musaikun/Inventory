<script setup>
/**
 * カレンダーを初めて開いたときに一度だけ、天気を表示するか訊く（User決定 2026-10-04）。
 * 許可してもしなくても、そのあと「各種設定から変更できます」と伝え、以降は訊かない。
 * カレンダーの上には、現在地の取得ボタンを出さない（変更は各種設定の「カレンダーの天気」）。
 */
import { ref } from 'vue'
import { useWeather, weatherAsk, markWeatherAsked } from '../composables/useWeather.js'

const { state, requestGeolocation } = useWeather()
const step = ref('ask')   // 'ask' | 'done'
const busy = ref(false)
const result = ref('')    // 'on' | 'off' | 'denied'

async function allow() {
  busy.value = true
  try { await requestGeolocation(); result.value = 'on' } catch (_) { result.value = 'denied' } finally { busy.value = false }
  markWeatherAsked()
  step.value = 'done'
}
function skip() { result.value = 'off'; markWeatherAsked(); step.value = 'done' }
function close() { step.value = 'closed' }
</script>

<template>
  <div v-if="(!weatherAsk.asked && !state.loc && step === 'ask') || step === 'done'" class="modal-overlay wa-bg">
    <div class="modal-sheet wa" role="dialog" aria-modal="true" aria-label="カレンダーの天気">
      <div class="sheet-handle"></div>
      <template v-if="step === 'ask'">
        <div class="wa-ico" aria-hidden="true">🌤</div>
        <div class="wa-t">現在地の天気をカレンダーに表示できます</div>
        <p class="wa-p">日ごとの天気・気温・降水確率が出て、売れ行きや発注の振り返りに使えます。位置情報を許可しますか？</p>
        <button type="button" class="wa-btn pri" :disabled="busy" @click="allow">{{ busy ? '取得しています…' : '許可して表示する' }}</button>
        <button type="button" class="wa-btn" :disabled="busy" @click="skip">今はしない</button>
      </template>
      <template v-else>
        <div class="wa-t">{{ result === 'on' ? 'カレンダーに天気を表示します' : result === 'denied' ? '位置情報を取得できませんでした' : '天気は表示しません' }}</div>
        <p class="wa-p">あとから<b>☰ メニューの「各種設定」</b>の「カレンダーの天気」で、いつでも変更できます。</p>
        <button type="button" class="wa-btn pri" @click="close">OK</button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.wa { display: grid; gap: 10px; text-align: center; padding-bottom: 20px; }
.wa-ico { font-size: 40px; }
.wa-t { font-size: 17px; font-weight: 800; color: var(--text); text-wrap: balance; }
.wa-p { margin: 0; font-size: 13px; color: var(--text-muted); line-height: 1.7; }
.wa-p b { color: var(--text); }
.wa-btn { min-height: 48px; border-radius: 12px; border: 1.5px solid var(--border); background: var(--surface); color: var(--text); font: inherit; font-size: 15px; font-weight: 800; cursor: pointer; }
.wa-btn.pri { border: none; background: var(--btn-bg); color: var(--btn-fg); }
.wa-btn:disabled { opacity: .6; cursor: default; }
</style>
