# 横断改善タスクボード

最終更新: 2026-08-10

**このファイルが状態の正本です。** 状態・優先度・担当を変えるときは、まずここを更新します。
根拠・実装・検証証拠・完了条件は [`tasks/`](tasks/) 配下の各タスクファイルにあります。

- 状態: `未着手` / `進行中` / `レビュー待ち` / `保留` / `完了` / `リスク受容`
- 担当: `未割当` / `Codex` / `Claude Code` / `User`
- P0 は認可・データ境界または**現在のWeb公開**を直接blockする項目

現在は[Web公開準備](web-release-readiness.md)に含まれるP0/P1と品質基盤だけを実装し、
新機能、Stripe、trial、TWA、Google Play提出作業は原則保留します。
D-021以前の2週間計画は[履歴](sprint-plan-2026-07-27.md)として保持します。

> **CCセッションの実行計画は [`cc-session-plan.md`](cc-session-plan.md) にあります。**
> 8タスクを3セッションへ束ねた割り振り、各タスクの完了条件、環境・コマンド、
> 主要ファイル地図、既知の落とし穴をまとめた**指示出し用の一時文書**です。
> CC側の作業を始めるときは、まずそちらを読んでください（状態の正本は本ファイルのままです）。

## 現在のマイルストーン: Web Free版

### 初回Web版の中心（2026-08-08 確定）

初回Web版の中心は **棚卸業務の効率化** です。第一導線は
「品目を準備 → 棚卸開始 → 入力 → 完了 → 履歴」で、棚卸開始を最も目立つ主操作とします。

- **入出庫・発注確認は中核機能ではなく β機能** として位置づけます。理論在庫は記録状況によって
  誤差が出るため、その旨を画面に明示します。発注確認は仕入先へ自動送信しません。
- **新機能は増やしません。** 今回のscopeは既存機能の整理と安定化に限定します。
  画面構成の再編（棚卸中心へ戻す）は機能追加ではなく整理として扱います。
- 公開scopeの正本は [`web-release-readiness.md`](web-release-readiness.md)、
  CC側の実行順は [`cc-session-plan.md`](cc-session-plan.md) にあります。

| ID | P | 状態 | 担当 | Web公開との関係 | 詳細 |
|---|---:|---|---|---|---|
| WEB-001 | P0 | 進行中 | Codex | CCレビュー修正（棚卸完了失敗時の状態保持・pending整合） | [WEB-001.md](tasks/WEB-001.md) |
| PLAY-002 | P0 | レビュー待ち | User | code review済み。canonicalと実機確認待ち | [PLAY-002.md](tasks/PLAY-002.md) |
| PLAY-003 | P1 | 保留 | Codex | canonical/release candidate確定後にWeb最終照合 | [PLAY-003.md](tasks/PLAY-003.md) |
| OPS-001 | P1 | 保留 | Codex | 事前調査済み。最小observability・構造化log・互換日確認 | [OPS-001.md](tasks/OPS-001.md) |
| PRIV-001 | P1 | 保留 | Codex | release candidateで分析無効・通信なしを検証 | [PRIV-001.md](tasks/PRIV-001.md) |
| DATA-002 | P1 | レビュー待ち | Claude Code | CCレビュー修正（pending整合・永続化・表示・履歴identity） | [DATA-002.md](tasks/DATA-002.md) |
| IMPORT-001 | P1 | レビュー待ち | Claude Code | 品目マスタ取込・過去棚卸取込の非破壊性・preview・error明細を公開契約へ適合 | [IMPORT-001.md](tasks/IMPORT-001.md) |
| SEC-005 | P1 | 未着手 | Codex | 公開登録とlegacy店舗作成の濫用防止。DATA-002 Phase 1 完了により2026-08-08から着手可 | [SEC-005.md](tasks/SEC-005.md) |
| DATA-001 | P1 | レビュー待ち | Claude Code | CCレビュー修正（棚卸完了失敗時の状態保持・再試行・server原子性） | [DATA-001.md](tasks/DATA-001.md) |
| TEST-002 | P1 | 保留 | Codex | package分離済み、critical integration/E2Eが残る | [TEST-002.md](tasks/TEST-002.md) |

`DO-001`は重要な既知P1ですが、現時点の監査ではdata破壊を伴わないため、
ownerと回避策を付けてWeb公開後へ送れる候補です。正式なrelease受容はWEB-001で判断します。

## 次のマイルストーン

| ID | P | 状態 | 担当 | 対象 | 詳細 |
|---|---:|---|---|---|---|
| PLAY-004 | P1 | 保留 | Claude Code | TWA、reviewer、store listing、screenshots | [PLAY-004.md](tasks/PLAY-004.md) |
| DO-001 | P1 | 未着手 | Codex | 公開後の同期UX改善候補 | [DO-001.md](tasks/DO-001.md) |
| UI-001 | P2 | レビュー待ち | Claude Code | デスクトップ表示（>=1024px）とホームの順路再編（旧 UI-002 を統合） | [UI-001.md](tasks/UI-001.md) |

`UI-001`（旧 `UI-002` の画面再編を含む）はUser指示で**実装済み**ですが、`WEB-01`〜`WEB-10`のどのgateにも含まれません。
gateへ追加するか公開後へ送るかは[提案箱](../proposals.md)のPMトリアージ待ちです。
モバイル表示は非改変のため、release gate側の375px検証をやり直す必要はありません。
実ブラウザでの目視確認は未実施です。

