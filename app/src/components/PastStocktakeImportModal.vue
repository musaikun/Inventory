<script setup>
/**
 * 過去棚卸取込の確認画面（IMPORT-001）。
 *
 * 以前は window.confirm 1枚で「※既存の N 日分は上書きされます」とだけ出し、
 * 実際には localStorage を日付キーで書き潰していた。ここでは
 *   ・何日ぶん・何品目が入るのか
 *   ・同じ日に既にある棚卸をどうするのか（別セッションで追加／上書き／やめる）
 * を取り込む前に日付単位で選ばせる。既定は非破壊（別セッションとして追加）。
 *
 * 「取り込みました」はサーバーが sessionId を返した日についてだけ出す。
 *
 * **応答が届かなかったとき**（通信断・タイムアウト）は、サーバーに入っている可能性がある。
 * このときモーダルを閉じてしまうと、その batchId が画面から消えて再試行も取消もできない。
 * そこで計画と importBatchId を持ち続け、
 *   ・同じ batchId で再試行する（サーバー側で冪等なので成功済みの日は重複しない）
 *   ・この batchId を取り消す（結果不明でも実行できる）
 * の2つの導線をここに出す。再試行では**新しい batchId を作らない**。
 */
import { ref, computed } from 'vue'
import { useEscapeKey } from '../composables/useEscapeKey.js'
import {
  ON_CONFLICT_ADD, ON_CONFLICT_REPLACE,
  OUTCOME_UNKNOWN, classifyCommitError,
  mergeCommitResults, retryableDates, canCancelBatch,
} from '../services/pastImportPlan.js'

const props = defineProps({
  plan:     { type: Object, required: true },
  filename: { type: String, default: '' },
  // 確定・取消は結果を見て表示を決めるため、イベントではなく関数で受ける
  // （「サーバーが確認した件数」を表示に使うので戻り値が要る）
  confirmImport: { type: Function, required: true },
  undoImport:    { type: Function, required: true },
})
const emit = defineEmits(['resolve', 'imported', 'close'])

const importing = ref(false)
const undoing   = ref(false)

// キャンセル・Escape・オーバーレイクリックが重なっても閉じる処理は1回だけ。
// 閉じる経路では履歴もサーバーも一切変更しない。
const closed = ref(false)
// 結果不明が残っているのに閉じようとしたときの説明（押した理由を画面に残す）
const closeBlockedNote = ref('')

function requestClose() {
  if (closed.value || importing.value || undoing.value) return
  // 結果不明が1日でも残っているあいだは閉じない。閉じると batchId と計画が画面から消え、
  // サーバーに入っているかもしれないデータを再試行も取消もできなくなる。
  if (hasUnknown.value) {
    closeBlockedNote.value =
      '結果不明が残っているため閉じられません。同じ取込IDで再試行するか、この取込を取り消してください。'
    return
  }
  closed.value = true
  emit('close')
}
useEscapeKey(requestClose)

const result    = ref(null)   // { saved, failed, ok, importBatchId }
const undoMsg   = ref('')
const undoFailed = ref(false)

const days      = computed(() => props.plan?.days ?? [])
const totals    = computed(() => props.plan?.totals ?? { days: 0, items: 0, conflicts: 0 })
const conflicts = computed(() => days.value.filter(d => d.collisions.length > 0))

// 数値・日付として読めなかった行。件数だけでは気づけないので明細を出し、
// 「除いて取り込む」を明示するまで確定させない。
const rowErrors  = computed(() => props.plan?.rowErrors ?? [])
const errorsAcknowledged = ref(false)

const savedCount  = computed(() => result.value?.saved?.length ?? 0)
const failedList  = computed(() => result.value?.failed ?? [])
const finished    = computed(() => result.value !== null)
const unknownList = computed(() => failedList.value.filter(f => f.outcome === OUTCOME_UNKNOWN))
// 取込IDは再試行・取消の手がかりなので、失敗しても画面から消さない
const batchId     = computed(() => result.value?.importBatchId ?? props.plan?.importBatchId ?? '')
const canRetry    = computed(() => retryableDates(result.value).length > 0 && !undone.value)
const undone      = computed(() => result.value?.undone === true)
const canCancel   = computed(() => !undone.value && canCancelBatch(result.value))

