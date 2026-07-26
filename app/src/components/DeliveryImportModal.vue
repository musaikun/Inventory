<script setup>
import { ref, computed } from 'vue'
import { parseDeliveryImportCSV } from '../utils/deliveryImportParser.js'
import { matchRow } from '../services/deliveryImportMatch.js'
import { existingLineKeys, lineKey, newImportBatchId } from '../utils/importBatch.js'
import { buildImportMovements } from '../services/deliveryImportCommit.js'

const props = defineProps({
  csvText:  { type: String, required: true },
  filename: { type: String, default: '' },
  // 名寄せ用コンテキスト（App.vue から）: { order, dictionary, masterDict, categories }
  ctx: { type: Object, default: () => ({ order: [], dictionary: {}, masterDict: {}, categories: {} }) },
  // 重複判定用の既存入出庫レコード
  existingMovements: { type: Array, default: () => [] },
})
const emit = defineEmits(['imported', 'close'])

const NEW = '__new__'   // 「この名前で新規追加」を表す choice 値

const parseError = ref('')
const skipped    = ref(0)
const rows       = ref([])

try {
  const { rows: parsed, skipped: sk } = parseDeliveryImportCSV(props.csvText)
  skipped.value = sk
  const existKeys = existingLineKeys(props.existingMovements)
  const seen = new Set()

  rows.value = parsed.map(r => {
    const m = matchRow(r.name, props.ctx)
    // 既存 or バッチ内の内容重複を判定（対応づけ前の生名で暫定判定）
    const k = lineKey({ date: r.date, type: r.type, item: r.name, qty: r.qty })
    const duplicate = existKeys.has(k) || seen.has(k)
    if (!duplicate) seen.add(k)
    return {
      ...r,
      status:     m.status,
      candidates: m.candidates,
      // 既定の対応づけ: matched/candidate は候補、unmatched は新規追加
      choice:     m.status === 'unmatched' ? NEW : m.item,
      excluded:   duplicate,   // 重複は既定で除外
      duplicate,
    }
  })
} catch (e) {
  parseError.value = e?.message || '取り込みに失敗しました'
}

const orderOptions = computed(() => props.ctx.order ?? [])

function resolvedItem(r) {
  return r.choice === NEW ? r.name.trim() : r.choice
}

const summary = computed(() => {
  const s = { total: rows.value.length, matched: 0, candidate: 0, unmatched: 0, duplicate: 0, willImport: 0, newItems: 0 }
  for (const r of rows.value) {
    s[r.status]++
    if (r.duplicate) s.duplicate++
    if (!r.excluded && resolvedItem(r)) {
      s.willImport++
      if (r.choice === NEW) s.newItems++
    }
  }
  return s
})

const canImport = computed(() => summary.value.willImport > 0)

function statusLabel(r) {
  if (r.duplicate) return '重複'
  if (r.choice === NEW) return '新規'
  return { matched: 'マッチ', candidate: '要確認', unmatched: '未マッチ' }[r.status] ?? ''
}
function statusClass(r) {
  if (r.duplicate) return 'st-dup'
  if (r.choice === NEW) return 'st-new'
  return { matched: 'st-ok', candidate: 'st-maybe', unmatched: 'st-no' }[r.status] ?? ''
}

function onImport() {
  if (!canImport.value) return
  const batchId = newImportBatchId()
  const accepted = rows.value
    .filter(r => !r.excluded && resolvedItem(r))
    .map(r => ({ ...r, item: resolvedItem(r) }))

  const movements = buildImportMovements(accepted, { batchId })

  // 名寄せ学習: 業者名 ≠ 対応づけた既存品目 のペア（新規追加は名前=品目なので対象外）
  const aliasPairs = []
  const newItems   = new Map()
  for (const r of accepted) {
    if (r.choice === NEW) {
      if (!newItems.has(r.item)) newItems.set(r.item, { name: r.item, unit: r.unit, category: r.category, price: r.price })
    } else if (r.name.trim() && r.name.trim() !== r.item) {
      aliasPairs.push({ term: r.name.trim(), canonical: r.item })
    }
  }

  emit('imported', { movements, aliasPairs, newItems: [...newItems.values()], batchId })
}
</script>

