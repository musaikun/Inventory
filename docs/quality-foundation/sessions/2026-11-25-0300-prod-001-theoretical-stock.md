# 2026-11-25 PROD-001 入出庫で在庫の数を変える（v0.218.0）

- User: PROD-001 を進める。決定: 要補充は理論在庫で判定／理論在庫と数えた数の差は棚卸の結果に出す／レポートの金額は数えた数のまま
- 変更:
  - `composables/useStockView.js`: 在庫の数＝理論在庫（直近の棚卸＋その後の入庫−出庫）。`countedOf` → `stockOf`。要補充もこの数。内訳 `basisLabel`「11/20 棚卸 10 ＋入庫 5 −出庫 3」、一覧の根拠「11/20 棚卸から」「入出庫のみ」
  - `StockPage.vue`・`ItemStockSheet.vue`: 見出し「在庫」、説明文「棚卸の数に入庫・出庫を足し引きした数です。使った分は出庫で減らします。」（説明の id を変えたので、前の説明を消した端末にも1回出る）
  - `services/theoreticalStock.js`: `before`（その時点より前に記録した入出庫だけ）と `countMoment` を公開
  - `services/stockGap.js`（新）: 数えた数 − 帳簿（前の棚卸＋その品目を数えた時点までの入出庫）。`SessionReportPanel` に「帳簿との差 n品目 / m品目」と一覧、`SessionDetailPage`・`StocktakeDoneSheet`（「帳簿と差がある品目 n」）で渡す。共有URLの閲覧には出さない
- docs: `spec.md` F-12、`ordering-analytics-design.md`、`decisions.md` D-035 追記、`tasks/PROD-001.md`、`task-list.md`（レビュー待ち / User）
- test: `stockGap.test.js`（3）、`SessionReportPanel.gap.test.js`（2）、`StockPage.tools.test.js`（要補充が入出庫で変わる）、`StockPage.test.js`（入出庫で在庫が 4・内訳）
- 検証: `cd app && npm test` 247 files・2313 pass ／ `npm run build` OK ／ `node scripts/check-docs-links.mjs`。ログイン後の実画面は未確認
- feature-checklist: 同期・API・D1・認可の変更なし（App 内の計算と表示だけ）。文言は UI-006 に沿って短く
- 残件: User 実機確認。使った分を出庫しない店では在庫が増え続ける（棚卸で戻る）。発注の「理論在庫プリフィル」は従来どおり
