<script setup>
// 読み込み中の共通表示。文字だけだと「止まっているのか待てばいいのか」が読めないので、
// 動きのあるリングを添える。文字は読み上げ向けにも残す（aria-label）。
//
// inline: ボタンの中など、すでに文字が並んでいる場所へ差し込むとき。
//         リングだけを小さく出し、文字は呼び出し側が持つ。
defineProps({
  label:  { type: String,  default: '読み込み中' },
  size:   { type: String,  default: 'md' },   // 'sm' | 'md'
  inline: { type: Boolean, default: false },
})
</script>

<template>
  <span class="ld" :class="[size, { inline }]" role="status" :aria-label="label">
    <span class="ld-ring" aria-hidden="true"></span>
    <span v-if="!inline && label" class="ld-label">{{ label }}</span>
  </span>
</template>

<style scoped>
.ld {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 18px 12px;
  color: var(--text-muted, #94a3b8);
  font-size: 13px;
}
.ld.inline { display: inline-flex; padding: 0; gap: 0; vertical-align: middle; margin-right: 7px; }

.ld-ring {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border: 2.5px solid var(--primary-border, #bfdbfe);
  border-top-color: var(--primary, #2563eb);
  border-radius: 50%;
  animation: ld-spin 0.8s linear infinite;
}
.ld.sm .ld-ring { width: 15px; height: 15px; border-width: 2px; }
/* ボタンの中では、そのボタンの文字色に合わせる（青いボタンの上で青いリングは見えない） */
.ld.inline .ld-ring {
  border-color: currentColor;
  border-top-color: transparent;
  opacity: 0.85;
}

.ld-label { font-weight: 600; }

@keyframes ld-spin { to { transform: rotate(360deg); } }

/* 回転を止める指定でも「待っている」ことは伝える必要がある。回さずに明滅させる。 */
@media (prefers-reduced-motion: reduce) {
  .ld-ring { animation: ld-blink 1.4s ease-in-out infinite; }
  @keyframes ld-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
}
</style>
