import * as XLSX from 'xlsx'

// ── 1シート分をパース ────────────────────────────────────────────────────────
function parseSheet(rows) {
  let category = ''
  const items  = []

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] || []

    // ── カテゴリ検出（「分類」を含むセルの右側にある日本語テキスト）────────
    if (!category) {
      for (let c = 0; c < row.length; c++) {
        if (String(row[c] ?? '').includes('分類')) {
          for (let offset = 1; offset <= 5; offset++) {
            const val = String(row[c + offset] ?? '').trim()
            if (val && !/^\d+$/.test(val)) { category = val; break }
          }
          break
        }
      }
    }

    // ── データ行検出（col[0] が 1〜60 の整数）────────────────────────────
    const rowNum = parseInt(String(row[0] ?? '').trim(), 10)
    if (isNaN(rowNum) || rowNum < 1 || rowNum > 60) continue

    // 左側: 商品名=col3, 単位=col5
    const nameL = String(row[3] ?? '').trim()
    const unitL = String(row[5] ?? '').trim()
    if (nameL) items.push({ name: nameL, unit: unitL, category })

    // 右側: 商品名=col11, 単位=col15
    const nameR = String(row[11] ?? '').trim()
    const unitR = String(row[15] ?? '').trim()
    if (nameR) items.push({ name: nameR, unit: unitR, category })
  }

  return items
}

// ── 全シート / 複数ブロック対応 ─────────────────────────────────────────────
export function parseExcelFile(arrayBuffer) {
  const wb    = XLSX.read(arrayBuffer, { type: 'array' })
  const items = []

  if (wb.SheetNames.length > 1) {
    // ── パターンA: 1シート＝1カテゴリ（30シート想定）────────────────────
    for (const name of wb.SheetNames) {
      const ws   = wb.Sheets[name]
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
      items.push(...parseSheet(rows))
    }
  } else {
    // ── パターンB: 1シートに複数ブロック（業態名行で分割）────────────────
    const ws       = wb.Sheets[wb.SheetNames[0]]
    const allRows  = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
    let   block    = []

    for (const row of allRows) {
      const col0 = String(row[0] ?? '').trim()
      if (col0 === '業態名' && block.length > 0) {
        // 新ページ検出 → 前のブロックをパース
        items.push(...parseSheet(block))
        block = []
      }
      block.push(row)
    }
    if (block.length > 0) items.push(...parseSheet(block))
  }

  return items
}

// ── app の品目リスト CSV に変換 ─────────────────────────────────────────────
export function itemsToConfigCSV(items) {
  const rows = ['品目名,単位,単価,カテゴリ,エイリアス']
  for (const { name, unit, category } of items) {
    const u = unit     ? `"${unit}"`     : ''
    const c = category ? `"${category}"` : ''
    rows.push(`"${name}",${u},,${c},`)
  }
  return rows.join('\r\n')
}
