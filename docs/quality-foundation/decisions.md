# 判断記録

最終更新: 2026-08-22

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

- 日付: 2026-07-25（2026-07-26決定）
- 状態: 採用
- 判断: 入庫履歴は日付昇順とし、同一日内では取込ファイルで仕入先が最初に登場した順を保持する。
  同一の日付・仕入先の複数行は、最初の登場位置に1件の入庫レコードとして集約する。
- 理由: 利用者が確認したCSVの並びを維持でき、漢字の読み方や実行環境のlocaleに依存しないため。
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

## D-016 — 初回Google Play版は恒久無料枠、PROは将来のWeb契約とする

- 日付: 2026-07-28
- 状態: 採用
- 決定者: User
- 判断:
  - 初回公開は14日トライアルや自動課金を行わず、期間制限のない無料プランを提供する。
  - 無料登録時にも1店舗の店舗コードと4桁PINを発行し、別端末ログインとルーム同期を可能にする。
  - 無料枠は接続端末2台、登録品目150件、棚卸履歴の閲覧直近3回とする。現行の中核機能と取込は利用できる。
  - 将来のPROは月額2,980円の1本とし、Webで明示的に契約した店舗だけに付与する。
  - Google Play/TWA内には価格、Stripe、外部購入リンクを出さず、アプリ名は共通して「タナオロ」とする。
- 実装境界: 初回公開は全店舗をfreeとして扱い、公開前にFree店舗の2台制限をserver-sideで強制する。
  PRO開始前にStripe Webhook、server entitlement、その他のserver-side上限制御、解約・支払失敗・
  account削除との連携を別途実装する。
- 適用範囲変更: Free上限、現在はtrial/課金なし、Web Stripe、Play内購入なしという**現行W1の実装境界**は
  維持する。公開順と将来trialの方針はD-021が置き換える。

## D-017 — PostHogはFree・最小event・1年保持とする

- 日付: 2026-07-28
- 状態: 採用
- 決定者: User
- 判断:
  - PostHog Cloud EUのFree planを使用し、現行planの1年保持を採用する。
  - autocapture等は使わず、allowlist済みの疑似・最小eventだけを明示同意後に送る。
  - privacy policy、Data Safety、同意/撤回、削除連携、公開build通信確認が揃うまではno-opを維持する。

## D-018 — Pro ReviewはPages・Worker・D1/DOをproductionから分離する

- 日付: 2026-07-28
- 状態: 採用
- 決定者: User
- 判断:
  - 無料版develop Reviewとは別に、Cloudflare Accessで保護したPro Review Previewを急ぎ構築する。
  - Pages project、Worker、D1、Durable Objectsをproductionから分離し、Cloudflare Free枠で運用する。
  - URL parameter/localStorageではPRO化せず、専用build変数2つの完全一致とreview Workerの`plan=pro`を使う。
  - review画面へテスト環境表示を常時出し、productionの店舗dataを移さない。

## D-019 — Account削除時に端末固有設定も自動削除する

- 日付: 2026-08-01
- 状態: 採用
- 決定者: User
- 判断:
  - account削除完了時に、業務dataだけでなく端末ID、端末名、天気用位置情報とcacheも自動削除する。
  - logoutやaccount切替では端末設定を維持し、account削除成功時だけ消去する。
  - 削除失敗時は認証・業務data・端末設定を保持し、再試行可能にする。
- 実装境界: 現行buildと公開privacy/supportは「端末設定として残る」挙動に一致している。
  App実装とtestを先に変更し、同じreleaseでprivacy/support/Data Safetyを自動削除の説明へ更新する。
- 実装結果: 2026-08-04にApp、回帰test、公開privacy/support/legal、Data Safety draftを同期済み。
  production反映と実機確認はWEB-001 / PLAY-002で継続する。

## D-020 — 初期Cloudflare運用はFree planとしWorkers Logsを有効にする

- 日付: 2026-08-01
- 状態: 採用
- 決定者: User
- 判断:
  - 当面はCloudflare Free planを使用し、D1 Time Travelの回復可能期間を7日として扱う。
  - Workers LogsはDashboardで有効化する（Userが設定済み）。
  - 規模拡大時にPaid planとD1 Time Travel 30日への変更を再検討する。
- 残り: Workers Logsの実保持期間・閲覧担当・機密値masking、alert対象と通知先を`OPS-001`で確定する。

## D-021 — Web先行とPlay向け将来フローの分離

