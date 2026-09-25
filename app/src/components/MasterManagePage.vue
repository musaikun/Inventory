<script setup>
import { ref, computed, onUnmounted } from 'vue'
import { useConfig } from '../composables/useConfig.js'
import { useHistory } from '../composables/useHistory.js'
import { shopCode } from '../composables/useStore.js'
import { showAxisAssign, axisAssignInitial, settingsSection, registerInnerLayerCloser } from '../composables/appMenuState.js'
import { useDataImport } from '../composables/useDataImport.js'
import { runBusy, HEAVY_ROWS } from '../composables/useBusy.js'
import InventoryTable from './InventoryTable.vue'
import DeliveryImportModal from './DeliveryImportModal.vue'
import PastStocktakeImportModal from './PastStocktakeImportModal.vue'
import RowMapperModal from './RowMapperModal.vue'
import PdfGridSetup from './PdfGridSetup.vue'

const emit = defineEmits(['back', 'clear-master'])

const { config, itemCount, exportConfigCSV } = useConfig()
const { getSnapshots, exportSnapshotCSV } = useHistory()

// ── 過去データ取込（納品・棚卸）＋ 書き出し ─────────────────────
const {
  showDeliveryModal, deliveryCsv, deliveryFilename, importCtx, existingMovements,
  openDeliveryFromFile, closeDelivery, onDeliveryImported, downloadDeliveryTemplate,
  showStocktakeModal, stocktakePlan, stocktakeFilename,
  rowMapper, closeRowMapper, applyRowMapping, mapDeliveryColumns,
  pdfSetup, closePdfSetup, applyPdfSetup,
  askRecipe, recipeName, savedRecipe, recipes, confirmSaveRecipe, dismissRecipe,
  openStocktakeFromFile, closeStocktake, setStocktakeResolution,
  confirmStocktakeImport, undoStocktakeImport,
} = useDataImport()

const deliveryFileInput  = ref(null)
const stocktakeFileInput = ref(null)
function pickDelivery()  { deliveryFileInput.value?.click() }
function pickStocktake() { stocktakeFileInput.value?.click() }
function onDeliveryFile(e)  { const f = e.target.files?.[0]; e.target.value = ''; openDeliveryFromFile(f) }
function onStocktakeFile(e) { const f = e.target.files?.[0]; e.target.value = ''; openStocktakeFromFile(f) }

function _download(text, filename) {
  const blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}
// CSVの組み立ては同期で、品目が多いと数百ms止まる。止まっている間は旗を立てても
// 描画されないので、多いときだけ先に描いてから始める（少ないときに待たせないため）。
function exportMasterCsv() {
  if (itemCount.value === 0) { alert('出力する品目がありません。'); return }
  return runBusy('書き出し中…', () => {
    _download(exportConfigCSV(), `品目マスタ_${new Date().toISOString().slice(0, 10)}.csv`)
  }, { paintFirst: itemCount.value >= HEAVY_ROWS })
}
function exportLatestSnapshotCsv() {
  const snap = getSnapshots()[0]
  if (!snap) { alert('棚卸の履歴がまだありません。'); return }
  return runBusy('書き出し中…', () => {
    _download(exportSnapshotCSV(snap), `棚卸結果_${snap.date}.csv`)
  }, { paintFirst: (snap.items ?? []).length >= HEAVY_ROWS })
}
const latestSnapshotDate = computed(() => getSnapshots()[0]?.date ?? null)

const hiddenSet  = computed(() => new Set(config.hiddenItems))

// 設定済み品目一覧はページとして開く。非表示の品目もここのチップ
// （非表示設定品目・非表示にした順）で見る。以前は別の「非表示中」ブロックがあった
const listOpen = ref(false)
function openList()  { activeHelp.value = ''; listOpen.value = true }
function closeList() { listOpen.value = false }


