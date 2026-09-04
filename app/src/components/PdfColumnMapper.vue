<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { extractRows, detectSectionCount } from '../utils/pdfTableParser.js'
import { fingerprintTokens, saveProfile } from '../composables/pdfProfiles.js'
import { useEscapeKey } from '../composables/useEscapeKey.js'

const props = defineProps({
  file: { type: Object, default: null },   // File（PDF本体）
})
const emit = defineEmits(['close', 'apply'])
useEscapeKey(() => emit('close'))

const FIELDS = [
  { field: 'name',      label: '品目名', required: true, color: '#2563eb' },
  { field: 'price',     label: '単価',   color: '#059669' },
  { field: 'unit',      label: '単位',   color: '#7c3aed' },
  { field: 'category',  label: '分類',   color: '#d97706' },
  { field: 'code',      label: 'コード', color: '#0891b2' },
  { field: 'qty',       label: '数量',   color: '#db2777' },
  { field: 'packQty',   label: '入数',   color: '#4b5563' },
  { field: 'prevMonth', label: '前月',   color: '#9333ea' },
]
const labelOf = (f) => FIELDS.find(x => x.field === f)?.label ?? f
const colorOf = (f) => FIELDS.find(x => x.field === f)?.color ?? '#2563eb'

// ── pdfjs ロード ────────────────────────────────────────────
let _pdfjs = null
async function getPdfjs() {
  if (_pdfjs) return _pdfjs
  const lib = await import('pdfjs-dist')
  lib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href
  _pdfjs = lib
  return lib
}
function cMapUrl() { try { return new URL('cmaps/', document.baseURI).href } catch (_) { return undefined } }

// ── 状態 ────────────────────────────────────────────────────
const busy      = ref(true)
const errorMsg  = ref('')
const pageCount = ref(0)
const pageIndex = ref(0)
const zoom      = ref(1)
const boxes     = ref([])       // 現在ページの当たり判定 [{ text, x, y, left, top, w, h }]
const allTokens = ref([])       // 全ページのトークン [[{text,x,y}], ...]（抽出プレビュー用）
const canvasEl  = ref(null)
const wrapEl    = ref(null)

let _pdf = null
let _pdfjsLib = null
let _baseW = 600                // scale=1 でのページ幅（フィット計算用）

// 割り当て: field -> [{ x, y }, ...]（PDF座標）
//
// 1つのフィールドに複数のxを持てる。1ページに同じ表が2枚並ぶ帳票（2段組み）では
// 「品名」の列が2か所にあり、1対1では**構造上そもそも指定できなかった**。
// 指定できないまま読むと、右段の値が左段の列へ吸い込まれて単価が連結され
// （1200 と 280 → 1200280）、右段の品目はまるごと消える。
const assign = ref({})
const picking = ref(null)       // タップ中のbox

onMounted(async () => {
  try {
    _pdfjsLib = await getPdfjs()
    const data = new Uint8Array(await props.file.arrayBuffer())
    _pdf = await _pdfjsLib.getDocument({ data, cMapUrl: cMapUrl(), cMapPacked: true }).promise
    pageCount.value = _pdf.numPages
    // 全ページのテキストを取得（抽出プレビュー用・描画はしない）
    const toks = []
    for (let p = 1; p <= _pdf.numPages; p++) {
      const page = await _pdf.getPage(p)
      const tc = await page.getTextContent()
      toks.push(tc.items
        .map(i => ({ text: (i.str ?? '').trim(), x: i.transform[4], y: i.transform[5] }))
        .filter(i => i.text))
    }
    allTokens.value = toks
    await renderPage()
  } catch (e) {
    errorMsg.value = 'PDFの表示に失敗しました。' + (e?.message || '')
  } finally {
    busy.value = false
  }
})
onBeforeUnmount(() => { try { _pdf?.destroy() } catch (_) {} })

async function renderPage() {
  if (!_pdf) return
  busy.value = true
  try {
    const page = await _pdf.getPage(pageIndex.value + 1)
    _baseW = page.getViewport({ scale: 1 }).width
    const wrapW = (wrapEl.value?.clientWidth || 340) - 2
    const fit = wrapW / _baseW
    const scale = fit * zoom.value
    const viewport = page.getViewport({ scale })
    await nextTick()
    const canvas = canvasEl.value
    const dpr = window.devicePixelRatio || 1
    canvas.width  = Math.floor(viewport.width * dpr)
    canvas.height = Math.floor(viewport.height * dpr)
    canvas.style.width  = viewport.width + 'px'
    canvas.style.height = viewport.height + 'px'
    const ctx = canvas.getContext('2d')
    await page.render({ canvasContext: ctx, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined }).promise
    // 当たり判定（テキストの画面上の矩形）
    const tc = await page.getTextContent()
    const bs = []
    for (const it of tc.items) {
      const s = (it.str ?? '').trim()
      if (!s) continue
      const tm = _pdfjsLib.Util.transform(viewport.transform, it.transform)
      const h = (it.height || 10) * scale
      const w = Math.max((it.width || 0) * scale, 8)
      bs.push({ text: s, x: it.transform[4], y: it.transform[5], left: tm[4], top: tm[5] - h, w, h: Math.max(h, 11) })
    }
    boxes.value = bs
  } catch (e) {
    errorMsg.value = 'ページの描画に失敗しました。' + (e?.message || '')
  } finally {
    busy.value = false
  }
}
watch([pageIndex, zoom], renderPage)

