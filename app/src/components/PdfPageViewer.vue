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
 *
 * ## 指の操作（スマホで紙を見るときの当たり前）
 *
 * - **横スワイプでページ送り**（等倍以下のときだけ）
 * - **2本指で拡大・縮小**
 *
 * 上のボタンは残す。片手で持っているとき・PCのときはボタンのほうが速い。
 *
 * 作りで気をつけている点:
 *
 * 1. **`touch-action` はジェスチャの開始時に決まり、途中では取り返せない。** そのため
 *    拡大中（横にはみ出しているとき）は `pan-x pan-y` で紙を指で動かせるようにし、
 *    等倍以下では `pan-y`（縦スクロールだけ）にして横をこちらで受け取る。
 *    `zoom` はジェスチャの合間にしか変わらないので、切り替えが途中で起きない。
 * 2. **ピンチ中はcanvasを描き直さない。** 1フレームごとの再描画は間に合わないので、
 *    `.pdf-stage` にCSSの `scale` を当てて即座に追従させ（当たり判定も子なので一緒に動く）、
 *    **指を離してから**その倍率で描き直して解像度を戻す。描き直しが終わるまでCSSの
 *    拡大を残すので、いったん元の大きさへ戻る瞬間がない。
 * 3. **ピンチの中心を動かさない。** `transform-origin` を指の中心に置けば、ジェスチャ中は
 *    scrollを1度も書かずに中心が留まる（scrollを毎フレーム書くと滑らかさが落ちる）。
 *    描き直しの後は実寸が変わるので、そこで同じ点が同じ位置に来るようscrollを合わせる。
 * 4. **ジェスチャの後のclickを1回だけ捨てる。** 紙の上の文字はbuttonなので、スワイプや
 *    ピンチの直後にそのままclickが飛ぶと、触っていない列が選ばれてしまう。
 */
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { toReadingCoords } from '../utils/pdfTableParser.js'
import LoadingSpinner from './LoadingSpinner.vue'

const props = defineProps({
  file: { type: Object, default: null },   // File（PDF本体）
  dim:  { type: Boolean, default: false }, // 操作を伏せる（先に答えてほしい問いがあるとき）
})
const emit = defineEmits(['loaded', 'error', 'boxes'])

// 拡大の範囲。ボタンも指も同じ範囲にする（片方だけ広いと、行き先が違って混乱する）
const ZOOM_MIN = 0.6
const ZOOM_MAX = 3
const ZOOM_STEP = 0.2

// 横スワイプでページを送る判定。タップと取り違えない幅にする
const SWIPE_SLOP   = 10   // これを超えてから、縦スクロールか横スワイプかを決める
const SWIPE_THRESH = 60   // 離した時点でこれ以上動いていればページを送る
const GHOST_CLICK_MS = 500

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

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
const stageEl   = ref(null)

// 指に即座に追従させるための見かけの変形（描き直しが終わったら 1 / 0 に戻す）
const liveScale  = ref(1)
const liveOrigin = ref('0 0')
const dragX      = ref(0)
const snapping   = ref(false)

let _pdf = null
let _pdfjsLib = null

// 等倍以下なら横にはみ出さないので、横スワイプをページ送りに使える。
// 拡大中は紙を指で動かしたいので、横はブラウザに渡す。
const canSwipePage = computed(() => pageCount.value > 1 && zoom.value <= 1)
const touchAction  = computed(() => (zoom.value > 1 ? 'pan-x pan-y' : 'pan-y'))

const stageTransform = computed(() => {
  const parts = []
  if (dragX.value) parts.push(`translateX(${dragX.value}px)`)
  if (liveScale.value !== 1) parts.push(`scale(${liveScale.value})`)
  return parts.length ? parts.join(' ') : 'none'
})

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
        tokens.push({ text, x: c.x, y: c.y, w: i.width ?? 0, h: i.height ?? 0 })
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
onBeforeUnmount(() => {
  clearTimeout(_swallowT)
  try { _pdf?.destroy() } catch (_) {}
})

// ピンチのあと、同じ点が同じ位置に来るよう合わせるための控え
let _pendingFocus = null

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
    applyPendingFocus()
    // 実寸で描けたので、見かけの拡大は用済み
    liveScale.value = 1
    liveOrigin.value = '0 0'
  }
}

// ピンチで指が留めていた点を、描き直した後の実寸でも同じ位置へ戻す
function applyPendingFocus() {
  const f = _pendingFocus
  _pendingFocus = null
  if (!f || !wrapEl.value || !stageEl.value) return
  const w = stageEl.value.offsetWidth  || 0
  const h = stageEl.value.offsetHeight || 0
  wrapEl.value.scrollLeft = Math.max(0, f.u * w - f.ox)
  wrapEl.value.scrollTop  = Math.max(0, f.v * h - f.oy)
}