// 「サーバーに入ったかどうか端末から判断できない」日が残っているか。
// **明確なHTTP失敗（保存されていないと分かっている日）はここに含めない。**
// 取り消し済みなら、その batchId ぶんはサーバーから消えているので残らない。
const hasUnknown = computed(() => !undone.value && unknownList.value.length > 0)

const canConfirm = computed(() =>
  !importing.value && totals.value.days > 0
  && (rowErrors.value.length === 0 || errorsAcknowledged.value))

function setResolution(date, resolution) {
  emit('resolve', { date, resolution })
}

/**
 * 確定・再試行の共通処理。`dates` を渡すとその日だけを送る。
 * 二重押しは importing で塞ぐ。再試行でも batchId は計画のものを使い回す。
 */
async function _commit(dates) {
  if (importing.value || undoing.value) return
  importing.value = true
  closeBlockedNote.value = ''
  try {
    const next = await props.confirmImport(dates)
    // サーバーが確認した結果だけを表示に使い、前回の成功はそのまま残す
    result.value = mergeCommitResults(result.value, next)
    if ((next?.saved?.length ?? 0) > 0) emit('imported', result.value)
  } catch (err) {
    // confirmImport 自体が投げた場合も、HTTP status の有無で「保存されなかった」と
    // 「結果が分からない」を分ける（判定は pastImportPlan と同じ1つの実装）。
    const outcome = classifyCommitError(err)
    result.value = mergeCommitResults(result.value, {
      importBatchId: batchId.value,
      saved:  [],
      failed: (dates ?? days.value.map(d => d.date)).map(date => ({ date, ...outcome })),
      ok: false,
    })
  } finally {
    importing.value = false
  }
}

function onConfirm() {
  if (!canConfirm.value || finished.value) return
  return _commit()
}

/** 失敗・結果不明の日だけを、同じ batchId で送り直す */
function onRetry() {
  if (!canRetry.value) return
  return _commit(retryableDates(result.value))
}

async function onUndo() {
  if (undoing.value || importing.value || !batchId.value) return
  undoing.value = true
  undoMsg.value = ''
  undoFailed.value = false
  closeBlockedNote.value = ''
  try {
    const r = await props.undoImport(batchId.value)
    undoMsg.value = `この取込（${batchId.value}）のぶんをサーバーから${r.removedOnServer}日分取り消しました。`
    result.value  = { ...(result.value ?? { importBatchId: batchId.value }), saved: [], failed: [], undone: true }
    emit('imported', result.value)
  } catch (err) {
    undoFailed.value = true
    undoMsg.value = `${err?.message ?? '取り消せませんでした。'}（取込ID ${batchId.value}）`
  } finally {
    undoing.value = false
  }
}
</script>