// ── 各セクションのヘルプ（「?」で開閉） ─────────────────────────
const HELP = {
  import: 'CSV・Excel・PDFファイルから品目を一括登録・更新します。品目名が一致するものは上書き、無いものは追加され、ファイルに載っていない品目はそのまま残ります。取り込む前に追加・更新・除外の件数と差分を確認できます。ファイルの内容だけにする「全入れ替え」も確認画面から選べます。',
  delivery: '過去の納品履歴（CSV・Excel）を入庫として一括取り込みます。「種別」列に出庫（出荷・廃棄・ロス・返品）とある行は出庫として記録します。取込前に品目への対応づけ・重複チェックを確認できます。同じファイルを二度入れても二重になりません。取り込んだ日は履歴カレンダーに星が出ます。',
  stocktake: '過去の棚卸結果（日付つきCSV）を実行済みの棚卸として取り込みます。納品と両方を入れると、消費量・適正在庫・発注の理論値が過去に遡って算出されます。',
  axis: '棚卸・発注カードに品目が出てくる順番を決めるところです。「保管場所」「仕入先」などのグループを作り、「グループ化・並び替え」で品目をその中へまとめ、まとまりの中の順番も変えられます。ジャンルは取込元データ由来のグループで、名前も中身も編集できません。',
  list: '登録済みの全品目を、実際の棚卸・発注カードと同じ表示で確認できます。上のチップでジャンル・作ったグループ（設定済みグループの枠の中）・非表示設定品目・非表示にした順を切り替えられます。非表示設定品目はジャンル別に出ます。「非表示にした順」は最後に隠したものが先頭に来るので、誤って隠したものを遡って探せます。この表は確認用で、数量や設定は変えられません。',
  delete: '登録済みの品目をすべて削除します。取り消せません。誤操作防止のため店舗コードの入力が必要です。分類名やグループ定義・振り分けの記憶は既定で残ります。',
}
const activeHelp = ref('')
function toggleHelp(k) { activeHelp.value = activeHelp.value === k ? '' : k }

// ── 取り込む / 書き出す（押してから種類を選ぶ）──────────────
// 入口を1つずつにしたので、種類の選択はここで受ける。
// 入口に「何を覚えているか」を出す。名前が読めないと、どのファイルを入れる場所なのか
// 分からず、結局はじめての入口へ戻ってしまう
const _recipeNames = (kind) => {
  const names = (recipes.value ?? []).filter(r => (r.for ?? 'items') === kind).map(r => r.name)
  if (!names.length) return ''
  return names.length <= 2 ? names.join('・') : `${names.slice(0, 2).join('・')} ほか${names.length - 2}件`
}
const deliveryRecipes  = computed(() => _recipeNames('delivery'))
const stocktakeRecipes = computed(() => _recipeNames('stocktake'))

const picker = ref('')   // '' | 'import' | 'export'
function openPicker(kind) { activeHelp.value = ''; picker.value = kind }
function closePicker()    { picker.value = ''; activeHelp.value = '' }
// 選んだらシートは閉じる。取込はこの後それぞれの確認画面が開く
function runPick(fn) { closePicker(); fn() }
// 戻るは、この画面を閉じる前にシートを閉じる（独自実装せず既存の段に乗せる）
onUnmounted(registerInnerLayerCloser(() => {
  if (picker.value) { closePicker(); return true }
  if (listOpen.value) { closeList(); return true }
  return false
}))

function openReorder(idx) { axisAssignInitial.value = idx; showAxisAssign.value = true }

/**
 * 「グループ化・並び替え」の入口。
 *
 * 以前はグループの行ごとに「振り分け →」を置いていた。グループが2つあると入口も2つに
 * なり、**どちらを押すかを決めてからでないと入れない**。開く画面は同じで、中に
 * グループのタブがあるのだから、入口は1つでいい。名前の付いた最初のグループで開く。
 */
const firstNamedAxis = computed(() => ((config.axisNames ?? [])[0] ? 0 : 1))
function openListOrganize() { openReorder(firstNamedAxis.value) }

