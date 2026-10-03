<script setup>
import { ref, computed, onMounted } from 'vue'
import DismissibleHint from './DismissibleHint.vue'
import { useConfig } from '../composables/useConfig.js'
import { useMovements, deliveryLinesFromOrder, unreflectedOrders } from '../composables/useMovements.js'
import { useMovementDraft } from '../composables/useMovementDraft.js'
import { useOrders } from '../composables/useOrders.js'
import { saveMovementToD1 } from '../composables/useStore.js'
import { useHorizontalSwipe } from '../composables/useSwipe.js'
import MovementQtyModal from './MovementQtyModal.vue'
import InventoryTable from './InventoryTable.vue'
import { useStockView } from '../composables/useStockView.js'

/**
 * 入出庫の記録（入庫・出庫）。
 *
 * 以前は「仕入れ」として在庫・発注・入庫・出庫の4タブを持っていたが、在庫と発注は
 * ホーム（品目・在庫の表と開始シート）と重複し、入口も2つあった（画面遷移図の課題①・2026-10-01）。
 * ここは**記録するだけ**の画面にする。在庫の確認・発注の開始はホーム、
 * 発注基準・発注日の設定は管理タブ。
 */
const emit = defineEmits(['back', 'saved', 'tabChange'])
// 開いたときに選んでおくタブ（'in' | 'out'）
const props = defineProps({
  initialTab: { type: String, default: 'in' },
})

const { config } = useConfig()
const { saveMovement } = useMovements()
const { getOrders } = useOrders()
const { draft, clearMode } = useMovementDraft()

// 画面モード: 入庫 / 出庫（どちらも記録）
const TAB_ORDER = ['in', 'out']
const mode = ref(TAB_ORDER.includes(props.initialTab) ? props.initialTab : 'in')
const slideDir = ref('fwd')  // タブ切替時のスライド方向（アニメーション用）
const tabIndex = computed(() => TAB_ORDER.indexOf(mode.value))  // スライド下線の位置
// メモはモード別（入庫/出庫で混ざらない）
const noteModel = computed({
  get: () => (mode.value === 'out' ? draft.noteOut : draft.noteIn),
  set: (v) => { if (mode.value === 'out') draft.noteOut = v; else draft.noteIn = v },
})

const search = ref('')
// 日付・メモ・発注紐付け・入力量は draft（localStorage 保持）に持つ。
// 未記録のままホームへ戻っても入力が残り、ホームカードに「未記録の入力あり」を出せる。

// 理論在庫・発注基準・要補充の判定は「品目・在庫」ページと共通（composables/useStockView）
const { allItems, _moves, theoOf, unitOf, lotOf } = useStockView()
function _md(d) {
  const [, mo, dd] = String(d || '').split('-').map(Number)
  return mo && dd ? `${mo}/${dd}` : ''
}

// ── 入力量の操作（現在の記録モード）─────────────────────────
function _q(item) {
  const v = Number(draft[mode.value][item])
  return Number.isFinite(v) && v > 0 ? v : 0
}
function _set(item, v) {
  draft[mode.value][item] = Math.max(0, Math.round(v * 1000) / 1000)
}
// 記録タブの一覧は棚卸・発注と同じ InventoryTable を使う。
// あちらは { 品目: { qty, unit } } を「入力済みの行」として描くので、今回の入力量を
// その形へ写す（0 は未入力＝null）。保存に使うのは従来どおり draft のほうで、
// ここで作るのは表示用の射影。
const draftInventory = computed(() => {
  const inv = {}
  for (const item of allItems.value) {
    const q = _q(item)
    if (q > 0) inv[item] = { qty: q, unit: unitOf(item) }
  }
  return inv
})

// 行のヒント欄に出す理論在庫（記録後の値も添える）。出庫で在庫を割り込む入力に気づけるようにする。
const theoNoteMap = computed(() => {
  const map = {}
  for (const item of allItems.value) {
    const t = theoOf(item)
    if (t == null) continue
    const q = _q(item)
    map[item] = q > 0 ? `理論: ${t}${unitOf(item)} → ${afterQty(item)}${unitOf(item)}` : `理論: ${t}${unitOf(item)}`
  }
  return map
})

