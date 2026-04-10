import * as XLSX from 'xlsx'
import * as pdfjsLib from 'pdfjs-dist'

// ── PDF.js ワーカー設定 ───────────────────────────────────────────────────────
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).href

// ── 共通: 行トークンから商品名・単位を抽出 ──────────────────────────────────
function isCjk(s) {
  return /[\u3000-\u9FFF\uFF00-\uFFEF]/.test(s)
}

function extractProduct(tokens) {
  // パターン: [行番号] [商品コード?] [商品名(CJK)] [入数?] [単位(短文)] [実績?]
  let name = ''
  let unit = ''

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (!name) {
      if (isCjk(t) && t.length > 1) name = t
    } else {
      // 数字(入数・実績)はスキップ、短い非数値テキスト → 単位
      if (/^\d+(\.\d+)?$/.test(t)) continue
      if (t.length >= 1 && t.length <= 6) { unit = t; break }
      break
    }
  }
  return name ? { name, unit } : null
}

// ── カテゴリ検出（「分類」を含むトークンの右側にある日本語テキスト）────────
function findCategory(tokens) {
  for (let i = 0; i < tokens.length; i++) {
    if (String(tokens[i]).includes('分類')) {
      for (let j = i + 1; j <= Math.min(i + 6, tokens.length - 1); j++) {
        const v = String(tokens[j]).trim()
        if (v && !/^\d+$/.test(v)) return v
      }
    }
  }
  return ''
}

// ── Excel パーサー ────────────────────────────────────────────────────────────
function parseExcelSheet(rows) {
  let category = ''
  const items  = []

  for (const row of rows) {
    if (!category) {
      const cat = findCategory(row.map(c => String(c ?? '')))
      if (cat) category = cat
    }

    const rowNum = parseInt(String(row[0] ?? '').trim(), 10)
    if (isNaN(rowNum) || rowNum < 1 || rowNum > 60) continue

    // 左側: col3=商品名, col5=単位
    const nameL = String(row[3]  ?? '').trim()
    const unitL = String(row[5]  ?? '').trim()
    if (nameL) items.push({ name: nameL, unit: unitL, category })

    // 右側: col11=商品名, col15=単位
    const nameR = String(row[11] ?? '').trim()
    const unitR = String(row[15] ?? '').trim()
    if (nameR) items.push({ name: nameR, unit: unitR, category })
  }

  return items
}

export function parseExcelFile(arrayBuffer) {
  const wb    = XLSX.read(arrayBuffer, { type: 'array' })
  const items = []

  if (wb.SheetNames.length > 1) {
    // パターンA: 複数シート（1シート＝1カテゴリ）
    for (const name of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' })
      items.push(...parseExcelSheet(rows))
    }
  } else {
    // パターンB: 1シートに複数ページが縦に続く
    const rows  = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' })
    let   block = []
    for (const row of rows) {
      if (String(row[0] ?? '').trim() === '業態名' && block.length > 0) {
        items.push(...parseExcelSheet(block))
        block = []
      }
      block.push(row)
    }
    if (block.length > 0) items.push(...parseExcelSheet(block))
  }

  return items
}

// ── PDF パーサー ──────────────────────────────────────────────────────────────
async function getPdfPageRows(page) {
  const viewport    = page.getViewport({ scale: 1 })
  const midX        = viewport.width / 2
  const YTOL        = 5   // y座標の許容誤差(pt)
  const textContent = await page.getTextContent()

  const rowMap = new Map()
  for (const item of textContent.items) {
    const text = (item.str ?? '').trim()
    if (!text) continue
    const y = Math.round(item.transform[5] / YTOL) * YTOL
    if (!rowMap.has(y)) rowMap.set(y, [])
    rowMap.get(y).push({ text, x: item.transform[4], isRight: item.transform[4] > midX })
  }

  // y の大きい順（ページ上部から）に並べて返す
  return [...rowMap.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, cells]) => ({
      left:  cells.filter(c => !c.isRight).sort((a, b) => a.x - b.x).map(c => c.text),
      right: cells.filter(c =>  c.isRight).sort((a, b) => a.x - b.x).map(c => c.text),
    }))
}

function parsePdfPageRows(rows) {
  let category = ''
  const items  = []

  for (const { left, right } of rows) {
    // カテゴリ検出
    if (!category) {
      const cat = findCategory([...left, ...right])
      if (cat) category = cat
    }

    // 左側データ行（行番号 1–30）
    const leftNum = parseInt(left[0], 10)
    if (!isNaN(leftNum) && leftNum >= 1 && leftNum <= 30) {
      const prod = extractProduct(left.slice(1))
      if (prod) items.push({ ...prod, category })
    }

    // 右側データ行（行番号 31–60）
    const rightNum = parseInt(right[0], 10)
    if (!isNaN(rightNum) && rightNum >= 31 && rightNum <= 60) {
      const prod = extractProduct(right.slice(1))
      if (prod) items.push({ ...prod, category })
    }
  }

  return items
}

export async function parsePdfFile(arrayBuffer) {
  const pdf   = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise
  const items = []
  const debugLines = []

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p)

    // 1ページ目: 生座標をデバッグ出力
    if (p === 1) {
      const tc = await page.getTextContent()
      const vp = page.getViewport({ scale: 1 })
      debugLines.push(`pageW=${Math.round(vp.width)} pageH=${Math.round(vp.height)} rotate=${page.rotate}`)
      const rawItems = tc.items
        .map(i => ({ text: (i.str ?? '').trim(), x: Math.round(i.transform[4]), y: Math.round(i.transform[5]) }))
        .filter(i => i.text)
        .sort((a, b) => b.y - a.y || a.x - b.x)
      for (const i of rawItems.slice(0, 60)) {
        debugLines.push(`x=${String(i.x).padStart(4)}  y=${String(i.y).padStart(4)}  "${i.text}"`)
      }
    }

    const rows = await getPdfPageRows(page)
    items.push(...parsePdfPageRows(rows))
  }

  return { items, debugLines }
}

// ── アプリ形式 CSV に変換 ────────────────────────────────────────────────────
export function itemsToConfigCSV(items) {
  const rows = ['品目名,単位,単価,カテゴリ,エイリアス']
  for (const { name, unit, category } of items) {
    const u = unit     ? `"${unit}"`     : ''
    const c = category ? `"${category}"` : ''
    rows.push(`"${name}",${u},,${c},`)
  }
  return rows.join('\r\n')
}
