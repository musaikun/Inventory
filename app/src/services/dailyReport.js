// 日報の文字（日誌の伝票の「📤 日報で送る」・User決定 2026-10-25）。LINE などにそのまま貼れる短い文。
// 画面には依存しない（材料は引数で受け取る）
import { stockTimeLabel } from './journalRecords.js'

const WEEK = ['日', '月', '火', '水', '木', '金', '土']

/**
 * @param {object} p
 * @param {string} p.date 'YYYY-MM-DD'
 * @param {string} [p.store] 店の名前
 * @param {{ text, doneAt, assigneeName }[]} p.tasks その日のやること
 * @param {{ cl: { name }, complete, filled, total }[]} p.lists その日のルーティン
 * @param {{ kind, title, at, end, pauses, pauseMs, imported }[]} p.records 棚卸・発注・入出庫
 * @param {string} [p.note] その日のメモ
 */
export function dailyReportText({ date, store = '', tasks = [], lists = [], records = [], note = '' }) {
  const d = new Date(date + 'T00:00:00')
  const head = `【日報】${d.getMonth() + 1}/${d.getDate()}（${WEEK[d.getDay()]}）${store ? ` ${store}` : ''}`
  const done = tasks.filter(t => t.doneAt).length + lists.filter(r => r.complete).length
  const total = tasks.length + lists.length
  const out = [head]
  if (total) out.push(`やること ${done}/${total} 済み`)
  const left = [
    ...lists.filter(r => !r.complete).map(r => `${r.cl.name}${r.total > 1 ? ` ${r.filled}/${r.total}` : ''}`),
    ...tasks.filter(t => !t.doneAt).map(t => `${t.text}${t.assigneeName ? `（${t.assigneeName}）` : ''}`),
  ]
  if (left.length) out.push('▼ やり残し', ...left.map(x => `・${x}`))
  if (records.length) {
    out.push('▼ 記録')
    for (const r of records) {
      const time = r.kind === 'stock' ? stockTimeLabel(r) : ''
      out.push(`・${r.title}${time ? `（${time}）` : ''}`)
    }
  }
  if (note) out.push('▼ メモ', note)
  return out.join('\n')
}
