<script setup>
defineProps({
  isListening:    Boolean,
  continuousMode: { type: Boolean, default: false },
})
defineEmits(['toggle'])
</script>

<template>
  <button
    class="voice-btn"
    :class="{
      listening:  isListening,
      waiting:    continuousMode && !isListening,
    }"
    @click="$emit('toggle')"
  >
    <span class="mic">🎤</span>
    <span class="label">
      <template v-if="!continuousMode">タップして開始</template>
      <template v-else-if="isListening">聞いています…</template>
      <template v-else>待機中…</template>
    </span>
    <span v-if="continuousMode" class="stop-hint">タップで停止</span>
  </button>
</template>

<style scoped>
.voice-btn {
  width: 130px;
  height: 130px;
  border-radius: 50%;
  background: var(--primary);
  color: white;
  border: none;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  box-shadow: 0 6px 24px rgba(37,99,235,0.35);
  transition: background 0.2s, box-shadow 0.2s, transform 0.15s;
  user-select: none;
  -webkit-user-select: none;
  -webkit-tap-highlight-color: transparent;
}

.voice-btn:active { transform: scale(0.95); }

/* 音声認識中: 赤パルス */
.voice-btn.listening {
  background: var(--danger);
  animation: pulse 1.4s ease-in-out infinite;
  box-shadow: 0 6px 24px rgba(220,38,38,0.4);
}

/* 連続モード待機中: やや暗めの赤 */
.voice-btn.waiting {
  background: #b91c1c;
  animation: pulse-idle 2s ease-in-out infinite;
  box-shadow: 0 6px 24px rgba(185,28,28,0.3);
}

@keyframes pulse {
  0%, 100% { box-shadow: 0 6px 24px rgba(220,38,38,0.3); }
  50%       { box-shadow: 0 6px 40px rgba(220,38,38,0.65); }
}

@keyframes pulse-idle {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.65; }
}

.mic       { font-size: 42px; line-height: 1; }
.label     { font-size: 12px; font-weight: 600; text-align: center; padding: 0 8px; }
.stop-hint { font-size: 10px; opacity: 0.75; }
</style>
