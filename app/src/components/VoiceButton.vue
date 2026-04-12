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
    :class="{ listening: isListening, continuous: continuousMode }"
    @click="$emit('toggle')"
  >
    <span class="mic">🎤</span>
    <span class="label">
      <template v-if="continuousMode">
        {{ isListening ? '聞いています…' : '待機中' }}<br>
        <span class="sub-label">タップで停止</span>
      </template>
      <template v-else>
        {{ isListening ? '聞いています…' : 'タップして話す' }}
      </template>
    </span>
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
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  box-shadow: 0 6px 24px rgba(37,99,235,0.35);
  transition: transform 0.15s;
  user-select: none;
  -webkit-user-select: none;
  -webkit-tap-highlight-color: transparent;
}

.voice-btn:active { transform: scale(0.95); }

.voice-btn.listening {
  background: var(--danger);
  animation: pulse 1.4s ease-in-out infinite;
  box-shadow: 0 6px 24px rgba(220,38,38,0.4);
}

/* 連続モード: 待機中（赤系でやや暗め） */
.voice-btn.continuous:not(.listening) {
  background: #dc2626cc;
  box-shadow: 0 6px 24px rgba(220,38,38,0.25);
  animation: pulse-idle 2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { box-shadow: 0 6px 24px rgba(220,38,38,0.3); }
  50%       { box-shadow: 0 6px 40px rgba(220,38,38,0.65); }
}

@keyframes pulse-idle {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.7; }
}

.mic   { font-size: 42px; line-height: 1; }
.label { font-size: 12px; text-align: center; padding: 0 8px; line-height: 1.4; }
.sub-label { font-size: 10px; opacity: 0.8; }
</style>
