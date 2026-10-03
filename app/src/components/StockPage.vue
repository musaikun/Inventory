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
 * - 右下の「＋」で1品目ずつ追加。行をタップすると品目シート（入庫・出庫・品目の情報・品目のカレンダー）
 */
import { ref, computed, onUnmounted } from 'vue'
import DismissibleHint from './DismissibleHint.vue'
import { useConfig } from '../composables/useConfig.js'
import { useStockView } from '../composables/useStockView.js'
import { registerInnerLayerCloser, showAxisAssign, axisAssignInitial } from '../composables/appMenuState.js'
import { completionBusy } from '../composables/useSession.js'
import InventoryTable from './InventoryTable.vue'
import ItemStockSheet from './ItemStockSheet.vue'
import { useMovements } from '../composables/useMovements.js'
import { saveMovementToD1 } from '../composables/useStore.js'
import { deviceName } from '../composables/useDeviceId.js'
import ItemFormModal from './ItemFormModal.vue'
import ItemCheckPage from './ItemCheckPage.vue'
import HiddenItemsList from './HiddenItemsList.vue'
import SortRecoCard from './SortRecoCard.vue'
import { useHistory } from '../composables/useHistory.js'
import { itemCheckRows, ITEM_CHECKS } from '../utils/itemCheck.js'
import { isHintShown, dismissHint, snoozeHint } from '../composables/useHints.js'

// embedded: ホーム（SessionListPage）の中に置くとき。見出しと戻るを出さず、上の段は #top スロットで差し込む
const props = defineProps({
  embedded: { type: Boolean, default: false },
  stocktakeOpen: { type: Boolean, default: false },   // 棚卸の最中（中断中を含む）。品目シートの入出庫を止める
})
const emit = defineEmits(['back', 'openMaster', 'startSession'])

const { config, setAxisName } = useConfig()
const { getSnapshots } = useHistory()
const {
  allItems, needsReorder, reorderCount, reorderSetCount, theoOf, unitOf, basisLabel, baseShort, _snaps, _moves,
} = useStockView()
const { saveMovement, getAllMovements, voidMovement, restoreMovement, markMovementSynced } = useMovements()
// 品目シートの明細は、取り消した記録も「取り消し済み」として見せる
const allMoves = computed(() => getAllMovements())
async function _send(rec) {
  if (!rec) return
  if (await saveMovementToD1(rec)) markMovementSynced(rec.id)
}
// 取り消し・元に戻す（記録は消さずに印を付け外す。サーバーは保存と同じ経路で受け取る）
function onVoid(id) { if (!locked.value && !props.stocktakeOpen) _send(voidMovement(id)) }
function onRestore(id) { if (!locked.value && !props.stocktakeOpen) _send(restoreMovement(id)) }

// 品目シートの入庫・出庫。両方に入れたら差し引かず、入庫1件・出庫1件として記録する（User決定 2026-10-03）。
// 記録は入出庫ページと同じ形なので、理論在庫・履歴カレンダーにもそのまま反映される。
function onRegister(item, { in: inQ = 0, out: outQ = 0 } = {}) {
  if (locked.value || props.stocktakeOpen) return
  const unit = unitOf(item)
  for (const [type, qty] of [['in', inQ], ['out', outQ]]) {
    if (!(qty > 0)) continue
    const rec = saveMovement({ type, by: deviceName.value || '', lines: [{ item, qty, unit }] })
    if (rec) saveMovementToD1(rec)
  }
}

const search = ref('')

