<script setup>
/**
 * アプリの印（アイコンの光る輪と重なったカード）。見出しの名前の横に置く。
 * 同じ画面に複数あってもグラデーションの id がぶつからないよう、置くたびに id を変える。
 */
defineProps({ size: { type: Number, default: 28 } })
const gid = `appmark-${Math.random().toString(36).slice(2, 9)}`
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 40 40" aria-hidden="true" class="appmark">
    <defs>
      <linearGradient :id="gid" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#2563eb" /><stop offset=".55" stop-color="#22d3ee" /><stop offset="1" stop-color="#34d399" />
      </linearGradient>
    </defs>
    <rect x="15" y="12.5" width="9" height="13" rx="2" transform="skewY(-14) translate(0 4.5)" fill="#cffafe" stroke="#0e7490" stroke-width="1.4" />
    <ellipse cx="20" cy="20" rx="16" ry="10" transform="rotate(-18 20 20)" fill="none" :stroke="`url(#${gid})`" stroke-width="3.4" stroke-linecap="round" />
  </svg>
</template>

<style scoped>
.appmark { flex: none; display: block; filter: drop-shadow(0 0 3px rgba(34, 211, 238, .45)); }
</style>
