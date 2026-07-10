<script setup>
import { ref, computed } from 'vue'
import { useConfig } from '../composables/useConfig.js'
import { useHistory } from '../composables/useHistory.js'
import { showAxisAssign, axisAssignInitial } from '../composables/appMenuState.js'

const emit = defineEmits(['close'])

const { config, itemCount, hideItem, unhideItem } = useConfig()
const { getSnapshots } = useHistory()

const hiddenSet  = computed(() => new Set(config.hiddenItems))
const hiddenList = computed(() => [...config.hiddenItems])

// 直近N回の棚卸で「入力があった」品目（0入力も入力扱い）
const USAGE_SESSIONS = 3
const usedNames = computed(() => {
  const s = new Set()
  for (const snap of getSnapshots().slice(0, USAGE_SESSIONS)) {
    for (const it of (snap.items ?? [])) {
      if (it.qty !== null && it.qty !== undefined) s.add(it.item)
    }
  }
  return s
})
const hasHistory = computed(() => usedNames.value.size > 0)

// 使っていない候補: 直近で未入力 かつ まだ非表示でない品目
const unusedCandidates = computed(() =>
  config.order.filter(i => !hiddenSet.value.has(i) && !usedNames.value.has(i))
)

// 閲覧用の一覧
const listOpen = ref(false)
function genreOf(item) { return config.categories?.[item] || '' }
function axisTagsOf(item) {
  const a = (config.tagsA?.[item] || [])
  const b = (config.tagsB?.[item] || [])
  return [...a, ...b]
}

function launchReorder() { axisAssignInitial.value = 0; showAxisAssign.value = true; emit('close') }
function hideAllUnused() {
  if (!unusedCandidates.value.length) return
  if (!confirm(`前回まで未入力の ${unusedCandidates.value.length} 件をまとめて非表示にします。\nいつでも戻せます。よろしいですか？`)) return
  for (const n of [...unusedCandidates.value]) hideItem(n)
}
</script>