// ── 列の割り当て ────────────────────────────────────────────
const COL_TOL = 14   // 同じ列とみなすx許容差（PDF座標）
function fieldOfBox(b) {
  for (const [field, list] of Object.entries(assign.value)) {
    if (list.some(a => Math.abs(a.x - b.x) < COL_TOL)) return field
  }
  return null
}
function onBoxTap(b) {
  picking.value = (picking.value && picking.value.x === b.x && picking.value.y === b.y) ? null : b
}
function pickField(field) {
  const b = picking.value
  if (!b) return
  const list = assign.value[field] ?? []
  const at = list.findIndex(a => Math.abs(a.x - b.x) < COL_TOL)
  // 同じ列をもう一度選んだら外す。別の位置なら足す（2段組みの右側の列がこれ）。
  const next = at >= 0 ? list.filter((_, i) => i !== at) : [...list, { x: b.x, y: b.y }]
  const all = { ...assign.value }
  if (next.length) all[field] = next.sort((p, q) => p.x - q.x)
  else delete all[field]
  assign.value = all
  picking.value = null
}
function removeAt(field, x) {
  const next = (assign.value[field] ?? []).filter(a => a.x !== x)
  const all = { ...assign.value }
  if (next.length) all[field] = next
  else delete all[field]
  assign.value = all
}
function clearAll() { assign.value = {}; picking.value = null }

const columns = computed(() =>
  Object.entries(assign.value)
    .flatMap(([field, list]) => list.map(a => ({ field, x: a.x })))
    .sort((a, b) => a.x - b.x))
// 代表行のy（見出しでもデータでもOK。見出しは isMetaName で除外される）
const fromY = computed(() => {
  const ys = Object.values(assign.value).flat().map(a => a.y)
  return ys.length ? Math.max(...ys) : Infinity
})
// 指定した「品目名」の数＝ユーザーが宣言した段の数
const nameCols = computed(() => (assign.value.name ?? []).length)
// 紙の見た目から見積もった段の数。足りないまま読むと右段が消えるので、その前に言う。
const sectionGuess = computed(() => detectSectionCount(allTokens.value[0] ?? []))
const missingSections = computed(() =>
  nameCols.value >= 1 && sectionGuess.value > nameCols.value
    ? sectionGuess.value - nameCols.value : 0)
const hasName = computed(() => columns.value.some(c => c.field === 'name'))

// 現在ページで、各割り当て列を縦帯としてハイライト（列全体＝全行が対象だと視覚化）
const bands = computed(() => {
  const out = []
  for (const [field, list] of Object.entries(assign.value)) {
    for (const a of list) {
      const matched = boxes.value.filter(b => Math.abs(b.x - a.x) < COL_TOL)
      if (!matched.length) continue
      let l = Infinity, r = -Infinity
      for (const b of matched) { l = Math.min(l, b.left); r = Math.max(r, b.left + b.w) }
      out.push({ key: `${field}@${a.x}`, field, left: l - 3, width: (r - l) + 6, color: colorOf(field) })
    }
  }
  return out
})

const preview = computed(() => {
  if (!hasName.value || columns.value.length < 2) return []
  const all = []
  for (const toks of allTokens.value) all.push(...extractRows(toks, columns.value, { fromY: fromY.value }))
  return all
})

const saveName = ref('')
const wantSave = ref(true)

