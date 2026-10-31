<script setup>
// パスワード・暗証番号の入力欄に 👁️ を付け、入力した中身を見られるようにする。
// 入力欄は呼び出し側に置く（slot）。各画面の scoped な入力欄の見た目をそのまま使うため。
//   <PasswordReveal v-slot="{ type }"><input :type="type" ... /></PasswordReveal>
import { ref } from 'vue'

const shown = ref(false)
</script>

<template>
  <span class="pr-wrap">
    <slot :type="shown ? 'text' : 'password'" />
    <button
      type="button"
      class="pr-eye"
      :aria-label="shown ? '入力した内容を隠す' : '入力した内容を表示する'"
      :aria-pressed="shown"
      @click="shown = !shown"
    >{{ shown ? '🙈' : '👁️' }}</button>
  </span>
</template>

<style scoped>
.pr-wrap { position: relative; display: block; }
.pr-wrap :slotted(input) { padding-right: 48px; }
.pr-eye {
  position: absolute; top: 0; right: 0; bottom: 0; width: 44px;
  display: flex; align-items: center; justify-content: center;
  border: 0; background: transparent; font-size: 18px; line-height: 1;
  cursor: pointer; -webkit-tap-highlight-color: transparent;
}
</style>