- 日付: 2026-08-04
- 状態: 採用
- 決定者: User
- 判断:
  1. **W1（現在）**: まずWeb/PWAのFree版を安全に公開する。現行どおり14日trial、Stripe、
     Pro販売、自動課金は提供しない。
  2. **A1（将来のAndroid / Google Play milestone）**: Google PlayからAndroid appをinstallし、
     app内で新規account登録した利用者へ14日間のPro無料体験を付与する。終了後は自動でFreeへ戻す。
  3. 利用者がWebでStripe契約を明示的に行った場合、同じaccountでAndroid appへloginすると
     server entitlementによりProを自動反映する。Play版はconsumption-onlyとし、app内に
     Stripe Checkout、外部購入link、購入CTAを置かない。
- A1のtrial終了時にAndroid appへ表示する確定文言:

  > 無料体験が終了しました。
  >
  > 現在、このアカウントでは利用可能なProプランがありません。
  >
  > Proプランをご利用いただくには有効な契約が必要です。

- 権利境界:
  - plan/trialの正はbackendとし、URL query、localStorage、TWA判定を権限の正にしない。
  - 将来のStripe webhookは冪等に処理し、解約、支払失敗、猶予、返金、account削除を状態遷移へ含める。
  - Stripeを有効にする前にWeb購入面とPlay配布artifact/originの分離方法を決定する。
- 未決:
  - Webから新規登録したaccountにも14日trialを付与するか。今回の判断ではAndroid app内登録だけを確定する。
  - Stripe/backendをPlay公開前に単独releaseするか、Playと同時にreleaseするか。
  - Android trialの厳密な起算時点、既存accountへのtrial付与、再登録防止、grace期間。
  - 将来の最終価格、Pro上限、特商法・規約・privacy改定内容。
- 置換関係:
  - D-016の「Google Playを初回公開にする」という順序を置き換える。
  - D-016の「初回公開ではtrialなし」はW1として維持する。
  - 将来trialは上記Android app内登録フローだけを確定し、Web登録への適用は未決とする。
  - D-016の月額2,980円確定を予定価格へ戻し、A1開始前に最終価格を再決定する。
  - W1の実装・legalは現在のFree/no-payment状態を記述し、将来機能を提供前に現在形で掲載しない。
- 現在のrelease gate: [`web-release-readiness.md`](web-release-readiness.md)

## D-022 — Claude Code は develop への push をユーザーの都度確認なしで行う

- 日付: 2026-08-22
- 状態: 採用
- 決定者: User
- 判断: Claude Code は、テストとビルドが通ったコミットに限り、`develop` への
  commit / push を毎回の確認なしで実行する。統合は fast-forward を原則とする。
- 変更前: 「デプロイ、コミット、push、マイグレーション適用は、ユーザーの明示依頼なしに
  行わない」（[README](README.md) の「使い方」）。この判断は **push（`develop` に限る）だけ**を
  この規定から外す。
- 確認を残す範囲（従来どおり明示依頼が必要）:
  - 本番デプロイ（`scripts/deploy.sh`）
  - D1 の本番マイグレーション適用（0012〜0016 を含む。→ [WEB-04](web-release-readiness.md)）
  - `main` への統合、および `develop` 以外のブランチへの push
- 前提条件: push 前に `cd app && npm test` と `npm run build` が成功していること。
  失敗している場合は push せず、結果を報告する。
- 理由: UI 改善のように小さく反復する作業で、develop preview（Actions が Worker/App test →
  build → Pages preview を実行）まで一続きに回したいため。preview は本番 D1・Worker・
  本番 Pages を変更しない。
- 適用範囲: Claude Code セッション。Codex や他セッションの作業規約は変更しない。

## D-023 — アプリのバージョンは変更ごとに更新する

