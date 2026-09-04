/**
 * 取込の「文字の読み方」を1か所に集める。
 *
 * 同じ判断（この見出しはどの列か／この行は品目か）を、CSV経路とPDF経路が
 * 別々の書き方で持っていた。実運用の帳票は半角カナだらけで、
 * `pdfTableParser` だけが NFKC 正規化していたため、
 * **PDFなら当たる列がCSVでは当たらない**という説明のつかない差が出ていた
 * （実物の `商品ｺｰﾄﾞ` がヒント `商品コード` に一致せず、コード列だけ手作業になる）。
 */

/** NFKC で字形をそろえる。半角カナ・全角英数を、辞書と同じ土俵に乗せるため。 */
export function normText(s) {
  return String(s ?? '').normalize('NFKC').trim()
}

/** 見出しの突き合わせ用。字形・大小・空白の違いを消す。 */
export function normHeader(s) {
  return normText(s).toLowerCase().replace(/\s+/g, '')
}

/**
 * 見出し語のヒントに当たるか。`商品ｺｰﾄﾞ` と `商品コード` を同じものとして扱う。
 * 見出し行があると分かっているときだけ使う（無いファイルで推測すると
 * 1行目のデータを列名と誤読する）。
 */
export function headerMatches(header, hints) {
  const h = normHeader(header)
  if (!h) return false
  return (hints ?? []).some(hint => hint && h.includes(normHeader(hint)))
}

// 列見出しそのものの語。見出し行をデータとして拾ってしまったときに品目から外す。
const HEADER_LABELS = new Set([
  '品目名', '商品名', '品名', '名称', '品目', '商品', '品目コード', '商品コード', 'コード', '品番',
  '単価', '価格', '金額', '値段', '数量', '在庫', '個数', '分類', 'カテゴリ', 'ジャンル', '区分',
  '単位', '入数', '前月', '前月実績', '発注点',
  'item', 'name', 'product', 'qty', 'quantity', 'stock', 'unit', 'price', 'category', 'code',
])

/**
 * 品目ではない行（発行日・取引先・ページ番号・区分見出し・小計/合計）か。
 *
 * 帳票をそのまま取り込むと「小計」が単価つきの品目として登録され、
 * 品目リスト・棚卸カード・発注点に残る。**呼び出し側は既定で外し、
 * 外したことを理由つきで見せて戻せるようにする**（黙って足すのも黙って捨てるのも避ける）。
 */
export function isMetaName(name) {
  const t = normText(name)
  if (!t) return true
  if (/^[\d,.\s]+$/.test(t)) return true                                     // 数字だけ
  if (HEADER_LABELS.has(t) || HEADER_LABELS.has(t.toLowerCase())) return true // 列見出しそのもの
  // 帳票の見出しは行の先頭に来る（`発行日 2026/08/01` `ページ 1 / 26`）。
  // ここを部分一致にすると、`棚卸用ラベル` のような実在の品目まで巻き込む。
  if (/^(発行日|取引先|作成|店舗|業態|棚卸|ページ|p\.?\s*\d|注意|※|社外秘)/i.test(t)) return true
  if (/合計|小計/.test(t)) return true                        // 集計行はどこに書かれても品目ではない
  if (/^[【〔[(（].*[】〕\])）]$/.test(t)) return true                        // 【飲料】等の区分見出し
  return false
}

/** 外した理由を人の言葉で返す（画面にそのまま出す。理由が無いと戻す判断ができない）。 */
export function metaReason(name) {
  const t = normText(name)
  if (/^[【〔[(（].*[】〕\])）]$/.test(t)) return '区分の見出しに見えます'
  if (/合計|小計/.test(t)) return '合計・小計の行に見えます'
  if (/^(発行日|取引先|作成|店舗|業態|棚卸|ページ|p\.?\s*\d|注意|※|社外秘)/i.test(t)) return '帳票の見出しに見えます'
  if (HEADER_LABELS.has(t) || HEADER_LABELS.has(t.toLowerCase())) return '列の名前に見えます'
  if (/^[\d,.\s]+$/.test(t)) return '数字だけの行です'
  return '品目ではない行に見えます'
}