<template>
  <div class="modal-overlay" @click.self="requestClose">
    <div class="modal-sheet past-sheet" role="dialog" aria-modal="true" aria-labelledby="past-import-title">
      <div class="sheet-handle"></div>
      <div class="sheet-title" id="past-import-title">過去の棚卸を取り込む</div>

      <p class="src-line">
        <span v-if="filename" class="src-file">{{ filename }}</span>
        <span class="src-now">{{ totals.days }}日分 / {{ totals.items }}品目</span>
      </p>

      <!-- 取込前: 何が起きるかを日付単位で見せる -->
      <template v-if="!finished">
        <div class="counts">
          <div class="count-cell add">
            <span class="count-num">{{ totals.days }}</span><span class="count-label">取り込む日数</span>
          </div>
          <div class="count-cell upd">
            <span class="count-num">{{ totals.items }}</span><span class="count-label">品目（延べ）</span>
          </div>
          <div class="count-cell skip">
            <span class="count-num">{{ totals.conflicts }}</span><span class="count-label">同じ日に既存あり</span>
          </div>
        </div>

        <div v-if="conflicts.length" class="warn alias-warn">
          <p class="warn-title">同じ日にすでに棚卸の記録があります</p>
          <p class="warn-body">
            日付ごとに扱いを選べます。既定は<b>別の棚卸として追加</b>で、既存の記録は消えません。
          </p>
          <div v-for="d in conflicts" :key="d.date" class="conflict-day">
            <div class="conflict-date">
              {{ d.date }}
              <span class="conflict-existing">
                既存 {{ d.collisions.length }}件（{{ d.collisions.map(c => c.source === 'import' ? '取込' : '棚卸').join('・') }}）
              </span>
            </div>
            <label class="alias-opt">
              <input type="radio" :name="`res-${d.date}`" :checked="d.resolution === ON_CONFLICT_ADD"
                     @change="setResolution(d.date, ON_CONFLICT_ADD)" />
              別の棚卸として追加する（既存はそのまま残る）
            </label>
            <label class="alias-opt">
              <input type="radio" :name="`res-${d.date}`" :checked="d.resolution === ON_CONFLICT_REPLACE"
                     @change="setResolution(d.date, ON_CONFLICT_REPLACE)" />
              既存の{{ d.collisions.length }}件を消して置き換える
            </label>
          </div>
        </div>

        <div class="detail-block">
          <div class="detail-head">取り込む内容</div>
          <div class="skip-list">
            <div v-for="d in days" :key="d.date" class="skip-row">
              <span class="skip-line">{{ d.date }}</span>
              <span class="skip-name">{{ d.itemCount }}品目</span>
              <span class="skip-reason">
                {{ d.totalValue == null ? '金額なし' : `${d.totalValue.toLocaleString()}円` }}
                <template v-if="d.collisions.length">
                  ／ {{ d.resolution === ON_CONFLICT_REPLACE ? '置き換え' : '追加' }}
                </template>
              </span>
            </div>
          </div>
        </div>

        <!-- 読めなかった行。行番号・列名・元の値・理由をそのまま出す -->
        <div v-if="rowErrors.length" class="warn err-warn" role="alert">
          <p class="warn-title">取り込めない値が{{ rowErrors.length }}行あります</p>
          <div class="err-list">
            <div v-for="(e, i) in rowErrors.slice(0, 20)" :key="i" class="err-row">
              <span class="err-line">{{ e.line }}行目</span>
              <span class="err-col">{{ e.columnLabel }}{{ e.name ? `（${e.name}）` : '' }}</span>
              <span class="err-val">「{{ e.value }}」</span>
              <span class="err-why">{{ e.reason }}</span>
            </div>
            <p v-if="rowErrors.length > 20" class="err-more">ほか{{ rowErrors.length - 20 }}行</p>
          </div>
          <label class="err-ack">
            <input type="checkbox" v-model="errorsAcknowledged" />
            この{{ rowErrors.length }}行を取り込まずに進む
          </label>
        </div>

        <p class="policy-note">
          取り込んだ棚卸は<b>通常の棚卸と同じ記録</b>として保存され、カレンダーと詳細から開けます。
          サーバーへの保存を確認できた日だけを「取り込み済み」として表示します。
          取り込んだあとは<b>この取込ぶんだけ</b>をあとから取り消せます（ほかの棚卸は残ります）。
        </p>
      </template>

      <!-- 取込後: サーバーが確認した結果だけを出す -->
      <template v-else>
        <div class="msg" :class="failedList.length ? 'warning' : 'success'" role="status" aria-live="polite">
          <template v-if="undone">✓ 取り消しました。</template>
          <template v-else-if="savedCount > 0 && failedList.length">
            ✓ {{ savedCount }}日分を保存しました。残り{{ failedList.length }}日は確認が必要です。
          </template>
          <template v-else-if="savedCount > 0">✓ {{ savedCount }}日分をサーバーに保存しました。</template>
          <template v-else>✗ 取り込めませんでした。</template>
        </div>

        <p v-if="batchId" class="batch-line">
          取込ID <b class="batch-id">{{ batchId }}</b>
          <span class="batch-note">再試行・取消はこのIDのまま行います（新しい取込にはなりません）。</span>
        </p>

        <div v-if="failedList.length" class="detail-block">
          <div class="detail-head">保存を確認できなかった日（{{ failedList.length }}日）</div>
          <div class="skip-list">
            <div v-for="f in failedList" :key="f.date" class="skip-row">
              <span class="skip-line">{{ f.date }}</span>
              <span class="skip-name" :class="f.outcome === OUTCOME_UNKNOWN ? 'st-unknown' : 'st-failed'">
                {{ f.outcome === OUTCOME_UNKNOWN ? '結果不明' : '保存されず' }}
              </span>
              <span class="skip-reason">{{ f.error }}</span>
            </div>
          </div>
        </div>

        <p v-if="hasUnknown" class="warn-inline">
          {{ unknownList.length }}日は応答が届かず、<b>サーバーに保存されている可能性があります</b>。
          結果が確定するまでこの画面は閉じられません。
          「同じ取込IDで再試行」を押すと、同じ日を送り直しても重複しません。
          取り込みたくない場合は「この取込を取り消す」で消せます。
        </p>

        <p v-if="closeBlockedNote" class="blocked-note" role="alert" aria-live="assertive">
          {{ closeBlockedNote }}
        </p>

        <p v-if="undoMsg" class="policy-note" :class="{ 'undo-failed': undoFailed }" role="status" aria-live="polite">
          {{ undoMsg }}
        </p>

        <p v-if="savedCount > 0 && !undone" class="policy-note">
          この取込は1つのまとまりとして取り消せます。取り消すとサーバーと端末の両方から
          <b>この取込ぶんだけ</b>が消え、ほかの棚卸は残ります。
        </p>
      </template>

      <p v-if="rowErrors.length && !errorsAcknowledged && !finished" class="blocked-note" role="status">
        取り込めない行の扱いを選ぶと取り込めます。
      </p>

      <div class="actions">
        <!-- 結果不明が残っているあいだは閉じる導線を塞ぐ（batchId と計画を画面から失わないため） -->
        <button
          class="btn btn-secondary"
          :disabled="importing || undoing || hasUnknown"
          :title="hasUnknown ? '結果不明が残っているため閉じられません' : ''"
          @click="requestClose"
        >
          {{ finished ? '閉じる' : 'キャンセル' }}
        </button>
        <button v-if="!finished" class="btn btn-primary" :disabled="!canConfirm" @click="onConfirm">
          {{ importing ? '保存中…' : '取り込む' }}
        </button>
        <template v-else>
          <button v-if="canRetry" class="btn btn-primary" :disabled="importing || undoing" @click="onRetry">
            {{ importing ? '再試行中…' : '同じ取込IDで再試行' }}
          </button>
          <button v-if="canCancel" class="btn btn-primary danger" :disabled="undoing || importing" @click="onUndo">
            {{ undoing ? '取り消し中…' : 'この取込を取り消す' }}
          </button>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.past-sheet { max-height: 88vh; overflow-y: auto; }

