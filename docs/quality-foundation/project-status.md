# 現状スナップショット

> **履歴snapshot:** 2026-07-25 / `develop@131a36f`時点の技術監査です。
> 現在地として更新しません。現在の全体索引は[`../project-status.md`](../project-status.md)、
> 公開判定は[`web-release-readiness.md`](web-release-readiness.md)を参照してください。

検証日時: 2026-07-25（Asia/Tokyo）  
対象ブランチ: `develop`（`origin/develop` を追跡）  
対象コミット: `131a36f520e7350b995ec6e811452b10527e00c5`  
フロントエンド版: `0.66.0`

現在の実行方針: 2026-07-27〜2026-08-08はGoogle Play要件と品質基盤以外の機能開発を停止。  
計画: [`sprint-plan-2026-07-27.md`](sprint-plan-2026-07-27.md)  
公開判定: [`quality-scorecard.md`](quality-scorecard.md) / [`google-play-readiness.md`](google-play-readiness.md)

この文書は、上記コミットに対して実行・確認した事実です。最新性の判断は、検証日時と
対象コミットを必ず併せて行ってください。

> 追記（2026-07-26、未コミット差分）: D-005を「日付昇順＋同一日内はCSV入力初出順」で採用し、
> `TEST-001`を解消。clean install後にApp 658/658、Worker 195/195、App production build成功を確認した。
> 以下の表は記載どおり2026-07-25 / `131a36f`時点のsnapshotとして保持する。

## 検証済みの状態

| 項目 | 結果 | 補足 |
|---|---|---|
| `app` 依存関係再構築 | 成功 | `npm ci` |
| `worker` 依存関係再構築 | 成功 | `npm ci` |
| フロントビルド | 成功 | 1 MB 超の JavaScript chunk と Vite CJS API の警告あり |
| Worker テスト | 成功 | 121件合格 |
| App テスト | 失敗 | 500件合格、1件失敗 |
| App 本番依存監査 | 要対応 | low 1件、high 2件 |
| Worker 本番依存監査 | 成功 | 既知の本番依存脆弱性 0件 |

App テストの失敗は `deliveryImportCommit.test.js` の仕入先順です。実装は
`localeCompare` で二次ソートし、テストは入力順に近い別の順序を期待しています。
業務上の正しい順序を決めてから、実装または期待値を直す必要があります。

## 重要リスク

### P0

- WebSocket 接続後、正常な `join` より前に在庫更新などのメッセージを処理できる。
- 注文 ID が既存の別店舗注文と衝突した場合、`ON CONFLICT(id)` が店舗境界を確認せず
  注文ヘッダーを更新できる。
- Google Play公開前に、in-appと公開Webの両方からaccount deletionを開始でき、
  関連dataを削除する一貫した仕組みが必要。

### P1

- 日次 cron が存在しない `sessions.updated_at` を参照する。
- Push 購読 API が認証対象外で、購読データの検証も不足している。
- D1 障害時の保護判定が fail-open になり、ホスト権限の取得境界まで緩む。
- Durable Object の保留中品目追加要求がメモリだけにあり、休止復帰時に失われる。
- 注文、移動、棚卸完了の複数書き込みに部分失敗の余地がある。
- 現在の作業ブランチ `develop` は GitHub Actions の対象外。
- `xlsx@0.18.5` に修正版のない high 脆弱性があり、ユーザー提供ファイルを処理している。

詳細と完了条件は [`task-list.md`](task-list.md)、コード根拠は
[`audit-2026-07-25.md`](audit-2026-07-25.md) を参照してください。

## 保守性・運用上の状態

- `App.vue`、`SessionListPage.vue`、`InventoryTable.vue`、`useConfig.js`、`useSync.js`、
  `RoomDO.js` などが大きく、責務分割の余地がある。
- App の Vitest 設定が Worker テストも含み、CI では Worker テストが重複実行される。
- E2E、カバレッジ閾値、lint、Cloudflare Workers 実ランタイムに近いテストがない。
- `worker/wrangler.toml` の `compatibility_date` は `2025-01-01`。
- Workers の observability 設定と構造化ログ方針がない。
- 初回確認時に `.wrangler/`、`worker/dist/`、ルート `package-lock.json` が未追跡だった。
  今回 `.gitignore` に追加したが、ファイル自体は削除していない。

## 文書の状態

既存文書には価値のある設計判断が多い一方、実装 v0.66.0 より古い記述があります。
代表例は次のとおりです。

- `docs/project-status.md`: v0.58、全テスト成功、旧ブランチを前提としている。
- `docs/spec.md`: v0.48、movement の D1 化、PDF 制限、CSP、migration 数が古い。
- `docs/api-design.md`: movement API がなく、`/pdf` と complete payload の記述が実装と違う。
- `docs/security-review.md`: 残課題とテスト件数が現在の監査結果を反映していない。
- `docs/test-cases.md` と新機能チェックリスト: 現在のテスト件数・失敗を反映していない。
- `docs/ci-cd.md`: 現在の `develop` 運用が workflow 対象外である点を扱っていない。

日付付き監査と `docs/export/` は履歴スナップショットとして扱い、現在仕様に合わせて
上書きしません。分類の全体は [`documentation-inventory.md`](documentation-inventory.md)
にあります。

## 今回変更していないもの

- アプリケーションおよび Worker の実装
- テストの期待値
- 依存パッケージのバージョン
- Cloudflare / GitHub の外部状態
- デプロイ、DB migration、commit、push
