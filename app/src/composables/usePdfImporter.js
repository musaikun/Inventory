import * as XLSX from 'xlsx'
import * as pdfjsLib from 'pdfjs-dist'

// ── PDF.js ワーカー設定 ───────────────────────────────────────────────────────
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).href

// ── 共通ユーティリティ ────────────────────────────────────────────────────────
function isCjk(s) {
  return /[\u3000-\u9FFF\uFF00-\uFFEF]/.test(s)
}

// ── カテゴリ検出（「分類」を含むトークンの右側にある日本語テキスト）────────
function findCategory(tokens) {
  for (let i = 0; i < tokens.length; i++) {
    if (String(tokens[i]).includes('分類')) {
      for (let j = i + 1; j <= Math.min(i + 6, tokens.length - 1); j++) {
        const v = String(tokens[j]).trim()
        if (v && isCjk(v) && !/^\d+$/.test(v)) return v
      }
    }
  }
  return ''
}

// ── Excelヘッダー行から追加列のインデックスを検出（商品名列は固定） ─────────
// nameL=3, unitL=5, nameR=11, unitR=15 は既知固定値として維持し、
// 商品コード・入数・前月実績のみ動的に検出する
function detectExtraExcelCols(rows) {
  const NAME_L = 3
  const NAME_R = 11
  for (const row of rows) {
    const strs = row.map(c => String(c ?? '').trim())
    if (strs[NAME_L] !== '商品名') continue

    const findIn = (arr, baseOffset, names) => {
      const i = arr.findIndex(s => names.includes(s))
      return i >= 0 ? baseOffset + i : null
    }

    const leftStrs  = strs.slice(0, NAME_R)
    const rightStrs = strs.slice(NAME_R)

    return {
      codeL: findIn(leftStrs,  0,      ['商品コード', '商品ｺｰﾄﾞ']),
      packL: findIn(leftStrs,  0,      ['入数']),
      prevL: findIn(leftStrs,  0,      ['前月実績']),
      codeR: findIn(rightStrs, NAME_R, ['商品コード', '商品ｺｰﾄﾞ']),
      packR: findIn(rightStrs, NAME_R, ['入数']),
      prevR: findIn(rightStrs, NAME_R, ['前月実績']),
    }
  }
  // ヘッダー行が見つからない場合は全て null（追加フィールドは空）
  return { codeL: null, packL: null, prevL: null, codeR: null, packR: null, prevR: null }
}

// ── Excel パーサー ────────────────────────────────────────────────────────────
function parseExcelSheet(rows) {
  let category = ''
  const items  = []
  const extra  = detectExtraExcelCols(rows)
  const xcol   = (row, idx) => idx != null ? String(row[idx] ?? '').trim() : ''

  for (const row of rows) {
    if (!category) {
      const cat = findCategory(row.map(c => String(c ?? '')))
      if (cat) category = cat
    }

    const rowNum = parseInt(String(row[0] ?? '').trim(), 10)
    if (isNaN(rowNum) || rowNum < 1 || rowNum > 60) continue

    const nameL = String(row[3]  ?? '').trim()
    const unitL = String(row[5]  ?? '').trim()
    if (nameL) items.push({
      name: nameL, unit: unitL, category,
      code:      xcol(row, extra.codeL),
      packQty:   xcol(row, extra.packL),
      prevMonth: xcol(row, extra.prevL),
    })

    const nameR = String(row[11] ?? '').trim()
    const unitR = String(row[15] ?? '').trim()
    if (nameR) items.push({
      name: nameR, unit: unitR, category,
      code:      xcol(row, extra.codeR),
      packQty:   xcol(row, extra.packR),
      prevMonth: xcol(row, extra.prevR),
    })
  }

  return items
}