- 日付: 2026-08-22
- 状態: 採用（採番の桁割りは [D-025](#d-025--バージョンを6桁にし-セッションごとに担当桁を分ける) で更新）
- 決定者: User
- 判断: `app/package.json` の `version` を、develop へ入れる変更ごとに更新する。
  - 機能追加・画面構成の変更 → minor（`0.67.0` → `0.68.0`）
  - 不具合修正・文言修正・内部整理 → patch（`0.67.0` → `0.67.1`）
  - 破壊的変更（保存形式・API契約の非互換）は現状 0.x のため minor で扱い、
    変更内容を [`session-log.md`](session-log.md) と該当 task file に必ず残す。
- 起点: `0.67.0`。`0.66.3`（2026-08-04）以降、develop に入った未採番の変更
  （DATA-001 / DATA-002 / IMPORT-001、履歴カレンダーの専用ページ化、取込の列指定導線、
  入出庫の数量入力統一）をまとめて `0.67.0` とする。
- 表示先: 設定 →「アプリ情報」のバージョン欄（`SettingsModal`）と
  ランディング（`__APP_VERSION__`）。ビルド時に埋め込むため、更新後は再ビルドが必要。
- 対象外: `worker/package.json` の version は配布物ではないため据え置く
  （Worker の識別は deploy 時の commit SHA を正とする。→ [WEB-03](web-release-readiness.md)）。

## D-025 — バージョンを6桁にし、セッションごとに担当桁を分ける

- 日付: 2026-08-27
- 状態: 採用
- 決定者: User
- 背景: 複数の Claude Code セッションで同時に開発しており、[D-023](#d-023--アプリのバージョンは変更ごとに更新する)
  の「変更ごとに更新」を各セッションが独立に行うと**採番が衝突する**。
  実際に `v0.79.0` / `v0.80.0` / `v0.82.x` / `v0.86.0` で4回起きた。
  とくに **`package.json` の値が偶然同じだと merge で競合すらせず**、
  別々の変更が同じ番号を名乗る状態が黙って成立する（`v0.86.0` がこれ）。
- 判断: `app/package.json` の `version` を **6桁**にし、桁ごとに担当を分ける。
  各セッションは**自分の担当桁だけ**を上げ、他の桁には触らない。
  担当桁が違えば同じ場所を書いても値が衝突しないので、merge で必ず差分として現れる。

  | 桁 | 担当 |
  |---|---|
  | 1 | メジャー。Userのみ |
  | 2 | 従来の採番（公開・リリース単位）。User / PM セッション |
  | 3 | セッション枠A |
  | 4 | セッション枠B |
  | 5 | セッション枠C |
  | 6 | セッション枠D |

- 起点: `0.87.0.0.0.0`。従来の `0.87.0` を2桁目へ置き、残りを 0 で埋めた。
- 上げ方: **`./scripts/bump-version.sh <1-6>`** を使う。
  `npm version` は semver（3桁）しか受け付けず `Invalid version` で落ちるため、
  `app/package.json` と `app/package-lock.json` を両方そろえて書き換える専用scriptを持つ。
  上げた桁より下位は 0 に戻す。
- 検証済み: 6桁でも `npm run build` / `npm ci` / `__APP_VERSION__` の画面表示は動く。
  影響を受けるのは `npm version` コマンドだけで、そこは上記scriptで置き換えた。
- 副作用: バージョンは semver ではなくなるため、**semver前提の外部ツールへは渡せない**。
  npm publish はしていないので現時点で実害はない。将来公開する場合は
  配布用のタグ（2桁目まで）を別に切る。
- D-023 との関係: 「変更ごとに更新する」「minor / patch の使い分け」は自分の担当桁の中で
  意味を持たない（桁は1つしかない）。**担当桁を +1 するだけ**とする。
  変更の大きさは commit message と [`session-log.md`](session-log.md) が示す。

## D-024 — 仕入れ・発注管理の統合カードを公開gateより優先する

- 日付: 2026-08-22
- 状態: 採用
- 決定者: User
- 判断: 入出庫・発注確認・発注スケジュールの3導線を「仕入れ」1カードへ統合する作業を、
  Web Free版の公開gate（[WEB-01〜10](web-release-readiness.md)）より先に進める。
- 変更前: 「Web Free版の公開gateと品質基盤以外の新機能を停止」（`CLAUDE.md` / [README](README.md)）。
  この判断は**その停止方針を一時的に外す**。停止方針そのものは廃止しない。
- 理由:
  - 現状の利用実態は「棚卸から使い始め、不定期に部分利用する」段階で、公開よりも
    仕入れ導線の作り込みが実使用の障害になっている。
  - 統合の土台（`InventoryTable` の共通化）は公開後にも使うため、先に作っても捨てにならない。
- 想定ユーザーの前提（設計の重心）:
  - **部分利用（週1回・不定期）を主要な使い方とする**。曜日別の学習が貯まらない前提で、
    推奨発注数は当面**発注点ベース**で出す。学習は貯まったら精度が上がるおまけとする。
  - したがって「発注点の入力の手間を下げる」ことを、分析の高度化より優先する。
- 実行順: A 入出庫の刷新 → B 統合カード → C 発注数の決め方 → D 分析。
  設計の詳細は [`../proposals.md`](../proposals.md) の2026-08-22エントリ。
- 影響: Codex 側は停止方針のまま作業しているため、取り込み時に方針差を確認すること。
  公開gateのtaskは止めず、[task-list.md](task-list.md) の状態も変更しない。
