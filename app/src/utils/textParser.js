// 納品書・発注書・メモなどの自由テキストから「品目名・数量・単位」を抽出する。
// TextPasteParserModal から利用。純粋関数としてテスト可能にするため utils に分離。

export const UNITS = ['kg', 'g', 'L', 'l', 'ml', 'ML', 'ℓ', '㎖',
  '本', '個', '袋', 'パック', '枚', '缶', '箱', '瓶',
  '玉', 'ケース', 'セット', '束', '冊', '皿', '尾', '匹', '羽', '杯']

const UNIT_LOWER = new Set(UNITS.map(u => u.toLowerCase()))

const NUM_WITH_UNIT = new RegExp(
  '^(\\d+(?:\\.\\d+)?)(' + UNITS.join('|') + ')?$', 'i'
)

export function normalizeUnit(u) {
  if (!u) return ''
  if (u.toLowerCase() === 'l') return 'L'
  if (u.toLowerCase() === 'ml') return 'ml'
  return u
}

// 1行をパースして { name, qty, unit, selected } を返す。品目が取れなければ null。
export function parseLine(raw) {
  const text = (raw ?? '').trim()
  if (!text) return null
  if (/^[-=─━_＿─]{2,}/.test(text)) return null  // separator

  // 金額表示を除去
  const cleaned = text
    .replace(/[¥￥]\s*[\d,]+/g, '')
    .replace(/[\d,]+\s*円/g, '')
    .replace(/合計|小計|税込|税抜|消費税/g, '')
    .trim()
  if (!cleaned) return null

  // ヘッダー行スキップ
  if (/^(品名|品目名?|商品名|数量|単位|単価|No\.|#|合計|備考)/.test(cleaned)) return null

  // 空白・タブで分割
  const tokens = cleaned.split(/[\s\t　]+/).filter(Boolean)
  if (!tokens.length) return null

  // nameEndIdx = 数量トークンの位置（品目名はこれより前のトークン）。
  // 単位が別トークンでも品目名には含めない（数量の語が名前に漏れるのを防ぐ）。
  let nameEndIdx = -1
  let qty = null
  let unit = ''

  for (let i = 0; i < tokens.length; i++) {
    const m = tokens[i].match(NUM_WITH_UNIT)
    if (m) {
      const v = parseFloat(m[1])
      if (!isNaN(v)) {
        nameEndIdx = i
        qty        = v
        unit       = normalizeUnit(m[2] || '')
        // 次のトークンが単位単体なら取り込む（品目名の終端は数量位置のまま）
        if (!unit && i + 1 < tokens.length && UNIT_LOWER.has(tokens[i + 1].toLowerCase())) {
          unit = normalizeUnit(tokens[i + 1])
        }
        break
      }
    }
  }

  const nameParts = nameEndIdx >= 0 ? tokens.slice(0, nameEndIdx) : tokens
  const name = nameParts.join('').trim()  // 日本語品目名はスペース不要

  if (!name) return null
  return { name, qty, unit, selected: true }
}

// 複数行テキストをパースして抽出できた行だけ返す。
export function parseInventoryText(text) {
  return (text ?? '').split(/\r?\n/).map(parseLine).filter(Boolean)
}
