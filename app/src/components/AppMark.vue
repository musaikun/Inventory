<script setup>
/**
 * アプリの印（アイコンの光る輪）。見出しの名前の横に置く。
 * ホームの上部と在庫タブの見出しで同じ形にする（User 2026-11-28。以前は在庫タブだけ重なったカード付き・光のにじみ付き）。
 * 同じ画面に複数あってもグラデーションの id がぶつからないよう、置くたびに id を変える。
 */
defineProps({ size: { type: Number, default: 24 } })
const gid = `appmark-${Math.random().toString(36).slice(2, 9)}`
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 40 40" aria-hidden="true" class="appmark">
    <defs>
      <linearGradient :id="gid" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#2563eb" /><stop offset=".55" stop-color="#22d3ee" /><stop offset="1" stop-color="#34d399" />
      </linearGradient>
    </defs>
    <ellipse cx="20" cy="20" rx="16" ry="10" transform="rotate(-18 20 20)" fill="none" :stroke="`url(#${gid})`" stroke-width="3.4" />
  </svg>
</template>

<style scoped>
.appmark { flex: none; display: block; }
</style>
