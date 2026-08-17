# 共同品質基盤ハブ

最終更新: 2026-08-09

このディレクトリは、プロジェクト全体の監査・公開準備・バグ修正を、
ユーザー、Codex、Claude Codeの間で継続するための共有入口です。
現在の目標は**Web Free版を安全に公開すること**です。製品仕様そのものを二重管理する場所ではありません。

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
6. [`session-log.md`](session-log.md) — 直近の作業と次の再開地点

**Claude Code（CC）として製品機能・データ処理・画面構成を実装する場合は、
上記に加えて [`cc-session-plan.md`](cc-session-plan.md) を読みます。**
Codexレビューの修正を3セッションへ分けた実行順、受入条件、必須test、引き渡し方法を持つ
**指示出し用の一時文書**です。各セッションを順番に参照して着手できるよう書いてあります
（状態の正本は [`task-list.md`](task-list.md) のままです）。

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

## 現在の再開地点

最終更新: 2026-08-06

- 基準HEAD: `develop@bc9fb85`。文書整理開始時のworktreeはclean。
- develop Actions run `30882005257`はWorker/App test、App build、develop Pages preview deployに成功。
  production公開の証拠ではありません。
- account削除のdata消去、Back制御、focus/a11yはcode/testまで反映済み。実機確認と本番migrationは未実施。
- 現在のP0は[WEB-001](tasks/WEB-001.md)と[PLAY-002](tasks/PLAY-002.md)。
- canonical/contact、本番origin/CORS、legal route、0010〜0016のmigration、登録濫用、Free 2台制限、
  履歴data integrity、observability、critical E2E、production smokeが主なWeb blockerです。
- deploy、production migration、commit、pushはUserの明示依頼なしに行いません。

最新のblocker、owner、公開順は[Web公開準備](web-release-readiness.md)だけを更新し、
この節へ詳細を複製しません。
