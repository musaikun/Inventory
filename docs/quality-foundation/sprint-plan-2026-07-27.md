# 共同品質基盤スプリント計画

> **履歴snapshot:** この計画は2026-07-27〜2026-08-08のGoogle Play先行計画です。
> 2026-08-04にD-021で公開順をWeb先行へ変更しました。現在の実行計画とrelease gateは
> [`web-release-readiness.md`](web-release-readiness.md)を参照してください。以下の本文は当時の計画として保持します。

期間: 2026-07-27〜2026-08-08  
基準実装: `develop@131a36f` / app `0.66.0`  
参加者: User / Codex / Claude Code

## 目的

Google Play 公開要件と本番の重要経路に範囲を固定し、機能開発を再開しても品質が崩れにくい
基盤を2週間で作ります。プロジェクト全体を短期間で全面刷新する計画ではありません。

目標は次の3点です。

1. Google Play公開を妨げる機能・規約・データ処理の不足を解消する。
2. 既知のP0と公開対象P1を解消し、認証・店舗境界・削除処理をテストで固定する。
3. CodexとClaude Codeの独立評価で、全10項目9.0以上、8項目以上をA+にする。

正式な採点方法は [`quality-scorecard.md`](quality-scorecard.md)、Play固有の要件は
[`google-play-readiness.md`](google-play-readiness.md) を使用します。

## スコープ凍結

### 実施する

- WebSocket参加・ホスト権限・店舗間分離の修正
- アカウント削除のbackend、in-app UI、公開Web申請導線
- D1、Durable Objects、Push、token、localStorageを含む削除範囲の確定と実装
- 登録経路の濫用防止、Push認証、fail-closed化、cron不具合
- Appテストの既知失敗、重要経路の統合/E2Eテスト、`develop`のCI
- `xlsx` high脆弱性の解消、隔離、または審査対象buildからの除外
- Data Safety、privacy policy、terms、第三者SDKの実装整合
- Google Play提出に必要なTWA確認、reviewer導線、metadata、UI確定後の画像
- 変更した範囲に必要な文書更新

### 2026-08-08まで停止する

- Google Play要件と無関係な新機能
- 管理者分析、需要予測、多店舗、課金などの機能拡張
- 大型コンポーネントの全面分割
- 公開判定を変えないbundle最適化
- 履歴snapshotを含む全docsの一括再編集
- major依存更新。ただし脆弱性解消に不可欠なものは例外とする

バグ修正に必要な局所refactoringは許可しますが、機能追加と同じ差分に混ぜません。

## 役割分担

| Track | 主担当 | 内容 |
|---|---|---|
| A: Security / Data | Codex | Worker、D1、DO、認証・認可、削除API、tenant境界、cron、Push、依存監査 |
| B: Play UX / Legal surface | Claude Code | 登録・削除UX、再認証、規約画面、外部削除ページ、accessibility、store画像 |
| C: Verification | Codex主担当・Claude Code独立review | CI、unit/integration/E2E、Data Safety照合、scorecard |
| D: Product decisions | User | 削除時の確認強度、保持データ、表示文言、公開可否の最終判断 |

同じファイルを同時編集しません。共通contractは実装前に `decisions.md` へ固定し、
backendとUIを分離してから並行作業します。

## クリティカルパス

1. `SEC-001` と `SEC-002` で認可・店舗境界を閉じる。
2. 削除対象データ、保持例外、API contract、再認証方式を確定する。
3. Codexが削除backend、Claude CodeがUIとWeb導線を並行実装する。
4. Data Safety / privacy policyを実際のSDK・権限・保存先と照合する。
5. CI、統合テスト、TWA buildで全体を接続する。
6. UIを凍結してからscreenshotsとstore metadataを作る。
7. 双方が独立採点し、低い方の点数でgapを閉じる。

## 日程

| 日付 | Milestone | Exit criteria |
|---|---|---|
| 7/27 | Scope / Contract freeze | task担当確定、削除data map・API・保持方針が採用済み |
| 7/28〜7/30 | Security core | `SEC-001`、`SEC-002`、削除backendの主要失敗testが成功 |
| 7/29〜8/1 | Play UX | in-app削除、再認証、外部Web導線、規約導線が接続可能 |
| 7/31〜8/3 | Reliability | Push、fail-closed、cron、部分失敗、既知test失敗を処理 |
| 8/3〜8/5 | Supply chain / CI | xlsx方針適用、develop CI、重要経路integration/E2E成功 |
| 8/5〜8/6 | Play readiness | Data Safety台帳、privacy/terms、TWA、reviewer導線を確認 |
| 8/6 | UI freeze | 提出対象UI固定、screenshots作成開始 |
| 8/7 | Dual audit | Codex・Claude Codeが独立採点、gap list確定 |
| 8/8 | Release candidate | mandatory gate全通過、全項目9.0以上、8項目以上A+ |

## 日次運用

- 開始時: `git status`、担当タスク、他担当の変更予定を確認する。
- 終了時: task状態、test結果、残件、次の一手を `session-log.md` に残す。
- P0または公開blockerを新規発見した場合、予定済みP2を外してbufferを確保する。
- 8/6以降は新規実装を原則止め、bug fix・文書整合・提出物だけにする。

## 完了条件

- [`quality-scorecard.md`](quality-scorecard.md) のmandatory gateをすべて通過。
- [`google-play-readiness.md`](google-play-readiness.md) に未解決blockerがない。
- App / Worker testとbuildがclean checkout相当で再現可能。
- 未解決P0と公開対象P1が0件。
- deploy、migration、store提出はUserの最終承認後にのみ実施する。