// ── 絞り込み（User決定 2026-10-03：管理の「整える・確認」を在庫タブへ）──────────
// すべて / 要補充（発注点を手で入れた品目だけ。1つも無ければチップごと出さない）/
// 要確認（空欄・しばらく数えていない）/ 非表示（戻せる・取込で除外した行も）
const filter = ref('all')   // 'all' | 'low' | 'check' | 'hidden'
const checkMap = computed(() => new Map(itemCheckRows(config, { snapshots: _snaps.value }).map(r => [r.item, r])))
const hiddenCount = computed(() => (config.hiddenItems ?? []).length)
const excludedCount = computed(() => config.importExcluded?.total ?? 0)
const chips = computed(() => {
  const out = [{ key: 'all', label: 'すべて', n: allItems.value.length }]
  if (reorderSetCount.value) out.push({ key: 'low', label: '要補充', n: reorderCount.value, warn: reorderCount.value > 0 })
  out.push({ key: 'check', label: '要確認', n: checkMap.value.size, warn: checkMap.value.size > 0 })
  if (hiddenCount.value || excludedCount.value) out.push({ key: 'hidden', label: '非表示', n: hiddenCount.value })
  return out
})
// チップが消えた（発注点を全部外した等）ら「すべて」へ戻す
const activeFilter = computed(() => (chips.value.some(c => c.key === filter.value) ? filter.value : 'all'))
const itemFilter = computed(() => {
  if (activeFilter.value === 'low') return item => needsReorder(item)
  if (activeFilter.value === 'check') return item => checkMap.value.has(item)
  return null
})
const CHECK_CHIP = Object.fromEntries(ITEM_CHECKS.map(c => [c.key, c.chip]))
function checkLabel(item) {
  const r = checkMap.value.get(item)
  return r ? r.missing.map(k => CHECK_CHIP[k]).filter(Boolean).join('・') : ''
}
const checkOpen = ref(false)

// ── 並び替えのおすすめ ─────────────────────────────
// 名前の付いた並び替え（保管場所など）のうち、いちばん振り分けが進んでいるもので判断する
const RECO_ID = 'reco-sort'
const sortProgress = computed(() => {
  const names = config.axisNames ?? ['', '']
  const items = allItems.value
  let best = null
  for (const idx of [0, 1]) {
    if (!(names[idx] || '').trim()) continue
    const tags = (idx === 0 ? config.tagsA : config.tagsB) ?? {}
    const assigned = items.reduce((n, it) => n + (tags[it]?.length ? 1 : 0), 0)
    if (!best || assigned > best.assigned) best = { idx, name: names[idx], assigned }
  }
  return { best, total: items.length }
})
const recoStage = computed(() => {
  const { best, total } = sortProgress.value
  if (!total) return ''
  if (!best || best.assigned === 0) return 'none'
  return best.assigned < total ? 'half' : ''
})
const showReco = computed(() => !!recoStage.value && !locked.value && isHintShown(RECO_ID))
function startSort() {
  const best = sortProgress.value.best
  let idx = best?.idx
  if (idx == null) {
    const names = config.axisNames ?? ['', '']
    idx = !(names[0] || '').trim() ? 0 : 1
    if (!(names[idx] || '').trim()) {
      const name = (window.prompt('並び替えの名前を入力（例：保管場所・仕入先）', '保管場所') || '').trim()
      if (!name) return
      if (!setAxisName(idx, name)) { window.alert('その名前は既に使われています'); return }
    }
  }
  axisAssignInitial.value = idx
  showAxisAssign.value = true
}
// サンプルの品目リスト（まだ自分のリストを持っていない）も「0件」として扱う。
// サンプルを在庫として並べると、自分の店の品目と区別がつかない
const isEmpty = computed(() => (config.order || []).length === 0 || !config.isCustom)
defineExpose({ reorderCount, openAdd: () => openAdd() })