export function parseExcelFile(arrayBuffer) {
  const wb    = XLSX.read(arrayBuffer, { type: 'array' })
  const items = []

  if (wb.SheetNames.length > 1) {
    for (const name of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' })
      items.push(...parseExcelSheet(rows))
    }
  } else {
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

// ── PDF テキスト抽出 ──────────────────────────────────────────────────────────
async function getPdfPageItems(page) {
  const tc = await page.getTextContent()
  return tc.items
    .map(i => ({ text: (i.str ?? '').trim(), x: i.transform[4], y: i.transform[5] }))
    .filter(i => i.text)
}

// ── rotate=90 対応パーサー ────────────────────────────────────────────────────
// 座標の意味（rotate=90 の場合）:
//   y座標 → 列の種類（商品名・単位など、各列ヘッダーのy≒データのy）
//   x座標 → 行（左セクションと右セクションで共通のx位置）
// 構造:
//   左セクション (y > 440): 商品名y≈539, 単位y≈647
//   右セクション (y < 440): 商品名y≈141, 単位y≈249
function parsePdfPageRotated(items) {
  const KNOWN_HEADERS = new Set([
    '商品名', '商品ｺｰﾄﾞ', '商品コード', '単位', '入数', '在庫数', '前月実績',
    '棚卸記入表', '棚 卸 記 入 表', '業態名', '店舗名', '棚卸月', '店舗番号',
  ])

  // ── カテゴリ検出 ─────────────────────────────────────────────────────────
  // 「分類」を含む行のうち、同じx座標に並ぶ日本語テキストがカテゴリ名
  // x閾値を5に絞り、隣のヘッダー行（店舗名等）を誤検出しない
  let category = ''
  const bunrui = items.find(i => i.text.includes('分類'))
  if (bunrui) {
    const sameX = items.filter(i =>
      Math.abs(i.x - bunrui.x) < 5 &&
      i !== bunrui &&
      i.text.length > 1 &&
      isCjk(i.text) &&
      !/^\d+$/.test(i.text) &&
      !/\d+[年月日]/.test(i.text) &&   // 日付（2026年4月など）を除外
      !KNOWN_HEADERS.has(i.text) &&
      !i.text.includes('ｺｰﾄﾞ') &&
      !i.text.includes('コード') &&
      !i.text.includes('分類')
    )
    if (sameX.length > 0) category = sameX[0].text
  }

  // ── 各列ヘッダーのy座標を検出 ─────────────────────────────────────────────
  const nameHeaderYs = items.filter(i => i.text === '商品名').map(i => i.y)
  const unitHeaderYs = items.filter(i => i.text === '単位').map(i => i.y)
  const codeHeaderYs = items.filter(i => i.text === '商品ｺｰﾄﾞ' || i.text === '商品コード').map(i => i.y)
  const packHeaderYs = items.filter(i => i.text === '入数').map(i => i.y)
  const prevHeaderYs = items.filter(i => i.text === '前月実績').map(i => i.y)
  if (nameHeaderYs.length === 0) return []

  const Y_TOL = 40  // ヘッダーy座標からの許容差（広めに取って候補を収集）
  const X_TOL = 8   // 行x座標のマッチング許容差
  const MIN_X = 130 // x<130 はページ下端のメタデータなので除外

  // ── テーブルのx上限を行番号から動的検出 ───────────────────────────────────
  // rotate=90では x = ページ縦方向位置（行位置）
  // ページヘッダー（業態名・店舗名）は表の行より上（x が大きい）ため、
  // 行番号 1-60 が存在するx範囲の最大値を上限として使う
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

  // ── 特定列のデータを x位置マッチ＋y距離優先で1件返す ─────────────────────
  // find()（最初の一致）ではなく、ヘッダーyに最も近い候補を優先することで
  // 隣接列への溢れ込みを防ぐ
  function pickNearest(pool, refX, headerY) {
    return pool
      .filter(d => Math.abs(d.x - refX) <= X_TOL)
      .sort((a, b) => Math.abs(a.y - headerY) - Math.abs(b.y - headerY))[0]
  }

  const products = []

  for (const nameY of nameHeaderYs) {
    const rawNameItems = dataAt(nameY).filter(i => isCjk(i.text))
    if (rawNameItems.length === 0) continue

    // ── 同一行（同じx）のテキストをマージ（分割された品目名を結合）─────────
    // 例: "豆乳" と "２００ｍｌ" → "豆乳 ２００ｍｌ"
    rawNameItems.sort((a, b) => a.x - b.x || a.y - b.y)
    const nameItems = []
    for (const ni of rawNameItems) {
      const last = nameItems[nameItems.length - 1]
      if (last && Math.abs(last.x - ni.x) <= X_TOL) {
        last.text += ' ' + ni.text  // 同一行なのでテキストを連結
      } else {
        nameItems.push({ ...ni })
      }
    }

    const unitY = unitHeaderYs.length > 0 ? nearestY(unitHeaderYs, nameY) : null
    const codeY = codeHeaderYs.length > 0 ? nearestY(codeHeaderYs, nameY) : null
    const packY = packHeaderYs.length > 0 ? nearestY(packHeaderYs, nameY) : null
    const prevY = prevHeaderYs.length > 0 ? nearestY(prevHeaderYs, nameY) : null

    const unitData = unitY != null ? dataAt(unitY) : []
    const codeData = codeY != null ? dataAt(codeY) : []
    const packData = packY != null ? dataAt(packY) : []
    const prevData = prevY != null ? dataAt(prevY) : []

    for (const ni of nameItems) {
      const ui = pickNearest(unitData, ni.x, unitY ?? nameY)
      const ci = pickNearest(codeData, ni.x, codeY ?? nameY)
      const qi = pickNearest(packData, ni.x, packY ?? nameY)
      const pi = pickNearest(prevData, ni.x, prevY ?? nameY)
      products.push({
        name:      ni.text,
        unit:      ui?.text ?? '',
        category,
        code:      ci?.text ?? '',
        packQty:   qi?.text ?? '',
        prevMonth: pi?.text ?? '',
      })
    }
  }

  return products
}

export async function parsePdfFile(arrayBuffer) {
  const pdf        = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise
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

  return { items, debugLines }
}

// ── アプリ形式 CSV に変換 ────────────────────────────────────────────────────
export function itemsToConfigCSV(items) {
  const rows = ['品目名,単位,単価,カテゴリ,エイリアス,商品コード']
  for (const { name, unit, category, code } of items) {
    const u = unit     ? `"${unit}"`     : ''
    const c = category ? `"${category}"` : ''
    // カテゴリ名をエイリアスにも登録（「備品」「資材」などで音声検索できるように）
    const a = category ? `"${category}"` : ''
    const d = code     ? `"${code}"`     : ''
    rows.push(`"${name}",${u},,${c},${a},${d}`)
  }
  return rows.join('\r\n')
}
