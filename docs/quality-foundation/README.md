# 共同品質基盤ハブ

最終更新: 2026-08-04

このディレクトリは、プロジェクト全体の監査・バグ修正・リファクタリングと
Google Play公開準備を、ユーザー、Codex、Claude Codeの間で継続するための共有入口です。
製品仕様そのものを二重管理する場所ではありません。

## 作業開始時に読む順番

1. [`sprint-plan-2026-07-27.md`](sprint-plan-2026-07-27.md) — 2週間の範囲・担当・日程・完了条件
2. [`project-status.md`](project-status.md) — 最後に確認できた実装・テスト・依存関係の状態
3. [`task-list.md`](task-list.md) — **状態の正本**。優先度・状態・担当の進捗ボード
   （各タスクの根拠・実装・検証証拠・完了条件は [`tasks/`](tasks/) 配下。完了分は
   [`tasks/completed-2026-07.md`](tasks/completed-2026-07.md)、P2/P3は [`tasks/backlog.md`](tasks/backlog.md)。
   実使用バグの報告台帳は [`bug-reports.md`](bug-reports.md)）
4. [`google-play-readiness.md`](google-play-readiness.md) — Google Play公開チェックリスト
   （data安全性の実装台帳 → [`data-safety-audit.md`](data-safety-audit.md)、
   Console回答案 → [`data-safety-form-draft.md`](data-safety-form-draft.md)、
   保持文面 → [`privacy-retention-draft.md`](privacy-retention-draft.md)、
   D1復元手順 → [`d1-recovery-runbook.md`](d1-recovery-runbook.md)、
   審査手順 → [`play-reviewer-guide.md`](play-reviewer-guide.md)）
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

- 着手前に [`task-list.md`](task-list.md) の `状態` を `進行中`、`担当` を自分の名前に更新する。
  進行中・未着手P0/P1の作業記録は `tasks/<ID>.md` へ追記する。
  優先度・状態・担当は詳細fileへ複製せず、`task-list.md`だけで管理する。
- 同じタスクを複数エージェントが同時に編集しない。
- 実装後は完了条件に沿って検証し、結果とコミット前の差分を記録する。
- 完了した事実だけを `完了` とし、未検証は `レビュー待ち` または `保留` にする。
- デプロイ、コミット、push、マイグレーション適用は、ユーザーの明示依頼なしに行わない。

## 現在の再開地点

最終更新: 2026-08-02

`develop@7d47cb4`はcommit / push済みです。Access保護付きPro Review Pagesと専用Worker / D1 / DOは
2026-08-01に初回deploy済みで、本番Pages / Worker / D1は変更していません。

Node 24とApp/Worker test分離を反映したdevelop Actions（run `30725392991`）は、Worker/App test、App build、
Pages deployの全stepが成功しました。develop aliasは`https://develop.inventory-app-c40.pages.dev`です。
現在の未commit差分では、PLAY-002/004の削除・legal対応、PLAY-003のD-019 Data Safety整合と、
DEP-001の依存更新・Excel解析隔離を実装しています。ローカルではApp 502 tests、App production build、
`npm audit --omit=dev` 0件を確認しています。

Google Play公開前の主な残件は、`PLAY-002`の実機確認、`PLAY-003`のcanonical URL/contact・
Data Safety最終照合、`PLAY-004`のFree 2台制限server強制・TWA表示・screenshots、
critical integration/E2E、未修正の履歴P1（`DATA-002`）です。本番D1の0010/0011はUserの明示承認まで適用しません。

次の判断・確認:

- User — canonical domain/contact、Workers Logsの閲覧担当・payload masking・alert通知先、Free既存3台利用の扱いを決める。
- Codex — PLAY-003のprovider共有例外・公開build network・TWA microphone・`/pdf`存廃を継続する。
- Claude Code — canonical決定後に公開legalの絶対URLを反映し、8/6 UI freeze後にscreenshotsを作成する。

現在のPLAY-002/003/004・DEP-001・完了記録は未commitです。追加deploy、production migrationは行っていません。