let _lastPage = 0
watch([pageIndex, zoom], async () => {
  const pageChanged = pageIndex.value !== _lastPage
  _lastPage = pageIndex.value
  if (pageChanged) _pendingFocus = null   // 別の紙なので、留めるべき点はない
  await renderPage()
  if (pageChanged && wrapEl.value) { wrapEl.value.scrollLeft = 0; wrapEl.value.scrollTop = 0 }
})

function zoomBy(d) {
  zoom.value = +clamp(zoom.value + d, ZOOM_MIN, ZOOM_MAX).toFixed(2)
}

/* ---------------- ジェスチャ ---------------- */

// ジェスチャの直後のclickを1回だけ捨てる。時間の窓にしないのは、端末差で
// 本物のタップまで飲み込んでしまうため（振り分けのチップで一度それを踏んでいる）。
let _swallowNextClick = false
let _swallowT = null
function armGhostSwallow() {
  _swallowNextClick = true
  clearTimeout(_swallowT)
  _swallowT = setTimeout(() => { _swallowNextClick = false }, GHOST_CLICK_MS)
}
function swallowGhostClick(e) {
  if (!_swallowNextClick) return
  _swallowNextClick = false
  clearTimeout(_swallowT)
  e.stopPropagation()
  e.stopImmediatePropagation?.()
  e.preventDefault()
}

let _mode = null    // null=未確定 / 'pinch' / 'swipe' / 'scroll'（ブラウザに任せた）
let _pinch = null
let _sw = null
let _moved = false

function twoFinger(e) {
  const a = e.touches[0], b = e.touches[1]
  return {
    dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
    cx: (a.clientX + b.clientX) / 2,
    cy: (a.clientY + b.clientY) / 2,
  }
}

function beginPinch(e) {
  const p = twoFinger(e)
  if (!(p.dist > 1) || !stageEl.value) return
  // 前の描き直しがまだ終わっていないときは、見かけの拡大を畳んでから測る
  // （変形の入った矩形から中心を逆算すると、ずれが積み上がる）
  if (liveScale.value !== 1) { liveScale.value = 1; liveOrigin.value = '0 0' }
  const st = stageEl.value.getBoundingClientRect()
  _pinch = {
    dist0: p.dist, z0: zoom.value,
    fx: p.cx - st.left, fy: p.cy - st.top,
    stageW: st.width, stageH: st.height,
    cx: p.cx, cy: p.cy,
  }
  liveOrigin.value = `${_pinch.fx}px ${_pinch.fy}px`
  dragX.value = 0
  _sw = null
  _mode = 'pinch'
}

function endPinch() {
  const p = _pinch
  _pinch = null
  _mode = null
  if (!p) return
  const z = +clamp(p.z0 * liveScale.value, ZOOM_MIN, ZOOM_MAX).toFixed(3)
  if (Math.abs(z - zoom.value) < 0.005) {
    // 端まで来ていて倍率が変わらない。描き直しは起きないので、ここで畳む
    liveScale.value = 1
    liveOrigin.value = '0 0'
    return
  }
  const wr = wrapEl.value?.getBoundingClientRect()
  _pendingFocus = p.stageW > 0 && p.stageH > 0 && wr
    ? { u: p.fx / p.stageW, v: p.fy / p.stageH, ox: p.cx - wr.left, oy: p.cy - wr.top }
    : null
  zoom.value = z   // → watch → renderPage が focus を当て、見かけの拡大を畳む
}

// はみ出す側へは強く抵抗させる（次のページが無いのに動くと、送れると誤解する）
function dampDx(dx) {
  const atEdge = (dx > 0 && pageIndex.value === 0) ||
                 (dx < 0 && pageIndex.value >= pageCount.value - 1)
  return dx * (atEdge ? 0.18 : 0.5)
}

function onTouchStart(e) {
  snapping.value = false
  if (e.touches.length >= 2) { beginPinch(e); return }
  if (e.touches.length === 1) {
    const t = e.touches[0]
    _sw = { x: t.clientX, y: t.clientY, dx: 0 }
    _mode = null
    _moved = false
  }
}

function onTouchMove(e) {
  if (e.touches.length >= 2) {
    if (_mode !== 'pinch') beginPinch(e)
    if (!_pinch) return
    if (e.cancelable) e.preventDefault()
    const p = twoFinger(e)
    if (!(p.dist > 1)) return
    // 倍率の範囲へ先に丸める（範囲外まで指で開けると、離した瞬間に戻って見える）
    const z = clamp((p.dist / _pinch.dist0) * _pinch.z0, ZOOM_MIN, ZOOM_MAX)
    liveScale.value = z / _pinch.z0
    if (Math.abs(liveScale.value - 1) > 0.02) _moved = true
    return
  }
  if (_mode === 'pinch' || _mode === 'scroll' || !_sw) return
  const t = e.touches[0]
  const dx = t.clientX - _sw.x
  const dy = t.clientY - _sw.y
  if (_mode === null) {
    if (Math.abs(dx) < SWIPE_SLOP && Math.abs(dy) < SWIPE_SLOP) return
    // 縦が勝っているか、そもそも送るページが無いならブラウザに任せる
    _mode = (Math.abs(dy) >= Math.abs(dx) || !canSwipePage.value) ? 'scroll' : 'swipe'
    if (_mode === 'scroll') return
  }
  if (e.cancelable) e.preventDefault()
  _sw.dx = dx
  _moved = true
  dragX.value = dampDx(dx)
}

