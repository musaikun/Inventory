# ドキュメント案内

最終整理: 2026-08-06 / 実装照合基準: `develop@bc9fb85`

このファイルを `docs/` 全体の唯一の総合索引とします。現在の公開目標は
**Web Free版を安全に公開できる状態にすること**です。Google Play、14日無料体験、
Stripe契約は後続マイルストーンであり、現在のWeb公開判定には含めません。

## 情報の優先順位

矛盾した場合は次の順で判断します。

1. 現在のコード、migration、test、実行結果
2. ユーザーが明示した最新判断
3. [判断記録](quality-foundation/decisions.md)の採用事項
4. 現行仕様・契約・runbook
5. dated audit、作業log、`docs/export/`

## 現在の正本

| 知りたいこと | 正本 | 役割 |
|---|---|---|
| 現在の公開可否 | [Web公開準備](quality-foundation/web-release-readiness.md) | Web Free版のrelease gate |
| タスクの状態・優先度・担当 | [タスクボード](quality-foundation/task-list.md) | **状態の唯一の正本** |
| 採用・変更・廃止した判断 | [判断記録](quality-foundation/decisions.md) | 過去判断を消さず置換関係を記録 |
| 共同作業の入口 | [品質基盤README](quality-foundation/README.md) | 読む順番と再開地点 |
| 作業規則 | [共同作業ルール](quality-foundation/working-agreement.md) | 競合回避、検証、引き継ぎ |
| 製品全体の現在地 | [プロジェクト現況](project-status.md) | 現行の短いproduct overview |
| 法務原文 | [利用規約](legal/terms.md) / [privacy](legal/privacy-policy.md) | 公開HTMLへ同期する原文 |
| 削除API契約 | [account deletion contract](quality-foundation/account-deletion-contract.md) | App / Worker / D1 / DO境界 |
| デプロイ方式 | [CI/CD](ci-cd.md) | preview、本番release、rollback |

コード・migrationと現行仕様書が矛盾する場合、仕様書を根拠に実装を推測しません。
差分をタスク化し、どちらを直すか判断記録へ残します。

## 現行仕様・設計

| 文書 | 現在の扱い |
|---|---|
| [spec.md](spec.md) | 現行W1 architecture/data境界。旧本文はreference snapshot |
| [api-design.md](api-design.md) | 現行W1 endpoint/auth baseline。将来v2はreference snapshot |
| [sync-spec.md](sync-spec.md) | 現行同期・join認可・fail-closedとknown gap |
| [security-review.md](security-review.md) | 現行security baselineとWeb公開前gap |
| [db-design-v2.md](db-design-v2.md) | 現行と将来設計が混在。実schemaの正はmigration |
| [feature-checklist.md](feature-checklist.md) | 新機能・仕様変更の共通DoD |
| [test-cases.md](test-cases.md) | 同期・競合・offlineの恒久手動回帰 |
| [test-checklist-new-features.md](test-checklist-new-features.md) | 2026-07-28までの履歴snapshot。Web release gateには使わない |

鮮度の詳細と更新順は
[ドキュメント鮮度台帳](quality-foundation/documentation-inventory.md)を参照します。

## 現在の運用・公開資料

- [Web公開準備](quality-foundation/web-release-readiness.md) — 現在のrelease gate
- [D1復元runbook](quality-foundation/d1-recovery-runbook.md) — draft。前提未整備のため本番実行不可
- [Pro Review runbook](quality-foundation/pro-review-runbook.md) — Access保護された分離review環境
- [PostHog checklist](quality-foundation/posthog-setup-checklist.md) — 分析を有効化するreleaseだけで使用
- [Data flow監査](quality-foundation/data-safety-audit.md) — Web privacyと将来のPlay申告の根拠

## 後続マイルストーン

提供順は [D-021](quality-foundation/decisions.md#d-021--web先行とplay向け将来フローの分離)
を正とします。

1. **W1（現在）**: Web Free版。trial、Stripe、課金、Play配布なし
2. **A1（将来のAndroid / Google Play milestone）**: Android app内の新規登録を起点に
   14日Pro無料体験、終了後はFree。Webで明示的にStripe契約すると、同じaccountの
   Android appへPro権利を反映

Web登録者にもtrialを付与するか、Stripe/backendをPlayより先に単独公開するかは未決です。

Play専用資料は削除せず、A1着手時に公式要件を再確認して使用します。

- [Google Play readiness](quality-foundation/google-play-readiness.md)
- [Play reviewer guide](quality-foundation/play-reviewer-guide.md)
- [Data Safety回答draft](quality-foundation/data-safety-form-draft.md)
- [Play向けquality scorecard](quality-foundation/quality-scorecard.md)

長期・将来設計は [strategy-10yr.md](strategy-10yr.md)、
[roadmap.md](roadmap.md)、[enterprise-design.md](enterprise-design.md)、
[pricing-strategy.md](pricing-strategy.md) を参照します。提案は
[proposals.md](proposals.md)に記録し、採用前の仕様として扱いません。

## 履歴

次は作成時点の証拠です。現在仕様へ書き換えません。

- `docs/audit-2026-07.md`、`docs/holistic-review-2026-07.md`
- `docs/quality-foundation/audit-2026-07-25.md`
- `docs/quality-foundation/project-status.md`（2026-07-25 snapshot）
- `docs/quality-foundation/sprint-plan-2026-07-27.md`
- `docs/quality-foundation/tasks/completed-*.md`
- `docs/export/**`

`session-log.md`、`intake-reviews.md`、`proposals.md`も過去entryを改変せず、新しい記録を上に追記します。

## 整理ルール

- 物理移動やrenameは、参照linkを一括検証できる独立タスクで行う。
- task状態を詳細fileやsession logへ複製しない。状態は`task-list.md`だけに置く。
- test実績には日付、対象commit、commandを残す。固定件数を恒久仕様にしない。
- legal、API、DB、認可、動作、運用を変えたreleaseでは関連する現行文書も同時更新する。
- dated auditとexportは履歴として保持する。
