<script setup>
/**
 * 設定の画面（ホームのショートカット「設定」から開く・User決定 2026-11-27）。
 * 以前は下部ナビの「設定」タブ。設定は毎日開く画面ではなく、ホームのショートカットにも同じ入口があったので
 * タブをやめ、ホームの上に重ねて開く画面にした。中身（各種設定・この端末・ログアウト・品目の一括削除）は前と同じで、
 * SessionListPage がスロットで渡す。戻る・Escape で閉じる（モーダルの層に積む＝下部ナビは隠れる）。
 */
import { useEscapeKey } from '../composables/useEscapeKey.js'

const emit = defineEmits(['close'])
useEscapeKey(() => emit('close'))
</script>

<template>
  <div class="stp" role="dialog" aria-label="設定">
    <header class="stp-h">
      <button type="button" class="stp-back" @click="emit('close')">‹ 戻る</button>
      <span class="stp-t">設定</span>
      <span class="stp-sp" aria-hidden="true"></span>
    </header>
    <div class="stp-body"><slot /></div>
  </div>
</template>

<style scoped>
/* 設定から開くシート（発注日・定期・チェック表・確認など）は z-index 50 以上。それより下に置く */
.stp { position: fixed; inset: 0; z-index: 45; display: flex; flex-direction: column; background: var(--bg, #edf5f7); }
.stp-h {
  flex: none; display: flex; align-items: center; gap: 8px; padding: 12px 14px;
  padding-top: calc(12px + env(safe-area-inset-top, 0px));
  background: #fff; border-bottom: 1px solid #d6e6ea;
}
.stp-back { border: none; background: none; color: var(--primary, #0e7490); font-size: 14px; font-weight: 700; cursor: pointer; padding: 4px 2px; font-family: inherit; }
.stp-back, .stp-sp { width: 64px; text-align: left; }
/* 見出しはレポートの画面と同じく真ん中に */
.stp-t { flex: 1; text-align: center; font-size: 16px; font-weight: 800; color: #12303a; }
.stp-body { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding-bottom: calc(16px + env(safe-area-inset-bottom, 0px)); }
</style>
