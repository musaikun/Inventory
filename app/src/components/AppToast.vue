<script setup>
// トースト（画面の上・弾むように出る）。状態と出し方は composables/useToast.js。
// 見た目（.toast / data-type / 出入りのアニメーション）は style.css の共通定義を使う。
import { toastMsg, toastType, toastShow } from '../composables/useToast.js'
</script>

<template>
  <Transition name="toast">
    <div v-if="toastShow" class="toast" :data-type="toastType">{{ toastMsg }}</div>
  </Transition>
</template>
