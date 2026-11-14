<script setup>
/**
 * 発注を終えるとき、発注数を決めていない品目をまとめて「発注なし（0）」にしてよいか訊く
 * （訊くこと自体は User決定 2026-10-19）。ブラウザ標準の確認は3品目までしか名前を出せず、
 * どれが 0 になるのかを見ずに押すしかなかったので、全部を見せるシートにした（User 2026-11-14）。
 */
import { onUnmounted } from 'vue'
import { useEscapeKey } from '../composables/useEscapeKey.js'
import { registerInnerLayerCloser } from '../composables/appMenuState.js'

defineProps({
  items:      { type: Array,   required: true },   // 発注数が未入力の品目名
  stockOnly:  { type: Array,   default: () => [] }, // そのうち在庫だけ入れた品目名
  closesRoom: { type: Boolean, default: false },    // ホスト: 完了でルームを閉じる
})
const emit = defineEmits(['ok', 'cancel'])
useEscapeKey(() => emit('cancel'))
onUnmounted(registerInnerLayerCloser(() => { emit('cancel'); return true }))
</script>

<template>
  <Teleport to="body">
    <div class="modal-overlay" @click.self="emit('cancel')">
      <div class="modal-sheet ou" role="dialog" aria-modal="true" aria-label="発注数が未入力の品目">
        <div class="ou-title">発注数が未入力の品目が {{ items.length }}件 あります</div>
        <p class="ou-note">
          このまま終えると、下の品目は<b>発注なし（0）</b>で保存します。<template v-if="stockOnly.length">うち在庫だけ入力 {{ stockOnly.length }}件。</template>
        </p>
        <ul class="ou-list">
          <li v-for="n in items" :key="n">{{ n }}<small v-if="stockOnly.includes(n)">在庫だけ入力</small></li>
        </ul>
        <p v-if="closesRoom" class="ou-note">ゲストへ完了通知を送り、ルームを閉じます。</p>
        <div class="ou-acts">
          <button type="button" class="ou-btn sec" @click="emit('cancel')">戻って入れる</button>
          <button type="button" class="ou-btn pri" @click="emit('ok')">発注なしで完了</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.ou { max-height: 86vh; display: flex; flex-direction: column; gap: 10px; }
.ou-title { font-size: 17px; font-weight: 800; color: var(--text, #12303a); }
.ou-note { margin: 0; font-size: 13px; line-height: 1.6; color: var(--text-muted, #4c6a72); }
.ou-note b { color: var(--text, #12303a); }
.ou-list { list-style: none; margin: 0; padding: 4px 12px; flex: 1; min-height: 0; overflow-y: auto; border: 1px solid var(--border, #d6e6ea); border-radius: 14px; background: var(--bg, #f6fafb); }
.ou-list li { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; padding: 9px 0; font-size: 14.5px; font-weight: 700; color: var(--text, #12303a); border-bottom: 1px solid var(--border, #d6e6ea); }
.ou-list li:last-child { border-bottom: none; }
.ou-list li small { font-size: 11.5px; font-weight: 700; color: #b45309; white-space: nowrap; }
.ou-acts { display: flex; gap: 8px; }
.ou-btn { flex: 1; min-height: 48px; border-radius: 12px; font-size: 15px; font-weight: 800; cursor: pointer; }
.ou-btn.pri { border: none; background: #ea580c; color: #fff; }
.ou-btn.sec { border: 1px solid var(--border, #d6e6ea); background: var(--surface, #fff); color: var(--text, #12303a); }
</style>
