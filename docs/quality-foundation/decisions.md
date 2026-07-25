# 判断記録

最終更新: 2026-07-25

状態は `提案 / 採用 / 却下 / 保留 / 廃止` を使用します。採用済み判断を変える場合は
既存項目を消さず、新しい項目から置き換え先を参照します。

## D-001 — `docs/quality-foundation/` を共有作業の入口にする

- 日付: 2026-07-25
- 状態: 採用
- 判断: Codex、Claude Code、ユーザー間の現状・タスク・引き継ぎは
  `docs/quality-foundation/` に集約する。
- 理由: 会話履歴や各ツール固有の context に依存せず、Git 管理可能な再開地点を持つため。
- 境界: 製品仕様の正本を複製しない。既存仕様書への反映は `DOC-001` で行う。
- 名称: 特定agentではなく、共同で品質基盤を向上させる目的を示す名称とする。

## D-002 — 日付付き監査と export は履歴として保持する

- 日付: 2026-07-25
- 状態: 採用
- 判断: `docs/*-2026-07.md` と `docs/export/` を現在仕様へ上書きしない。
- 理由: 過去に何を前提として判断したかを追跡できるようにするため。

## D-003 — 初回監査ではアプリ本体を変更しない

- 日付: 2026-07-25
- 状態: 採用
- 判断: 共有基盤、監査、最小限の agent 導線と ignore 設定だけを作る。
- 理由: P0 を含む複数論点を、所有者・完了条件なしに同時修正しないため。

## D-004 — P0 認可・店舗境界を最優先にする

- 日付: 2026-07-25
- 状態: 採用
- 判断: `SEC-001` と `SEC-002` を、新機能・大型 refactoring より先に扱う。

## D-005 — 仕入先の正しい並び順

- 日付: 2026-07-25
- 状態: 保留
- 選択肢: 入力順を保持 / 日本語 locale 順 / 正規化済み表示名の安定順。
- 影響: `deliveryImportCommit` の実装、既存テスト、画面上の予測可能性。
- 決定者: User

## D-006 — `develop` の CI と preview

- 日付: 2026-07-25
- 状態: 採用
- 判断: `develop` のpush / PRではtestとbuildを実行し、自動deployは行わない。
  previewは明示的な対象branchまたは手動実行に限定する。
- 理由: 品質feedbackを早くしつつ、外部変更とCloudflare実行costを無断で増やさないため。

## D-007 — Skill / hook の追加時期

- 日付: 2026-07-25
- 状態: 採用
- 判断: 初回は新しい repo 固有 Skill を作らず、既存の Cloudflare / Durable Objects /
  Workers best-practices Skill と文書化した手順を使う。hook の全面改修も保留する。
- 理由: 現在の `.claude` hook は Linux 固定 path で Windows では可搬でなく、各編集後 build は
  高コストで失敗も隠している。まず一巡の修正 flow を確立し、繰り返し部分だけを
  cross-platform script として自動化する。

## D-008 — 2週間の機能凍結と品質集中

- 日付: 2026-07-25
- 状態: 採用
- 期間: 2026-07-27〜2026-08-08
- 判断: Google Play要件と品質基盤以外の新機能を停止する。
- 対象: P0、公開対象P1、account deletion、Data Safety、CI、test、dependency、必要なlegal/UX。
- 対象外: 管理分析、多店舗、課金、需要予測、大型refactoring、非必須performance改善。
- 計画: `sprint-plan-2026-07-27.md`

## D-009 — Codex / Claude Codeの主担当を分離する

- 日付: 2026-07-25
- 状態: 採用
- Codex: Worker、D1、DO、認証・認可、削除backend、tenant境界、CI、security/data test。
- Claude Code: 登録・削除UI/UX、再認証画面、privacy/terms表示、外部削除page、store画像。
- 共同: API contract、Data Safety、integration、相互review。
- 規則: 同じfileを同時編集せず、`task-list.md` のownerを先に更新する。

## D-010 — 品質評価は独立採点の低い方を採用する

- 日付: 2026-07-25
- 状態: 採用
- 判断: 10項目をCodexとClaude Codeが独立採点し、項目ごとの低い方を正式点とする。
- 合格: 全項目9.0以上、8項目以上A+、mandatory release gates全通過。
- 根拠: agent間の楽観差を平均で隠さず、test・CI・URL・code evidenceで評価するため。
- 評価表: `quality-scorecard.md`

## D-011 — Google Play account deletionを公開P0とする

- 日付: 2026-07-25
- 状態: 採用
- 判断: account作成が既に存在するため、in-app削除、公開Web申請、関連data削除を
  Google Play公開前のP0 gateとする。
- 注意: `stores.deleted_at` だけの凍結では完了としない。保持dataは理由と期間をpolicyへ記載する。
- Checklist: `google-play-readiness.md`
