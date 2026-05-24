// pdfjs-dist はブラウザ向けのため、CF Workers に存在しない Canvas 系 API を
// モジュール初期化時のみ使用する。テキスト抽出では実際に呼ばれないためスタブで回避する。
if (typeof globalThis.DOMMatrix === 'undefined') {
  globalThis.DOMMatrix = class DOMMatrix {
    constructor() {
      this.a=1;this.b=0;this.c=0;this.d=1;this.e=0;this.f=0
      this.m11=1;this.m12=0;this.m13=0;this.m14=0
      this.m21=0;this.m22=1;this.m23=0;this.m24=0
      this.m31=0;this.m32=0;this.m33=1;this.m34=0
      this.m41=0;this.m42=0;this.m43=0;this.m44=1
    }
    static fromMatrix()      { return new globalThis.DOMMatrix() }
    static fromFloat32Array(){ return new globalThis.DOMMatrix() }
    static fromFloat64Array(){ return new globalThis.DOMMatrix() }
    multiply()       { return new globalThis.DOMMatrix() }
    translate()      { return new globalThis.DOMMatrix() }
    scale()          { return new globalThis.DOMMatrix() }
    rotate()         { return new globalThis.DOMMatrix() }
    inverse()        { return new globalThis.DOMMatrix() }
    transformPoint(p){ return p }
  }
}
if (typeof globalThis.Path2D    === 'undefined') globalThis.Path2D    = class Path2D {}
if (typeof globalThis.ImageData === 'undefined') {
  globalThis.ImageData = class ImageData {
    constructor(w, h) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(w * h * 4) }
  }
}

// static import はホイストされスタブより先に実行されるため、動的インポートを使用する
// pdfjs worker を先に import しておくことで wrangler がバンドルに含め、
// fake worker モード時の import(workerSrc) が成功するようにする
await import('pdfjs-dist/build/pdf.worker.min.mjs')
const pdfjsLib = await import('pdfjs-dist')

// CF Workers には Worker クラスがないため pdfjs v5 の fake worker モードを使用する。
// pdfjs v5 は Worker が存在しない場合 import(workerSrc) を実行してインプロセスで処理する。
// 'fake' などの存在しないパッケージ名では失敗するため、実際の worker モジュールパスを指定する。
pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdfjs-dist/build/pdf.worker.min.mjs'

function isCjk(s) {
  return /[　-鿿＀-￯]/.test(s)
}

async function getPdfPageItems(page) {
  const tc = await page.getTextContent()
  return tc.items
    .map(i => ({ text: (i.str ?? '').trim(), x: i.transform[4], y: i.transform[5] }))
    .filter(i => i.text)
}

