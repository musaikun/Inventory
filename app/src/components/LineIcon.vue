<script setup>
/**
 * 線のアイコン（User決定 2026-11-05: 絵文字のアイコンはやめて、全部ラインアイコンに）。
 * 形は Lucide（ISC ライセンス・lucide-vue-next）。色は文字の色（currentColor）、大きさは文字に合わせる（1.15em）。
 * 使い方: <LineIcon name="clipboard" />。名前は下の ICONS のキー
 */
import { computed } from 'vue'
import { ICONS } from '../utils/lineIcons.js'

const props = defineProps({
  name: { type: String, required: true },
  size: { type: [String, Number], default: '1.15em' },
  stroke: { type: [String, Number], default: 2 },
})
const comp = computed(() => ICONS[props.name] ?? null)
</script>

<template>
  <component :is="comp" v-if="comp" class="li-ic" :size="size" :stroke-width="stroke" aria-hidden="true" focusable="false" />
</template>

<style scoped>
.li-ic { display: inline-block; vertical-align: -0.2em; flex: none; }
</style>
