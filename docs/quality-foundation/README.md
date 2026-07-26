# 共同品質基盤ハブ

最終更新: 2026-07-25

このディレクトリは、プロジェクト全体の監査・バグ修正・リファクタリングと
Google Play公開準備を、ユーザー、Codex、Claude Codeの間で継続するための共有入口です。
製品仕様そのものを二重管理する場所ではありません。

## 作業開始時に読む順番

1. [`sprint-plan-2026-07-27.md`](sprint-plan-2026-07-27.md) — 2週間の範囲・担当・日程・完了条件
2. [`project-status.md`](project-status.md) — 最後に確認できた実装・テスト・依存関係の状態
3. [`task-list.md`](task-list.md) — 優先順位、担当、完了条件、検証方法
4. [`google-play-readiness.md`](google-play-readiness.md) — Google Play公開チェックリスト
5. [`quality-scorecard.md`](quality-scorecard.md) — Codex / Claude Code共通の評価基準
6. [`working-agreement.md`](working-agreement.md) — 並行作業と引き継ぎのルール
7. [`decisions.md`](decisions.md) — 未決事項を含む判断記録
8. [`session-log.md`](session-log.md) — 直近の作業と次の再開地点

監査の根拠は [`audit-2026-07-25.md`](audit-2026-07-25.md)、既存文書の鮮度は
[`documentation-inventory.md`](documentation-inventory.md) を参照してください。

## 情報の優先順位

矛盾がある場合は、原則として次の順で判断します。

1. 現在のコード、マイグレーション、テスト、実行結果
2. ユーザーが明示した最新の判断
3. `docs/quality-foundation/decisions.md` の `採用` 状態
4. 現行仕様書・設計書
5. 日付付き監査、`docs/export/`、過去の作業ログ

不明な点を推測で仕様化せず、`task-list.md` または `decisions.md` に未決として残します。

## 使い方

- 着手前にタスクの `状態` を `進行中`、`担当` を自分の名前に更新する。
- 同じタスクを複数エージェントが同時に編集しない。
- 実装後は完了条件に沿って検証し、結果とコミット前の差分を記録する。
- 完了した事実だけを `完了` とし、未検証は `レビュー待ち` または `保留` にする。
- デプロイ、コミット、push、マイグレーション適用は、ユーザーの明示依頼なしに行わない。

## 現在の再開地点

2026-07-25 に初回横断監査、共有基盤、2週間スプリントの方針確定、`SEC-001` と
`SEC-002` を完了しました。WorkerにはWebSocket参加認可境界と注文の店舗境界、
それぞれの回帰テストと `PLAY-001` account deletion backendが追加されています。次はClaude Codeが
`PLAY-002` のin-app削除UX/公開Webを接続し、Codexが認可・data削除を独立reviewします。
