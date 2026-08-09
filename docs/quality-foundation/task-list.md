# 横断改善タスクボード

最終更新: 2026-08-09

**このファイルが状態の正本です。** 状態・優先度・担当を変えるときは、まずここを更新します。
根拠・実装・検証証拠・完了条件は [`tasks/`](tasks/) 配下の各タスクファイルにあります。

- 状態: `未着手` / `進行中` / `レビュー待ち` / `保留` / `完了` / `リスク受容`
- 担当: `未割当` / `Codex` / `Claude Code` / `User`
- P0 は認可・データ境界または**現在のWeb公開**を直接blockする項目

現在は[Web公開準備](web-release-readiness.md)に含まれるP0/P1と品質基盤だけを実装し、
新機能、Stripe、trial、TWA、Google Play提出作業は原則保留します。
D-021以前の2週間計画は[履歴](sprint-plan-2026-07-27.md)として保持します。

> **CCセッションの実行計画は [`cc-session-plan.md`](cc-session-plan.md) にあります。**
> Codexレビューの修正を3セッションへ分け、各回の範囲、受入条件、必須test、
> 引き渡し方法をまとめた**指示出し用の一時文書**です。
> CC側の作業を始めるときは、まずそちらを読んでください（状態の正本は本ファイルのままです）。

## 現在のマイルストーン: Web Free版

| ID | P | 状態 | 担当 | Web公開との関係 | 詳細 |
|---|---:|---|---|---|---|
| WEB-001 | P0 | 進行中 | Codex | 公開契約・独立採点基盤を更新中。production変更はWEB-01のUser判断待ち | [WEB-001.md](tasks/WEB-001.md) |
| PLAY-002 | P0 | レビュー待ち | User | code review済み。canonicalと実機確認待ち | [PLAY-002.md](tasks/PLAY-002.md) |
| PLAY-003 | P1 | 保留 | Codex | canonical/release candidate確定後にWeb最終照合 | [PLAY-003.md](tasks/PLAY-003.md) |
| OPS-001 | P1 | 保留 | Codex | 事前調査済み。最小observability・構造化log・互換日確認 | [OPS-001.md](tasks/OPS-001.md) |
| PRIV-001 | P1 | 保留 | Codex | release candidateで分析無効・通信なしを検証 | [PRIV-001.md](tasks/PRIV-001.md) |
| IMPORT-001 | P1 | 未着手 | Claude Code | 品目マスタ取込の非破壊性・preview・error明細を公開契約へ適合 | [IMPORT-001.md](tasks/IMPORT-001.md) |
| DATA-002 | P1 | 未着手 | 未割当 | 別端末で履歴詳細を読めない実害と参照不整合 | [DATA-002.md](tasks/DATA-002.md) |
| SEC-005 | P1 | 未着手 | Codex | 公開登録とlegacy店舗作成の濫用防止 | [SEC-005.md](tasks/SEC-005.md) |
| DATA-001 | P1 | 未着手 | Codex | 棚卸完了を含む複数writeの部分失敗防止 | [DATA-001.md](tasks/DATA-001.md) |
| TEST-002 | P1 | 保留 | Codex | package分離済み、critical integration/E2Eが残る | [TEST-002.md](tasks/TEST-002.md) |

`DO-001`は重要な既知P1ですが、現時点の監査ではdata破壊を伴わないため、
ownerと回避策を付けてWeb公開後へ送れる候補です。正式なrelease受容はWEB-001で判断します。

## 次のマイルストーン

| ID | P | 状態 | 担当 | 対象 | 詳細 |
|---|---:|---|---|---|---|
| PLAY-004 | P1 | 保留 | Claude Code | TWA、reviewer、store listing、screenshots | [PLAY-004.md](tasks/PLAY-004.md) |
| DO-001 | P1 | 未着手 | Codex | 公開後の同期UX改善候補 | [DO-001.md](tasks/DO-001.md) |
| UI-001 | P2 | レビュー待ち | Claude Code | デスクトップ表示（>=1024px サイドナビ + 本文カラム） | [UI-001.md](tasks/UI-001.md) |

`UI-001`はUser指示で**実装済み**ですが、`WEB-01`〜`WEB-10`のどのgateにも含まれません。
gateへ追加するか公開後へ送るかは[提案箱](../proposals.md)のPMトリアージ待ちです。
モバイル表示は非改変のため、release gate側の375px検証をやり直す必要はありません。
実ブラウザでの目視確認は未実施です。

14日trial/StripeはD-021のA1将来フローとして保持します。W1完了前に実装タスクを開始しません。
Web登録へのtrial適用とStripe/backendの単独公開順はUser判断待ちです。

