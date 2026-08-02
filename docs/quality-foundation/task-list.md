# 横断改善タスクボード

最終更新: 2026-08-02

**このファイルが状態の正本です。** 状態・優先度・担当を変えるときは、まずここを更新します。
根拠・実装・検証証拠・完了条件は [`tasks/`](tasks/) 配下の各タスクファイルにあります。

- 状態: `未着手` / `進行中` / `レビュー待ち` / `保留` / `完了` / `リスク受容`
- 担当: `未割当` / `Codex` / `Claude Code` / `User`
- P0 は認可・データ境界またはGoogle Play公開を直接blockする項目

2026-07-27〜2026-08-08はP0と公開対象P1だけを実装し、P2以下は原則保留します。
全体計画は [`sprint-plan-2026-07-27.md`](sprint-plan-2026-07-27.md) を参照してください。

## 進行中・未着手

| ID | P | 状態 | 担当 | 概要 | 詳細 |
|---|---:|---|---|---|---|
| PLAY-002 | P0 | 進行中 | Claude Code | in-app削除UXと公開Web申請導線 | [PLAY-002.md](tasks/PLAY-002.md) |
| PLAY-003 | P1 | 進行中 | Codex | Data Safety・privacy・第三者SDKの整合監査 | [PLAY-003.md](tasks/PLAY-003.md) |
| PLAY-004 | P1 | 進行中 | Claude Code | TWA審査導線・store listing・screenshots | [PLAY-004.md](tasks/PLAY-004.md) |
| CI-001 | P1 | 進行中 | Codex | `develop` のtest/buildとPages preview自動実行 | [CI-001.md](tasks/CI-001.md) |
| OPS-001 | P1 | 進行中 | Codex | 最小observability・構造化log・互換日確認 | [OPS-001.md](tasks/OPS-001.md) |
| PRIV-001 | P1 | 進行中 | Codex | PostHogの収集内容と同意・規約を照合 | [PRIV-001.md](tasks/PRIV-001.md) |
| DATA-002 | P1 | 未着手 | 未割当 | 履歴の端末依存を解消しDO/D1の成長時設計を検証 | [DATA-002.md](tasks/DATA-002.md) |
| SEC-005 | P1 | 未着手 | Codex | 無制限な店舗作成経路を整理 | [SEC-005.md](tasks/SEC-005.md) |
| DO-001 | P1 | 未着手 | Codex | 品目追加要求を休止復帰対応にする | [DO-001.md](tasks/DO-001.md) |
| DATA-001 | P1 | 未着手 | Codex | 複数D1書き込みの原子性と入力制限を改善 | [DATA-001.md](tasks/DATA-001.md) |
| DEP-001 | P1 | 未着手 | Codex | 本番依存の high 脆弱性を解消または隔離 | [DEP-001.md](tasks/DEP-001.md) |
| TEST-002 | P1 | 進行中 | Codex | package test分離とcritical integration/E2E | [TEST-002.md](tasks/TEST-002.md) |

## 完了

詳細は [`tasks/completed-2026-07.md`](tasks/completed-2026-07.md)。各詳細内の「未実施」は完了記録時点の状態です。
実装は `develop@96233d4` までに commit / push 済みです。Pro Review は 2026-08-01 にdeploy済みですが、
本番Pages / Workerの更新と本番D1 migrationは未実施です。

| ID | P | 完了日 | 担当 | 概要 |
|---|---:|---|---|---|
| SEC-001 | P0 | 2026-07-25 | Codex | WebSocket の参加完了前メッセージを遮断 |
| SEC-002 | P0 | 2026-07-25 | Codex | 注文 upsert の店舗境界を保証 |
| PLAY-001 | P0 | 2026-07-25 | Codex | account削除backendと関連data削除 |
| SEC-003 | P1 | 2026-07-25 | Codex | Push 購読 API の認証・検証を追加 |
| BUG-001 | P1 | 2026-07-25 | Codex | cron の存在しない列参照を修正 |
| SEC-004 | P1 | 2026-07-26 | Codex | ホスト認可境界を fail-closed 化 |
| TEST-001 | P1 | 2026-07-26 | Codex | 仕入先順の仕様を決め App テストを復旧 |
| DOC-000 | P2 | 2026-07-25 | Codex | 共有監査・引き継ぎ基盤を作成 |
| REPO-001 | P3 | 2026-07-25 | Codex | ローカル生成物を `.gitignore` に追加 |

## 保留（P2 / P3）

詳細は [`tasks/backlog.md`](tasks/backlog.md)。スプリント後に優先度を再評価します。

| ID | P | 状態 | 担当 | 概要 |
|---|---:|---|---|---|
| REF-001 | P2 | 保留 | 未割当 | 大型コンポーネントと composable を段階分割 |
| PERF-001 | P2 | 保留 | 未割当 | フロント bundle を分割 |
| SEC-006 | P2 | 保留 | 未割当 | 店舗コード・PIN・保存トークンを再評価 |
| DOC-001 | P2 | 保留 | 未割当 | 現行仕様書の鮮度差を解消 |
| CFG-001 | P2 | 保留 | 未割当 | Claude Code の古い hook/command を可搬化 |

## 統合済みの課題（新規IDは作らない）

以下は独立したタスクIDを持たず、既存タスクの中で扱います。

| 課題 | 統合先 |
|---|---|
| CIのNode 20で`node:sqlite`が起動せず、依存packageのengine要件とも不一致 | [CI-001](tasks/CI-001.md) |
| AppのVitestがWorkerテストを重複実行する問題（分離済み。critical E2E等は未完） | [TEST-002](tasks/TEST-002.md) |
| `postcss` / `xlsx` の production high 脆弱性 | [DEP-001](tasks/DEP-001.md) |
| TWA での価格表示・無料版2台制限（D-016の公開面への反映） | [PLAY-004](tasks/PLAY-004.md) |
| 履歴の端末依存とデータ源の不整合（`R-001` / `F-001`〜`F-004`） | [DATA-002](tasks/DATA-002.md) |

実使用バグの報告全文・コード根拠・本番D1の調査結果は [`bug-reports.md`](bug-reports.md) に保存しています。

## 変更履歴

- 2026-08-01: 一覧と詳細を分離。詳細を `tasks/` 配下へ移し、完了分を `tasks/completed-2026-07.md`、
  P2/P3を `tasks/backlog.md` へ。`DATA-002` を P2 → **P1** へ変更し、実使用バグ `R-001` /
  `F-001`〜`F-004` を統合。既存の記録・完了条件・検証証拠は削除していない。