### 初回公開scope外（着手しない・2026-08-08 確定）

新規IDは作らず、既存タスクの公開後フェーズとして扱います。

| 対象 | 統合先 | 着手の前提 |
|---|---|---|
| DATA-002 **Phase 3**（データ源一本化・`LIMIT 50`見直し・削除のサーバー側完結） | [DATA-002](tasks/DATA-002.md) | PM判断 ＋ `WEB-04`（本番D1 migration の適用） |

Phase 3 は migration を伴い、本番D1に 0010/0011 が未適用の現状では判断材料が揃いません。
実装済みは **Phase 1（別端末からの明細取得・R-001復旧）と Phase 2（保存失敗の可視化・バックフィル）** です。

> **2026-08-10 前提の置き換え（記録を消さずに追記）**
>
> 2026-08-08 時点でこの表には次の2行がありました。
>
> - 「`store_history` の session 単位キー化」＝ Phase 3 の一部
> - 「過去棚卸取込の再設計（`importBatchId`・日付衝突の選択・一括取消）」
>   — 着手の前提は「**Phase 3 完了後**。履歴が日付キーのままでは成立しない」
>
> このうち session 単位キー化は **2026-08-09 の第2セッションで migration 0012 として実装済み**で、
> 前提だった「履歴が日付キーのまま」という状態がなくなりました。これを受けて
> [`cc-session-plan.md`](cc-session-plan.md) 第3セッションが過去棚卸取込を対象に含め、
> 2026-08-10 に `IMPORT-001` として実装しています（migration 0013）。
>
> **PM判断の対象**: 前提が消えたことによる自動的なscope入りではなく、
> 第3セッション指示に基づく実装です。公開scopeへ正式に含めるかどうかは
> Codex再レビューとPM判断に残します。CC判断で `WEB-07` 通過や公開可とはしていません。

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
| ホームを棚卸中心の順路へ戻す画面再編（旧 `UI-002`。独立した詳細fileを持たなかった） | [UI-001](tasks/UI-001.md) |

実使用バグの報告全文・コード根拠・本番D1の調査結果は [`bug-reports.md`](bug-reports.md) に保存しています。

## 変更履歴

- 2026-08-10: `IMPORT-001` を実装し **レビュー待ち / Claude Code** へ。品目取込のCSV厳格化
  （quoted comma・escaped quote・未閉じquote・列数不一致・ヘッダ無し・不正数値）、
  エイリアス衝突の非破壊化と明示解決、preview の欠落項目（分類コード・軸名・名称切り詰め・
  error明細）を追加。過去棚卸取込を **sessionId モデルへ接続**し、取込前preview・
  サーバー保存確認・`importBatchId` 単位の取消をserver側で原子的・冪等に実装した
  （**migration 0013 追加。適用は未実施**）。あわせて `DATA-001` / `DATA-002` を
  第1〜第3セッションの成果として **レビュー待ち** へ。Codex承認前に`完了`にしない。
  旧 `UI-002` は実体fileを持たず `UI-001.md` へ誤リンクしていたため `UI-001` へ統合した。
  詳細は [`IMPORT-001.md`](tasks/IMPORT-001.md)。

- 2026-08-08: `DATA-001`（複数writeの原子性）実装。棚卸完了・発注・入出庫のヘッダと明細を
  1つの `db.batch`（=1トランザクション）へまとめ、行数・文字列長の上限をserver側で強制。
  `useSession.complete()` の危険なフォールバック（明細保存に失敗してもセッションだけ完了にする）を削除。
  状態を レビュー待ち へ。migrationなし。詳細は [`DATA-001.md`](tasks/DATA-001.md)。
- 2026-08-08: `DATA-002` Phase 1（`GET /store/:code/sessions/:id/lines`）実装。Phase 1/2 完了により
  状態を レビュー待ち へ。**`SEC-005` を着手可へ変更**（順序ブロック解除）。実装内容は
  [`DATA-002.md`](tasks/DATA-002.md)、API登録は [`api-design.md`](../api-design.md)。
- 2026-08-08: `DATA-001` の担当を Codex → **Claude Code**、`DATA-002` の担当を 未割当 → **Claude Code** へ変更。
  初回Web版の中心を「棚卸効率化」、入出庫・発注確認を β機能 と明記し、新機能を増やさない方針を記載。
  `DATA-002` Phase 1 → `SEC-005` の着手順を固定（`worker/src/index.js` の store ルート群で競合するため）。
  `DATA-002` Phase 3 と過去棚卸取込の再設計を初回公開scope外へ。優先度・状態・release gateは変更していない。
- 2026-08-05: `UI-001`（デスクトップ表示）を次のマイルストーンへ追加。User指示で実装済み・PMトリアージ待ち。
  release gate（`WEB-01`〜`WEB-10`）とWeb Free版のscopeは変更していない。
- 2026-08-04: D-021により現在目標をWeb Free版へ変更。WEB-001を新設し、DOC-001だけをCodex進行中へ変更。
  PLAY-004をA1へ保留し、Stripe/trialをA1将来フローへ分離した。
- 2026-08-01: 一覧と詳細を分離。詳細を `tasks/` 配下へ移し、完了分を `tasks/completed-2026-07.md`、
  P2/P3を `tasks/backlog.md` へ。`DATA-002` を P2 → **P1** へ変更し、実使用バグ `R-001` /
  `F-001`〜`F-004` を統合。既存の記録・完了条件・検証証拠は削除していない。
