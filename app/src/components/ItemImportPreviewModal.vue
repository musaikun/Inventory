<script setup>
/**
 * 品目マスタ取込の確認画面（S6）。
 *
 * 取り込む前に「何件が追加・更新・変更なしになり、何行が除外されるか」を必ず見せる。
 * プレビューは実際の取込と同じ計画（buildImportPlan）を使うので、ここに出た結果と
 * 取込後の状態は一致する。全入れ替えは既定から外し、明示的な確認を通した時だけ実行する。
 */
import { ref, computed, watch } from 'vue'
import { useConfig, IMPORT_MODE_MERGE, IMPORT_MODE_REPLACE } from '../composables/useConfig.js'
import { useEscapeKey } from '../composables/useEscapeKey.js'
import { FREE_ITEM_LIMIT, isPro } from '../utils/planLimits.js'
import { confirmMasterImport } from '../utils/masterImportWarning.js'

const props = defineProps({
  // origin: 'csv'（推奨フォーマット）| 'mapped'（列指定）| 'pdf'（PDF/Excelから変換済み）
  origin:   { type: String, default: 'csv' },
  csvText:  { type: String, required: true },
  mapping:  { type: Object, default: null },
  filename: { type: String, default: '' },
})
const emit = defineEmits(['imported', 'close'])
useEscapeKey(() => emit('close'))

const {
  itemCount,
  loadFromCSV, loadFromCSVMapped, previewCSVImport, previewMappedImport,
} = useConfig()

const mode             = ref(IMPORT_MODE_MERGE)
const replaceConfirmed = ref(false)
const importing        = ref(false)
const importError      = ref('')   // 取込実行時のエラー（解析エラーは preview 側）
const showDiff         = ref(false)
const showSkipped      = ref(false)

const isMapped  = computed(() => props.origin === 'mapped')
const isReplace = computed(() => mode.value === IMPORT_MODE_REPLACE)

// 全入れ替えを選び直したら確認チェックはやり直す
watch(mode, () => { replaceConfirmed.value = false })

// 解析できないファイルはここでエラーになる。件数と一緒に1つの computed で持つ。
const preview = computed(() => {
  try {
    const summary = isMapped.value
      ? previewMappedImport(props.csvText, props.mapping, { mode: mode.value })
      : previewCSVImport(props.csvText, { mode: mode.value })
    return { summary, error: '' }
  } catch (err) {
    return { summary: null, error: err.message }
  }
})

const summary = computed(() => preview.value.summary)
const error   = computed(() => importError.value || preview.value.error)

const counts = computed(() => {
  const s = summary.value
  if (!s) return null
  return {
    added:     s.added.length,
    updated:   s.updated.length,
    unchanged: s.unchanged.length,
    removed:   s.removed.length,
    skipped:   s.skipped.length,
    truncated: s.truncated.length,
    total:     s.total,
  }
})

const LIST_CAP = 20   // 長いリストは先頭だけ出し、残りは件数で示す
const updatedSample = computed(() => (summary.value?.updated ?? []).slice(0, LIST_CAP))
const removedSample = computed(() => (summary.value?.removed ?? []).slice(0, LIST_CAP))
const skippedSample = computed(() => (summary.value?.skipped ?? []).slice(0, LIST_CAP))

const canImport = computed(() =>
  !!summary.value && !importing.value && (!isReplace.value || replaceConfirmed.value)
)

function onConfirm() {
  if (!canImport.value) return
  // 全置換だけは最後にもう一段の同意を取る（S2 の確認をこの操作にだけ残した）。
  // 追加・更新は既存品目を消さないため確認を挟まない。
  if (isReplace.value && !confirmMasterImport(itemCount.value)) return
  importing.value  = true
  importError.value = ''
  try {
    const result = isMapped.value
      ? loadFromCSVMapped(props.csvText, props.mapping, { mode: mode.value })
      : loadFromCSV(props.csvText, { mode: mode.value })
    emit('imported', result)
  } catch (err) {
    importError.value = err.message
  } finally {
    importing.value = false
  }
}
</script>

<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <div class="modal-sheet preview-sheet" role="dialog" aria-modal="true" aria-labelledby="import-preview-title">
      <div class="sheet-handle"></div>
      <div class="sheet-title" id="import-preview-title">取込内容の確認</div>

      <p class="src-line">
        <span v-if="filename" class="src-file">{{ filename }}</span>
        <span v-if="origin === 'pdf'" class="beta-tag">PDF/Excel 読み取り（β）</span>
        <span class="src-now">現在の登録：{{ itemCount }}件</span>
      </p>

      <div v-if="error" class="msg error" role="alert">✗ {{ error }}</div>

      <template v-if="counts">
        <!-- 取込方法 -->
        <div class="mode-block">
          <div class="mode-label">取込の方法</div>
          <label class="mode-opt" :class="{ on: !isReplace }">
            <input type="radio" :value="IMPORT_MODE_MERGE" v-model="mode" />
            <span class="mode-body">
              <span class="mode-name">追加・更新（推奨）</span>
              <span class="mode-desc">ファイルに無い品目はそのまま残ります。同じ品目名はファイルの値で更新します。</span>
            </span>
          </label>
          <label class="mode-opt danger" :class="{ on: isReplace }">
            <input type="radio" :value="IMPORT_MODE_REPLACE" v-model="mode" />
            <span class="mode-body">
              <span class="mode-name">全入れ替え</span>
              <span class="mode-desc">現在の品目をすべて捨て、ファイルの内容だけにします。</span>
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
          <div v-if="isReplace" class="count-cell del">
            <span class="count-num">{{ counts.removed }}</span><span class="count-label">削除</span>
          </div>
        </div>
        <p class="total-line">取込後の登録品目は <b>{{ counts.total }}件</b> になります。</p>

        <!-- 全入れ替えの警告と確認 -->
        <div v-if="isReplace" class="warn danger-warn">
          <p class="warn-title">⚠ {{ counts.removed }}件の品目が削除されます</p>
          <p class="warn-body">
            単価・別名・分類・発注点など、削除される品目に紐づく設定も一緒に消えます。
            この操作は取り消せません。<span v-if="counts.removed > 0">先に「品目リストを出力」でバックアップを取ることをおすすめします。</span>
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

      <div class="actions">
        <button class="btn btn-secondary" @click="emit('close')">キャンセル</button>
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