// 数量入力は棚卸・発注と同じ NumPad シートで行う（打鍵感をそろえ、OSキーボードを出さない）。
// 行内の −/＋/＋箱 は連打用に残す。数量チップをタップするとここが開く。
const qtyTarget = ref(null)   // null | 品目名
function openQty(item) { qtyTarget.value = item }
function onRowTap(item) { openQty(item) }
function closeQty()    { qtyTarget.value = null }
function onQtyConfirm(v) {
  if (qtyTarget.value) _set(qtyTarget.value, Number(v) || 0)
  closeQty()
}
// 記録後の理論在庫プレビュー
function afterQty(item) {
  const t = theoOf(item)
  if (t == null) return null
  return Math.round((t + (mode.value === 'out' ? -_q(item) : _q(item))) * 1000) / 1000
}

// ── 記録対象の行 ─────────────────────────────
const changed = computed(() => allItems.value.filter(n => _q(n) > 0))
const recordLines = computed(() => changed.value.map(n => ({ item: n, qty: _q(n), unit: unitOf(n) })))
const canSave = computed(() => recordLines.value.length > 0)

// ── 発注→入庫の一括プリフィル（入庫モードのみ）─────────────
// 未反映の発注（直近30日で入庫が未記録のもの）。ホームカードのバッジと共通の純関数を使う。
const pendingOrders = computed(() => unreflectedOrders(getOrders(), _moves.value, 30).slice(0, 5))
function importOrder(o) {
  const dl = deliveryLinesFromOrder(o)
  if (dl.length === 0) return
  for (const l of dl) _set(l.item, _q(l.item) + l.qty)
  draft.orderId = o.id
  draft.orderLabel = `${_md(o.date)} ${o.supplier || '（未分類）'}`
  if (!draft.noteIn) draft.noteIn = `${_md(o.date)}発注分の納品`
}
function unlinkOrder() { draft.orderId = null; draft.orderLabel = '' }

// ── モード切替・保存 ─────────────────────────────
// 発注紐付けは入庫の保存でのみ使う。モード切替では消さない（在庫を見て戻っても保持）。
function setMode(m) {
  if (m === mode.value) return
  slideDir.value = TAB_ORDER.indexOf(m) > TAB_ORDER.indexOf(mode.value) ? 'fwd' : 'back'
  mode.value = m
  // 再読込でこのタブへ戻れるよう、選んでいるタブを親へ伝える（親が保存を持つ）
  emit('tabChange', m)
}
// 左右スワイプで入庫⇄出庫を切り替え
const swipe = useHorizontalSwipe({
  onLeft:  () => { const i = TAB_ORDER.indexOf(mode.value); if (i < TAB_ORDER.length - 1) setMode(TAB_ORDER[i + 1]) },
  onRight: () => { const i = TAB_ORDER.indexOf(mode.value); if (i > 0) setMode(TAB_ORDER[i - 1]) },
})
function onSave() {
  if (!canSave.value) return
  const m = mode.value
  const rec = saveMovement({
    type: m === 'out' ? 'out' : 'in',
    date: draft.date,
    note: m === 'out' ? draft.noteOut : draft.noteIn,
    orderId: m === 'in' ? draft.orderId : null,
    lines: recordLines.value,
  })
  if (rec) saveMovementToD1(rec)   // D1 にも永続化（端末間共有・キャッシュ削除からの復旧）
  // 保存したモードのドラフトをクリアする（同じタブに残る。結果はホームの表と履歴で見る）
  clearMode(m)
  emit('saved')
}

// 取込（過去の納品・過去の棚卸・品目マスタ）はデータ管理へ集約した。
// 同じ取込に2つの入口があると、どちらが正か分からなくなるためこの画面には置かない。
</script>

