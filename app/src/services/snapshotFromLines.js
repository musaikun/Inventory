/**
 * D1 の inventory_lines から、詳細画面が読める形のスナップショットを組み立てる。
 *
 * 背景（DATA-002 / R-001）: 一覧は D1 `sessions`、詳細は localStorage + D1 `store_history` と
 * データの持ち主が違うため、端末を変えると「一覧には出るのに詳細が開けない」状態になる。
 * 完了時の明細は `inventory_lines` に残っているので、そこから表示用を作り直す。
 *
 * localStorage には保存しない。これは「その場で見るための復元」であり、
 * 端末のスナップショットとして正になるものではない（D1への書き戻しも行わない）。
 */

/** 復元したスナップショットの出所を示す印。訂正可否・保存有無の判断に使う */
export const SNAPSHOT_SOURCE_LINES = 'd1-lines'

/**
 * @param {object} res `GET /store/:code/sessions/:id/lines` の応答
 * @returns {object|null} 詳細画面へ渡せるスナップショット。明細が無ければ null
 */
export function buildSnapshotFromLines(res) {
  const lines = Array.isArray(res?.lines) ? res.lines : null
  if (!lines || lines.length === 0) return null

  let totalValue = 0
  let hasPrices  = false
  const items = []

  for (const l of lines) {
    const name = String(l?.item ?? '').trim()
    if (!name) continue

    const qtyRaw    = l.qty
    const qty       = (qtyRaw == null || qtyRaw === '' || !Number.isFinite(Number(qtyRaw)))
      ? null
      : Number(qtyRaw)
    const unitPrice = l.unitPrice ?? null
    // subtotal はサーバーの line_value を優先する。完了時に確定した金額であり、
    // ここで qty×unitPrice を再計算すると当時と違う値を出しかねない。
    const subtotal  = l.subtotal ?? ((qty != null && unitPrice != null) ? Math.round(qty * unitPrice) : null)
    if (subtotal != null) { totalValue += subtotal; hasPrices = true }

    items.push({
      item:      name,
      qty,
      unit:      l.unit ?? '',
      unitPrice,
      subtotal,
      code:      '',
      flagged:   false,
      category:  l.category ?? null,
      lotSize:   '',
      prevMonth: '',
      tagA:      '',
      tagB:      '',
    })
  }
  if (items.length === 0) return null

  const date = res.date || (res.endedAt ?? res.startedAt ?? '').slice(0, 10)

  return {
    date,
    // 完了時刻を savedAt にする。端末に保存した時刻ではないので、
    // 訂正ウィンドウの判定が「復元した瞬間から3日」にならないようにする。
    savedAt:      res.endedAt ?? res.startedAt ?? (date ? `${date}T00:00:00.000Z` : new Date().toISOString()),
    items,
    // 合計はサーバーの total_value を優先。明細が上限で打ち切られている場合、
    // 明細の積み上げだと実際より小さい額を出してしまう。
    totalValue:   res.totalValue ?? (hasPrices ? totalValue : null),
    entryLog:     [],
    participants: null,
    flaggedItems: [],
    sessionId:    res.sessionId ?? null,
    auditLog:     [],
    activeMs:     null,
    axisNames:    ['', ''],
    source:       SNAPSHOT_SOURCE_LINES,
    // 端末にこのスナップショットの実体が無いため訂正はできない。
    // patchSnapshotItems は localStorage の該当日付を書き換える実装で、
    // 復元しただけの記録を編集させると「保存したつもりで消える」状態になる。
    locked:       true,
    truncated:    res.truncated === true,
  }
}