<template>
  <div class="mm-overlay" @click.self="emit('close')">
    <div class="mm-sheet">
      <div class="mm-head">
        <span class="mm-title">📦 品目マスタ管理</span>
        <span class="mm-count">{{ itemCount }}件</span>
        <button class="mm-close" @click="emit('close')">閉じる</button>
      </div>

      <div class="mm-scroll">
        <!-- 並び替え・振り分け -->
        <button class="mm-row" @click="launchReorder">
          <span class="mm-row-ico">🔀</span>
          <span class="mm-row-body">
            <span class="mm-row-title">並び替え・振り分け</span>
            <span class="mm-row-sub">ジャンル／場所・仕入先などの軸でグループ分け</span>
          </span>
          <span class="mm-row-arrow">→</span>
        </button>

        <!-- 使っていない候補（前回まで未入力）の一括非表示 -->
        <div class="mm-block">
          <div class="mm-block-head">
            <span class="mm-block-title">使っていない候補</span>
            <span class="mm-block-note">前回まで未入力</span>
          </div>
          <template v-if="!hasHistory">
            <div class="mm-empty">棚卸の履歴がまだありません。数回の棚卸のあとに候補が出ます。</div>
          </template>
          <template v-else-if="unusedCandidates.length === 0">
            <div class="mm-empty">直近の棚卸で全ての品目に入力があります。候補はありません。</div>
          </template>
          <template v-else>
            <div class="mm-block-sub">{{ unusedCandidates.length }}件。要らないものはまとめて非表示にできます（進捗の分母から外れます）。</div>
            <button class="mm-bulk" @click="hideAllUnused">まとめて非表示にする（{{ unusedCandidates.length }}件）</button>
            <div class="mm-chiplist">
              <button v-for="n in unusedCandidates" :key="n" class="mm-chip" @click="hideItem(n)">
                {{ n }}<span class="mm-chip-x">×</span>
              </button>
            </div>
          </template>
        </div>

        <!-- 非表示中の管理 -->
        <div class="mm-block">
          <div class="mm-block-head">
            <span class="mm-block-title">非表示中</span>
            <span class="mm-block-note">{{ hiddenList.length }}件</span>
          </div>
          <div v-if="hiddenList.length === 0" class="mm-empty">非表示の品目はありません。</div>
          <div v-else class="mm-hidden">
            <div v-for="n in hiddenList" :key="n" class="mm-hidden-row">
              <span class="mm-hidden-name">{{ n }}</span>
              <button class="mm-restore" @click="unhideItem(n)">戻す</button>
            </div>
          </div>
        </div>

        <!-- 品目一覧（閲覧） -->
        <div class="mm-block">
          <button class="mm-block-head mm-toggle" @click="listOpen = !listOpen">
            <span class="mm-block-title">品目一覧を見る</span>
            <span class="mm-block-note">{{ listOpen ? '▲' : '▼' }} {{ itemCount }}件</span>
          </button>
          <div v-if="listOpen" class="mm-items">
            <div v-for="item in config.order" :key="item" class="mm-item" :class="{ hidden: hiddenSet.has(item) }">
              <span class="mm-item-name">{{ item }}</span>
              <span class="mm-item-meta">
                <span v-if="genreOf(item)" class="mm-tag genre">{{ genreOf(item) }}</span>
                <span v-for="t in axisTagsOf(item)" :key="t" class="mm-tag">{{ t }}</span>
                <span v-if="hiddenSet.has(item)" class="mm-tag off">非表示</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mm-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.4);
  display: flex; align-items: flex-end; justify-content: center; z-index: 55;
}
.mm-sheet {
  width: 100%; max-width: 560px; max-height: 88vh;
  background: #f8fafc; border-radius: 18px 18px 0 0;
  display: flex; flex-direction: column;
}
.mm-head {
  display: flex; align-items: center; gap: 10px;
  padding: 16px 18px 12px; border-bottom: 1px solid #e2e8f0; background: #fff;
  border-radius: 18px 18px 0 0;
}
.mm-title { font-size: 16px; font-weight: 800; color: #1e293b; }
.mm-count { font-size: 13px; font-weight: 800; color: var(--primary, #2563eb); }
.mm-close { margin-left: auto; border: none; background: none; color: #64748b; font-size: 13px; font-weight: 700; cursor: pointer; padding: 4px 6px; }
.mm-scroll { overflow-y: auto; padding: 12px 14px 24px; }

.mm-row {
  width: 100%; display: flex; align-items: center; gap: 12px;
  background: #fff; border: 1px solid #e2e8f0; border-radius: 12px;
  padding: 14px; margin-bottom: 12px; cursor: pointer; text-align: left;
}
.mm-row:active { background: #f1f5f9; }
.mm-row-ico { font-size: 20px; }
.mm-row-body { flex: 1; min-width: 0; }
.mm-row-title { display: block; font-size: 15px; font-weight: 700; color: #334155; }
.mm-row-sub { display: block; font-size: 12px; color: #94a3b8; margin-top: 2px; }
.mm-row-arrow { color: #cbd5e1; font-size: 18px; }

.mm-block { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px 14px; margin-bottom: 12px; }
.mm-block-head { display: flex; align-items: center; gap: 8px; width: 100%; border: none; background: none; padding: 0; cursor: default; }
.mm-toggle { cursor: pointer; }
.mm-block-title { font-size: 14px; font-weight: 800; color: #334155; }
.mm-block-note { margin-left: auto; font-size: 12px; font-weight: 700; color: #94a3b8; }
.mm-block-sub { font-size: 12px; color: #64748b; margin: 8px 0; line-height: 1.5; }
.mm-empty { font-size: 12px; color: #94a3b8; margin-top: 8px; }

.mm-bulk {
  width: 100%; border: none; border-radius: 10px; padding: 10px;
  background: #64748b; color: #fff; font-size: 13px; font-weight: 800; cursor: pointer; margin-bottom: 8px;
}
.mm-bulk:active { background: #475569; }
.mm-chiplist { display: flex; flex-wrap: wrap; gap: 6px; }
.mm-chip {
  border: 1px solid #e2e8f0; background: #f8fafc; color: #475569;
  border-radius: 20px; padding: 4px 10px; font-size: 12px; cursor: pointer;
}
.mm-chip-x { color: #cbd5e1; margin-left: 4px; }
.mm-chip:active { background: #e2e8f0; }

.mm-hidden-row { display: flex; align-items: center; justify-content: space-between; padding: 8px 2px; border-bottom: 1px solid #f1f5f9; }
.mm-hidden-name { font-size: 14px; color: #334155; }
.mm-restore { border: 1px solid var(--primary-border, #bfdbfe); background: #fff; color: var(--primary, #2563eb); border-radius: 8px; font-size: 12px; font-weight: 700; padding: 5px 14px; cursor: pointer; }

.mm-items { margin-top: 8px; max-height: 40vh; overflow-y: auto; }
.mm-item { display: flex; align-items: center; gap: 8px; padding: 8px 2px; border-bottom: 1px solid #f1f5f9; }
.mm-item.hidden { opacity: 0.5; }
.mm-item-name { font-size: 14px; color: #334155; flex: 1; min-width: 0; }
.mm-item-meta { display: flex; flex-wrap: wrap; gap: 4px; justify-content: flex-end; }
.mm-tag { font-size: 10px; font-weight: 700; color: #64748b; background: #f1f5f9; border-radius: 6px; padding: 2px 7px; }
.mm-tag.genre { color: #6d28d9; background: #ede9fe; }
.mm-tag.off { color: #dc2626; background: #fef2f2; }
</style>
