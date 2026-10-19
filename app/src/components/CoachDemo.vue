<script setup>
/**
 * 操作のお手本（User決定 2026-10-17）。小さな「お手本の画面」を数秒で1周させて、操作の流れを見せる。
 * 実物の画面の上に指を重ねる方式は、画面の大きさや状態でずれやすいので使わない。
 * - 初めてその機能を使ったときに1回だけ出す（id ごと・端末ごと。useHints の記憶）。
 *   閉じたあとは、その画面の「？」から open() でいつでも見直せる。各種設定の「消した説明を戻す」で全部もう一度出る
 * - 場面ごとに台本（steps の説明）と、#scene の差し込み口（step 番号でお手本の画面を描く）だけを書けば、どこにでも置ける
 */
import { ref, onMounted, onUnmounted } from 'vue'
import { isHintShown, dismissHint } from '../composables/useHints.js'

const props = defineProps({
  id:       { type: String, required: true },
  title:    { type: String, required: true },
  steps:    { type: Array,  required: true },   // [{ caption }]
  interval: { type: Number, default: 2200 },
  auto:     { type: Boolean, default: true },   // 初めてのとき自動で出す
})
const visible = ref(false)
const step = ref(0)
let timer = null
function _tick() { step.value = (step.value + 1) % props.steps.length }
function open() {
  step.value = 0
  visible.value = true
  clearInterval(timer)
  timer = setInterval(_tick, props.interval)
}
function close() {
  visible.value = false
  clearInterval(timer)
  dismissHint(props.id)
}
function go(i) { step.value = i; clearInterval(timer); timer = setInterval(_tick, props.interval) }
onMounted(() => { if (props.auto && isHintShown(props.id)) open() })
onUnmounted(() => clearInterval(timer))
defineExpose({ open })
</script>

<template>
  <div v-if="visible" class="cd-back" @click.self="close">
    <div class="cd" role="dialog" aria-modal="true" :aria-label="title">
      <div class="cd-title">{{ title }}</div>
      <div class="cd-scene" aria-hidden="true"><slot name="scene" :step="step" /></div>
      <p class="cd-cap" aria-live="polite"><b>{{ step + 1 }}</b>{{ steps[step]?.caption }}</p>
      <div class="cd-dots">
        <button v-for="(s, i) in steps" :key="i" type="button" :class="{ on: i === step }" :aria-label="`${i + 1}つめ`" @click="go(i)"></button>
      </div>
      <button type="button" class="cd-go" @click="close">やってみる</button>
    </div>
  </div>
</template>

<style scoped>
.cd-back { position: fixed; inset: 0; z-index: 120; background: rgba(15, 23, 42, .55); display: grid; place-items: center; padding: 16px; }
.cd { width: 100%; max-width: 360px; background: #fff; border-radius: 18px; padding: 16px; display: grid; gap: 12px; box-shadow: 0 16px 40px rgba(0, 0, 0, .3); }
.cd-title { font-size: 16px; font-weight: 900; color: var(--text, #12303a); text-align: center; }
.cd-scene { background: var(--bg, #edf5f7); border-radius: 14px; padding: 12px; min-height: 210px; position: relative; overflow: hidden; }
.cd-cap { margin: 0; min-height: 3em; font-size: 14px; font-weight: 700; color: var(--text, #12303a); line-height: 1.5; display: flex; gap: 8px; align-items: flex-start; }
.cd-cap b { flex: none; width: 22px; height: 22px; border-radius: 50%; background: var(--primary, #0e7490); color: #fff; font-size: 12px; display: grid; place-items: center; }
.cd-dots { display: flex; justify-content: center; gap: 6px; }
.cd-dots button { width: 8px; height: 8px; padding: 0; border-radius: 50%; border: none; background: #cbd5e1; cursor: pointer; }
.cd-dots button.on { background: var(--primary, #0e7490); width: 18px; border-radius: 9px; }
.cd-go { min-height: 46px; border: none; border-radius: 12px; background: var(--primary, #0e7490); color: #fff; font-size: 15px; font-weight: 900; cursor: pointer; }
</style>