<template>
  <div :class="['mv', mode]">
    <header class="mv-header">
      <button class="mv-back" @click="emit('back')">‹ 戻る</button>
      <span class="mv-title">📥 入出庫</span>
      <span v-if="changed.length" class="mv-count">{{ changed.length }}品目</span>
    </header>

    <!-- モードタブ（スライド下線で切替可能を示す）-->
    <div class="mv-tabs">
      <button :class="['mv-tab', 'in', { on: mode === 'in' }]" @click="setMode('in')">
        📥 入庫<span v-if="pendingOrders.length" class="mv-tab-badge">{{ pendingOrders.length }}</span>
      </button>
      <button :class="['mv-tab', 'out', { on: mode === 'out' }]" @click="setMode('out')">📤 出庫</button>
      <div class="mv-tab-ind" :class="mode" :style="{ transform: `translateX(${tabIndex * 100}%)` }"></div>
    </div>
    <DismissibleHint id="movement-swipe" class="mv-swipe-hint">‹ スワイプで切替 ›</DismissibleHint>

    <div
      class="mv-scroll"
      @touchstart.passive="swipe.onTouchStart"
      @touchmove.passive="swipe.onTouchMove"
      @touchend.passive="swipe.onTouchEnd"
      @touchcancel.passive="swipe.onTouchCancel"
    >
     <div class="mv-page" :key="mode" :class="slideDir">
      <!-- 表の外側（日付・メモ・検索・案内）。表そのものは全幅で置き、棚卸と同じ地続きにする -->
      <div class="mv-controls-wrap">
      <!-- 日付・メモ・発注取込 -->
      <template v-if="mode">
        <div class="mv-controls">
          <div class="mv-ctl-row">
            <label class="mv-ctl-label">日付</label>
            <input v-model="draft.date" type="date" class="mv-date" />
          </div>
          <input v-model="noteModel" type="text" class="mv-note" placeholder="メモ（任意）例: 火曜納品分 / まかない使用" />
        </div>

        <div v-if="mode === 'in' && draft.orderId" class="mv-linked">
          🧾 {{ draft.orderLabel }} の発注を入庫にプリフィル済み
          <button class="mv-linked-clear" @click="unlinkOrder">解除</button>
        </div>
        <div v-else-if="mode === 'in' && pendingOrders.length" class="mv-orders">
          <div class="mv-orders-title">🧾 入庫として未反映の発注があります</div>
          <div class="mv-orders-list">
            <div v-for="o in pendingOrders" :key="o.id" class="mv-order-row">
              <div class="mv-order-info">
                <span class="mv-order-when">{{ _md(o.date) }} {{ o.supplier || '（未分類）' }}</span>
                <span class="mv-order-meta">{{ o.lines.length }}品目の発注が未反映です</span>
              </div>
              <button class="mv-order-apply" @click="importOrder(o)">反映する</button>
            </div>
          </div>
          <div class="mv-orders-note">※ 実際に届いた数に直してから保存できます（分納・欠品に対応）</div>
        </div>

        <!-- 過去データの一括取込（入庫モードのみ）-->
      </template>

      <!-- 品目検索。表の絞り込みへ渡す -->
      <input v-model="search" type="text" class="mv-search" placeholder="品目名で絞り込み" />

      <DismissibleHint v-if="mode === 'in'" id="movement-in" class="mv-hint">納品分を入力。入数がある品目は「＋箱」でケース単位（バラに換算）。</DismissibleHint>
      <DismissibleHint v-else-if="mode === 'out'" id="movement-out" class="mv-hint">使用・廃棄した数を個（バラ）で入力。</DismissibleHint>
      </div><!-- /.mv-controls-wrap -->

      <!-- 品目一覧。棚卸・発注とまったく同じ表を使う。行タップで数量シート -->
      <InventoryTable
        :inventory="draftInventory"
        :filled-count="changed.length"
        :note-map="theoNoteMap"
        :search-term="search"
        :can-manage-list="false"
        hide-amount
        hide-tap-continuous
        @tap="onRowTap"
      />
     </div>
    </div>

    <!-- 保存バー -->
    <div class="mv-savebar">
      <div class="mv-save-summary">
        <span v-if="changed.length" :class="['mv-sum', mode]">{{ mode === 'in' ? '入庫' : '出庫' }} {{ changed.length }}品目</span>
        <span v-else class="mv-sum none">数量を入力してください</span>
      </div>
      <div class="mv-save-actions">
        <button :class="['mv-save', mode]" :disabled="!canSave" @click="onSave">
          {{ mode === 'in' ? '入庫を記録' : '出庫を記録' }}
        </button>
      </div>
    </div>

    <MovementQtyModal
      v-if="qtyTarget"
      :item="qtyTarget"
      :mode="mode"
      :qty="_q(qtyTarget)"
      :unit="unitOf(qtyTarget)"
      :lot="lotOf(qtyTarget)"
      :theo="theoOf(qtyTarget)"
      @confirm="onQtyConfirm"
      @cancel="closeQty"
    />
  </div>