.src-line { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 12px; color: #64748b; margin: 0 0 12px; }
.src-file { font-weight: 700; color: #334155; word-break: break-all; }
.src-now  { margin-left: auto; }

.msg { padding: 10px 14px; border-radius: 10px; font-size: 14px; font-weight: 700; margin-bottom: 12px; }
.msg.success { background: #f0fdf4; color: #15803d; }
.msg.warning { background: #fffbeb; color: #b45309; }

.counts { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
.count-cell {
  flex: 1 1 80px; display: flex; flex-direction: column; align-items: center; gap: 2px;
  border: 1px solid #e2e8f0; border-radius: 10px; padding: 8px 4px; background: #fff;
}
.count-num   { font-size: 20px; font-weight: 800; line-height: 1; }
.count-label { font-size: 11px; font-weight: 700; color: #94a3b8; text-align: center; }
.count-cell.add  .count-num { color: #16a34a; }
.count-cell.upd  .count-num { color: var(--primary, #2563eb); }
.count-cell.skip .count-num { color: #b45309; }

.warn { border-radius: 10px; padding: 10px 12px; margin-bottom: 12px; }
.warn-title { font-size: 13px; font-weight: 800; margin: 0 0 4px; }
.warn-body  { font-size: 12px; line-height: 1.6; margin: 0; }
.alias-warn { background: #fffbeb; border: 1px solid #fde68a; }
.alias-warn .warn-title { color: #b45309; }
.alias-warn .warn-body  { color: #78350f; }

.conflict-day { margin-top: 10px; padding-top: 8px; border-top: 1px solid #fde68a; }
.conflict-date { font-size: 13px; font-weight: 800; color: #78350f; }
.conflict-existing { font-weight: 600; font-size: 11px; color: #b45309; margin-left: 6px; }
.alias-opt {
  display: flex; align-items: flex-start; gap: 8px;
  font-size: 13px; font-weight: 700; color: #78350f;
  margin-top: 6px; cursor: pointer; line-height: 1.5;
}
.alias-opt input { width: 16px; height: 16px; margin-top: 2px; flex-shrink: 0; }

.detail-block { margin-bottom: 12px; }
.detail-head {
  border: 1px solid #e2e8f0; border-radius: 10px 10px 0 0;
  background: #f8fafc; color: #475569; font-size: 13px; font-weight: 700; padding: 9px 12px;
}
.skip-list { border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 10px 10px; padding: 8px 12px; }
.skip-row { display: flex; flex-wrap: wrap; gap: 8px; font-size: 12px; padding: 5px 0; border-bottom: 1px solid #f1f5f9; }
.skip-row:last-child { border-bottom: none; }
.skip-line   { color: #334155; font-weight: 800; min-width: 88px; }
.skip-name   { color: #475569; }
.skip-reason { color: #94a3b8; margin-left: auto; }

.policy-note { font-size: 12px; color: #475569; line-height: 1.6; margin: 0 0 12px; }
.policy-note.undo-failed { color: #b91c1c; font-weight: 700; }

.batch-line { font-size: 12px; color: #64748b; margin: 0 0 10px; line-height: 1.6; }
.batch-id { color: #334155; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; word-break: break-all; }
.batch-note { display: block; color: #94a3b8; }

.warn-inline {
  background: #fffbeb; border: 1px solid #fde68a; border-radius: 10px;
  padding: 10px 12px; font-size: 12px; color: #78350f; line-height: 1.6; margin: 0 0 12px;
}

.err-warn { background: #fef2f2; border: 1px solid #fecaca; }
.err-warn .warn-title { color: #b91c1c; }
.err-list { max-height: 180px; overflow-y: auto; margin-top: 4px; }
.err-row { display: flex; flex-wrap: wrap; gap: 6px; font-size: 12px; line-height: 1.6; padding: 3px 0; }
.err-line { color: #b45309; font-weight: 800; min-width: 56px; }
.err-col  { color: #334155; }
.err-val  { color: #7f1d1d; font-weight: 700; word-break: break-all; }
.err-why  { color: #94a3b8; }
.err-more { font-size: 12px; color: #94a3b8; margin: 4px 0 0; }
.err-ack {
  display: flex; align-items: center; gap: 8px;
  font-size: 13px; font-weight: 700; color: #7f1d1d; margin-top: 8px; cursor: pointer;
}
.err-ack input { width: 16px; height: 16px; }

.blocked-note { font-size: 12px; color: #b45309; font-weight: 700; margin: 0 0 8px; }
.st-unknown { color: #b45309; font-weight: 800; }
.st-failed  { color: #b91c1c; font-weight: 800; }

.actions { display: flex; gap: 10px; margin-top: 6px; }
.btn { flex: 1; border: none; border-radius: 10px; padding: 12px; font-size: 14px; font-weight: 800; cursor: pointer; }
.btn-secondary { background: #f1f5f9; color: #475569; }
.btn-primary   { background: var(--primary, #2563eb); color: #fff; }
.btn-primary.danger { background: #dc2626; }
.btn-primary:disabled, .btn-secondary:disabled { background: #cbd5e1; cursor: not-allowed; }
</style>
