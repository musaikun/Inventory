# 2026-11-13 — 初回ホームの最初の一歩・レポートから単価へ・分かりにくい文言

- version: 0.206.0 → **0.207.0**

User: 評価の残り（3 初回ホーム・5 レポート・7 言葉・8 細かい点）を推奨で調整。PC の UI（6）は考え直すので触らない。develop へ push してよい
- 3: `HomeTop.vue` に `firstRun`。品目が1つも無い店（登録直後）のホームに「まず、品目を用意します」— ファイルから取り込む／数えながら登録する。`SessionListPage.vue` が `!hasOwnList && !activeSession` で出し、既存の `pickItemFile`・`startStockEmpty` へつなぐ。品目が入れば消える
- 5: `ManagerDashboard.vue` — 「金額データなし／単価が未設定です」の下に「単価を入れる ›」（`fix-prices`）。在庫タブの「要確認」（単価なしが並ぶ）を開く（`StockPage` の expose に `showCheck`）
- 5: `SessionDetailPage.vue` — 「あと3日」→「修正 あと3日」、「あと今日まで」→「修正は今日まで」（何の残り日数かを書く）
- 7: `SettingsModal.vue` — 品目の取込の「カスタム設定 ／ N件」→「登録している品目 N件」（サンプルのときは「サンプルの品目 N件」）
- 触らなかったもの（理由）: 品目リスト整理の「まだ」（User決定 2026-10-30）／「ルーム」「ホスト中」（招待文・トースト・共有シートまで同じ語で通っており、一部だけ変えると揺れが増える。言い換える語を決めて UI-006 でまとめて）／「業務管理」のタブ名（D-035 の概念名）／トーストの位置・発注の未入力確認が標準ダイアログ・単位の既定（挙動の変更が大きい）。評価で挙げた「虫眼鏡でチャットが開く」は自動操作の押し間違いで、不具合ではなかった
- test: `HomeTop.shortcuts.test.js`（最初の一歩）、`ManagerDashboard.hub.test.js`（単価を入れる）
- 検証: `cd app && npm run build` OK ／ `npm test` 237 files・2255 pass ／ `cd e2e && npx playwright test` 1 passed ／ ローカル Worker＋実ブラウザで 登録直後のホーム→数えながら登録→完了→ホームから案内が消える・レポート→単価を入れる→在庫の要確認・履歴詳細の「修正 あと3日」を確認 ／ `node scripts/check-docs-links.mjs`
- feature-checklist: 同期・API・D1・認可は変更なし（N/A）。取込は既存の権限判定（`item.admin`）をそのまま通る
- 残件: PC幅のナビ二重（User が UI を考え直す）。上の「触らなかったもの」