## 完了

2026-07完了分の詳細は [`tasks/completed-2026-07.md`](tasks/completed-2026-07.md)。
2026-08完了分は [`CI-001.md`](tasks/CI-001.md)、[`DEP-001.md`](tasks/DEP-001.md)、
[`DOC-001.md`](tasks/DOC-001.md)。
各詳細内の「未実施」は完了記録時点の状態です。
2026-07完了分は`develop@96233d4`まで、CI-001は`develop@7d47cb4`で初回完了し、
現在HEAD `develop@bc9fb85`のpreview CIも成功済みです。
DEP-001、PLAY-002/003/004の直近成果は`develop@bc9fb85`までにcommit / push済みです。
Pro Reviewは2026-08-01にdeploy済みですが、本番Pages / Workerの現行化と本番D1 migrationは未実施です。

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
| CI-001 | P1 | 2026-08-02 | Codex | `develop` のtest/buildとPages preview自動実行 |
| DEP-001 | P1 | 2026-08-02 | Codex | 本番依存の high 脆弱性を解消または隔離 |
| DOC-001 | P1 | 2026-08-06 | Codex | docsの正本・現行・将来・履歴をWeb先行へ整理 |

## 保留（P2 / P3）

詳細は [`tasks/backlog.md`](tasks/backlog.md)。スプリント後に優先度を再評価します。

| ID | P | 状態 | 担当 | 概要 |
|---|---:|---|---|---|
| REF-001 | P2 | 保留 | 未割当 | 大型コンポーネントと composable を段階分割 |
| PERF-001 | P2 | 保留 | 未割当 | フロント bundle を分割 |
| SEC-006 | P2 | 保留 | 未割当 | 店舗コード・PIN・保存トークンを再評価 |
| CFG-001 | P2 | 保留 | 未割当 | Claude Code の古い hook/command を可搬化 |

## 統合済みの課題（新規IDは作らない）

以下は独立したタスクIDを持たず、既存タスクの中で扱います。

| 課題 | 統合先 |
|---|---|
| CIのNode 20で`node:sqlite`が起動せず、依存packageのengine要件とも不一致 | [CI-001](tasks/CI-001.md) |
| AppのVitestがWorkerテストを重複実行する問題（分離済み。critical E2E等は未完） | [TEST-002](tasks/TEST-002.md) |
| `postcss` / `xlsx` の production high 脆弱性 | [DEP-001](tasks/DEP-001.md) |
| TWAでの価格・購入面（D-021のP1） | [PLAY-004](tasks/PLAY-004.md) |
| Free 2台制限のserver整合（D-016のW1公開面） | [WEB-001](tasks/WEB-001.md) |
| 履歴の端末依存とデータ源の不整合（`R-001` / `F-001`〜`F-004`） | [DATA-002](tasks/DATA-002.md) |

実使用バグの報告全文・コード根拠・本番D1の調査結果は [`bug-reports.md`](bug-reports.md) に保存しています。

## 変更履歴

- 2026-08-09: CC実装のCodex独立reviewで、品目取込のparser・alias衝突・preview・表示文言に
  公開前修正が必要と判定した。WEB-07配下の実装作業を追跡する`IMPORT-001`をP1で追加し、
  3セッションの修正計画を`cc-session-plan.md`へ更新した。既存タスクの状態・担当は変更していない。
- 2026-08-08: User判断で製品実装をClaude Code、release品質基盤と独立reviewをCodexへ分離。
  WEB-001を品質基盤更新として再開し、棚卸中心の公開契約とWeb向け共同採点を追加した。
  production変更、URL/contact、deploy承認待ちは継続する。
- 2026-08-05: `UI-001`（デスクトップ表示）を次のマイルストーンへ追加。User指示で実装済み・PMトリアージ待ち。
  release gate（`WEB-01`〜`WEB-10`）とWeb Free版のscopeは変更していない。
- 2026-08-04: D-021により現在目標をWeb Free版へ変更。WEB-001を新設し、DOC-001だけをCodex進行中へ変更。
  PLAY-004をA1へ保留し、Stripe/trialをA1将来フローへ分離した。
- 2026-08-01: 一覧と詳細を分離。詳細を `tasks/` 配下へ移し、完了分を `tasks/completed-2026-07.md`、
  P2/P3を `tasks/backlog.md` へ。`DATA-002` を P2 → **P1** へ変更し、実使用バグ `R-001` /
  `F-001`〜`F-004` を統合。既存の記録・完了条件・検証証拠は削除していない。
