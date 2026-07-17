<script setup>
import { ref, computed } from 'vue'
import { extractRows } from '../utils/pdfTableParser.js'
import { fingerprintTokens, saveProfile } from '../composables/pdfProfiles.js'
import { useEscapeKey } from '../composables/useEscapeKey.js'

const props = defineProps({
  pages: { type: Array, default: () => [] },   // [{ tokens:[{text,x,y}], rotate }]
})
const emit = defineEmits(['close', 'apply'])
useEscapeKey(() => emit('close'))

const FIELDS = [
  { field: 'name',      label: '品目名', required: true },
  { field: 'price',     label: '単価' },
  { field: 'unit',      label: '単位' },
  { field: 'category',  label: '分類' },
  { field: 'code',      label: 'コード' },
  { field: 'qty',       label: '数量' },
  { field: 'packQty',   label: '入数' },
  { field: 'prevMonth', label: '前月' },
]
const labelOf = (f) => FIELDS.find(x => x.field === f)?.label ?? f

const pageIndex = ref(0)
const tokens = computed(() => props.pages[pageIndex.value]?.tokens ?? [])

// レイアウト範囲（座標→画面へのスケール変換）
const bounds = computed(() => {
  const ts = tokens.value
  if (!ts.length) return { minX: 0, maxX: 1, minY: 0, maxY: 1 }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const t of ts) {
    if (t.x < minX) minX = t.x
    if (t.x > maxX) maxX = t.x
    if (t.y < minY) minY = t.y
    if (t.y > maxY) maxY = t.y
  }
  return { minX, maxX, minY, maxY }
})
const SCALE = 0.9
const canvasW = computed(() => Math.max(200, (bounds.value.maxX - bounds.value.minX + 80) * SCALE))
const canvasH = computed(() => Math.max(120, (bounds.value.maxY - bounds.value.minY + 40) * SCALE))
function posStyle(t) {
  const b = bounds.value
  return {
    left: ((t.x - b.minX) * SCALE) + 'px',
    top: ((b.maxY - t.y) * SCALE) + 'px',
  }
}

// 割り当て: field -> { x, y }
const assign = ref({})
const picking = ref(null)   // タップ中のトークン

function fieldOfToken(t) {
  for (const [field, a] of Object.entries(assign.value)) {
    if (Math.abs(a.x - t.x) < 0.5 && Math.abs(a.y - t.y) < 0.5) return field
  }
  return null
}
function onTokenTap(t) {
  picking.value = (picking.value && picking.value.x === t.x && picking.value.y === t.y) ? null : t
}
function pickField(field) {
  const t = picking.value
  if (!t) return
  // 同じトークンに既にこのfieldが付いていれば解除
  if (fieldOfToken(t) === field) { delete assign.value[field]; assign.value = { ...assign.value } }
  else assign.value = { ...assign.value, [field]: { x: t.x, y: t.y } }
  picking.value = null
}
function clearAll() { assign.value = {}; picking.value = null }

const columns = computed(() =>
  Object.entries(assign.value).map(([field, a]) => ({ field, x: a.x })).sort((a, b) => a.x - b.x)
)
// 代表行のy（＝データ開始行）。これ以下（下方向）をデータとみなす。
const fromY = computed(() => {
  const ys = Object.values(assign.value).map(a => a.y)
  return ys.length ? Math.max(...ys) : Infinity
})
const hasName = computed(() => columns.value.some(c => c.field === 'name'))

const preview = computed(() => {
  if (!hasName.value || columns.value.length < 2) return []
  const all = []
  for (const pg of props.pages) all.push(...extractRows(pg.tokens, columns.value, { fromY: fromY.value }))
  return all
})

const saveName = ref('')
const wantSave = ref(true)

function onApply() {
  if (!preview.value.length) return
  if (wantSave.value && props.pages[0]?.tokens?.length) {
    saveProfile({
      name: saveName.value.trim() || '無名レシピ',
      columns: columns.value,
      fromY: fromY.value,
      fingerprint: fingerprintTokens(props.pages[0].tokens),
    })
  }
  emit('apply', preview.value)
}
</script>