function onApply() {
  if (!preview.value.length) return
  if (wantSave.value && allTokens.value[0]?.length) {
    saveProfile({
      name: saveName.value.trim() || '無名レシピ',
      columns: columns.value,
      fromY: fromY.value,
      fingerprint: fingerprintTokens(allTokens.value[0]),
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

      <!-- 手順 -->
      <ol class="mapper-steps">
        <li>下のPDFで、<b>取り込みたい列を1か所タップ</b>します（見出しでもデータのセルでもOK）。</li>
        <li>その列が<b>何の項目か</b>（品目名・単価…）を選びます。<b>品目名は必須</b>。</li>
      </ol>
      <p v-if="pageCount > 1" class="mapper-note">🗂 指定した列は<b>全 {{ pageCount }} ページ</b>に自動で適用されます。</p>
      <!-- 段組みの取りこぼし。読んだ後では「右half が消えた」と気づけないので、読む前に言う -->
      <p v-if="missingSections" class="mapper-warn">
        この紙は同じ表が<b>{{ sectionGuess }}枚</b>並んでいるように見えます。
        右の表の<b>「品目名」もタップして</b>指定してください
        （指定しないと右側の{{ missingSections }}枚ぶんが取り込まれず、値が左の列に混ざります）。
      </p>

      <!-- 割り当て済み -->
      <div class="assigned-row">
        <span v-if="columns.length === 0" class="assigned-empty">まだ列を指定していません</span>
        <span v-for="c in columns" :key="c.field + '@' + c.x" class="assigned-chip" :style="{ background: colorOf(c.field) }">
          {{ labelOf(c.field) }}<button class="chip-x" @click="removeAt(c.field, c.x)">×</button>
        </span>
        <button v-if="columns.length" class="clear-btn" @click="clearAll">全クリア</button>
      </div>

      <!-- ページ送り -->
      <div class="topbar">
        <div v-if="pageCount > 1" class="page-nav">
          <button :disabled="pageIndex === 0" @click="pageIndex--">◀</button>
          <span>{{ pageIndex + 1 }} / {{ pageCount }}</span>
          <button :disabled="pageIndex >= pageCount - 1" @click="pageIndex++">▶</button>
        </div>
        <div class="zoom-nav">
          <button :disabled="zoom <= 0.6" @click="zoom = Math.max(0.6, +(zoom - 0.2).toFixed(2))">－</button>
          <span>{{ Math.round(zoom * 100) }}%</span>
          <button :disabled="zoom >= 3" @click="zoom = Math.min(3, +(zoom + 0.2).toFixed(2))">＋</button>
        </div>
      </div>

      <!-- PDF実物＋オーバーレイ -->
      <div class="pdf-wrap" ref="wrapEl">
        <div v-if="busy" class="pdf-busy">読み込み中…</div>
        <div v-if="errorMsg" class="pdf-error">{{ errorMsg }}</div>
        <div class="pdf-stage">
          <canvas ref="canvasEl" class="pdf-canvas"></canvas>
          <!-- 列ハイライト帯 -->
          <div v-for="b in bands" :key="'band-' + b.key" class="col-band"
               :style="{ left: b.left + 'px', width: b.width + 'px', background: b.color + '22', borderColor: b.color }">
            <span class="col-band-label" :style="{ background: b.color }">{{ labelOf(b.field) }}</span>
          </div>
          <!-- 当たり判定 -->
          <button
            v-for="(b, i) in boxes" :key="i"
            class="hit"
            :class="{ picking: picking && picking.x === b.x && picking.y === b.y, assigned: fieldOfBox(b) }"
            :style="{ left: b.left + 'px', top: b.top + 'px', width: b.w + 'px', height: b.h + 'px',
                      '--fc': fieldOfBox(b) ? colorOf(fieldOfBox(b)) : 'transparent' }"
            @click="onBoxTap(b)"
          ></button>
        </div>
      </div>

      <!-- フィールド選択（タップ時） -->
      <div v-if="picking" class="field-bar">
        <div class="field-bar-title">「<b>{{ picking.text }}</b>」の列は何の項目？</div>
        <div class="field-chips">
          <button v-for="f in FIELDS" :key="f.field" class="field-chip"
                  :class="{ on: fieldOfBox(picking) === f.field }"
                  :style="fieldOfBox(picking) === f.field ? { background: f.color, borderColor: f.color, color: '#fff' } : {}"
                  @click="pickField(f.field)">
            {{ f.label }}<span v-if="f.required" class="req">*</span>
          </button>
        </div>
      </div>

      <!-- プレビュー -->
      <div class="preview-line" :class="{ ok: preview.length }">
        <template v-if="!hasName">▲ 「品目名」の列を指定してください</template>
        <template v-else-if="preview.length">✓ 全 {{ pageCount }} ページから <b>{{ preview.length }}</b> 件を抽出</template>
        <template v-else>該当する行がありません（列の指定を見直してください）</template>
      </div>
      <ul v-if="preview.length" class="mini-preview">
        <li v-for="(p, i) in preview.slice(0, 6)" :key="i">
          <span class="mp-name">{{ p.name }}</span>
          <span class="mp-meta">{{ [p.unit, p.price, p.category].filter(Boolean).join(' / ') }}</span>
        </li>
        <li v-if="preview.length > 6" class="mp-more">…他 {{ preview.length - 6 }} 件</li>
      </ul>

      <!-- レシピ保存 -->
      <label class="save-row" :class="{ disabled: !preview.length }">
        <input type="checkbox" v-model="wantSave" :disabled="!preview.length" />
        <span>このレイアウトを「レシピ」として保存（次回同じ形式なら自動で読み取り）</span>
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
.mapper-sheet { max-height: 94vh; overflow-y: auto; }
.mapper-steps { margin: 0 0 8px; padding-left: 20px; font-size: 12.5px; color: var(--text); line-height: 1.6; }
.mapper-steps b { color: var(--primary); }
.mapper-note { font-size: 12px; color: #b45309; background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 6px 10px; margin: 0 0 10px; }
.mapper-warn { font-size: 12px; line-height: 1.6; color: #7f1d1d; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 8px 10px; margin: 0 0 10px; }
.mapper-note b { color: #92400e; }

.assigned-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 8px; min-height: 26px; }
.assigned-empty { font-size: 12px; color: var(--text-muted); }
.assigned-chip { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 700; color: #fff; border-radius: 20px; padding: 3px 6px 3px 11px; }
.chip-x { border: none; background: rgba(255,255,255,0.25); color: #fff; border-radius: 50%; width: 16px; height: 16px; line-height: 1; cursor: pointer; font-size: 12px; }
.clear-btn { margin-left: auto; font-size: 11px; color: var(--danger); background: none; border: none; cursor: pointer; }

.topbar { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 6px; }
.page-nav, .zoom-nav { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-muted); }
.page-nav button, .zoom-nav button { border: 1px solid var(--border); background: var(--surface); border-radius: 8px; min-width: 30px; padding: 4px 8px; cursor: pointer; font-size: 14px; }
.page-nav button:disabled, .zoom-nav button:disabled { opacity: 0.4; }

.pdf-wrap { position: relative; border: 1px solid var(--border); border-radius: 10px; background: #f1f5f9; overflow: auto; max-height: 52vh; margin-bottom: 10px; -webkit-overflow-scrolling: touch; }
.pdf-busy, .pdf-error { position: absolute; top: 8px; left: 50%; transform: translateX(-50%); z-index: 5; font-size: 12px; font-weight: 700; color: var(--text-muted); background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 4px 12px; }
.pdf-error { color: var(--danger); }
.pdf-stage { position: relative; width: max-content; }
.pdf-canvas { display: block; }

.col-band { position: absolute; top: 0; bottom: 0; border-left: 1.5px dashed; border-right: 1.5px dashed; pointer-events: none; z-index: 1; }
.col-band-label { position: sticky; top: 0; display: inline-block; font-size: 10px; font-weight: 800; color: #fff; padding: 1px 6px; border-radius: 0 0 6px 0; }

.hit { position: absolute; z-index: 2; padding: 0; margin: 0; border: 1.5px solid var(--fc); background: color-mix(in srgb, var(--fc) 14%, transparent); border-radius: 3px; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.hit:not(.assigned):not(.picking) { border-color: transparent; background: transparent; }
.hit:active { background: rgba(37,99,235,0.16); }
.hit.picking { border: 2px solid #ef4444; background: rgba(239,68,68,0.14); z-index: 3; }

.field-bar { position: sticky; bottom: 0; background: var(--surface); border: 1.5px solid var(--primary); border-radius: 10px; padding: 8px 10px; margin-bottom: 10px; box-shadow: 0 -4px 14px rgba(0,0,0,0.08); }
.field-bar-title { font-size: 12.5px; margin-bottom: 7px; color: var(--text); }
.field-bar-title b { color: var(--primary); }
.field-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.field-chip { font-size: 13px; padding: 7px 13px; border-radius: 20px; border: 1px solid var(--border); background: #fff; cursor: pointer; font-weight: 700; }
.field-chip .req { color: var(--danger); margin-left: 1px; }

.preview-line { font-size: 13px; font-weight: 700; color: var(--text-muted); margin-bottom: 6px; }
.preview-line.ok { color: var(--success); }
.preview-line b { font-size: 15px; }
.mini-preview { list-style: none; border: 1px solid var(--border); border-radius: 10px; overflow: hidden; margin-bottom: 12px; }
.mini-preview li { display: flex; justify-content: space-between; gap: 10px; padding: 7px 12px; font-size: 12px; border-bottom: 1px solid var(--border); }
.mini-preview li:last-child { border-bottom: none; }
.mp-name { font-weight: 600; color: var(--text); }
.mp-meta { color: var(--text-muted); white-space: nowrap; }
.mp-more { color: var(--text-muted); justify-content: center; }

.save-row { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text); margin-bottom: 8px; cursor: pointer; }
.save-row.disabled { opacity: 0.5; }
.save-name { width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid var(--border); border-radius: 8px; font-size: 13px; margin-bottom: 12px; }

.actions { display: flex; gap: 10px; }
.btn:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
