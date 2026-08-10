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
 */
import { ref, computed } from 'vue'
import { useEscapeKey } from '../composables/useEscapeKey.js'
import { ON_CONFLICT_ADD, ON_CONFLICT_REPLACE } from '../services/pastImportPlan.js'

const props = defineProps({
  plan:     { type: Object, required: true },
  filename: { type: String, default: '' },
  // 確定・取消は結果を見て表示を決めるため、イベントではなく関数で受ける
  // （「サーバーが確認した件数」を表示に使うので戻り値が要る）
  confirmImport: { type: Function, required: true },
  undoImport:    { type: Function, required: true },
})
const emit = defineEmits(['resolve', 'imported', 'close'])

// キャンセル・Escape・オーバーレイクリックが重なっても閉じる処理は1回だけ。
// 閉じる経路では履歴もサーバーも一切変更しない。
const closed = ref(false)
function requestClose() {
  if (closed.value || importing.value) return
  closed.value = true
  emit('close')
}
useEscapeKey(requestClose)

const importing = ref(false)
const result    = ref(null)   // { saved, failed, ok, importBatchId }
const undoing   = ref(false)
const undoMsg   = ref('')

const days      = computed(() => props.plan?.days ?? [])
const totals    = computed(() => props.plan?.totals ?? { days: 0, items: 0, conflicts: 0 })
const conflicts = computed(() => days.value.filter(d => d.collisions.length > 0))

const savedCount  = computed(() => result.value?.saved?.length ?? 0)
const failedList  = computed(() => result.value?.failed ?? [])
const finished    = computed(() => result.value !== null)

function setResolution(date, resolution) {
  emit('resolve', { date, resolution })
}

async function onConfirm() {
  if (importing.value || finished.value) return
  importing.value = true
  try {
    // サーバーが確認した結果だけを表示に使う
    result.value = await props.confirmImport()
    if ((result.value?.saved?.length ?? 0) > 0) emit('imported', result.value)
  } catch (err) {
    result.value = { saved: [], failed: [{ date: '—', error: err?.message ?? '保存に失敗しました' }] }
  } finally {
    importing.value = false
  }
}

async function onUndo() {
  if (undoing.value || !result.value?.importBatchId) return
  undoing.value = true
  undoMsg.value = ''
  try {
    const r = await props.undoImport(result.value.importBatchId)
    undoMsg.value = `取り込んだ${r.removedOnServer}日分を取り消しました。`
    result.value  = { ...result.value, saved: [], undone: true }
    emit('imported', result.value)
  } catch (err) {
    undoMsg.value = err?.message ?? '取り消せませんでした。'
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

        <p class="policy-note">
          取り込んだ棚卸は<b>通常の棚卸と同じ記録</b>として保存され、カレンダーと詳細から開けます。
          サーバーへの保存を確認できた日だけを「取り込み済み」として表示します。
        </p>
      </template>

      <!-- 取込後: サーバーが確認した結果だけを出す -->
      <template v-else>
        <div class="msg" :class="failedList.length ? 'warning' : 'success'" role="status" aria-live="polite">
          <template v-if="result.undone">✓ 取り消しました。</template>
          <template v-else-if="savedCount > 0">✓ {{ savedCount }}日分をサーバーに保存しました。</template>
          <template v-else>✗ 取り込めませんでした。</template>
        </div>

        <div v-if="failedList.length" class="detail-block">
          <div class="detail-head">保存できなかった日（{{ failedList.length }}日）</div>
          <div class="skip-list">
            <div v-for="f in failedList" :key="f.date" class="skip-row">
              <span class="skip-line">{{ f.date }}</span>
              <span class="skip-reason">{{ f.error }}{{ f.retryable ? '（時間をおいて再実行できます）' : '' }}</span>
            </div>
          </div>
        </div>

        <p v-if="undoMsg" class="policy-note" role="status" aria-live="polite">{{ undoMsg }}</p>

        <p v-if="savedCount > 0 && !result.undone" class="policy-note">
          この取込は1つのまとまりとして取り消せます。取り消すとサーバーと端末の両方から
          <b>この取込ぶんだけ</b>が消え、ほかの棚卸は残ります。
        </p>
      </template>

      <div class="actions">
        <button class="btn btn-secondary" :disabled="importing" @click="requestClose">
          {{ finished ? '閉じる' : 'キャンセル' }}
        </button>
        <button v-if="!finished" class="btn btn-primary" :disabled="importing || totals.days === 0" @click="onConfirm">
          {{ importing ? '保存中…' : '取り込む' }}
        </button>
        <button v-else-if="savedCount > 0 && !result.undone" class="btn btn-primary danger" :disabled="undoing" @click="onUndo">
          {{ undoing ? '取り消し中…' : 'この取込を取り消す' }}
        </button>
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

.actions { display: flex; gap: 10px; margin-top: 6px; }
.btn { flex: 1; border: none; border-radius: 10px; padding: 12px; font-size: 14px; font-weight: 800; cursor: pointer; }
.btn-secondary { background: #f1f5f9; color: #475569; }
.btn-primary   { background: var(--primary, #2563eb); color: #fff; }
.btn-primary.danger { background: #dc2626; }
.btn-primary:disabled, .btn-secondary:disabled { background: #cbd5e1; cursor: not-allowed; }
</style>
