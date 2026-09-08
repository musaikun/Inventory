<script setup>
/**
 * PDFの実物を出す（描画・ページ送り・拡大）だけの部品。
 *
 * 取込のどの画面でも「元の紙を見る」は同じ動きであってほしい。列指定の画面でも、
 * CSVと同じ表の画面（`ImportMapper`）から開く確認でも、同じものが同じように出る。
 * 文字の当たり判定は `overlay` スロットへ渡すので、上に何を重ねるかは呼ぶ側が決める。
 *
 * PDFを開くのはここ1回きり。トークンは `loaded` で親へ渡す（同じファイルを
 * 二度開くと、端末の重さが倍になるうえに座標の作り方が2通りに分かれる）。
 */
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { toReadingCoords } from '../utils/pdfTableParser.js'

const props = defineProps({
  file: { type: Object, default: null },   // File（PDF本体）
  dim:  { type: Boolean, default: false }, // 操作を伏せる（先に答えてほしい問いがあるとき）
})
const emit = defineEmits(['loaded', 'error', 'boxes'])

let _pdfjs = null
async function getPdfjs() {
  if (_pdfjs) return _pdfjs
  const lib = await import('pdfjs-dist')
  lib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href
  _pdfjs = lib
  return lib
}
// CJKフォントのPDFは cMap が無いとテキストが1文字も取れない
function cMapUrl() { try { return new URL('cmaps/', document.baseURI).href } catch (_) { return undefined } }

const busy      = ref(true)
const errorMsg  = ref('')
const pageCount = ref(0)
const pageIndex = ref(0)
const zoom      = ref(1)
const boxes     = ref([])     // 現在ページの文字の位置 [{ text, x, y, left, top, w, h }]
const canvasEl  = ref(null)
const wrapEl    = ref(null)

let _pdf = null
let _pdfjsLib = null

onMounted(async () => {
  try {
    _pdfjsLib = await getPdfjs()
    const data = new Uint8Array(await props.file.arrayBuffer())
    _pdf = await _pdfjsLib.getDocument({ data, cMapUrl: cMapUrl(), cMapPacked: true }).promise
    pageCount.value = _pdf.numPages

    // 全ページのテキスト。**読み方向へそろえた座標**で渡す（回転した帳票をここで吸収する）。
    // `parsePdfFile` が返す生座標のページとは別物なので、受け取る側は取り違えないこと。
    const pages = []
    for (let p = 1; p <= _pdf.numPages; p++) {
      const page = await _pdf.getPage(p)
      const tc = await page.getTextContent()
      const tokens = []
      for (const i of tc.items) {
        const text = (i.str ?? '').trim()
        if (!text) continue
        const c = toReadingCoords(i.transform[4], i.transform[5], page.rotate)
        tokens.push({ text, x: c.x, y: c.y, w: i.width ?? 0 })
      }
      pages.push({ tokens, rotate: page.rotate })
    }
    emit('loaded', { pageCount: _pdf.numPages, readingPages: pages })
    await renderPage()
  } catch (e) {
    errorMsg.value = 'PDFの表示に失敗しました。' + (e?.message || '')
    emit('error', errorMsg.value)
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
    const baseW = page.getViewport({ scale: 1 }).width
    const wrapW = (wrapEl.value?.clientWidth || 340) - 2
    const scale = (wrapW / baseW) * zoom.value
    const viewport = page.getViewport({ scale })
    await nextTick()
    const canvas = canvasEl.value
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    canvas.width  = Math.floor(viewport.width * dpr)
    canvas.height = Math.floor(viewport.height * dpr)
    canvas.style.width  = viewport.width + 'px'
    canvas.style.height = viewport.height + 'px'
    const ctx = canvas.getContext('2d')
    await page.render({
      canvasContext: ctx,
      viewport,
      transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
    }).promise

    // 文字の当たり判定。x/y は列を判定するための論理座標、left/top は画面上の位置
    const tc = await page.getTextContent()
    const bs = []
    for (const it of tc.items) {
      const s = (it.str ?? '').trim()
      if (!s) continue
      const tm = _pdfjsLib.Util.transform(viewport.transform, it.transform)
      const h = (it.height || 10) * scale
      const w = Math.max((it.width || 0) * scale, 8)
      const c = toReadingCoords(it.transform[4], it.transform[5], page.rotate)
      bs.push({ text: s, x: c.x, y: c.y, left: tm[4], top: tm[5] - h, w, h: Math.max(h, 11) })
    }
    boxes.value = bs
    emit('boxes', bs)   // 上に何かを重ねる画面（列指定）は、これを見て位置を合わせる
  } catch (e) {
    errorMsg.value = 'ページの描画に失敗しました。' + (e?.message || '')
    emit('error', errorMsg.value)
  } finally {
    busy.value = false
  }
}
watch([pageIndex, zoom], renderPage)
</script>

<template>
  <div class="pdfv">
    <div class="topbar" :class="{ dim }">
      <div v-if="pageCount > 1" class="page-nav">
        <button :disabled="pageIndex === 0" @click="pageIndex--">◀</button>
        <span>{{ pageIndex + 1 }} / {{ pageCount }}</span>
        <button :disabled="pageIndex >= pageCount - 1" @click="pageIndex++">▶</button>
      </div>
      <div v-else class="page-nav"><span>1 ページ</span></div>
      <div class="zoom-nav">
        <button :disabled="zoom <= 0.6" @click="zoom = Math.max(0.6, +(zoom - 0.2).toFixed(2))">－</button>
        <span>{{ Math.round(zoom * 100) }}%</span>
        <button :disabled="zoom >= 3" @click="zoom = Math.min(3, +(zoom + 0.2).toFixed(2))">＋</button>
      </div>
    </div>

    <div class="pdf-wrap" ref="wrapEl">
      <div v-if="busy" class="pdf-busy">読み込み中…</div>
      <div v-if="errorMsg" class="pdf-error">{{ errorMsg }}</div>
      <div class="pdf-stage">
        <canvas ref="canvasEl" class="pdf-canvas"></canvas>
        <slot name="overlay" :boxes="boxes"></slot>
      </div>
    </div>
  </div>
</template>

<style scoped>
.topbar { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 6px; }
.topbar.dim { opacity: .4; pointer-events: none; }
.page-nav, .zoom-nav { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-muted); }
.page-nav button, .zoom-nav button { border: 1px solid var(--border); background: var(--surface);
  border-radius: 8px; min-width: 30px; padding: 4px 8px; cursor: pointer; font-size: 14px; }
.page-nav button:disabled, .zoom-nav button:disabled { opacity: 0.4; }

.pdf-wrap { position: relative; border: 1px solid var(--border); border-radius: 10px; background: #f1f5f9;
  overflow: auto; max-height: 52vh; -webkit-overflow-scrolling: touch; }
.pdf-busy, .pdf-error { position: absolute; top: 8px; left: 50%; transform: translateX(-50%); z-index: 5;
  font-size: 12px; font-weight: 700; color: var(--text-muted); background: #fff;
  border: 1px solid var(--border); border-radius: 8px; padding: 4px 12px; }
.pdf-error { color: var(--danger); }
.pdf-stage { position: relative; width: max-content; }
.pdf-canvas { display: block; }
</style>
