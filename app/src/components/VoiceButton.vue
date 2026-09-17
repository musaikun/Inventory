<script setup>
// 検索欄の隣に置く小さいマイク。以前は画面中央に130pxの円で置いていたが、
// 音声も文字も「品目を探して数量を打つ」ための同じ入口なので、検索欄と同じ行へ寄せた。
// 文字が入る大きさではないので、状態は色と脈で示し、読み上げ向けには aria-label で出す。
defineProps({
  isListening:    Boolean,
  continuousMode: { type: Boolean, default: false },
})
defineEmits(['toggle'])
</script>

<template>
  <button
    type="button"
    class="voice-btn"
    :class="{
      listening:  isListening,
      waiting:    continuousMode && !isListening,
    }"
    :aria-pressed="isListening ? 'true' : 'false'"
    :aria-label="isListening ? '聞いています。タップで停止' : 'タップして話す'"
    :title="isListening ? '聞いています（タップで停止）' : 'タップして話す'"
    @click="$emit('toggle')"
  >
    <span class="mic" aria-hidden="true">🎤</span>
  </button>
</template>

<style scoped>
.voice-btn {
  width: 48px;
  height: 48px;
  flex-shrink: 0;
  border-radius: 12px;
  background: var(--primary);
  color: white;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s, box-shadow 0.2s, transform 0.15s;
  user-select: none;
  -webkit-user-select: none;
  -webkit-tap-highlight-color: transparent;
}

.voice-btn:active { transform: scale(0.94); }

/* 音声認識中: 赤パルス */
.voice-btn.listening {
  background: var(--danger);
  animation: pulse 1.4s ease-in-out infinite;
}

/* 連続モード待機中: やや暗めの赤 */
.voice-btn.waiting {
  background: #b91c1c;
  animation: pulse-idle 2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(220,38,38,0.45); }
  50%       { box-shadow: 0 0 0 7px rgba(220,38,38,0); }
}

@keyframes pulse-idle {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.65; }
}

@media (prefers-reduced-motion: reduce) {
  .voice-btn.listening, .voice-btn.waiting { animation: none; }
  .voice-btn.listening { box-shadow: 0 0 0 3px rgba(220,38,38,0.35); }
}

.mic { font-size: 22px; line-height: 1; }
</style>