// ── 品目リスト整理 ──────────────────────────────────────────
// ここはカード1枚だけにする。グループの作成・名前の変更・削除は
// **開いた先（グループ化・並び替え）で行う** ── 設定する場所と使う場所が離れていると、
// 「未設定です。管理画面で追加してください」と突き放されて往復することになる。
const namedAxes = computed(() => (config.axisNames ?? []).filter(n => (n || '').trim()))
const hasGenres = computed(() => Object.keys(config.categories || {}).length > 0)
const organizeSub = computed(() => {
  const names = [...(hasGenres.value ? ['ジャンル別'] : []), ...namedAxes.value]
  return names.length
    ? `${names.join(' ・ ')} でまとめて、数える順番に並べる`
    : 'グループを作って、品目をまとめる'
})

// ── 一括削除（店舗コード入力ゲート）─────────────────────────────
const delCode = ref('')
const resetAssign = ref(false)   // 振り分け（品目→分類先の割り当て）の記憶も消すか
const canDelete = computed(() => !!shopCode.value && delCode.value.trim().toUpperCase() === shopCode.value)
function onClear() {
  if (!canDelete.value) return
  const note = resetAssign.value
    ? '\n振り分け（分類先の割り当て）の記憶も消去します。'
    : '\n（軸の名前・グループ定義・振り分けの記憶は残り、同じ品目を再登録すれば割り当ては復活します）'
  if (!confirm(`登録済みの品目 ${itemCount.value} 件をすべて削除します。${note}\nこの操作は取り消せません。本当に削除しますか？`)) return
  emit('clear-master', { resetAssignments: resetAssign.value })
  delCode.value = ''
  resetAssign.value = false
}
</script>

