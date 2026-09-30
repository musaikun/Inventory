<script setup>
/**
 * 品目・在庫（ホームの主役の1枚）。
 *
 * 一般的な在庫アプリは「品目の一覧」が主役で、そこに「＋」がある。タナオロでは品目は
 * データ管理の奥（設定済み品目一覧・確認専用）と、棚卸の画面の中にしか無く、1品目を
 * 足すにも棚卸を始める必要があった（User相談 2026-09-29・参考画面で合意）。
 *
 * - 一覧は棚卸・発注と同じ InventoryTable。数字は「今の見込み」＝直近の棚卸＋入庫−出庫
 *   （仕入れの在庫タブと同じ計算＝composables/useStockView）。何を元にした数かを添える
 * - ここでは在庫数を書き換えない。数を変えるのは棚卸（実測）か入出庫の記録だけ
 *   （一覧で書き換えられると、見込みの根拠も発注の推奨も崩れる）
 * - 右下の「＋」で1品目ずつ追加。行をタップすると品目シート（発注点・品目の情報）
 */
import { ref, computed, onUnmounted } from 'vue'
import { useConfig } from '../composables/useConfig.js'
import { useStockView } from '../composables/useStockView.js'
import { registerInnerLayerCloser } from '../composables/appMenuState.js'
import InventoryTable from './InventoryTable.vue'
import StockDetailModal from './StockDetailModal.vue'
import ItemFormModal from './ItemFormModal.vue'

// embedded: ホーム（SessionListPage）の中に置くとき。見出しと戻るを出さず、上の段は #top スロットで差し込む
const props = defineProps({ embedded: { type: Boolean, default: false } })
const emit = defineEmits(['back', 'openMaster', 'startSession'])

const { config, setReorderPoint, setReplenishTarget } = useConfig()
const {
  allItems, reorderOf, needsReorder, reorderCount, itemMovements, consumptionHintOf,
  replenishOf, suggestedReorder, suggestBasisLabel, theoOf, unitOf, basisLabel, baseShort, lotOf,
} = useStockView()

const search = ref('')
const onlyLow = ref(false)
const itemFilter = computed(() => (onlyLow.value ? (item => needsReorder(item)) : null))
// サンプルの品目リスト（まだ自分のリストを持っていない）も「0件」として扱う。
// サンプルを在庫として並べると、自分の店の品目と区別がつかない
const isEmpty = computed(() => (config.order || []).length === 0 || !config.isCustom)
defineExpose({ reorderCount, openAdd: () => openAdd() })

// ── シート ───────────────────────────────
const detailTarget = ref(null)   // 品目シート
const form = ref(null)           // null | { mode: 'add' } | { mode: 'edit', item }
function openAdd()  { form.value = { mode: 'add' } }
function openEdit() { form.value = { mode: 'edit', item: detailTarget.value } }
function closeForm() { form.value = null }
// 端末の戻る操作は、ページを閉じる前に上のシートから閉じる（既存の段に乗せる）
onUnmounted(registerInnerLayerCloser(() => {
  if (form.value) { closeForm(); return true }
  if (detailTarget.value) { detailTarget.value = null; return true }
  return false
}))
</script>

<template>
  <div :class="['sp', { embedded }]">
    <header v-if="!embedded" class="sp-header">
      <button class="sp-back" @click="emit('back')">‹ 戻る</button>
      <span class="sp-title">📦 品目・在庫</span>
    </header>

    <slot name="top" :empty="isEmpty" />

    <!-- 品目が0件：一覧の代わりに、登録の入口を大きく出す -->
    <div v-if="isEmpty" class="sp-empty">
      <div class="sp-empty-ico">📦</div>
      <div class="sp-empty-title">最初の品目を追加</div>
      <p class="sp-empty-sub">在庫を数える品目を登録します</p>
      <button class="sp-btn pri" type="button" @click="openAdd">＋ 1つずつ追加</button>
      <button class="sp-btn sec" type="button" @click="emit('openMaster')">📄 ファイルからまとめて取込</button>
      <button class="sp-link" type="button" @click="emit('startSession')">または、棚卸をしながら登録する ›</button>
    </div>

    <div v-else class="sp-body">
      <input v-model="search" type="text" class="sp-search" placeholder="品目名で絞り込み" />
      <p class="sp-hint">数字は<b>今の見込み</b>（直近の棚卸＋入庫−出庫）。正確な数は棚卸で確定します。</p>

      <InventoryTable
        :inventory="{}"
        :filled-count="0"
        :search-term="search"
        :item-filter="itemFilter"
        :can-manage-list="false"
        hide-amount
        hide-tap-continuous
        @tap="item => (detailTarget = item)"
      >
        <template #qty="{ row }">
          <div :class="['sp-cell', { low: needsReorder(row.item), none: theoOf(row.item) == null }]">
            <span class="sp-cell-basis">{{ needsReorder(row.item) ? '要補充' : (baseShort(row.item) || '棚卸なし') }}</span>
            <span class="sp-cell-val">
              <template v-if="theoOf(row.item) != null">{{ theoOf(row.item) }}<span class="qty-unit">{{ unitOf(row.item) }}</span></template>
              <template v-else>—</template>
            </span>
          </div>
        </template>
        <template #filters>
          <div class="sp-chips">
            <button :class="['sp-chip', { on: !onlyLow }]" type="button" @click="onlyLow = false">すべて</button>
            <button :class="['sp-chip', 'low', { on: onlyLow }]" type="button" @click="onlyLow = true">要補充 {{ reorderCount }}</button>
          </div>
        </template>
        <template #progress>
          <span class="progress">品目 <strong>{{ allItems.length }}</strong> ・ 要補充 <strong>{{ reorderCount }}</strong></span>
        </template>
      </InventoryTable>

      <button class="sp-fab" type="button" aria-label="品目を追加" @click="openAdd">＋</button>
    </div>

    <StockDetailModal
      v-if="detailTarget && !form"
      :item="detailTarget"
      :unit="unitOf(detailTarget)"
      :theo="theoOf(detailTarget)"
      :basis="basisLabel(detailTarget)"
      :reorder="reorderOf(detailTarget)"
      :suggested="suggestedReorder(detailTarget)"
      :suggest-basis="suggestBasisLabel(detailTarget)"
      :hint="consumptionHintOf(detailTarget)"
      :target="replenishOf(detailTarget)?.value ?? null"
      :target-manual="config.replenishTargets?.[detailTarget] ?? null"
      :target-basis="replenishOf(detailTarget)?.basis ?? ''"
      :lot="lotOf(detailTarget)"
      :price="config.prices?.[detailTarget] ?? null"
      :category="config.categories?.[detailTarget] ?? ''"
      :movements="itemMovements(detailTarget)"
      editable
      @update-reorder="v => setReorderPoint(detailTarget, v)"
      @update-target="v => setReplenishTarget(detailTarget, v)"
      @edit="openEdit"
      @close="detailTarget = null"
    />

    <ItemFormModal
      v-if="form"
      :mode="form.mode"
      :item="form.item || ''"
      @saved="closeForm"
      @close="closeForm"
    />
  </div>
