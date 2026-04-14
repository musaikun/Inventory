<script setup>
import { computed, onMounted, onUnmounted } from 'vue'
import { useConfig } from '../composables/useConfig.js'

const props = defineProps({
  searchTerm: { type: String, default: '' },
  matched:    { type: Array,  default: () => [] },
  qty:        { type: Number, default: null },
  unit:       { type: String, default: '' },
})

const emit = defineEmits(['select', 'cancel'])

function handleKeydown(e) {
  if (e.key === 'Escape') { e.preventDefault(); emit('cancel') }
}

onMounted(()   => document.addEventListener('keydown', handleKeydown))
onUnmounted(() => document.removeEventListener('keydown', handleKeydown))

const { config } = useConfig()

// 一致しなかった残り品目（一致分を除いた全品目）
const otherItems = computed(() =>
  config.order.filter(item => !props.matched.includes(item))
)

const hasQty        = computed(() => props.qty !== null)
const qtyLabel      = computed(() => hasQty.value ? `${props.qty}${props.unit}` : '')
const hasMatch      = computed(() => props.matched.length > 0)
const noMatchNotice = computed(() => props.searchTerm && !hasMatch.value)
</script>

<template>
  <div class="modal-overlay" @click.self="$emit('cancel')">
    <div class="modal-sheet">
      <div class="sheet-handle"></div>

      <!-- 検索ヘッダー -->
      <div class="search-header">
        <div class="search-label">
          <span v-if="searchTerm" class="search-term">「{{ searchTerm }}」</span>
          <span v-else class="search-term-empty">品目を選択してください</span>
        </div>
        <div v-if="hasQty" class="qty-preset">
          数量プリセット：<strong>{{ qtyLabel }}</strong>
        </div>
      </div>

      <!-- 一致なし通知 -->
      <div v-if="noMatchNotice" class="no-match-notice">
        辞書に一致する品目がありません。下の一覧から選択してください。
      </div>

      <div class="item-list">

        <!-- 一致した候補（ハイライト） -->
        <template v-if="hasMatch">
          <div class="section-label match-label">一致</div>
          <button
            v-for="item in matched"
            :key="item"
            class="item item-matched"
            @click="$emit('select', item)"
          >
            <span class="item-name">{{ item }}</span>
            <span v-if="hasQty" class="item-qty-badge">{{ qtyLabel }}</span>
          </button>

          <div v-if="otherItems.length" class="list-divider">── その他の品目 ──</div>
        </template>

        <!-- 全品目 or 残り品目 -->
        <button
          v-for="item in otherItems"
          :key="item"
          class="item"
          @click="$emit('select', item)"
        >
          {{ item }}
        </button>

      </div>

      <button class="btn btn-secondary cancel-btn" @click="$emit('cancel')">
        キャンセル
      </button>
    </div>
  </div>
</template>

<style scoped>
/* ── 検索ヘッダー ── */
.search-header {
  margin-bottom: 12px;
}

.search-label {
  font-size: 15px;
  font-weight: 700;
  color: var(--text);
  margin-bottom: 4px;
}

.search-term {
  color: var(--primary);
}

.search-term-empty {
  color: var(--text-muted);
}

.qty-preset {
  font-size: 13px;
  color: var(--text-muted);
  background: #f0fdf4;
  border-radius: 6px;
  padding: 5px 10px;
  display: inline-block;
}

.qty-preset strong {
  color: var(--success);
}

/* ── 一致なし ── */
.no-match-notice {
  font-size: 13px;
  color: var(--warning, #d97706);
  background: #fefce8;
  border-radius: 8px;
  padding: 8px 12px;
  margin-bottom: 10px;
}

/* ── リスト ── */
.item-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 58vh;
  overflow-y: auto;
  margin-bottom: 12px;
}

.section-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-muted);
  padding: 2px 4px;
}

.match-label { color: var(--primary); }

.item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 13px 16px;
  border: 2px solid var(--border);
  border-radius: 12px;
  background: white;
  font-size: 14px;
  line-height: 1.4;
  text-align: left;
  cursor: pointer;
  color: var(--text);
  transition: border-color 0.15s, background 0.15s;
  width: 100%;
}

.item:active {
  background: #f8fafc;
  border-color: #94a3b8;
}

/* 一致品目：青ハイライト */
.item-matched {
  border-color: var(--primary);
  background: #eff6ff;
  font-weight: 600;
}

.item-matched:active {
  background: #dbeafe;
}

.item-name { flex: 1; }

.item-qty-badge {
  font-size: 13px;
  font-weight: 700;
  color: var(--success);
  background: #f0fdf4;
  border-radius: 6px;
  padding: 2px 8px;
  margin-left: 8px;
  white-space: nowrap;
}

.list-divider {
  font-size: 12px;
  color: var(--text-muted);
  text-align: center;
  padding: 6px 0;
}

.cancel-btn { width: 100%; }
</style>
