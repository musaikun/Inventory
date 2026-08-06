# ドキュメント鮮度台帳

最終監査: 2026-08-06
実装基準: `develop@bc9fb85` / app `0.66.2`
役割: 機械的な棚卸しと鮮度負債。総合索引は[`../README.md`](../README.md)を正とする。

## 2026-08-04〜2026-08-06 棚卸し

- 対象: 92 files（Markdown 91、export ZIP 1）。8/5に並行追加された`tasks/UI-001.md`を含む
- `docs/export/`: 30 files。すべて履歴
- 非export: 62 files
- 物理移動・削除: なし

| 分類 | 対象 |
|---|---|
| 作業・判断の正本 | `quality-foundation/README.md`、`task-list.md`、`decisions.md`、`working-agreement.md`、`web-release-readiness.md` |
| 契約・法務の正本 | `account-deletion-contract.md`、`legal/terms.md`、`legal/privacy-policy.md` |
| 現行overview・仕様 | `project-status.md`、`spec.md`、`api-design.md`、`sync-spec.md`、`security-review.md`、`roadmap.md`、`test-cases.md`、`ci-cd.md` |
| Runbook / checklist / draft | D1復元、Pro Review、PostHog、Play readiness/reviewer/Data Safety、privacy retention |
| 将来設計・提案 | `strategy-10yr.md`、`enterprise-design.md`、`db-design-v2.md`、ordering/order import設計、`proposals.md` |
| 作業証拠 | `tasks/<ID>.md`、`bug-reports.md`、`session-log.md` |
| 履歴 | dated audit、旧sprint/snapshot、`test-checklist-new-features.md`、completed task、`intake-reviews.md`、`docs/export/**` |

### 現在の重大な鮮度差

- 2冊の`project-status.md`: rootはoverview、quality-foundation側は2026-07-25 snapshotとして役割を分離した。
- `spec/api/sync/security/test/ci-cd`は2026-08-06に現行code/workflowへ照合し、
  current baselineと旧reference snapshotを分離した。未解消実装は各文書からtaskへ追跡する。
- `ci-cd.md`のproduction branch、Wrangler版、rollbackは文書鮮度ではなくWEB-001の実装gapとして未確定。
- legal正本の`https://<host>`、canonical URL、正式contactはUser判断待ち。
- `bug-reports.md`のrepository root基準相対link 41件はDOC-001 Phase 1で修正済み。

### 更新順

1. Web公開gate、task board、判断、agent入口
2. canonical/contact、Pages routing/CORS、production deploy/migration runbook
3. canonical確定後にlegal原文・公開HTML・supportを同期
4. release candidateで仕様、security、test、CIを対象SHA付き再検証
5. 長期設計は対応機能へ着手するときに再照合

## 2026-07-25 初回台帳（履歴）

基準日: 2026-07-25  
実装基準: `develop@131a36f` / app `0.66.0`

分類:

- `現行・要更新`: 現在仕様の正本候補だが、実装との差が確認された。
- `現行・確認`: 現在も参照する設計。関連実装時に局所確認する。
- `方針`: 事業・法務・長期設計。コードだけでは正否を決めない。
- `履歴`: 作成時点の監査・snapshot。原則として本文を現行化しない。
- `運用ログ`: 提案・取り込みの時系列。追記で扱う。

## 共同品質基盤

| 文書 | 役割 |
|---|---|
| `docs/quality-foundation/README.md` | Codex・Claude Code・Userの共通入口 |
| `sprint-plan-2026-07-27.md` | 2週間のscope、担当、日程、release gate |
| `task-list.md` | 優先度、owner、状態、完了条件 |
| `google-play-readiness.md` | Google Play公開要件と提出前checklist |
| `quality-scorecard.md` | 双方の独立評価とA+基準 |
| `project-status.md` | 検証日・commit付きの技術状態 |
| `decisions.md` | 採用・保留判断の履歴 |
| `session-log.md` | 作業結果と次の再開地点 |
| `working-agreement.md` | 競合回避・検証・引き継ぎ規則 |
| `audit-2026-07-25.md` | 初回横断監査の根拠 |