</template>

<style scoped>
.sp.embedded { min-height: 0; padding-bottom: 88px; }
/* ホームでは下部ナビの上に出す */
.sp.embedded .sp-fab { bottom: calc(78px + env(safe-area-inset-bottom)); }
.sp { min-height: 100vh; background: var(--bg, #f1f5f9); padding-bottom: 96px; }
.sp-header {
  position: sticky; top: 0; z-index: 2; display: flex; align-items: center; gap: 10px;
  padding: 12px 14px; background: #fff; border-bottom: 1px solid #e2e8f0;
}
.sp-back { border: none; background: none; color: var(--primary, #2563eb); font-size: 14px; font-weight: 700; cursor: pointer; padding: 4px 2px; }
.sp-title { font-size: 16px; font-weight: 800; color: #1e293b; }
.sp-body { padding: 12px 12px 0; }
.sp-search { width: 100%; box-sizing: border-box; border: 1.5px solid #e2e8f0; border-radius: 10px; padding: 10px 12px; font-size: 14px; margin-bottom: 6px; background: #fff; }
.sp-search:focus { outline: none; border-color: #94a3b8; }
.sp-hint { font-size: 11.5px; color: #94a3b8; margin: 0 2px 8px; line-height: 1.6; }
.sp-hint b { color: #64748b; }

.sp-chips { display: flex; gap: 6px; }
.sp-chip {
  border: 1.5px solid #cbd5e1; background: #fff; color: #475569; border-radius: 16px;
  padding: 5px 12px; font-size: 12.5px; font-weight: 700; cursor: pointer; white-space: nowrap;
}
.sp-chip.on { border-color: var(--primary, #2563eb); color: var(--primary, #2563eb); background: #eff6ff; }
.sp-chip.low.on { border-color: #f97316; color: #c2410c; background: #fff7ed; }

/* 数量セル：数字に「何を元にした数か」を添える（素の数字だと実測か見込みか分からない） */
.sp-cell {
  display: inline-flex; flex-direction: column; align-items: center; min-width: 84px;
  border: 1.5px solid var(--border, #e2e8f0); border-radius: 8px; padding: 3px 8px; background: #f8fafc;
}
.sp-cell-basis { font-size: 9.5px; font-weight: 700; color: #94a3b8; line-height: 1.2; white-space: nowrap; }
.sp-cell-val { font-size: 16px; font-weight: 800; color: #334155; white-space: nowrap; }
.sp-cell.low { border-color: #fdba74; background: #fff7ed; }
.sp-cell.low .sp-cell-basis, .sp-cell.low .sp-cell-val { color: #c2410c; }
.sp-cell.none .sp-cell-val { color: #cbd5e1; }

.sp-fab {
  position: fixed; right: max(16px, calc(50vw - 320px)); bottom: calc(20px + env(safe-area-inset-bottom));
  width: 58px; height: 58px; border-radius: 50%; border: none; z-index: 5;
  background: var(--primary, #2563eb); color: #fff; font-size: 32px; line-height: 1; cursor: pointer;
  box-shadow: 0 6px 16px rgba(37, 99, 235, 0.35);
}

.sp-empty { text-align: center; padding: 64px 20px 0; }
.sp-empty-ico { font-size: 64px; }
.sp-empty-title { font-size: 19px; font-weight: 800; color: #1e293b; margin-top: 8px; }
.sp-empty-sub { font-size: 13px; color: #64748b; margin: 4px 0 20px; }
.sp-btn { display: block; width: 100%; max-width: 360px; margin: 0 auto 10px; border-radius: 12px; padding: 14px; font-size: 15px; font-weight: 800; cursor: pointer; }
.sp-btn.pri { border: none; background: var(--primary, #2563eb); color: #fff; }
.sp-btn.sec { border: 1.5px solid #cbd5e1; background: #fff; color: #334155; }
.sp-link { border: none; background: none; color: var(--primary, #2563eb); font-size: 13px; font-weight: 700; cursor: pointer; margin-top: 6px; }
</style>