function onTouchEnd(e) {
  if (_mode === 'pinch') {
    // 指が1本になった時点で確定する（残った1本でそのまま引きずらせない）
    if (e.touches.length < 2) { endPinch(); _sw = null }
    if (_moved) armGhostSwallow()
    return
  }
  if (_mode === 'swipe' && _sw) {
    const dx = _sw.dx
    snapping.value = true
    dragX.value = 0
    if (Math.abs(dx) >= SWIPE_THRESH) {
      if (dx < 0 && pageIndex.value < pageCount.value - 1) pageIndex.value++
      else if (dx > 0 && pageIndex.value > 0) pageIndex.value--
    }
  }
  if (_moved) armGhostSwallow()
  _mode = null
  _sw = null
}

// システムにジェスチャを取られた（画面端スワイプ・着信・通知）。touchend は来ない。
function onTouchCancel() {
  if (_mode === 'pinch') { endPinch(); return }
  snapping.value = true
  dragX.value = 0
  _mode = null
  _sw = null
}
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
        <button :disabled="zoom <= ZOOM_MIN" @click="zoomBy(-ZOOM_STEP)">－</button>
        <span>{{ Math.round(zoom * 100) }}%</span>
        <button :disabled="zoom >= ZOOM_MAX" @click="zoomBy(ZOOM_STEP)">＋</button>
      </div>
    </div>

    <div
      class="pdf-wrap" ref="wrapEl"
      :style="{ touchAction }"
      @touchstart="onTouchStart"
      @touchmove="onTouchMove"
      @touchend="onTouchEnd"
      @touchcancel="onTouchCancel"
    >
      <div v-if="busy" class="pdf-busy"><LoadingSpinner /></div>
      <div v-if="errorMsg" class="pdf-error">{{ errorMsg }}</div>
      <div
        class="pdf-stage" ref="stageEl"
        :class="{ snapping }"
        :style="{ transform: stageTransform, transformOrigin: liveOrigin }"
        @click.capture="swallowGhostClick"
      >
        <canvas ref="canvasEl" class="pdf-canvas"></canvas>
        <slot name="overlay" :boxes="boxes"></slot>
      </div>
    </div>

    <p class="pdf-hint">
      <span v-if="canSwipePage">横スワイプでページ送り ・ </span>2本指で拡大・縮小
    </p>
  </div>
</template>

<style scoped>
.topbar { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 6px; }
.topbar.dim { opacity: .4; pointer-events: none; }
.page-nav, .zoom-nav { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-muted); }
.page-nav button, .zoom-nav button { border: 1px solid var(--border); background: var(--surface);
  border-radius: 8px; min-width: 30px; padding: 4px 8px; cursor: pointer; font-size: 14px; }
.page-nav button:disabled, .zoom-nav button:disabled { opacity: 0.4; }

/* `touch-action` は script 側から当てる（拡大中だけ横を渡すため）。
   文字の選択が割り込むとジェスチャごと取られるので、ここで止める */
/* 高さは **固定**。`max-height` だと拡大・縮小やページ送りのたびに枠が伸び縮みして、
   下にある操作（戻る・次へ）が押し出されたり隠れたりする。紙の見え方が変わるだけで
   画面の骨組みが動くのは、いちばん落ち着かない。 */
.pdf-wrap { position: relative; border: 1px solid var(--border); border-radius: 10px; background: #f1f5f9;
  overflow: auto; height: 52vh; -webkit-overflow-scrolling: touch;
  user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
.pdf-busy, .pdf-error { position: absolute; top: 8px; left: 50%; transform: translateX(-50%); z-index: 5;
  font-size: 12px; font-weight: 700; color: var(--text-muted); background: #fff;
  border: 1px solid var(--border); border-radius: 8px; padding: 4px 12px; }
.pdf-error { color: var(--danger); }
.pdf-stage { position: relative; width: max-content; will-change: transform; }
/* 指を離したあとの戻りだけ滑らかにする。ジェスチャ中に transition があると指から遅れる */
.pdf-stage.snapping { transition: transform 0.18s ease-out; }
.pdf-canvas { display: block; }

.pdf-hint { margin: 5px 0 0; font-size: 10.5px; color: var(--text-muted); text-align: center; }
/* 指で触れない環境では案内しない（上のボタンが本来の操作になる） */
@media (hover: hover) and (pointer: fine) { .pdf-hint { display: none; } }

@media (prefers-reduced-motion: reduce) {
  .pdf-stage.snapping { transition: none; }
}
</style>