<template>
  <div class="mp">
    <header class="mp-header">
      <button class="mp-back" @click="emit('back')">‹ 戻る</button>
      <span class="mp-title">🗂 データ管理</span>
      <span class="mp-count">{{ itemCount }}件</span>
    </header>

    <div class="mp-scroll">
      <!-- 取り込む / 書き出す。入口は1つずつにして、押してから種類を選ぶ。
           以前は5つの行が並んでいて、画面の最初に出るものが一番迷う場所になっていた。 -->
      <div class="mm-card">
        <div class="mm-row-wrap">
          <button class="mm-row" @click="openPicker('import')">
            <span class="mm-row-ico">📥</span>
            <span class="mm-row-body">
              <span class="mm-row-title">取り込む</span>
              <span class="mm-row-sub">品目リスト／過去の納品／過去の棚卸（CSV・Excel・PDF）</span>
            </span>
            <span class="mm-row-arrow">→</span>
          </button>
        </div>
        <div class="mm-row-wrap">
          <button class="mm-row" @click="openPicker('export')">
            <span class="mm-row-ico">📤</span>
            <span class="mm-row-body">
              <span class="mm-row-title">書き出す</span>
              <span class="mm-row-sub">品目リスト／棚卸結果（CSV）</span>
            </span>
            <span class="mm-row-arrow">↓</span>
          </button>
        </div>
      </div>

      <!-- 整える -->
      <div class="mm-section-label">整える・確認</div>

      <!-- 品目リスト整理。カード1枚だけ。グループの作成・変更は開いた先で行う -->
      <div class="mm-block">
        <div class="mm-block-head">
          <span class="mm-block-title">品目リスト整理</span>
          <button class="mm-help-btn" :class="{ on: activeHelp === 'axis' }" @click="toggleHelp('axis')">?</button>
        </div>
        <div v-if="activeHelp === 'axis'" class="mm-help">{{ HELP.axis }}</div>

        <button class="mm-organize" @click="openListOrganize">
          <span class="mm-organize-ico">⇅</span>
          <span class="mm-organize-body">
            <span class="mm-organize-title">グループ化・並び替え</span>
            <span class="mm-organize-sub">{{ organizeSub }}</span>
          </span>
          <span class="mm-organize-arrow">→</span>
        </button>
      </div>

      <!-- 設定済み品目一覧。表は別ページで開く（常に出すと、この画面の他の操作の邪魔になる）。
           非表示の品目もこの中のチップで見る -->
      <div class="mm-block">
        <div class="mm-head-row">
          <div class="mm-block-head">
            <span class="mm-block-title">設定済み品目一覧</span>
          </div>
          <button class="mm-help-btn" :class="{ on: activeHelp === 'list' }" @click="toggleHelp('list')">?</button>
        </div>
        <div v-if="activeHelp === 'list'" class="mm-help">{{ HELP.list }}</div>
        <button class="mm-organize mm-listopen" @click="openList">
          <span class="mm-organize-ico">📋</span>
          <span class="mm-organize-body">
            <span class="mm-organize-title">品目一覧を開く（{{ itemCount }}件）</span>
            <span class="mm-organize-sub">ジャンル・グループ・非表示（{{ hiddenSet.size }}件）をチップで切り替えて確認</span>
          </span>
          <span class="mm-organize-arrow">→</span>
        </button>
      </div>

      <!-- 一括削除（危険操作・店舗コードゲート） -->
      <div v-if="itemCount > 0" class="mm-block danger">
        <div class="mm-block-head">
          <span class="mm-block-title danger">品目マスタを一括削除</span>
          <button class="mm-help-btn danger" :class="{ on: activeHelp === 'delete' }" @click="toggleHelp('delete')">?</button>
        </div>
        <div v-if="activeHelp === 'delete'" class="mm-help">{{ HELP.delete }}</div>
        <div class="mm-block-sub">
          登録済みの品目をすべて削除します（軸の名前・グループ定義は残ります）。取り消せません。<br>
          削除するには店舗コード <b>{{ shopCode || '（未取得）' }}</b> を入力してください。
        </div>
        <input class="mm-del-input" v-model="delCode" placeholder="店舗コードを入力" autocapitalize="characters" />
        <label class="mm-del-reset"><input type="checkbox" v-model="resetAssign" />振り分け（分類先の割り当て）の記憶も消す</label>
        <button class="mm-del-btn" :disabled="!canDelete" @click="onClear">全品目を削除</button>
      </div>
    </div>

    <!-- 設定済み品目一覧（ページ）。戻るで閉じる -->
    <div v-if="listOpen" class="mm-page" role="dialog" aria-modal="true" aria-label="設定済み品目一覧">
      <header class="mp-header">
        <button class="mp-back" @click="closeList">‹ 戻る</button>
        <span class="mp-title">設定済み品目一覧</span>
        <span class="mp-count">{{ itemCount }}件</span>
      </header>
      <div class="mp-scroll">
        <div class="mm-preview-hint">実際の棚卸・発注カードと同じ表示で、品目と振り分け先を確認できます。上のチップか、左右にスワイプで表示を切り替えられます。</div>
        <InventoryTable :preview="true" :inventory="{}" :filled-count="0" :read-only="true" :hidden-items="config.hiddenItems" :hidden-tabs="true" :swipe-tabs="true" />
      </div>
    </div>

    <!-- 取り込む / 書き出す の種類を選ぶ -->
    <div v-if="picker" class="mm-pick-back" @click.self="closePicker">
      <div class="mm-pick" role="dialog" aria-modal="true" :aria-label="picker === 'import' ? '取り込む種類を選ぶ' : '書き出す種類を選ぶ'">
        <div class="mm-pick-head">
          <span class="mm-pick-title">{{ picker === 'import' ? '何を取り込みますか？' : '何を書き出しますか？' }}</span>
          <button class="mm-pick-close" aria-label="閉じる" @click="closePicker">✕</button>
        </div>

        <template v-if="picker === 'import'">
          <div class="mm-row-wrap">
            <button class="mm-row" @click="runPick(() => settingsSection = 'import')">
              <span class="mm-row-ico">📋</span>
              <span class="mm-row-body">
                <span class="mm-row-title">品目リスト</span>
                <span class="mm-row-sub">CSV・Excel から（PDF はβ）・既存の品目は消えません</span>
              </span>
              <span class="mm-help-btn" :class="{ on: activeHelp === 'import' }" @click.stop="toggleHelp('import')">?</span>
              <span class="mm-row-arrow">→</span>
            </button>
            <div v-if="activeHelp === 'import'" class="mm-help">{{ HELP.import }}</div>
          </div>
          <div class="mm-row-wrap">
            <button class="mm-row" @click="runPick(pickDelivery)">
              <span class="mm-row-ico">🧾</span>
              <span class="mm-row-body">
                <span class="mm-row-title">過去の納品</span>
                <span class="mm-row-sub">
                  CSV・Excel・PDF から（既定は入庫・種別列で出庫も）
                  <template v-if="deliveryRecipes">・覚えている読み方: {{ deliveryRecipes }}</template>
                </span>
              </span>
              <span class="mm-help-btn" :class="{ on: activeHelp === 'delivery' }" @click.stop="toggleHelp('delivery')">?</span>
              <span class="mm-row-arrow">→</span>
            </button>
            <div v-if="activeHelp === 'delivery'" class="mm-help">
              {{ HELP.delivery }}
              <button class="mm-tmpl-link" @click="downloadDeliveryTemplate">テンプレCSVをダウンロード</button>
            </div>
          </div>
          <div class="mm-row-wrap">
            <button class="mm-row" @click="runPick(pickStocktake)">
              <span class="mm-row-ico">🧮</span>
              <span class="mm-row-body">
                <span class="mm-row-title">過去の棚卸</span>
                <span class="mm-row-sub">
                  CSV・Excel・PDF から。消費・適正在庫・発注の理論値に必要
                  <template v-if="stocktakeRecipes">・覚えている読み方: {{ stocktakeRecipes }}</template>
                </span>
              </span>
              <span class="mm-help-btn" :class="{ on: activeHelp === 'stocktake' }" @click.stop="toggleHelp('stocktake')">?</span>
              <span class="mm-row-arrow">→</span>
            </button>
            <div v-if="activeHelp === 'stocktake'" class="mm-help">{{ HELP.stocktake }}</div>
          </div>
        </template>

        <template v-else>
          <div class="mm-row-wrap">
            <button class="mm-row" @click="runPick(exportMasterCsv)">
              <span class="mm-row-ico">📋</span>
              <span class="mm-row-body">
                <span class="mm-row-title">品目リスト</span>
                <span class="mm-row-sub">現在の品目マスタ（CSV・{{ itemCount }}件）</span>
              </span>
              <span class="mm-row-arrow">↓</span>
            </button>
          </div>
          <div class="mm-row-wrap">
            <button class="mm-row" @click="runPick(exportLatestSnapshotCsv)">
              <span class="mm-row-ico">🧮</span>
              <span class="mm-row-body">
                <span class="mm-row-title">棚卸結果</span>
                <span class="mm-row-sub">{{ latestSnapshotDate ? `直近の入力済み（${latestSnapshotDate}）` : '履歴がまだありません' }}</span>
              </span>
              <span class="mm-row-arrow">↓</span>
            </button>
          </div>
        </template>
      </div>
    </div>

    <!-- 取込ファイル入力（常設・非表示）-->
    <!-- 拡張子だけだと、iOSやAndroidのpickerがCSV/Excelを候補に出せないことがある。MIMEも併記する -->
    <input ref="deliveryFileInput" type="file" accept=".csv,.pdf,.xlsx,.xls,text/csv,text/comma-separated-values,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" class="mm-hidden-file" @change="onDeliveryFile" />
    <input ref="stocktakeFileInput" type="file" accept=".csv,.pdf,.xlsx,.xls,text/csv,text/comma-separated-values,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" class="mm-hidden-file" @change="onStocktakeFile" />

    <PastStocktakeImportModal
      v-if="showStocktakeModal && stocktakePlan"
      :plan="stocktakePlan"
      :filename="stocktakeFilename"
      :confirm-import="confirmStocktakeImport"
      :undo-import="undoStocktakeImport"
      @resolve="({ date, resolution }) => setStocktakeResolution(date, resolution)"
      @close="closeStocktake"
    />

    <DeliveryImportModal
      v-if="showDeliveryModal"
      :csv-text="deliveryCsv"
      :filename="deliveryFilename"
      :ctx="importCtx"
      :existing-movements="existingMovements()"
      @imported="onDeliveryImported"
      @map-columns="mapDeliveryColumns"
      @close="closeDelivery"
    />

    <!-- 自動で読み取れなかったファイルの受け皿（納品・棚卸で共通）-->
    <!-- 紙の納品書・棚卸表。表に均してから、CSV・Excel とまったく同じ経路へ合流する -->
    <PdfGridSetup
      v-if="pdfSetup"
      :file="pdfSetup.file"
      :pages="pdfSetup.pages"
      :initial="pdfSetup.initial"
      @ready="applyPdfSetup"
      @close="closePdfSetup"
    />

    <!-- 取り込めたあとで、この読み方に名前を付けて覚える。訊くのは**取り込んだ後**
         （合っていたと分かる前に名前を付けさせても、何に名前を付けているのか分からない） -->
    <div v-if="askRecipe" class="mm-rec-back" @click.self="dismissRecipe">
      <div class="mm-rec" role="dialog" aria-modal="true" aria-label="読み方を保存">
        <div class="mm-rec-t">この読み方を覚えますか？</div>
        <p class="mm-rec-n">
          同じ形のファイルなら、次からは問いが出ません。
          <span v-if="askRecipe.filename" class="mm-rec-f">{{ askRecipe.filename }}</span>
        </p>
        <input v-model="recipeName" class="mm-rec-in" type="text" placeholder="読み方の名前" maxlength="40" />
        <div class="mm-rec-btns">
          <button class="btn btn-secondary" @click="dismissRecipe">覚えない</button>
          <button class="btn btn-primary" @click="confirmSaveRecipe">覚える</button>
        </div>
      </div>
    </div>
    <div v-else-if="savedRecipe" class="mm-rec-done">✓ 読み方「{{ savedRecipe }}」を覚えました</div>

    <RowMapperModal
      v-if="rowMapper"
      :kind="rowMapper.kind"
      :csv-text="rowMapper.csvText"
      :filename="rowMapper.filename"
      :title="rowMapper.title"
      :message="rowMapper.message"
      :fields="rowMapper.fields"
      @apply="applyRowMapping"
      @close="closeRowMapper"
    />
  </div>
