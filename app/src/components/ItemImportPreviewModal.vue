<script setup>
/**
 * 品目マスタ取込の確認画面（IMPORT-001）。
 *
 * 取り込む前に「何件が追加・更新・変更なしになり、何行が除外・エラーになるか」を必ず見せる。
 * **プレビューに出した計画オブジェクトをそのまま取込へ渡す**ので、表示と実際の書き換えは
 * 同じデータに基づく（同じファイルから2回組み立て直さない）。
 * 全入れ替えは既定から外し、明示的な確認を通した時だけ実行する。
 */
import { ref, computed, watch } from 'vue'
import {
  useConfig, IMPORT_MODE_MERGE, IMPORT_MODE_REPLACE,
  ALIAS_KEEP_EXISTING, ALIAS_TAKEOVER,
} from '../composables/useConfig.js'
import { useEscapeKey } from '../composables/useEscapeKey.js'
import { FREE_ITEM_LIMIT, isPro } from '../utils/planLimits.js'
import { confirmMasterImport } from '../utils/masterImportWarning.js'
import { summaryCounts, IMPORT_ERROR_NO_HEADER } from '../utils/itemImport.js'

const props = defineProps({
  // origin: 'csv'（推奨フォーマット）| 'mapped'（列指定）| 'pdf'（PDF/Excelから変換済み）
  origin:   { type: String, default: 'csv' },
  csvText:  { type: String, required: true },
  mapping:  { type: Object, default: null },
  filename: { type: String, default: '' },
  // 列指定取込で「1行目は見出し／データ」のどちらを選んだか。
  // マッピング画面 → 確認画面 → 確定処理まで同じ値を運ぶ（画面の説明と結果を一致させる）。
  hasHeader: { type: Boolean, default: true },
})
const emit = defineEmits(['imported', 'close', 'mapColumns'])

// キャンセル・Escape・オーバーレイクリックが重なっても、閉じる処理は1回だけ。
// このモーダルは閉じる経路で config を一切変更しない（取込は onConfirm だけ）。
const closed = ref(false)
function requestClose() {
  if (closed.value) return
  closed.value = true
  emit('close')
}
useEscapeKey(requestClose)

const { itemCount, planCSVImport, planMappedImport, applyImportPlan } = useConfig()

const mode             = ref(IMPORT_MODE_MERGE)
const aliasPolicy      = ref(null)          // null = 未選択（衝突があるうちは取込不可）
const replaceConfirmed = ref(false)
const importing        = ref(false)
const importError      = ref('')   // 取込実行時のエラー（解析エラーは preview 側）
const showDiff         = ref(false)
const showSkipped      = ref(false)
const showErrors       = ref(true)  // エラーは既定で開く（黙って除外しない）

const isMapped  = computed(() => props.origin === 'mapped')
const isReplace = computed(() => mode.value === IMPORT_MODE_REPLACE)

// 取込方法を選び直したら、確認チェックとエイリアスの解決もやり直す
watch(mode, () => { replaceConfirmed.value = false; aliasPolicy.value = null })

// 解析できないファイルはここでエラーになる。計画と一緒に1つの computed で持つ。
const preview = computed(() => {
  try {
    const opts = { mode: mode.value, aliasPolicy: aliasPolicy.value ?? ALIAS_KEEP_EXISTING }
    const plan = isMapped.value
      ? planMappedImport(props.csvText, props.mapping, { ...opts, hasHeader: props.hasHeader })
      : planCSVImport(props.csvText, opts)
    return { plan, error: '', errorCode: '', rowErrors: [] }
  } catch (err) {
    // 1行も取り込めない場合も、行番号・列・理由は出す（何が悪かったのか消さない）
    return { plan: null, error: err.message, errorCode: err.code ?? '', rowErrors: err.errors ?? [] }
  }
})

const plan      = computed(() => preview.value.plan)
const summary   = computed(() => plan.value?.summary ?? null)
const error     = computed(() => importError.value || preview.value.error)
const needsMapping = computed(() => preview.value.errorCode === IMPORT_ERROR_NO_HEADER)

