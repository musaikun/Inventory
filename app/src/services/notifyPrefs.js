// 通知の設定（User決定 2026-10-05 → 2026-10-16）。サーバーの worker/src/pushPlan.js と同じ形・同じ既定。
// 「受け取る」をONにしたら全部届く。種類ごとのオン・オフ、日数・時刻の選択はない。
// 日付で知らせる通知の時刻は、サーバーがその人の「いつも最初にアプリを開く時刻」で決める（記録が無ければ9時）。
// 端末からは形だけ送る（サーバーは読まない）
export const DEFAULT_PREFS = Object.freeze({
  hour: 9,
  monthEnd:      { on: true, days: [0, 1] },
  gap:           { on: true, days: 35 },
  stale:         { on: true },
  taskDay:       { on: true, days: [0, 1] },
  taskAdded:     { on: true },
  taskAssigned:  { on: true },
  orderDeadline: { on: true, mins: [60] },
})

export function normalizePrefs() {
  return JSON.parse(JSON.stringify(DEFAULT_PREFS))
}

/** ONにすると届くもの（画面に並べる） */
export const NOTIFY_LIST = [
  { group: '棚卸', items: ['月末の棚卸（前日・当日）', 'しばらく棚卸していないとき（前回から35日）', '途中のままの棚卸（始めて1日たっても終わっていない）'] },
  { group: 'やること', items: ['やることの日（前日・当日）', 'だれかがやることを追加したとき（自分が追加したものは除く）', '自分が担当になったとき'] },
  { group: '発注', items: ['発注の締切（1時間前）'] },
]
