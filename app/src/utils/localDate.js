// 端末のローカル日付（YYYY-MM-DD）。
// `toISOString().slice(0, 10)` は UTC の日付なので、日本時間 0:00〜9:00 の記録が前日になる。
// 発注・入出庫の「その日」はカレンダーと同じローカル日付でそろえる。
export function localDateKey(d = new Date()) {
  const t = d instanceof Date ? d : new Date(d)
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
}