## 現行文書

| 文書 | 分類 | 確認結果 / 次の処理 |
|---|---|---|
| `docs/project-status.md` | 現行・要更新 | v0.58、旧ブランチ、全テスト成功、次タスクが現状と不一致 |
| `docs/spec.md` | 現行・要更新 | v0.48。movement、PDF、CSP、migration、API 一覧を更新 |
| `docs/api-design.md` | 現行・要更新 | movement API、PDF 認証/制限、complete payload を実装と照合 |
| `docs/sync-spec.md` | 現行・要更新 | join の認可 invariant、休止復帰、ホスト専用操作を追記 |
| `docs/security-review.md` | 現行・要更新 | 新 P0/P1、依存監査、test 実績を反映 |
| `docs/roadmap.md` | 現行・要更新 | header/version と実装済み・残件の矛盾を整理 |
| `docs/test-cases.md` | 現行・要更新 | 件数固定をやめ、現在の失敗と基準 commit を記録 |
| `docs/test-checklist-new-features.md` | 現行・要更新 | 旧ブランチと全件成功記述を更新 |
| `docs/ci-cd.md` | 現行・要更新 | `develop` の扱いを User 判断後に反映 |
| `docs/db-design-v2.md` | 現行・確認 | 2026-07-23 更新。変更実装時に現行 Cloudflare 制限を再確認 |
| `docs/order-history-import-design.md` | 現行・確認 | 最近の設計。テスト成功表現のみ再検証 |
| `docs/ordering-analytics-design.md` | 現行・確認 | 発注分析変更時に実装と再照合 |
| `docs/feature-checklist.md` | 現行・確認 | DoD として維持。自動/手動検証の境界を今後明確化 |
| `docs/room-url-design.md` | 履歴寄り | 導入時設計。現行 sync spec へ必要事項を統合後に位置付け明記 |

## 方針・運用文書

| 文書 | 分類 | 確認結果 / 次の処理 |
|---|---|---|
| `docs/strategy-10yr.md` | 方針 | 長期判断の羅針盤。変更は User / PM 判断を伴う |
| `docs/enterprise-design.md` | 方針 | 多店舗化の将来設計。現行実装とは区別して維持 |
| `docs/pricing-strategy.md` | 方針 | プラン制限再有効化前に実装と再照合 |
| `docs/legal/privacy-policy.md` | 方針 | PostHog/Push/保存期間の監査結果と法務判断を照合 |
| `docs/legal/terms.md` | 方針 | 機能・課金・データ取扱い変更時に review |
| `docs/proposals.md` | 運用ログ | header の更新日と最新 entry 日が不一致。追記規則を維持 |
| `docs/intake-reviews.md` | 運用ログ | 2026-07-23 以降の変更の取り込み状況を確認 |

## 履歴文書

| 文書 | 分類 | 扱い |
|---|---|---|
| `docs/audit-2026-07.md` | 履歴 | 当時の監査として保持。現在結果は `docs/quality-foundation/` を参照 |
| `docs/holistic-review-2026-07.md` | 履歴 | v0.48 時点の横断 review として保持 |
| `docs/export/project-summary-2026-07.md` | 履歴 | export 時点の snapshot。現行仕様として更新しない |
| `docs/export/vault/00-INDEX.md`〜`27-support-faq.md` | 履歴 | 一括 export の知識庫。個別の鮮度負債として数えない |

## 更新順

1. `security-review.md`、`sync-spec.md`、`api-design.md`
2. `test-cases.md`、`ci-cd.md`
3. `spec.md`、`project-status.md`
4. `roadmap.md` と各機能設計
5. 法務・戦略文書は、対応する User 判断が確定した時点

## 鮮度を保つ規則

- 実行結果には日付、対象 commit、command を付ける。
- version や test 件数を更新できない場合は固定値を書かず、確認手順へ link する。
- branch 名を恒久ルールとして固定せず、`git branch --show-current` を基準にする。
- dated audit と export は履歴として凍結し、現在状態は別文書に記録する。
- コード変更で仕様・API・DB・認可・運用が変わる場合、同じタスクの完了条件に文書更新を含める。
