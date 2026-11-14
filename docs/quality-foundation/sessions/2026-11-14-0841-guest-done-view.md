# 2026-11-14 — ゲストの終わりの画面

- version: 0.209.0 → **0.210.0**

User: ホストが完了したときのゲストの終わり方は、終了画面を出す案でよい
- `components/GuestDoneView.vue`（新）: 「お疲れさまでした／{名前}さん、{棚卸|発注}は完了しました。ホストがルームを閉じました」＋ 自分が入れた品目数（棚卸のときだけ。`inventory` の `localEntry` を数える）＋「入れた数はすべて保存されています。この画面は閉じて大丈夫です」。全画面で出し、「閉じる」でランディング
- `App.vue`: `session_ended`（completed）をゲストが受けたとき、通知トーストの代わりに `guestDone` を立てる。退出（`leaveRoom` → 在庫・名前の消去）の前に名前と品目数を控える
- test: `GuestDoneView.test.js`（新3件）
- 検証: `cd app && npm run build` OK ／ `npm test` 240 files・2269 pass ／ `cd e2e && npx playwright test` 1 passed ／ ローカル Worker＋実ブラウザ2台で ゲストが1品目入力 → ホストが完了 → ゲストに終了画面（田中さん・1品目）→ 閉じるでランディング を確認 ／ `node scripts/check-docs-links.mjs`
- feature-checklist: 同期・API・D1・認可は変更なし（N/A）。表示だけ
- 残件: ホストが「新しい棚卸を始めた」ことでゲストが退室する場合は従来どおり通知だけ。設定・取込などに残る標準 confirm() 10か所。PC の UI は User が考え直す