// 解析に失敗したファイルは、この画面から列指定インポートへ渡せるようにする。
// 「形式を確認してください」で行き止まりにすると、推奨フォーマットに合わない
// 仕入先のCSVを取り込む手段が画面から消える（別画面のボタンを自力で探させない）。
const canMapColumns = computed(() => !!error.value && !!props.csvText)
const mapColumnsLabel = computed(() => (isMapped.value ? '列の指定をやり直す' : '列を指定して取り込む'))
function onMapColumns() {
  if (closed.value) return
  closed.value = true
  emit('mapColumns', { csvText: props.csvText, filename: props.filename })
}

const counts = computed(() => (summary.value ? summaryCounts(summary.value) : null))

const LIST_CAP = 20   // 長いリストは先頭だけ出し、残りは件数で示す
const cap = (list) => (list ?? []).slice(0, LIST_CAP)
const updatedSample   = computed(() => cap(summary.value?.updated))
const removedSample   = computed(() => cap(summary.value?.removed))
const skippedSample   = computed(() => cap(summary.value?.skipped))
const errorSample     = computed(() => cap(summary.value?.errors ?? preview.value.rowErrors))
const errorTotal      = computed(() => (summary.value?.errors ?? preview.value.rowErrors ?? []).length)
const conflicts       = computed(() => summary.value?.aliasConflicts ?? [])
const conflictSample  = computed(() => cap(conflicts.value))
// 衝突の種類ごとに文言を変える（「既存を守る」と「先頭行を守る」は別の話なので混ぜない）
const CONFLICT_KIND_LABEL = {
  existing: '既存の別名',
  item:     '既存の品目名',
  file:     'ファイル内で重複',
}
const conflictKinds = computed(() => {
  const kinds = { existing: false, item: false, file: false }
  for (const c of conflicts.value) if (c.kind in kinds) kinds[c.kind] = true
  return kinds
})
const truncatedNames  = computed(() => summary.value?.truncatedNames ?? [])
const categoryCodeChanges = computed(() => cap(summary.value?.categoryCodeChanges))
const axisNameChanges = computed(() => summary.value?.axisNameChanges ?? [])
const reorderCleared  = computed(() => summary.value?.reorderPointsCleared ?? [])

// エイリアス衝突が残っているうちは取り込ませない（どちらを優先するか明示させる）
const aliasUnresolved = computed(() => conflicts.value.length > 0 && aliasPolicy.value === null)

const canImport = computed(() =>
  !!plan.value && !importing.value && !aliasUnresolved.value
  && (!isReplace.value || replaceConfirmed.value)
)

function onConfirm() {
  if (!canImport.value) return
  // 全置換だけは最後にもう一段の同意を取る（S2 の確認をこの操作にだけ残した）。
  // 追加・更新は既存品目を消さないため確認を挟まない。
  if (isReplace.value && !confirmMasterImport(itemCount.value)) return
  importing.value   = true
  importError.value = ''
  try {
    // プレビューで見せたものと同じ計画をそのまま適用する
    emit('imported', applyImportPlan(plan.value))
  } catch (err) {
    importError.value = err.message
  } finally {
    importing.value = false
  }
}
</script>