</template>

<style scoped>
.mv { min-height: 100dvh; background: #f6fafb; display: flex; flex-direction: column; }

/* 過去納品の一括取込バー */

/* ゲート案内（消費・理論値のアンロック） */
.mv-unlock {
  display: flex; align-items: center; gap: 10px;
  margin: 4px 0 8px; padding: 10px 12px;
  background: #fffbeb; border: 1px solid #fde68a; border-radius: 10px;
}
.mv-unlock-txt { flex: 1; font-size: 12px; color: #92400e; line-height: 1.4; }
.mv-unlock-btn {
  flex-shrink: 0; padding: 6px 12px; border: none; border-radius: 8px;
  background: #f59e0b; color: #fff; font-size: 12px; font-weight: 700; cursor: pointer;
}
.mv-unlock-btn:active { background: #d97706; }
.mv-header {
  position: sticky; top: 0; z-index: 2;
  display: flex; align-items: center; gap: 10px;
  padding: 12px 14px; background: #fff; border-bottom: 1px solid #d6e6ea;
}
.mv-back { border: none; background: none; color: #059669; font-size: 14px; font-weight: 700; cursor: pointer; padding: 4px 2px; }
.mv-title { font-size: 16px; font-weight: 800; color: #065f46; }
.mv-count { margin-left: auto; font-size: 13px; font-weight: 800; color: #059669; }
.mv.out .mv-back, .mv.out .mv-count { color: #dc2626; }
.mv.out .mv-title { color: #991b1b; }

.mv-tabs { position: sticky; top: 49px; z-index: 2; display: flex; padding: 0 8px; background: #fff; border-bottom: 1px solid #d6e6ea; }
.mv-tab { flex: 1; border: none; background: none; padding: 13px 4px; font-size: 14px; font-weight: 800; color: #7d969c; cursor: pointer; -webkit-tap-highlight-color: transparent; transition: color 0.18s; }
.mv-tab.on { color: #1f3d45; }
.mv-tab.in.on  { color: #047857; }
.mv-tab.out.on { color: #b91c1c; }
.mv-tab.order.on { color: #b45309; }
.mv-tab-ind { position: absolute; bottom: -1px; left: 8px; width: calc((100% - 16px) / 2); height: 3px; border-radius: 3px 3px 0 0; background: #1f3d45; transition: transform 0.24s cubic-bezier(0.4,0,0.2,1), background-color 0.18s; }
.mv-tab-ind.order { background: #f59e0b; }
.mv-tab-ind.in  { background: #10b981; }
.mv-tab-ind.out { background: #ef4444; }
.mv-swipe-hint { text-align: center; font-size: 10.5px; font-weight: 700; color: #bfd6dc; letter-spacing: 0.08em; padding: 5px 0 0; background: #f6fafb; }

.mv-gear { border: none; background: none; font-size: 18px; color: #4c6a72; cursor: pointer; padding: 4px 2px; -webkit-tap-highlight-color: transparent; }
.mv-gear.alone { margin-left: auto; }
.mv-tab-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #f59e0b; margin-left: 4px; vertical-align: middle; }
.mv-tab-badge { display: inline-block; font-size: 10px; font-weight: 800; color: #fff; background: #f59e0b; border-radius: 9px; padding: 0 5px; margin-left: 4px; vertical-align: middle; }
.mv-beta { margin-left: 6px; font-size: 10px; font-weight: 800; color: #b45309; background: #fffbeb; border: 1px solid #fde68a; border-radius: 7px; padding: 1px 5px; }

/* 発注タブ（既存の発注セッションへの入口） */
.mv-order-err { background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c; border-radius: 10px; padding: 9px 12px; font-size: 13px; margin-bottom: 10px; }
.mv-sched { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 56px; padding: 10px 12px; margin-bottom: 10px; border: 1.5px solid #d6e6ea; border-radius: 12px; background: #fff; cursor: pointer; text-align: left; -webkit-tap-highlight-color: transparent; }
.mv-sched-ico { flex-shrink: 0; font-size: 18px; }
.mv-sched-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.mv-sched-sum { font-size: 13.5px; font-weight: 700; color: #1f3d45; }
.mv-scheds { display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px; }
.mv-scheds .mv-sched { margin-bottom: 0; }   /* 間隔は gap が持つ */
.mv-sched.today { border-color: #fdba74; background: #fffbf5; }
.mv-sched-head { display: flex; align-items: center; gap: 6px; }
.mv-sched-name { font-size: 13.5px; font-weight: 800; color: #12303a; }
.mv-sched-today { padding: 1px 7px; border-radius: 999px; background: #fff7ed; color: #c2410c; font-size: 11px; font-weight: 800; }
.mv-scheds-ctx { font-size: 11.5px; color: #7d969c; margin: 0; padding: 0 2px; }
.mv-sched-dl { font-size: 12px; color: #b45309; font-weight: 800; }
.mv-sched-dl.past { color: #b91c1c; }
.mv-sched-ctx { font-size: 11.5px; color: #7d969c; }
.mv-sched-edit { flex-shrink: 0; font-size: 12px; font-weight: 800; color: #0e7490; }

.mv-order-start, .mv-order-resume {
  display: flex; flex-direction: column; gap: 3px; width: 100%;
  padding: 14px; margin-bottom: 12px; border-radius: 12px; border: none;
  cursor: pointer; text-align: left; -webkit-tap-highlight-color: transparent;
}
.mv-order-start { background: #fff7ed; border: 1.5px solid #fed7aa; }
.mv-order-start:disabled { opacity: 0.5; cursor: not-allowed; }
.mv-order-start-title { font-size: 15px; font-weight: 800; color: #c2410c; }
.mv-order-start-sub { font-size: 12px; color: #b45309; }
.mv-order-resume { background: linear-gradient(135deg, #fb923c 0%, #ea580c 100%); }
.mv-order-resume-title { font-size: 14px; font-weight: 800; color: #fff; }
.mv-order-resume-sub { font-size: 11.5px; color: #ffedd5; }
.mv-order-resume-go { font-size: 13px; font-weight: 800; color: #fff; margin-top: 4px; }

/* 表はページ直下に置く（棚卸・発注と同じ地続きの見え方）。
   以前は padding + max-width + 独自スクロールの3重の入れ子で、表が「箱の中の小さい表」に見えていた。
   左右の余白は表自身（.inventory-section の 16px）とコントロール群の wrapper が持つ。 */
/* 横スワイプはこの要素が受け持つ（pan-y = 縦だけブラウザに任せる）。
   宣言しないと Android Chrome が同じ指の動きを『進む・戻る』のエッジ操作として
   一緒に処理し、履歴が1つ余分に進む。この画面は戻るを履歴で受けているので、
   受け皿を横取りされてアプリごと閉じる。overscroll-behavior-x でも同じ操作を止める。 */
.mv-scroll { flex: 1; width: 100%; overflow-x: hidden; touch-action: pan-y; overscroll-behavior-x: contain; }
.mv-controls-wrap { padding: 14px 16px 0; }
.mv-page { animation: mv-slide-fwd 0.22s ease; }
.mv-page.back { animation: mv-slide-back 0.22s ease; }
@keyframes mv-slide-fwd  { from { opacity: 0; transform: translateX(26px); } to { opacity: 1; transform: none; } }
@keyframes mv-slide-back { from { opacity: 0; transform: translateX(-26px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .mv-page, .mv-page.back { animation: none; } }

.mv-controls { display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px; }
.mv-ctl-row { display: flex; align-items: center; gap: 10px; }
.mv-ctl-label { font-size: 13px; font-weight: 700; color: #4c6a72; flex-shrink: 0; }
.mv-date { flex: 1; border: 1.5px solid #d6e6ea; border-radius: 10px; padding: 8px 10px; font-size: 14px; color: #12303a; background: #fff; }
.mv-note { border: 1.5px solid #d6e6ea; border-radius: 10px; padding: 10px 12px; font-size: 14px; }

.mv-order-row { display: flex; align-items: center; gap: 8px; background: #fff; border: 1px solid #fed7aa; border-radius: 10px; padding: 8px 10px; }
.mv-order-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.mv-order-when { font-size: 13px; font-weight: 700; color: #c2410c; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mv-order-meta { font-size: 11px; color: #b45309; }
.mv-order-apply { flex-shrink: 0; border: none; background: linear-gradient(135deg, #fb923c 0%, #ea580c 100%); color: #fff; border-radius: 9px; padding: 8px 14px; font-size: 13px; font-weight: 800; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.mv-order-apply:active { transform: scale(0.97); }
.mv-orders { margin-bottom: 10px; background: #fff7ed; border: 1px solid #fed7aa; border-radius: 12px; padding: 10px 12px; }
.mv-orders-title { font-size: 13px; font-weight: 800; color: #9a3412; margin-bottom: 8px; }
.mv-orders-list { display: flex; flex-direction: column; gap: 6px; }
.mv-orders-note { font-size: 10.5px; color: #b45309; margin-top: 7px; line-height: 1.5; }
.mv-linked { font-size: 12px; font-weight: 600; color: #9a3412; background: #fff7ed; border: 1px solid #fed7aa; border-radius: 10px; padding: 8px 10px; display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.mv-linked-clear { margin-left: auto; border: none; background: none; color: #ea580c; font-size: 12px; font-weight: 700; cursor: pointer; flex-shrink: 0; }

.mv-search { width: 100%; border: 1.5px solid #d6e6ea; border-radius: 10px; padding: 10px 12px; font-size: 14px; margin-bottom: 8px; }
.mv-search:focus { outline: none; border-color: #7d969c; }
.mv-hint { font-size: 11.5px; color: #7d969c; margin-bottom: 10px; line-height: 1.6; }
/* 理論在庫の誤差要因は隠さない（甘い数字を出さない） */
.mv-hint-caveat { color: #b45309; }

/* 在庫タブの数量セル。表の qty-display と同じ形で、要補充だけ色を変える */
.mv-theo-cell.low { color: #b91c1c; }

/* 在庫タブ: 発注点の一括設定への導線（フィルターの並びに置く） */
.mv-rb-btn {
  border: 1.5px solid #fecaca; background: #fff; color: #b91c1c;
  border-radius: 16px; min-height: 34px; padding: 4px 12px;
  font-size: 12.5px; font-weight: 700; cursor: pointer; white-space: nowrap;
  -webkit-tap-highlight-color: transparent;
}
.mv-rb-btn:active { background: #fef2f2; }


/* 品目詳細（在庫タブ・タップ展開） */




/* 保存バー。棚卸の完了バー（.app-footer + .btn-complete）と同じ構成:
   件数を1行目に中央寄せ、2行目に幅いっぱいの主ボタン。
   ラベルは「記録」のまま（「完了」は確定・ロックを意味するので使わない）。 */
.mv-savebar {
  position: sticky; bottom: var(--app-footer-h, 0px);
  padding: 10px 16px calc(10px + env(safe-area-inset-bottom));
  background: #fff; border-top: 1px solid #d6e6ea;
  max-width: 620px; margin: 0 auto; width: 100%; box-sizing: border-box;
}
.mv-save-summary { text-align: center; font-size: 13px; font-weight: 700; margin-bottom: 8px; }
.mv-sum.in { color: #059669; }
.mv-sum.out { color: #dc2626; }
.mv-sum.none { color: #7d969c; }
.mv-save-actions { display: flex; gap: 10px; }
.mv-save {
  flex: 1; border: none; border-radius: 12px; padding: 14px;
  font-size: 15px; font-weight: 700; color: #fff; cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.mv-save.in  { background: #16a34a; }
.mv-save.out { background: #dc2626; }
.mv-save:disabled { opacity: 0.4; cursor: not-allowed; }
.mv-save:active:not(:disabled) { opacity: 0.85; }
</style>
