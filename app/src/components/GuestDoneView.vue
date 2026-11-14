<script setup>
/**
 * ホストが完了してルームが閉じたときの、ゲストの終わりの画面（User 2026-11-14）。
 * 以前は通知のあとランディング（ログイン・店舗の登録）へ戻るだけで、店に登録していない
 * アルバイトには「終わったのか・何をすればいいのか」が分からない行き止まりだった。
 */
import { onUnmounted } from 'vue'
import { useEscapeKey } from '../composables/useEscapeKey.js'
import { registerInnerLayerCloser } from '../composables/appMenuState.js'

defineProps({
  noun:  { type: String, default: '棚卸' },   // 棚卸 | 発注
  name:  { type: String, default: '' },       // 参加した名前
  count: { type: Number, default: null },     // 自分が入れた品目数（分からなければ出さない）
})
const emit = defineEmits(['close'])
useEscapeKey(() => emit('close'))
onUnmounted(registerInnerLayerCloser(() => { emit('close'); return true }))
</script>

<template>
  <Teleport to="body">
    <div class="gd" role="dialog" aria-modal="true" :aria-label="`${noun}が完了しました`">
      <div class="gd-card">
        <span class="gd-ic" aria-hidden="true"><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg></span>
        <div class="gd-title">お疲れさまでした</div>
        <p class="gd-text">{{ name ? `${name}さん、` : '' }}{{ noun }}は完了しました。<br>ホストがルームを閉じました。</p>
        <div v-if="count" class="gd-count"><b>{{ count }}</b>品目を入れました</div>
        <p class="gd-note">入れた数はすべて保存されています。この画面は閉じて大丈夫です。</p>
        <button type="button" class="gd-btn" @click="emit('close')">閉じる</button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.gd { position: fixed; inset: 0; z-index: 9400; display: grid; place-items: center; padding: 24px; background: var(--bg, #f6fafb); }
.gd-card { width: min(100%, 420px); display: grid; justify-items: center; gap: 12px; text-align: center; }
.gd-ic { width: 72px; height: 72px; border-radius: 50%; display: grid; place-items: center; background: var(--grad-btn); color: var(--on-grad); }
.gd-title { font-size: 24px; font-weight: 800; color: var(--text, #12303a); }
.gd-text { margin: 0; font-size: 15px; line-height: 1.8; color: var(--text, #12303a); }
.gd-count { padding: 10px 18px; border-radius: 14px; background: var(--surface, #fff); border: 1px solid var(--border, #d6e6ea); font-size: 14px; font-weight: 700; color: var(--text, #12303a); }
.gd-count b { font-size: 26px; font-weight: 800; color: var(--primary, #0e7490); margin-right: 6px; }
.gd-note { margin: 0; font-size: 13px; line-height: 1.7; color: var(--text-muted, #4c6a72); }
.gd-btn { margin-top: 8px; width: 100%; min-height: 52px; border-radius: 14px; border: 1px solid var(--border, #d6e6ea); background: var(--surface, #fff); color: var(--text, #12303a); font-size: 16px; font-weight: 800; cursor: pointer; }
</style>
