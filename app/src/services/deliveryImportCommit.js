// 納品取込の確定ロジック（純関数）。責務: 名寄せ・重複判定を通った取込行を、
// 日付×種別×仕入先ごとに入出庫レコードのペイロードへ畳み込む。副作用なし（保存は呼び出し側）。
//
// 入力行（確定対象）: { date, type, supplier, qty, unit, item }  ※ item = 対応づけ済みの品目名
// 出力: useMovements.saveMovement にそのまま渡せるペイロード配列。
//
// 種別は取込元の「種別 / 区分 / 入出庫」列（parser が 'in' | 'out' へ正規化・既定は 'in'）。
// 以前は out の行を黙って捨てていたため、確認画面が「N件取り込む」と数えた行がどこにも
// 残らず、履歴カレンダーのその日も空のままだった。数えた行はそのまま記録する。

// excluded / duplicate / 未対応づけ は呼び出し側で除外する前提だが、
// 念のため item と qty>0 を満たす行だけ通す。
export function buildImportMovements(rows = [], { batchId = null } = {}) {
  const groups = new Map()  // key: date \u0000 type \u0000 supplier → { date, type, supplier, firstSeen, lines[] }

  // Mapの各groupには、取込ファイル内でその組が最初に登場した位置も保持する。
  let firstSeen = 0
  for (const r of rows) {
    const item = (r.item ?? '').trim()
    const qty  = Number(r.qty)
    if (!item || !Number.isFinite(qty) || qty <= 0) continue

    const date = r.date
    if (!date) continue
    const type     = r.type === 'out' ? 'out' : 'in'
    const supplier = (r.supplier ?? '').trim()
    const key = `${date}\u0000${type}\u0000${supplier}`
    if (!groups.has(key)) groups.set(key, { date, type, supplier, firstSeen: firstSeen++, lines: [] })
    groups.get(key).lines.push({ item, qty, unit: (r.unit ?? '').trim() })
  }

  return [...groups.values()]
    .filter(g => g.lines.length > 0)
    // 日付は昇順。同一日内はCSVで仕入先が最初に登場した順を維持する（D-005）。
    .sort((a, b) => a.date.localeCompare(b.date) || a.firstSeen - b.firstSeen)
    .map(g => ({
      type:          g.type,
      date:          g.date,
      note:          g.supplier,           // 仕入先をメモに残す（movements に supplier 列は無いため）
      source:        'import',
      importBatchId: batchId,
      lines:         g.lines,
    }))
}