function parsePdfPageRotated(items) {
  const KNOWN_HEADERS = new Set([
    '商品名', '商品ｺｰﾄﾞ', '商品コード', '単位', '入数', '在庫数', '前月実績',
    '棚卸記入表', '棚 卸 記 入 表', '業態名', '店舗名', '棚卸月', '店舗番号',
  ])

  let category     = ''
  let categoryCode = ''
  const bunrui = items.find(i => i.text.includes('分類'))
  if (bunrui) {
    const sameX = items.filter(i =>
      Math.abs(i.x - bunrui.x) < 5 &&
      i !== bunrui &&
      i.text.length > 1 &&
      isCjk(i.text) &&
      !/^\d+$/.test(i.text) &&
      !/\d+[年月日]/.test(i.text) &&
      !KNOWN_HEADERS.has(i.text) &&
      !i.text.includes('ｺｰﾄﾞ') &&
      !i.text.includes('コード') &&
      !i.text.includes('分類')
    )
    if (sameX.length > 0) category = sameX[0].text

    const codeNums = items.filter(i =>
      Math.abs(i.x - bunrui.x) < 5 &&
      /^\d+$/.test(i.text) &&
      parseInt(i.text, 10) >= 1 &&
      parseInt(i.text, 10) <= 999
    )
    if (codeNums.length > 0) categoryCode = codeNums[0].text
  }

  const nameHeaderYs = items.filter(i => i.text === '商品名').map(i => i.y)
  const unitHeaderYs = items.filter(i => i.text === '単位').map(i => i.y)
  const codeHeaderYs = items.filter(i => i.text === '商品ｺｰﾄﾞ' || i.text === '商品コード').map(i => i.y)
  const packHeaderYs = items.filter(i => i.text === '入数').map(i => i.y)
  const prevHeaderYs = items.filter(i => i.text === '前月実績').map(i => i.y)
  if (nameHeaderYs.length === 0) return []

  const Y_TOL   = 40
  const X_TOL   = 8
  const MIN_X   = 130

  const rowNumXs = items
    .filter(i => {
      const n = parseInt(i.text, 10)
      return !isNaN(n) && n >= 1 && n <= 60 && i.text.trim() === String(n)
    })
    .map(i => i.x)
  const DATA_X_MAX = rowNumXs.length >= 3 ? Math.max(...rowNumXs) + 20 : Infinity

  function dataAt(targetY) {
    return items.filter(i =>
      Math.abs(i.y - targetY) <= Y_TOL &&
      i.x >= MIN_X &&
      i.x <= DATA_X_MAX &&
      !KNOWN_HEADERS.has(i.text)
    )
  }

  function nearestY(ys, target) {
    return ys.reduce((b, y) => Math.abs(y - target) < Math.abs(b - target) ? y : b, ys[0])
  }

  function pickNearest(pool, refX, headerY) {
    return pool
      .filter(d => Math.abs(d.x - refX) <= X_TOL)
      .sort((a, b) => Math.abs(a.y - headerY) - Math.abs(b.y - headerY))[0]
  }

  const products = []

  for (const nameY of nameHeaderYs) {
    const rawNameItems = dataAt(nameY).filter(i => isCjk(i.text))
    if (rawNameItems.length === 0) continue

    rawNameItems.sort((a, b) => a.x - b.x || a.y - b.y)
    const nameItems = []
    for (const ni of rawNameItems) {
      const last = nameItems[nameItems.length - 1]
      if (last && Math.abs(last.x - ni.x) <= X_TOL) {
        last.text += ' ' + ni.text
      } else {
        nameItems.push({ ...ni })
      }
    }

    const unitY = unitHeaderYs.length > 0 ? nearestY(unitHeaderYs, nameY) : null
    const codeY = codeHeaderYs.length > 0 ? nearestY(codeHeaderYs, nameY) : null
    const packY = packHeaderYs.length > 0 ? nearestY(packHeaderYs, nameY) : null
    const prevY = prevHeaderYs.length > 0 ? nearestY(prevHeaderYs, nameY) : null

    const unitData = unitY != null ? dataAt(unitY) : []
    const codeData = codeY != null ? dataAt(codeY).filter(i => /^\d+$/.test(i.text) && parseInt(i.text, 10) > 60) : []
    const packData = packY != null ? dataAt(packY) : []
    const prevData = prevY != null ? dataAt(prevY) : []

    for (const ni of nameItems) {
      const ui = pickNearest(unitData, ni.x, unitY ?? nameY)
      const ci = pickNearest(codeData, ni.x, codeY ?? nameY)
      const qi = pickNearest(packData, ni.x, packY ?? nameY)
      const pi = pickNearest(prevData, ni.x, prevY ?? nameY)
      products.push({
        name:         ni.text,
        unit:         ui?.text ?? '',
        category,
        categoryCode,
        code:         ci?.text ?? '',
        packQty:      qi?.text ?? '',
        prevMonth:    pi?.text ?? '',
      })
    }
  }

  return products
}

export async function parsePdfFile(arrayBuffer) {
  const loadingTask = pdfjsLib.getDocument({
    data:           new Uint8Array(arrayBuffer),
    useSystemFonts: true,
    disableRange:   true,
  })

  const pdf = await loadingTask.promise
  const items      = []
  const debugLines = []

  for (let p = 1; p <= pdf.numPages; p++) {
    const page      = await pdf.getPage(p)
    const pageItems = await getPdfPageItems(page)

    if (p === 1) {
      const vp = page.getViewport({ scale: 1 })
      debugLines.push(`pageW=${Math.round(vp.width)} pageH=${Math.round(vp.height)} rotate=${page.rotate}`)
      const sorted = [...pageItems].sort((a, b) => b.y - a.y || a.x - b.x)
      for (const i of sorted.slice(0, 60)) {
        debugLines.push(`x=${String(Math.round(i.x)).padStart(4)}  y=${String(Math.round(i.y)).padStart(4)}  "${i.text}"`)
      }
    }

    items.push(...parsePdfPageRotated(pageItems))
  }

  pdf.destroy()
  return { items, debugLines }
}
