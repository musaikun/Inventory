# 判断記録

最終更新: 2026-07-26

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

- 日付: 2026-07-25（2026-07-26更新）
- 状態: 採用
- 判断: `develop` のpushではWorker/App testとApp buildを実行し、成功時だけPagesの
  `develop` previewを自動更新する。D1 migration、Worker、本番Pagesは変更しない。
  手動実行は`workflow_dispatch`でも可能にする。
- 理由: 品質gateを維持しつつ、固定preview URLでdevelopの実機確認を継続するため。
- 決定者: User

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

## D-012 — Account deletion backend contract

- 日付: 2026-07-25
- 状態: 採用
- 判断:
  - `DELETE /auth/account` に有効Bearer、現在PIN、店舗code再入力、UUID requestIdを要求する。
  - D1業務data、Push購読、棚卸/発注DOを削除し、全auth tokenを失効する。
  - 復元不能なstore tombstoneとaccount識別子を持たない再送receiptだけを7日保持する。
  - DOまたはD1失敗時は成功扱いにせず、同じrequestIdで再試行できる。
- 理由: 誤操作・盗難token・越境削除を防ぎながら、応答喪失や部分失敗を冪等に回復するため。
- Contract: [`account-deletion-contract.md`](account-deletion-contract.md)

## D-013 — Account deletion contract のレビュー結果と解決

- 日付: 2026-07-25
- 状態: 採用
- 決定者: Codex（backend owner）
- 参照: D-012、[`account-deletion-contract.md`](account-deletion-contract.md)
- 経緯: Claude Code の contract レビューで、実装 `accountDeletion.js` と契約表の差分・未配線を検出。
  スキーマ・data map・PIN照合(verifyPinHash 再利用)・test 10件は整合を確認済み。
- レビュー時点の未決:
  1. 409 `deletion_in_progress` の意味と retryable。実装は「別 requestId が進行中」の時のみ 409 かつ
     `retryable: true`（[accountDeletion.js:146](../../worker/src/accountDeletion.js#L146)）。契約表の
     「同一 requestId で再試行」という UI 指示と矛盾するため、正しい UI 挙動を確定する。
  2. 429・409 の回帰テスト要否。契約 HTTP 表に載るが `accountDeletion.test.js` に無い（現状 400/401/
     正常/replay/DO失敗/D1失敗/cleanup のみ）。追加するか契約表から外すかを決める。
  3. DO purge の内部認可方式。`ACCOUNT_DELETION_INTERNAL_HEADER`（`account-delete-v1`）による RoomDO
     内部 purge endpoint と、shopCode からの棚卸/発注 2 DO id 導出が未仕様・未実装（constants にのみ存在）。
  4. `deletion_pending_at` 設定時の通常 API / room の read・update 遮断範囲。INSERT は 0011 のトリガ、
     login は authHandler で遮断済だが、その他の読み書き経路の遮断可否を確定する。
- 反映先: 確定後、`account-deletion-contract.md` の鮮度修正（confirmation 文言 / 429 閾値 / 409 UI /
  処理順 / 7日後 replay）と併せて Codex が更新する。
- 解決: 2026-07-25 / Codex
  1. 409は別requestId競合だけに返し、`retryable: false` とする。UIは保存済みの元IDを復元する。
  2. 429と409を自動testへ追加した。
  3. Workerが棚卸/発注の2 DOへ内部header付きDELETEを送り、DOは接続・alarm・storageを破棄する。
  4. pending中はlogin/token/store API/store参照/room gateを遮断し、0011 triggerで再INSERTも拒否する。
  5. confirmation、rate limit、処理順、7日後replayをcontractへ反映した。

## D-014 — Codexの自律作業と確認境界

- 日付: 2026-07-25
- 状態: 採用
- 決定者: User
- 確認なしで進める範囲:
  - 担当タスク内のローカルcode・test・文書編集。
  - test、build、lint、auditと、`git status` / `git diff`などのread-only確認。
  - CCと重ならないファイルでの局所refactoringと回帰test追加。
- 必ず停止してUserへ確認する範囲:
  - production deploy、実環境migration、commit、push、PR作成。
  - materialなファイル/data削除、secret・権限・外部service変更、major依存更新。
  - product仕様判断、担当scope拡張、CCと同一ファイルで競合する場合。
- 補足: 実行環境が表示するpermission確認はこの方針とは別に必要。許可は用途を限定し、shell/runtime全体の
  無制限許可は避ける。

## D-015 — 認可に必要なD1照会はfail-closedとする

- 日付: 2026-07-26
- 状態: 採用
- 判断:
  - 店舗の存在・削除状態・PIN保護状態など、権限付与に必要なD1照会は成功した場合だけ許可する。
  - DB binding欠落、D1例外、店舗行不明は、503または認証失敗として閉じる。
  - 明示的に存在しPIN未設定と確認できた店舗だけ、legacy互換のホスト発行条件を使う。
  - IPレート制限など補助的な可用性制御の照会失敗はfail-openを維持し、認可判断と混同しない。
- 理由: インフラ障害を「認証不要」と解釈して新しい権限を発行することを防ぎつつ、補助機能の障害で
  正常な認証処理まで停止させないため。
