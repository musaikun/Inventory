# 共同品質基盤ハブ

最終更新: 2026-10-02

このディレクトリは、プロジェクト全体の監査・公開準備・バグ修正を、
ユーザー、Codex、Claude Codeの間で継続するための共有入口です。
目標は**Web Free版を安全に公開すること**ですが、**2026-09-30 から当面は機能の不足と実使用の不具合の修正を優先**します
（User判断 → [D-027](decisions.md)。公開gateは止めずに後回し）。製品仕様そのものを二重管理する場所ではありません。

`docs/`全体の分類は[ドキュメント案内](../README.md)、現在の公開判定は
[Web公開準備](web-release-readiness.md)を正とします。

## 作業開始時に読む順番

1. [`../README.md`](../README.md) — docs全体の役割と正本
2. [`web-release-readiness.md`](web-release-readiness.md) — **現在のWeb release gate**
3. [`task-list.md`](task-list.md) — **状態の正本**。優先度・状態・担当の進捗ボード
   （各タスクの根拠・実装・検証証拠・完了条件は [`tasks/`](tasks/) 配下。完了分は
   [`tasks/completed-2026-07.md`](tasks/completed-2026-07.md)、P2/P3は [`tasks/backlog.md`](tasks/backlog.md)。
   実使用バグの報告台帳は [`bug-reports.md`](bug-reports.md)）
4. [`decisions.md`](decisions.md) — 採用・変更・廃止と未決事項
5. [`working-agreement.md`](working-agreement.md) — 並行作業と引き継ぎのルール
6. [`session-log.md`](session-log.md) — 2026-09以降の作業と次の再開地点。以前の記録は冒頭の月別archive索引を参照

2026-08の3セッション用[`cc-session-plan.md`](cc-session-plan.md)は完了済み作業の履歴です。
現在の実装指示には使用せず、対象タスクと[`session-log.md`](session-log.md)の証拠を参照します。

`session-log.md`と[`../proposals.md`](../proposals.md)は現行fileの肥大化を避けるため、2026-08以前を
[`archive/`](archive/)へ月別保存しています。archiveは履歴証拠であり、現在仕様へ書き換えません。

Google Playへ着手する場合だけ[`google-play-readiness.md`](google-play-readiness.md)、
[`play-reviewer-guide.md`](play-reviewer-guide.md)、
[`data-safety-form-draft.md`](data-safety-form-draft.md)、
[`quality-scorecard.md`](quality-scorecard.md)を追加で読みます。

2026-07-27の[旧sprint計画](sprint-plan-2026-07-27.md)と
[2026-07-25技術snapshot](project-status.md)は履歴です。監査の根拠は
[`audit-2026-07-25.md`](audit-2026-07-25.md)、既存文書の鮮度は
[`documentation-inventory.md`](documentation-inventory.md)を参照してください。

## 情報の優先順位

矛盾がある場合は、原則として次の順で判断します。

1. 現在のコード、マイグレーション、テスト、実行結果
2. ユーザーが明示した最新の判断
3. `docs/quality-foundation/decisions.md` の `採用` 状態
4. 現行仕様書・設計書
5. 日付付き監査、`docs/export/`、過去の作業ログ

不明な点を推測で仕様化せず、`task-list.md` または `decisions.md` に未決として残します。

## 使い方

- 着手前に [`task-list.md`](task-list.md) の `状態` を `進行中`、`担当` を自分の名前に更新する。
  進行中・未着手・保留P0/P1の作業記録は `tasks/<ID>.md` へ追記する。
  優先度・状態・担当は詳細fileへ複製せず、`task-list.md`だけで管理する。
- 同じタスクを複数エージェントが同時に編集しない。
- 実装後は完了条件に沿って検証し、結果とコミット前の差分を記録する。
- 完了した事実だけを `完了` とし、未検証は `レビュー待ち` または `保留` にする。
- デプロイ、コミット、push、マイグレーション適用は、ユーザーの明示依頼なしに行わない。
  ただし Claude Code の `develop` への push だけは例外とする（[D-022](decisions.md#d-022--claude-code-は-develop-への-push-をユーザーの都度確認なしで行う)）。
  本番デプロイ、本番マイグレーション、`main` への統合は引き続き明示依頼が必要。

## 現在の再開地点

- 状態・担当は[task board](task-list.md)、公開blockerは[Web公開準備](web-release-readiness.md)を正とし、
  このREADMEへ複製しません。
- [`DOC-002`](tasks/DOC-002.md)でApp `0.129.1` / migration `0018`までの現行実装へ文書を再同期済みです。
- 2026-10-02にUserがproduction Workerだけのdeployを承認。D1 migrationとPages deployは対象外です。
