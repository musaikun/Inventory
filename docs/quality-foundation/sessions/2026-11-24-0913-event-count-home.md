# 2026-11-24 イベントを本日の状況へ・カレンダーの「+n」（v0.216.0）

- User: カレンダーでイベントが3件以上あると2件しか出ず、3件目以降が見えない。ホームの本日の状況（店舗状況のように）に出したい。毎日のタスクはカレンダーに出さずホームのチェック表に／HACCP も今後のために考えたい
- 原因（カレンダー）: `JournalMonth.vue` は1週に2本まで（`SPAN_MAX`）。「ほかn」は出していたが、マスの空き（`lanesOf`）を2本で打ち切っていたため枠の外にはみ出して見えなかった
- 変更:
  - `JournalMonth.vue`: 入りきらない線を、かかっている日ごとに3段目の「+n」ボタンで出す（押すと pick でその日の一覧）。マスの空きも3段目の分を取る
  - `services/homeStatus.js`: `events`（eventsOn(today)）を受け、「イベント」の行（棒なし・輪の数に入れない）で出す。`eventCount` を返す。並びは 明日まで の次
  - `HomeTop.vue`: 見出しに「イベント n ・ 進行中 n」。イベントの印はカレンダーの線と同じ色
  - `JournalPage.vue`: ホームから開く `{ type: 'event' }` でイベントの編集を開く
  - docs: `decisions.md` D-042 に追記。HACCP・毎日の決まりごとは `docs/proposals.md`（2026-11-24・未決3点）
- test: `JournalMonth.spans.test.js` 2件、`homeStatus.test.js` 1件を追加
- 検証: `cd app && npm test` 245 files・2304 pass ／ `npm run build` OK ／ `node scripts/check-docs-links.mjs` OK。実画面（ログイン後のホーム・カレンダー）は未確認
- 残件: 実機で3段目の「+n」がマスに収まるか（週が6行の月）を User 確認。HACCP 提案の未決3点