<template>
  <div class="modal-overlay" @click.self="requestClose">
    <div class="modal-sheet preview-sheet" role="dialog" aria-modal="true" aria-labelledby="import-preview-title">
      <div class="sheet-handle"></div>
      <div class="sheet-title" id="import-preview-title">取込内容の確認</div>

      <p class="src-line">
        <span v-if="filename" class="src-file">{{ filename }}</span>
        <span v-if="origin === 'pdf'" class="beta-tag">PDF/Excel 読み取り（β）</span>
        <span v-if="isMapped" class="header-tag">
          {{ hasHeader ? '1行目は見出し' : '1行目からデータ' }}
        </span>
        <span class="src-now">現在の登録：{{ itemCount }}件</span>
      </p>

      <div v-if="error" class="msg error" role="alert" aria-live="assertive">
        ✗ {{ error }}
        <span v-if="needsMapping" class="msg-hint">
          列を指定して取り込み、<b>「1行目からデータ」</b>を選ぶと、1行目も品目として取り込めます。
        </span>
      </div>

      <!-- 推奨フォーマットに合わないファイルの受け皿。列を自分で指定して取り込む -->
      <button v-if="canMapColumns" class="map-columns-btn" @click="onMapColumns">
        🗂 {{ mapColumnsLabel }}
      </button>

      <!-- 1件も取り込めなかった場合でも、行番号・列・理由は出す -->
      <div v-if="!counts && errorTotal > 0" class="detail-block">
        <div class="detail-head">取り込めなかった行（{{ errorTotal }}行）</div>
        <div class="skip-list">
          <div v-for="(e, i) in errorSample" :key="i" class="skip-row">
            <span class="skip-line">{{ e.line }}行目</span>
            <span class="skip-name">{{ e.columnLabel }}</span>
            <span class="skip-reason">{{ e.reason }}</span>
          </div>
          <p v-if="errorTotal > errorSample.length" class="more">ほか{{ errorTotal - errorSample.length }}行</p>
        </div>
      </div>

      <template v-if="counts">
        <!-- 取込方法 -->
        <div class="mode-block">
          <div class="mode-label">取込の方法</div>
          <label class="mode-opt" :class="{ on: !isReplace }">
            <input type="radio" :value="IMPORT_MODE_MERGE" v-model="mode" />
            <span class="mode-body">
              <span class="mode-name">追加・更新（推奨）</span>
              <span class="mode-desc">
                ファイルに無い品目はそのまま残ります。同じ品目名はファイルの値で更新します。
                取込の直後にかぎり「取込前に戻す」で1回だけ戻せます。
              </span>
            </span>
          </label>
          <label class="mode-opt danger" :class="{ on: isReplace }">
            <input type="radio" :value="IMPORT_MODE_REPLACE" v-model="mode" />
            <span class="mode-body">
              <span class="mode-name">全入れ替え</span>
              <span class="mode-desc">
                現在の品目をすべて捨て、ファイルの内容だけにします。
                こちらも戻せるのは取込の直後に1回だけです。
              </span>
            </span>
          </label>
        </div>

        <!-- 件数サマリー -->
        <div class="counts">
          <div class="count-cell add">
            <span class="count-num">{{ counts.added }}</span><span class="count-label">追加</span>
          </div>
          <div class="count-cell upd">
            <span class="count-num">{{ counts.updated }}</span><span class="count-label">更新</span>
          </div>
          <div class="count-cell same">
            <span class="count-num">{{ counts.unchanged }}</span><span class="count-label">変更なし</span>
          </div>
          <div class="count-cell skip">
            <span class="count-num">{{ counts.skipped }}</span><span class="count-label">除外</span>
          </div>
          <div class="count-cell err">
            <span class="count-num">{{ counts.errors }}</span><span class="count-label">エラー</span>
          </div>
          <div v-if="isReplace" class="count-cell del">
            <span class="count-num">{{ counts.removed }}</span><span class="count-label">削除</span>
          </div>
        </div>
        <p class="total-line">取込後の登録品目は <b>{{ counts.total }}件</b> になります。</p>

        <!-- エイリアスの取り合い。どちらを優先するか選ぶまで取り込めない -->
        <div v-if="conflicts.length" class="warn alias-warn">
          <p class="warn-title">エイリアスが{{ conflicts.length }}件ぶつかっています</p>
          <p class="warn-body">
            同じ別名を複数の品目が使おうとしています。どちらを優先するか選んでください。
            <span v-if="conflictKinds.file">ファイルの中で取り合っている別名も含みます。</span>
          </p>
          <ul class="conflict-list">
            <li v-for="(c, i) in conflictSample" :key="i">
              <b>{{ c.alias }}</b>
              <span class="conflict-line">{{ c.line }}行目</span>
              <span class="conflict-kind">{{ CONFLICT_KIND_LABEL[c.kind] ?? '' }}</span>
              <span class="conflict-move">{{ c.from }} → {{ c.to }}</span>
            </li>
            <li v-if="conflicts.length > conflictSample.length" class="more">
              ほか{{ conflicts.length - conflictSample.length }}件
            </li>
          </ul>
          <label class="alias-opt">
            <input type="radio" :value="ALIAS_KEEP_EXISTING" v-model="aliasPolicy" />
            {{ conflictKinds.file && !conflictKinds.existing && !conflictKinds.item
               ? '先に出てきた行を優先する（ファイルの先頭側の品目が別名を持つ）'
               : '今のままにする（既存の割り当て・ファイルの先頭行を保持する）' }}
          </label>
          <label class="alias-opt">
            <input type="radio" :value="ALIAS_TAKEOVER" v-model="aliasPolicy" />
            ファイルの指定を優先する（別名をあとの行の品目へ付け替える）
          </label>
        </div>

        <!-- 品目名の切り詰め -->
        <div v-if="truncatedNames.length" class="warn limit-warn">
          <p class="warn-title">{{ truncatedNames.length }}件の品目名を{{ truncatedNames[0].after.length }}文字に切り詰めます</p>
          <ul class="name-list">
            <li v-for="(t, i) in truncatedNames.slice(0, 5)" :key="i">{{ t.line }}行目: {{ t.after }}…</li>
          </ul>
        </div>

        <!-- 分類コード（カテゴリ単位なので品目の差分には出ない） -->
        <div v-if="categoryCodeChanges.length" class="detail-block">
          <div class="detail-head">分類コードの変更（{{ summary.categoryCodeChanges.length }}件）</div>
          <div class="diff-list">
            <div v-for="(c, i) in categoryCodeChanges" :key="i" class="diff-row">
              <span class="diff-field">{{ c.category }}</span>
              <span class="diff-before">{{ c.before ?? '（なし）' }}</span>
              <span class="diff-arrow">→</span>
              <span class="diff-after">{{ c.after ?? '（なし）' }}</span>
            </div>
          </div>
        </div>

        <!-- 並び替え軸の名前をファイルの列名から採用する場合 -->
        <div v-if="axisNameChanges.length" class="detail-block">
          <div class="detail-head">並び替え軸の名前をファイルから設定します</div>
          <div class="diff-list">
            <div v-for="c in axisNameChanges" :key="c.index" class="diff-row">
              <span class="diff-field">並び替え{{ c.index === 0 ? '①' : '②' }}</span>
              <span class="diff-before">（未設定）</span>
              <span class="diff-arrow">→</span>
              <span class="diff-after">{{ c.after }}</span>
            </div>
          </div>
        </div>

        <!-- 発注点をどう扱うか。実装（列の有無で決まる）と同じ文言にする -->
        <p class="policy-note">
          <template v-if="summary.reorderPointsFromFile">
            このファイルには<b>発注点の列</b>があります。値のある行は更新し、
            <b>空欄の行は発注点を解除します</b>（{{ reorderCleared.length }}件が解除対象）。
          </template>
          <template v-else>
            このファイルには発注点の列がないため、<b>今の発注点はそのまま残ります</b>。
          </template>
        </p>

        <!-- 全入れ替えの警告と確認 -->
        <div v-if="isReplace" class="warn danger-warn">
          <p class="warn-title">⚠ {{ counts.removed }}件の品目が削除されます</p>
          <p class="warn-body">
            単価・別名・分類など、削除される品目に紐づく設定も一緒に消えます。
            取込の直後にかぎり「取込前に戻す」で1回だけ戻せますが、この端末のメモリ上だけの退避です。
            画面を再読み込みしたり、品目リストを他の操作で変更したりすると戻せなくなります。
            <span v-if="counts.removed > 0">先に「品目リストを出力」でバックアップを取ることをおすすめします。</span>
          </p>
          <ul v-if="removedSample.length" class="name-list">
            <li v-for="n in removedSample" :key="n">{{ n }}</li>
            <li v-if="counts.removed > removedSample.length" class="more">ほか{{ counts.removed - removedSample.length }}件</li>
          </ul>
          <label class="confirm-check">
            <input type="checkbox" v-model="replaceConfirmed" />
            上記を理解したうえで全入れ替えする
          </label>
        </div>

        <!-- Free 上限による切り捨て -->
        <div v-if="counts.truncated > 0" class="warn limit-warn">
          <p class="warn-title">無料プランの上限（{{ FREE_ITEM_LIMIT }}品目）を超えています</p>
          <p class="warn-body">
            {{ counts.truncated }}件は取り込まれません。取込後も既存の品目は削除されません。
          </p>
        </div>
        <p v-else-if="!isPro()" class="limit-note">
          無料プランは{{ FREE_ITEM_LIMIT }}品目まで登録できます（取込後 {{ counts.total }}/{{ FREE_ITEM_LIMIT }}件）。
        </p>

        <!-- 更新される品目の差分 -->
        <div v-if="counts.updated > 0" class="detail-block">
          <button class="detail-toggle" @click="showDiff = !showDiff">
            {{ showDiff ? '▲' : '▼' }} 更新される品目の変更内容（{{ counts.updated }}件）
          </button>
          <div v-if="showDiff" class="diff-list">
            <div v-for="u in updatedSample" :key="u.name" class="diff-item">
              <div class="diff-name">{{ u.name }}</div>
              <div v-for="(c, i) in u.changes" :key="i" class="diff-row">
                <span class="diff-field">{{ c.field }}</span>
                <span class="diff-before">{{ c.before || '（なし）' }}</span>
                <span class="diff-arrow">→</span>
                <span class="diff-after">{{ c.after || '（なし）' }}</span>
              </div>
            </div>
            <p v-if="counts.updated > updatedSample.length" class="more">
              ほか{{ counts.updated - updatedSample.length }}件
            </p>
          </div>
        </div>

        <!-- 取り込めなかった行（数値が読めない・列数が合わない等）。既定で開く -->
        <div v-if="counts.errors > 0" class="detail-block">
          <button class="detail-toggle err-toggle" @click="showErrors = !showErrors">
            {{ showErrors ? '▲' : '▼' }} 取り込めなかった行（{{ counts.errors }}行）
          </button>
          <div v-if="showErrors" class="skip-list" role="alert" aria-live="polite">
            <div v-for="(e, i) in errorSample" :key="i" class="skip-row">
              <span class="skip-line">{{ e.line }}行目</span>
              <span class="skip-name">{{ e.columnLabel }}{{ e.name ? `（${e.name}）` : '' }}</span>
              <span class="skip-reason">{{ e.reason }}</span>
            </div>
            <p v-if="counts.errors > errorSample.length" class="more">
              ほか{{ counts.errors - errorSample.length }}行
            </p>
          </div>
        </div>

        <!-- 除外された行 -->
        <div v-if="counts.skipped > 0" class="detail-block">
          <button class="detail-toggle" @click="showSkipped = !showSkipped">
            {{ showSkipped ? '▲' : '▼' }} 除外された行（{{ counts.skipped }}行）
          </button>
          <div v-if="showSkipped" class="skip-list">
            <div v-for="(s, i) in skippedSample" :key="i" class="skip-row">
              <span class="skip-line">{{ s.line }}行目</span>
              <span class="skip-name">{{ s.name || '—' }}</span>
              <span class="skip-reason">{{ s.reason }}</span>
            </div>
            <p v-if="counts.skipped > skippedSample.length" class="more">
              ほか{{ counts.skipped - skippedSample.length }}行
            </p>
          </div>
        </div>
      </template>

      <p v-if="aliasUnresolved" class="blocked-note" role="status">
        エイリアスの扱いを選ぶと取り込めます。
      </p>
      <div class="actions">
        <button class="btn btn-secondary" @click="requestClose">キャンセル</button>
        <button class="btn btn-primary" :class="{ danger: isReplace }" :disabled="!canImport" @click="onConfirm">
          {{ isReplace ? '全入れ替えする' : '取り込む' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.preview-sheet { max-height: 88vh; overflow-y: auto; }

.src-line { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 12px; color: #64748b; margin: 0 0 12px; }
.src-file { font-weight: 700; color: #334155; word-break: break-all; }
.src-now  { margin-left: auto; }
.beta-tag { border: 1px solid #fde68a; background: #fffbeb; color: #b45309; border-radius: 6px; padding: 2px 7px; font-size: 11px; font-weight: 800; }

.msg { padding: 10px 14px; border-radius: 10px; font-size: 14px; font-weight: 600; margin-bottom: 12px; }
.msg.error { background: #fef2f2; color: var(--danger, #dc2626); }

.mode-block { margin-bottom: 14px; }
.mode-label { font-size: 12px; font-weight: 800; color: #94a3b8; margin-bottom: 6px; }
.mode-opt {
  display: flex; align-items: flex-start; gap: 10px;
  border: 1.5px solid #e2e8f0; border-radius: 10px;
  padding: 10px 12px; margin-bottom: 8px; cursor: pointer;
}
.mode-opt.on        { border-color: var(--primary, #2563eb); background: var(--primary-weak, #eff6ff); }
.mode-opt.danger.on { border-color: #dc2626; background: #fef2f2; }
.mode-opt input { margin-top: 3px; width: 16px; height: 16px; flex-shrink: 0; }
.mode-body { display: flex; flex-direction: column; gap: 2px; }
.mode-name { font-size: 14px; font-weight: 800; color: #334155; }
.mode-desc { font-size: 12px; color: #64748b; line-height: 1.5; }

.counts { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
.count-cell {
  flex: 1 1 68px; display: flex; flex-direction: column; align-items: center; gap: 2px;
  border: 1px solid #e2e8f0; border-radius: 10px; padding: 8px 4px; background: #fff;
}
.count-num   { font-size: 20px; font-weight: 800; line-height: 1; }
.count-label { font-size: 11px; font-weight: 700; color: #94a3b8; }
.count-cell.add  .count-num { color: #16a34a; }
.count-cell.upd  .count-num { color: var(--primary, #2563eb); }
.count-cell.same .count-num { color: #94a3b8; }
.count-cell.skip .count-num { color: #b45309; }
.count-cell.err  .count-num { color: #dc2626; }
.count-cell.del  .count-num { color: #dc2626; }

.total-line { font-size: 13px; color: #475569; margin: 0 0 12px; }

.warn { border-radius: 10px; padding: 10px 12px; margin-bottom: 12px; }
.warn-title { font-size: 13px; font-weight: 800; margin: 0 0 4px; }
.warn-body  { font-size: 12px; line-height: 1.6; margin: 0; }
.danger-warn { background: #fef2f2; border: 1px solid #fecaca; }
.danger-warn .warn-title { color: #dc2626; }
.danger-warn .warn-body  { color: #7f1d1d; }
.limit-warn { background: #fffbeb; border: 1px solid #fde68a; }
.limit-warn .warn-title { color: #b45309; }
.limit-warn .warn-body  { color: #78350f; }
.limit-note { font-size: 12px; color: #94a3b8; margin: 0 0 12px; }
.alias-warn { background: #fffbeb; border: 1px solid #fde68a; }
.alias-warn .warn-title { color: #b45309; }
.alias-warn .warn-body  { color: #78350f; }
.conflict-list { margin: 8px 0; padding-left: 18px; font-size: 12px; color: #78350f; line-height: 1.7; }
.conflict-list .more { list-style: none; margin-left: -18px; color: #94a3b8; }
.conflict-line { color: #b45309; font-weight: 800; margin-left: 6px; }
.conflict-kind { color: #92400e; font-size: 11px; margin-left: 6px; }
.header-tag { border: 1px solid #cbd5e1; border-radius: 6px; padding: 2px 7px; font-size: 11px; font-weight: 700; color: #475569; }
.conflict-move { color: #475569; margin-left: 6px; }
.alias-opt {
  display: flex; align-items: flex-start; gap: 8px;
  font-size: 13px; font-weight: 700; color: #78350f;
  margin-top: 6px; cursor: pointer; line-height: 1.5;
}
.alias-opt input { width: 16px; height: 16px; margin-top: 2px; flex-shrink: 0; }
.policy-note { font-size: 12px; color: #475569; line-height: 1.6; margin: 0 0 12px; }
.detail-head {
  border: 1px solid #e2e8f0; border-radius: 10px 10px 0 0;
  background: #f8fafc; color: #475569; font-size: 13px; font-weight: 700; padding: 9px 12px;
}
.msg-hint { display: block; font-weight: 600; font-size: 12px; margin-top: 4px; line-height: 1.6; }

/* 解析に失敗したときの受け皿。エラーの直下に置き、次の操作をこの画面で完結させる */
.map-columns-btn {
  width: 100%; margin-bottom: 12px; padding: 12px;
  border: 1.5px solid #bfdbfe; border-radius: 10px;
  background: #eff6ff; color: #1d4ed8;
  font-size: 14px; font-weight: 800; cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.map-columns-btn:active { background: #dbeafe; }
.blocked-note { font-size: 12px; color: #b45309; font-weight: 700; margin: 0 0 8px; }
.err-toggle { border-color: #fecaca; background: #fef2f2; color: #b91c1c; }

.name-list { margin: 8px 0 0; padding-left: 18px; font-size: 12px; color: #7f1d1d; line-height: 1.6; }
.name-list .more { list-style: none; margin-left: -18px; color: #94a3b8; }

.confirm-check {
  display: flex; align-items: center; gap: 8px;
  font-size: 13px; font-weight: 700; color: #7f1d1d;
  margin-top: 10px; cursor: pointer;
}
.confirm-check input { width: 16px; height: 16px; }

.detail-block { margin-bottom: 12px; }
.detail-toggle {
  width: 100%; text-align: left; border: 1px solid #e2e8f0; border-radius: 10px;
  background: #f8fafc; color: #475569; font-size: 13px; font-weight: 700;
  padding: 9px 12px; cursor: pointer;
}

.diff-list, .skip-list { border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 10px 10px; padding: 8px 12px; }
.diff-item { padding: 6px 0; border-bottom: 1px solid #f1f5f9; }
.diff-item:last-child { border-bottom: none; }
.diff-name { font-size: 13px; font-weight: 800; color: #334155; margin-bottom: 3px; }
.diff-row { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; font-size: 12px; line-height: 1.7; }
.diff-field  { color: #94a3b8; min-width: 68px; }
.diff-before { color: #94a3b8; text-decoration: line-through; }
.diff-arrow  { color: #cbd5e1; }
.diff-after  { color: var(--primary, #2563eb); font-weight: 700; }

.skip-row { display: flex; flex-wrap: wrap; gap: 8px; font-size: 12px; padding: 5px 0; border-bottom: 1px solid #f1f5f9; }
.skip-row:last-child { border-bottom: none; }
.skip-line   { color: #b45309; font-weight: 800; min-width: 56px; }
.skip-name   { color: #334155; flex: 1; min-width: 0; word-break: break-all; }
.skip-reason { color: #94a3b8; }

.more { font-size: 12px; color: #94a3b8; margin: 6px 0 0; }

.actions { display: flex; gap: 10px; margin-top: 6px; }
.btn { flex: 1; border: none; border-radius: 10px; padding: 12px; font-size: 14px; font-weight: 800; cursor: pointer; }
.btn-secondary { background: #f1f5f9; color: #475569; }
.btn-primary   { background: var(--primary, #2563eb); color: #fff; }
.btn-primary.danger { background: #dc2626; }
.btn-primary:disabled { background: #cbd5e1; cursor: not-allowed; }
</style>
