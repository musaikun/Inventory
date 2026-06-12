<script setup>
const emit = defineEmits(['digit', 'dot', 'backspace', 'clear'])

const rows = [
  ['7', '8', '9'],
  ['4', '5', '6'],
  ['1', '2', '3'],
  ['C', '.', '0', '⌫'],
]

function press(key) {
  if      (key === '⌫') emit('backspace')
  else if (key === 'C') emit('clear')
  else if (key === '.') emit('dot')
  else                  emit('digit', key)
}
</script>

<template>
  <div class="numpad">
    <div v-for="(row, ri) in rows" :key="ri" class="numpad-row">
      <button
        v-for="key in row"
        :key="key"
        :class="['numpad-btn', { 'is-del': key === '⌫', 'is-dot': key === '.', 'is-clear': key === 'C' }]"
        @click="press(key)"
        type="button"
      >{{ key }}</button>
    </div>
  </div>
</template>

<style scoped>
.numpad {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 8px 0 4px;
}

.numpad-row {
  display: flex;
  gap: 6px;
}

.numpad-btn {
  flex: 1;
  height: 54px;
  font-size: 22px;
  font-weight: 600;
  border: 1.5px solid var(--border);
  border-radius: 12px;
  background: #f8fafc;
  color: var(--text);
  cursor: pointer;
  transition: background 0.1s, transform 0.08s;
  display: flex;
  align-items: center;
  justify-content: center;
  -webkit-tap-highlight-color: transparent;
  user-select: none;
}

.numpad-btn:active {
  background: #e2e8f0;
  transform: scale(0.95);
}

.is-del {
  background: #fef2f2;
  color: var(--danger);
  border-color: #fecaca;
  font-size: 20px;
}

.is-clear {
  background: #fff7ed;
  color: #d97706;
  border-color: #fed7aa;
  font-size: 16px;
  font-weight: 800;
  letter-spacing: 0.02em;
}

.is-dot {
  font-size: 28px;
  font-weight: 800;
  line-height: 1;
}
</style>
