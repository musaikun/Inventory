<script setup>
import { ref, computed } from 'vue'
import { useConfig } from '../composables/useConfig.js'

const emit = defineEmits(['close'])
const { masterDict, config, addMasterEntry, deleteMasterEntry } = useConfig()

const newKeyword = ref('')
const newItem    = ref('')
const addMsg     = ref(null)  // null | { type, text }
const searchKw   = ref('')

// キーワード検索フィルター付きフラットリスト（キーワード昇順）
const entries = computed(() => {
  const kw = searchKw.value.trim()
  return Object.entries(masterDict)
    .sort(([a], [b]) => a.localeCompare(b, 'ja'))
    .flatMap(([keyword, items]) => items.map(item => ({ keyword, item })))
    .filter(e => !kw || e.keyword.includes(kw) || e.item.includes(kw))
})

const totalCount = computed(() =>
  Object.values(masterDict).reduce((sum, items) => sum + items.length, 0)
)

function onAdd() {
  const k = newKeyword.value.trim()
  const i = newItem.value.trim()
  if (!k || !i) {
    addMsg.value = { type: 'error', text: 'キーワードと品目名を入力してください' }
    return
  }
  addMasterEntry(k, i)
  newKeyword.value = ''
  newItem.value    = ''
  addMsg.value     = { type: 'success', text: `「${k}」→「${i}」を追加しました` }
}

function onDelete(keyword, item) {
  deleteMasterEntry(keyword, item)
}
</script>

<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-sheet">
      <div class="sheet-handle"></div>
      <div class="sheet-title">検索学習を編集</div>

      <!-- カウント -->
      <div class="count-bar">
        <span class="count-num">{{ totalCount }}</span> 件のキーワード登録
        <input
          v-model="searchKw"
          type="text"
          class="kw-search"
          placeholder="絞り込み…"
        />
      </div>

      <!-- エントリ一覧 -->
      <div class="entry-list">
        <div v-if="entries.length === 0" class="empty-msg">
          {{ totalCount === 0 ? '登録されていません' : '一致するキーワードがありません' }}
        </div>
        <div v-for="(e, i) in entries" :key="`${e.keyword}__${e.item}`" class="entry-row">
          <span class="entry-kw">{{ e.keyword }}</span>
          <span class="entry-arrow">→</span>
          <span class="entry-item">{{ e.item }}</span>
          <button class="entry-del" @click="onDelete(e.keyword, e.item)" type="button" title="削除">×</button>
        </div>
      </div>

      <!-- 追加フォーム -->
      <div class="add-section">
        <div class="add-title">新規追加</div>
        <div class="add-form">
          <div class="add-field">
            <label class="add-label">キーワード</label>
            <input
              v-model="newKeyword"
              type="text"
              class="add-input"
              placeholder="例：ミルク"
              @keyup.enter="$refs.itemInput.focus()"
            />
          </div>
          <div class="add-field">
            <label class="add-label">品目名</label>
            <input
              ref="itemInput"
              v-model="newItem"
              type="text"
              list="item-datalist"
              class="add-input"
              placeholder="例：牛乳　成分無調整…"
              @keyup.enter="onAdd"
            />
            <datalist id="item-datalist">
              <option v-for="item in config.order" :key="item" :value="item" />
            </datalist>
          </div>
        </div>
        <div v-if="addMsg" class="add-msg" :class="addMsg.type">
          {{ addMsg.type === 'success' ? '✓' : '✗' }} {{ addMsg.text }}
        </div>
        <button class="btn btn-primary add-btn" @click="onAdd" type="button">+ 追加</button>
      </div>

      <button class="btn btn-secondary close-btn" @click="$emit('close')">閉じる</button>
    </div>
  </div>
</template>

<style scoped>
.modal-sheet {
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.count-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text-muted);
  margin-bottom: 10px;
  flex-shrink: 0;
}
.count-num {
  font-size: 18px;
  font-weight: 700;
  color: var(--primary);
}
.kw-search {
  margin-left: auto;
  width: 110px;
  border: 1.5px solid var(--border);
  border-radius: 8px;
  padding: 4px 10px;
  font-size: 13px;
  outline: none;
}
.kw-search:focus { border-color: var(--primary); }

/* エントリ一覧 */
.entry-list {
  flex: 1;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 10px;
  margin-bottom: 14px;
  min-height: 80px;
  max-height: 260px;
}
.empty-msg {
  padding: 20px;
  text-align: center;
  font-size: 13px;
  color: var(--text-muted);
}
.entry-row {
  display: grid;
  grid-template-columns: minmax(60px, 100px) 20px 1fr 32px;
  align-items: center;
  padding: 7px 10px;
  border-bottom: 1px solid var(--border);
  gap: 4px;
  font-size: 13px;
}
.entry-row:last-child { border-bottom: none; }
.entry-kw {
  font-weight: 700;
  color: var(--primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.entry-arrow {
  color: var(--text-muted);
  text-align: center;
  font-size: 11px;
}
.entry-item {
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.entry-del {
  width: 26px;
  height: 26px;
  border-radius: 6px;
  border: 1.5px solid #fecaca;
  background: #fef2f2;
  color: var(--danger);
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  padding: 0;
  -webkit-tap-highlight-color: transparent;
}
.entry-del:active { background: #fee2e2; }

/* 追加フォーム */
.add-section {
  border: 1.5px solid var(--border);
  border-radius: 12px;
  padding: 12px 14px;
  margin-bottom: 12px;
  flex-shrink: 0;
}
.add-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 10px;
}
.add-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 10px;
}
.add-field {
  display: flex;
  align-items: center;
  gap: 8px;
}
.add-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  width: 72px;
  flex-shrink: 0;
}
.add-input {
  flex: 1;
  border: 1.5px solid var(--border);
  border-radius: 8px;
  padding: 7px 10px;
  font-size: 14px;
  outline: none;
  font-family: inherit;
}
.add-input:focus { border-color: var(--primary); }

.add-msg {
  font-size: 13px;
  font-weight: 600;
  padding: 6px 10px;
  border-radius: 8px;
  margin-bottom: 8px;
}
.add-msg.success { background: #f0fdf4; color: var(--success); }
.add-msg.error   { background: #fef2f2; color: var(--danger); }

.add-btn   { width: 100%; }
.close-btn { width: 100%; margin-top: 0; }
</style>
