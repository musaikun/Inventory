# 2026-11-25 — E2E: host/guest同期と再接続・再接続でoffline入力が消える不具合を修正

- version: 0.218.0 → **0.218.1**
- task: TEST-002

User: E2Eの残り（同期・再接続）を進めて。
- E2E 2本を追加: `room-sync.spec.js`（招待リンクで参加したゲストがホストに揃い、互いの上書きが相手に出る）、
  `reconnect.spec.js`（ゲストの接続が切れている間の入力が、つながり直すとホストに届く）。ヘルパーは `e2e/tests/helpers.js`。
- `setOffline` では WebSocket が切れず再接続を通らない → `routeWebSocket` の中継で本当に切る（`controllableRoomSocket`）。
- **不具合（修正）**: 再接続に1回失敗するたびに `onclose` が切断時刻を「今」へ上書きし、その前のoffline入力が
  サーバーの古い値で上書きされて消えていた（ゲストの画面でも 4 → 2）。`useSync.js` で最初の切断時刻を joined まで保つ。
  ホストにも同じ経路で効く。
- 検証: e2e 3 passed（新しい2本は `--repeat-each=2` で 4/4）、worker 766 / app 2314 pass、build OK、docs検査 OK（develop 0.218.0 上）。
  mutation: 修正を戻すと unit test と reconnect E2E が落ちる／再送を外すと reconnect が落ちる／RoomDO の update 配信を外すと room-sync が落ちる。
- 残件: F-001（同日2回目の棚卸）・account登録→削除・ホスト側の切断・双方offlineの競合。本番への反映は Pages（フロント）の公開が必要。