<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-sheet mapper-sheet">
      <div class="sheet-handle"></div>
      <div class="sheet-title">列を指定して読み取る</div>
      <p class="mapper-help">
        表の<b>最初のデータ行</b>のセルをタップし、それが何の列か選んでください（品目名は必須）。
        指定した列に沿って下の行を読み取ります。
      </p>

      <div v-if="pages.length > 1" class="page-nav">
        <button :disabled="pageIndex === 0" @click="pageIndex--">◀</button>
        <span>{{ pageIndex + 1 }} / {{ pages.length }} ページ</span>
        <button :disabled="pageIndex >= pages.length - 1" @click="pageIndex++">▶</button>
      </div>

      <!-- 割り当て済みチップ -->
      <div class="assigned-row">
        <span v-if="columns.length === 0" class="assigned-empty">未指定</span>
        <span v-for="c in columns" :key="c.field" class="assigned-chip">
          {{ labelOf(c.field) }}
        </span>
        <button v-if="columns.length" class="clear-btn" @click="clearAll">クリア</button>
      </div>

      <!-- トークンマップ -->
      <div class="canvas-wrap">
        <div class="canvas" :style="{ width: canvasW + 'px', height: canvasH + 'px' }">
          <button
            v-for="(t, i) in tokens"
            :key="i"
            class="token"
            :class="{ assigned: fieldOfToken(t), picking: picking && picking.x === t.x && picking.y === t.y }"
            :style="posStyle(t)"
            @click="onTokenTap(t)"
          >
            <span class="token-text">{{ t.text }}</span>
            <span v-if="fieldOfToken(t)" class="token-badge">{{ labelOf(fieldOfToken(t)) }}</span>
          </button>
        </div>
      </div>

      <!-- フィールド選択バー（トークンタップ時） -->
      <div v-if="picking" class="field-bar">
        <div class="field-bar-title">「{{ picking.text }}」は？</div>
        <div class="field-chips">
          <button
            v-for="f in FIELDS"
            :key="f.field"
            class="field-chip"
            :class="{ on: fieldOfToken(picking) === f.field }"
            @click="pickField(f.field)"
          >
            {{ f.label }}<span v-if="f.required" class="req">*</span>
          </button>
        </div>
      </div>

      <!-- プレビュー -->
      <div class="preview-line" :class="{ ok: preview.length }">
        <template v-if="!hasName">品目名の列を指定してください</template>
        <template v-else-if="preview.length">{{ preview.length }}件を検出</template>
        <template v-else>該当する行がありません</template>
      </div>
      <ul v-if="preview.length" class="mini-preview">
        <li v-for="(p, i) in preview.slice(0, 6)" :key="i">
          <span class="mp-name">{{ p.name }}</span>
          <span class="mp-meta">{{ [p.unit, p.price, p.category].filter(Boolean).join(' / ') }}</span>
        </li>
        <li v-if="preview.length > 6" class="mp-more">…他 {{ preview.length - 6 }}件</li>
      </ul>

      <!-- レシピ保存 -->
      <label class="save-row" :class="{ disabled: !preview.length }">
        <input type="checkbox" v-model="wantSave" :disabled="!preview.length" />
        <span>このレイアウトをレシピとして保存（次回同じ形式で自動適用）</span>
      </label>
      <input v-if="wantSave" v-model="saveName" class="save-name" placeholder="レシピ名（例: ○○商店 仕入表）" :disabled="!preview.length" />

      <div class="actions">
        <button class="btn btn-secondary" @click="$emit('close')">キャンセル</button>
        <button class="btn btn-primary" :disabled="!preview.length" @click="onApply">この内容で読み込む</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mapper-sheet { max-height: 92vh; overflow-y: auto; }
.mapper-help { font-size: 12px; color: var(--text-muted); line-height: 1.5; margin: 0 0 10px; }
.mapper-help b { color: var(--text); }

.page-nav { display: flex; align-items: center; justify-content: center; gap: 12px; margin-bottom: 10px; font-size: 13px; color: var(--text-muted); }
.page-nav button { border: 1px solid var(--border); background: var(--surface); border-radius: 8px; padding: 4px 12px; cursor: pointer; }
.page-nav button:disabled { opacity: 0.4; }

.assigned-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 8px; min-height: 26px; }
.assigned-empty { font-size: 12px; color: var(--text-muted); }
.assigned-chip { font-size: 12px; font-weight: 700; color: var(--primary); background: var(--primary-weak); border-radius: 20px; padding: 3px 10px; }
.clear-btn { margin-left: auto; font-size: 11px; color: var(--danger); background: none; border: none; cursor: pointer; }

.canvas-wrap { border: 1px solid var(--border); border-radius: 10px; background: var(--surface); overflow: auto; max-height: 40vh; margin-bottom: 10px; }
.canvas { position: relative; }
.token {
  position: absolute;
  transform: translateY(-50%);
  font-size: 11px;
  line-height: 1.2;
  padding: 2px 5px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: white;
  color: var(--text);
  white-space: nowrap;
  cursor: pointer;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.token.assigned { border-color: var(--primary); background: var(--primary-weak); font-weight: 700; }
.token.picking  { border-color: var(--danger); box-shadow: 0 0 0 2px rgba(239,68,68,0.25); z-index: 3; }
.token-badge { display: block; font-size: 9px; color: var(--primary); font-weight: 700; }

.field-bar { position: sticky; bottom: 0; background: var(--surface); border: 1px solid var(--primary); border-radius: 10px; padding: 8px 10px; margin-bottom: 10px; }
.field-bar-title { font-size: 12px; font-weight: 700; margin-bottom: 6px; }
.field-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.field-chip { font-size: 13px; padding: 6px 12px; border-radius: 20px; border: 1px solid var(--border); background: white; cursor: pointer; }
.field-chip.on { border-color: var(--primary); background: var(--primary); color: white; }
.field-chip .req { color: var(--danger); margin-left: 1px; }
.field-chip.on .req { color: white; }

.preview-line { font-size: 13px; font-weight: 700; color: var(--text-muted); margin-bottom: 6px; }
.preview-line.ok { color: var(--success); }
.mini-preview { list-style: none; border: 1px solid var(--border); border-radius: 10px; overflow: hidden; margin-bottom: 12px; }
.mini-preview li { display: flex; justify-content: space-between; gap: 10px; padding: 6px 12px; font-size: 12px; border-bottom: 1px solid var(--border); }
.mini-preview li:last-child { border-bottom: none; }
.mp-name { font-weight: 500; color: var(--text); }
.mp-meta { color: var(--text-muted); white-space: nowrap; }
.mp-more { color: var(--text-muted); justify-content: center; }

.save-row { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text); margin-bottom: 8px; cursor: pointer; }
.save-row.disabled { opacity: 0.5; }
.save-name { width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid var(--border); border-radius: 8px; font-size: 13px; margin-bottom: 12px; }

.actions { display: flex; gap: 10px; }
.btn:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
