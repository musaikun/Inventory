# 2026-11-13 — 在庫タブの帯・グループの自動オープン・棚卸のまとめ

- version: 0.205.0 → **0.206.0**

User: アプリを網羅的に使って評価 → 指摘のうち 1（在庫タブが数えていないように見える）→ 2（グループが常に畳まれている）→ 4（棚卸完了の手応えがない）の順で直す
- 1: 在庫タブは `InventoryTable` に `inventory={}` を渡すので、帯が常に「0/3」＋空の進捗バーになっていた。`hideProgress`（新prop）で件数だけにし、`StockPage.vue` から渡す（上に固定される帯も同じ）
- 2: `InventoryTable.vue` — グループが3つまでなら最初から開く（並びごとに一度だけ。人が開閉した並びには手を出さない）。`revealItem(item)` を expose し、`App.vue` の数量確定のあとで呼ぶ（入れた行のグループを開く）
- 4: `StocktakeDoneSheet.vue`（新）— 棚卸の完了が成立したあとに、数えた品目数・在庫金額と前回差・数えていない品目・単価のない品目・人数・時間を出す。数字は `buildSessionReport`（履歴詳細と同じ）。「結果を見る」で履歴詳細へ。金額は `canSeeMoney` のときだけ。完了トーストは残した
- test: `InventoryTable.expand.test.js`（既存は4グループにして「畳んで始まる」を維持＋新4件）、`StocktakeDoneSheet.test.js`（新4件）、E2E helper の `completeStocktake` にまとめの表示と「閉じる」を追加
- 検証: `cd app && npm run build` OK ／ `npm test` 237 files・2254 pass ／ `cd e2e && npx playwright test` 1 passed ／ ローカル Worker＋実ブラウザ（Pixel 7 相当）で 追加直後に行が見える・完了後のまとめ→結果を見る・在庫タブの帯が件数だけ、を目視
- feature-checklist: 同期・API・D1・認可は変更なし（N/A）。権限は金額の表示だけ（`canSeeMoney`）。オフライン・多端末の動作は変えていない
- 残件: 開閉状態は再読込で戻る（保存していない）。完了を再送で確定した経路（`App.vue` の再開側）ではまとめを出していない。ゲスト側の完了時の見え方は未確認。評価のほかの指摘（初回ホームの空・レポートの空カード・PC幅のナビ二重・言葉の揺れ）は未着手