<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-sheet import-sheet">
      <div class="sheet-handle"></div>
      <div class="sheet-title">納品履歴の取り込み</div>

      <div v-if="parseError" class="import-error">{{ parseError }}</div>

      <template v-else>
        <div class="import-hint">
          <span v-if="filename" class="import-filename">{{ filename }}</span>
          {{ summary.total }}件を確認して取り込みます。
          <span v-if="skipped > 0" class="import-skip">（{{ skipped }}件は日付・数量の不備でスキップ）</span>
        </div>

        <!-- サマリ -->
        <div class="summary-row">
          <div class="sum-chip st-ok">マッチ {{ summary.matched }}</div>
          <div class="sum-chip st-maybe">要確認 {{ summary.candidate }}</div>
          <div class="sum-chip st-no">未マッチ {{ summary.unmatched }}</div>
          <div class="sum-chip st-dup">重複 {{ summary.duplicate }}</div>
        </div>

        <!-- 明細テーブル -->
        <div class="import-scroll">
          <table class="import-table">
            <thead>
              <tr>
                <th>取込</th><th>日付</th><th>仕入先</th><th>取込元の名前</th>
                <th>数量</th><th>品目への対応づけ</th><th>状態</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(r, i) in rows" :key="i" :class="{ 'row-off': r.excluded }">
                <td class="c-chk">
                  <input type="checkbox" :checked="!r.excluded" @change="r.excluded = !$event.target.checked" />
                </td>
                <td class="c-date">{{ r.date }}</td>
                <td class="c-sup">{{ r.supplier || '—' }}</td>
                <td class="c-name">{{ r.name }}</td>
                <td class="c-qty">{{ r.qty }}<span class="u">{{ r.unit }}</span></td>
                <td class="c-map">
                  <select v-model="r.choice" class="map-select">
                    <option :value="'__new__'">＋ 新規「{{ r.name }}」</option>
                    <option v-for="o in orderOptions" :key="o" :value="o">{{ o }}</option>
                  </select>
                </td>
                <td class="c-st"><span class="st-chip" :class="statusClass(r)">{{ statusLabel(r) }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="import-foot">
          <span class="foot-count">
            取込 <b>{{ summary.willImport }}</b> 件
            <span v-if="summary.newItems > 0">（うち新規品目 {{ summary.newItems }}）</span>
          </span>
        </div>

        <div class="import-actions">
          <button class="btn btn-secondary" @click="$emit('close')">キャンセル</button>
          <button class="btn btn-primary" :disabled="!canImport" @click="onImport">
            {{ summary.willImport }}件を取り込む
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.import-sheet { max-height: 92vh; overflow-y: auto; }

.import-error {
  background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c;
  padding: 12px; border-radius: 8px; font-size: 13px; margin-bottom: 12px;
}

.import-hint { font-size: 13px; color: var(--text-muted); line-height: 1.5; margin-bottom: 12px; }
.import-filename { font-weight: 700; color: var(--primary); margin-right: 4px; }
.import-skip { color: #d97706; }

.summary-row { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
.sum-chip {
  font-size: 12px; font-weight: 700; padding: 4px 10px; border-radius: 999px;
}

.import-scroll {
  overflow-x: auto; border: 1px solid var(--border); border-radius: 8px; margin-bottom: 10px;
}
.import-table { border-collapse: collapse; font-size: 12px; width: 100%; white-space: nowrap; }
.import-table th {
  background: #f1f5f9; font-weight: 700; color: var(--text);
  padding: 6px 8px; border-bottom: 1px solid var(--border); text-align: left; position: sticky; top: 0;
}
.import-table td { padding: 5px 8px; border-bottom: 1px solid #f1f5f9; color: var(--text); }
.row-off { opacity: 0.42; }
.c-chk { text-align: center; }
.c-name { max-width: 180px; overflow: hidden; text-overflow: ellipsis; }
.c-qty .u { color: var(--text-muted); margin-left: 2px; font-size: 11px; }
.map-select {
  padding: 4px 6px; border: 1.5px solid var(--border); border-radius: 6px;
  font-size: 12px; background: white; font-family: inherit; max-width: 200px;
}

.st-chip { font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 6px; }
.st-ok    { background: #dcfce7; color: #15803d; }
.st-maybe { background: #fef9c3; color: #a16207; }
.st-no    { background: #fee2e2; color: #b91c1c; }
.st-new   { background: #e0f2fe; color: #0369a1; }
.st-dup   { background: #f3f4f6; color: #6b7280; }

.import-foot { font-size: 13px; color: var(--text); margin-bottom: 12px; }
.foot-count b { color: var(--primary); font-size: 15px; }

.import-actions { display: flex; gap: 10px; }
.import-actions .btn { flex: 1; }
</style>