// ── シート ───────────────────────────────
const detailTarget = ref(null)   // 品目シート
const form = ref(null)           // null | { mode: 'add' } | { mode: 'edit', item }
// 完了の結果がサーバーで確定するまでは、品目・在庫の設定を変えない（User指示 2026-09-30）。
// 完了要求と端末の品目がずれた状態で確定させない＝完了は「確定するまで何も動かさない」
const locked = computed(() => completionBusy.value)
function openAdd()  { if (!locked.value) form.value = { mode: 'add' } }
function openEdit() { if (!locked.value) form.value = { mode: 'edit', item: detailTarget.value } }
function closeForm() { form.value = null }
// 端末の戻る操作は、ページを閉じる前に上のシートから閉じる（既存の段に乗せる）
onUnmounted(registerInnerLayerCloser(() => {
  if (form.value) { closeForm(); return true }
  if (checkOpen.value) { checkOpen.value = false; return true }
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

    <div v-if="locked" class="sp-locked" role="status">
      ⏳ 棚卸・発注の完了をサーバーで確認しています。確定するまで品目の追加・変更はできません。
    </div>

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
      <SortRecoCard
        v-if="showReco"
        :stage="recoStage"
        :axis-name="sortProgress.best?.name || ''"
        :assigned="sortProgress.best?.assigned || 0"
        :total="sortProgress.total"
        @start="startSort"
        @later="snoozeHint(RECO_ID)"
        @dismiss="dismissHint(RECO_ID)"
      />
      <DismissibleHint id="stock-basis" tag="p" class="sp-hint">数字は<b>今の見込み</b>（直近の棚卸＋入庫−出庫）。正確な数は棚卸で確定します。</DismissibleHint>

      <div class="sp-chips" role="group" aria-label="絞り込み">
        <button
          v-for="c in chips" :key="c.key" type="button"
          :class="['sp-chip', { on: activeFilter === c.key, warn: c.warn }]" :aria-pressed="activeFilter === c.key"
          @click="filter = c.key"
        >{{ c.label }}<span class="sp-chip-n">{{ c.n }}</span></button>
      </div>

      <template v-if="activeFilter === 'hidden'">
        <HiddenItemsList :editable="!locked" />
      </template>
      <template v-else>
      <DismissibleHint v-if="activeFilter === 'low'" id="stock-low" tag="p" class="sp-hint">
        発注点を設定した {{ reorderSetCount }}品目のうち、見込みが発注点以下の品目です。
      </DismissibleHint>
      <div v-if="activeFilter === 'check'" class="sp-checkbar">
        <span>空欄のある品目・しばらく数えていない品目です。直すと自動で外れます。</span>
        <button v-if="!locked && checkMap.size" type="button" @click="checkOpen = true">まとめて直す ›</button>
      </div>
      <InventoryTable
        :inventory="{}"
        :filled-count="0"
        :search-term="search"
        :item-filter="itemFilter"
        :can-manage-list="false"
        :axis-editable="!locked"
        hide-amount
        hide-tap-continuous
        @tap="item => (detailTarget = item)"
      >
        <template #qty="{ row }">
          <div v-if="activeFilter === 'check'" class="sp-cell chk">
            <span class="sp-cell-why">{{ checkLabel(row.item) }}</span>
          </div>
          <div v-else :class="['sp-cell', { low: needsReorder(row.item), none: theoOf(row.item) == null }]">
            <span class="sp-cell-basis">{{ needsReorder(row.item) ? `要補充 ・ 発注点 ${config.reorderPoints?.[row.item]}` : (baseShort(row.item) || '棚卸なし') }}</span>
            <span class="sp-cell-val">
              <template v-if="theoOf(row.item) != null">{{ theoOf(row.item) }}<span class="qty-unit">{{ unitOf(row.item) }}</span></template>
              <template v-else>—</template>
            </span>
          </div>
        </template>
        <template #filters><span></span></template>
        <template #progress>
          <span class="progress">品目 <strong>{{ allItems.length }}</strong><template v-if="reorderSetCount"> ・ 要補充 <strong>{{ reorderCount }}</strong></template></span>
        </template>
      </InventoryTable>
      </template>

      <button v-if="!locked" class="sp-fab" type="button" aria-label="品目を追加" @click="openAdd">＋</button>
    </div>

    <ItemStockSheet
      v-if="detailTarget && !form"
      :item="detailTarget"
      :unit="unitOf(detailTarget)"
      :theo="theoOf(detailTarget)"
      :basis="basisLabel(detailTarget)"
      :lot="config.lotSizes?.[detailTarget] ?? null"
      :price="config.prices?.[detailTarget] ?? null"
      :category="config.categories?.[detailTarget] ?? ''"
      :code="config.codes?.[detailTarget] ?? ''"
      :image-ref="config.images?.[detailTarget] ?? ''"
      :movements="allMoves"
      :snapshots="_snaps"
      :editable="!locked"
      :stocktake-open="stocktakeOpen"
      @register="p => onRegister(detailTarget, p)"
      @void="onVoid"
      @restore="onRestore"
      @edit="openEdit"
      @close="detailTarget = null"
    />

    <ItemCheckPage v-if="checkOpen" @close="checkOpen = false" />

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
.sp-locked { margin: 0 12px 8px; padding: 9px 12px; border-radius: 10px; background: #fff7ed; border: 1px solid #fed7aa; color: #9a3412; font-size: 12.5px; font-weight: 700; line-height: 1.5; }
.sp.embedded .sp-fab { bottom: calc(78px + env(safe-area-inset-bottom)); }
.sp { min-height: 100vh; background: var(--bg, #f1f5f9); padding-bottom: 96px; }
.sp-header {
  position: sticky; top: 0; z-index: 2; display: flex; align-items: center; gap: 10px;
  padding: 12px 14px; background: #fff; border-bottom: 1px solid #e2e8f0;
}
.sp-back { border: none; background: none; color: var(--primary, #2563eb); font-size: 14px; font-weight: 700; cursor: pointer; padding: 4px 2px; }
.sp-title { font-size: 16px; font-weight: 800; color: #1e293b; }
.sp-body { padding: 12px 0 0; }
.sp-body > .sp-search, .sp-body > .sp-hint { margin-left: 12px; margin-right: 12px; width: calc(100% - 24px); }
/* 表の左右の余白は InventoryTable 側（6px） */
.sp-search { width: 100%; box-sizing: border-box; border: 1.5px solid #e2e8f0; border-radius: 10px; padding: 10px 12px; font-size: 14px; margin-bottom: 6px; background: #fff; }
.sp-search:focus { outline: none; border-color: #94a3b8; }
.sp-hint { font-size: 11.5px; color: #94a3b8; margin: 0 2px 8px; line-height: 1.6; }
.sp-hint b { color: #64748b; }

.sp-chips { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; margin: 0 12px 8px; padding: 2px 0; }
.sp-chips::-webkit-scrollbar { display: none; }
.sp-chip {
  flex: none; display: inline-flex; align-items: center; gap: 5px; min-height: 36px;
  border: 1px solid var(--border); background: var(--surface); color: var(--text); border-radius: 999px;
  padding: 0 11px; font-size: 13px; font-weight: 700; cursor: pointer; white-space: nowrap;
}
.sp-chip-n { font-size: 11.5px; font-weight: 800; color: var(--text-muted); border-radius: 999px; padding: 0 6px; }
.sp-chip.warn .sp-chip-n { background: #fef3c7; color: #a16207; }
.sp-chip.on { border-color: var(--primary); color: var(--primary); background: var(--primary-weak); box-shadow: inset 0 0 0 1px var(--primary); }
.sp-checkbar {
  display: flex; align-items: center; gap: 8px; margin: 0 12px 8px; padding: 8px 10px; border-radius: 10px;
  background: #fef9e7; color: #854d0e; font-size: 12px; line-height: 1.5;
}
.sp-checkbar span { flex: 1; }
.sp-checkbar button {
  flex: none; min-height: 36px; border: 1.5px solid #d97706; background: var(--surface); color: #a16207;
  border-radius: 9px; padding: 0 10px; font-size: 12.5px; font-weight: 800; cursor: pointer;
}
.sp-cell.chk { border-color: #fcd34d; background: #fffbeb; min-width: 96px; max-width: 150px; }
.sp-cell-why { font-size: 11px; font-weight: 700; color: #a16207; line-height: 1.35; text-align: center; white-space: normal; }

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