</template>

<style scoped>
.mp { min-height: 100vh; background: #f8fafc; }
.mp-header {
  position: sticky; top: 0; z-index: 2;
  display: flex; align-items: center; gap: 10px;
  padding: 12px 14px; background: #fff; border-bottom: 1px solid #e2e8f0;
}
.mp-back { border: none; background: none; color: var(--primary, #2563eb); font-size: 14px; font-weight: 700; cursor: pointer; padding: 4px 2px; }
.mp-title { font-size: 16px; font-weight: 800; color: #1e293b; }
.mp-count { margin-left: auto; font-size: 13px; font-weight: 800; color: var(--primary, #2563eb); }
.mp-scroll { padding: 14px; max-width: 620px; margin: 0 auto; }

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

.mm-row-wrap { margin-bottom: 12px; }
.mm-row-wrap .mm-row { margin-bottom: 0; }

/* 同じ用途の行は1枚のカードにまとめ、区切り線だけで分ける */
.mm-card {
  background: #fff; border: 1px solid #e2e8f0; border-radius: 12px;
  overflow: hidden; margin-bottom: 12px;
}
.mm-card .mm-row-wrap { margin-bottom: 0; }
.mm-card .mm-row-wrap + .mm-row-wrap { border-top: 1px solid #f1f5f9; }
.mm-card .mm-row { border: none; border-radius: 0; background: transparent; }
.mm-card .mm-help { margin: 0 14px 12px; }

.mm-section-label {
  font-size: 12px; font-weight: 800; color: #94a3b8;
  letter-spacing: 0.04em; margin: 4px 2px 8px; text-transform: none;
}
.mm-section-label:not(:first-child) { margin-top: 6px; }
.mm-tmpl-link {
  display: block; margin-top: 8px; border: none; background: none;
  color: var(--primary, #2563eb); font-size: 12px; font-weight: 700;
  text-decoration: underline; cursor: pointer; padding: 0;
}
.mm-organize { display: flex; align-items: center; gap: 11px; width: 100%; text-align: left;
  border: 1.5px solid var(--primary-border); background: var(--primary-weak);
  border-radius: 12px; padding: 12px 13px; margin-bottom: 12px; cursor: pointer; }
.mm-organize:active { transform: scale(.995); }
.mm-organize-ico { font-size: 19px; color: var(--primary); flex-shrink: 0; }
.mm-organize-body { flex: 1; min-width: 0; }
.mm-organize-title { display: block; font-size: 14px; font-weight: 800; color: var(--text); }
.mm-organize-sub { display: block; font-size: 11px; line-height: 1.5; color: var(--text-muted); margin-top: 2px; }
.mm-organize-arrow { flex-shrink: 0; color: var(--primary); font-weight: 800; }

.mm-rec-back { position: fixed; inset: 0; z-index: 70; background: rgba(15, 23, 42, 0.5);
  display: flex; align-items: center; justify-content: center; padding: 18px; }
.mm-rec { background: var(--surface); border-radius: 14px; padding: 16px; width: 100%; max-width: 380px; }
.mm-rec-t { font-size: 15px; font-weight: 800; color: var(--text); margin-bottom: 6px; }
.mm-rec-n { font-size: 11.5px; line-height: 1.6; color: var(--text-muted); margin: 0 0 10px; }
.mm-rec-f { display: block; font-weight: 700; color: var(--text); }
.mm-rec-in { width: 100%; border: 1.5px solid var(--border); border-radius: 10px;
  padding: 10px 12px; font-size: 14px; margin-bottom: 12px; }
.mm-rec-btns { display: flex; gap: 10px; }
.mm-rec-btns .btn { flex: 1; }
.mm-rec-done { position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%); z-index: 70;
  background: var(--primary); color: #fff; border-radius: 20px; padding: 8px 16px;
  font-size: 12px; font-weight: 800; }

.mm-hidden-file { display: none; }

.mm-head-row { display: flex; align-items: center; gap: 8px; }
.mm-head-row .mm-block-head { flex: 1; }

.mm-help-btn {
  flex-shrink: 0;
  width: 22px; height: 22px;
  display: inline-flex; align-items: center; justify-content: center;
  margin-left: auto;
  border: 1px solid #cbd5e1; border-radius: 50%;
  background: #fff; color: #94a3b8;
  font-size: 12px; font-weight: 800; line-height: 1;
  cursor: pointer;
}
.mm-help-btn.on { background: var(--primary, #2563eb); color: #fff; border-color: var(--primary, #2563eb); }
.mm-help-btn.danger.on { background: #dc2626; border-color: #dc2626; }

.mm-help {
  font-size: 12px; line-height: 1.7; color: #475569;
  background: #f8fafc; border: 1px solid #e2e8f0;
  border-left: 3px solid var(--primary, #2563eb);
  border-radius: 8px; padding: 9px 12px; margin: 8px 0 2px;
}

.mm-block { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px 14px; margin-bottom: 12px; }
.mm-block.danger { border-color: #fecaca; }
.mm-block-head { display: flex; align-items: center; gap: 8px; width: 100%; border: none; background: none; padding: 0; }
.mm-toggle { cursor: pointer; }
.mm-block-title { font-size: 14px; font-weight: 800; color: #334155; }
.mm-block-title.danger { color: #dc2626; }
.mm-block-note { margin-left: auto; font-size: 12px; font-weight: 700; color: #94a3b8; }
.mm-block-sub { font-size: 12px; color: #64748b; margin: 8px 0; line-height: 1.6; }
.mm-empty { font-size: 12px; color: #94a3b8; margin-top: 8px; }

/* 取り込む / 書き出す の種類を選ぶシート */
.mm-pick-back { position: fixed; inset: 0; z-index: 40; background: rgba(15, 23, 42, 0.45); display: flex; align-items: flex-end; justify-content: center; }
.mm-pick { width: 100%; max-width: 560px; max-height: 84vh; overflow-y: auto; background: #fff; border-radius: 18px 18px 0 0; padding: 4px 12px 22px; box-shadow: 0 -8px 30px rgba(0,0,0,0.25); animation: mm-pick-up 0.22s cubic-bezier(0.22,0.8,0.28,1); }
@keyframes mm-pick-up { from { transform: translateY(100%); } to { transform: translateY(0); } }
.mm-pick-head { display: flex; align-items: center; gap: 10px; padding: 12px 4px 10px; }
.mm-pick-title { font-size: 15px; font-weight: 800; color: #1e293b; }
.mm-pick-close { margin-left: auto; border: none; background: none; font-size: 18px; color: #94a3b8; cursor: pointer; padding: 2px 6px; }
@media (prefers-reduced-motion: reduce) { .mm-pick { animation: none; } }


.mm-axis-row { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.mm-axis-label { font-size: 12px; font-weight: 800; color: #64748b; width: 58px; flex-shrink: 0; }
.mm-axis-input { flex: 1; min-width: 0; border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px 10px; font-size: 14px; }
.mm-axis-go { flex-shrink: 0; border: 1px solid var(--primary-border, #bfdbfe); background: #fff; color: var(--primary, #2563eb); border-radius: 8px; font-size: 12px; font-weight: 700; padding: 7px 12px; cursor: pointer; }
.mm-axis-name { flex: 1; min-width: 0; font-size: 15px; font-weight: 800; color: #1e293b; }
.mm-axis-confirm { flex-shrink: 0; border: none; background: var(--primary, #2563eb); color: #fff; border-radius: 8px; font-size: 13px; font-weight: 700; padding: 8px 16px; cursor: pointer; }
.mm-axis-confirm:disabled { background: #cbd5e1; cursor: not-allowed; }
.mm-axis-del { flex-shrink: 0; border: 1px solid #fecaca; background: #fff; color: #dc2626; border-radius: 8px; font-size: 12px; font-weight: 700; padding: 7px 12px; cursor: pointer; }
.mm-axis-edit { flex-shrink: 0; border: 1px solid #e2e8f0; background: #fff; color: #64748b; border-radius: 8px; font-size: 13px; font-weight: 700; padding: 6px 9px; cursor: pointer; }
.mm-axis-cancel { flex-shrink: 0; border: 1px solid #e2e8f0; background: #fff; color: #94a3b8; border-radius: 8px; font-size: 16px; line-height: 1; padding: 6px 11px; cursor: pointer; }
.mm-axis-add { flex: 1; min-width: 0; border: 1px dashed var(--primary-border, #bfdbfe); background: #fff; color: var(--primary, #2563eb); border-radius: 8px; font-size: 13px; font-weight: 700; padding: 10px; cursor: pointer; }
/* ジャンルは名前も中身も編集できない。触れるものが無いことを、空白ではなく言葉で出す */
.mm-axis-fixed { flex-shrink: 0; font-size: 11px; font-weight: 700; color: #94a3b8; background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 7px; padding: 5px 9px; white-space: nowrap; }
.mm-axis-err { font-size: 12px; font-weight: 700; color: #dc2626; margin: 6px 0 0 66px; line-height: 1.5; }




.mm-preview { margin-top: 10px; }
.mm-page { position: fixed; inset: 0; z-index: 30; background: #f8fafc; overflow-y: auto; }
.mm-preview-hint { font-size: 12px; color: #94a3b8; line-height: 1.5; margin-bottom: 8px; }

.mm-del-input { width: 100%; border: 1.5px solid #fecaca; border-radius: 8px; padding: 10px; font-size: 15px; letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 8px; }
.mm-del-reset { display: flex; align-items: center; gap: 8px; font-size: 12px; color: #64748b; margin-bottom: 10px; cursor: pointer; }
.mm-del-reset input { width: 16px; height: 16px; }
.mm-del-btn { width: 100%; border: none; border-radius: 10px; padding: 11px; background: #dc2626; color: #fff; font-size: 14px; font-weight: 800; cursor: pointer; }
.mm-del-btn:disabled { background: #fca5a5; cursor: not-allowed; }
</style>
