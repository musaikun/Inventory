# 横断改善タスクリスト

最終更新: 2026-07-25

状態は `未着手 / 進行中 / レビュー待ち / 保留 / 完了 / リスク受容` を使用します。
担当は `未割当 / Codex / Claude Code / User` のいずれか、または担当者名を記載します。
P0 は認可・データ境界またはGoogle Play公開を直接blockする項目です。

2026-07-27〜2026-08-08はP0と公開対象P1だけを実装し、P2以下は原則保留します。
全体計画は [`sprint-plan-2026-07-27.md`](sprint-plan-2026-07-27.md) を参照してください。

## 一覧

| ID | 優先度 | 状態 | 担当 | 概要 |
|---|---:|---|---|---|
| SEC-001 | P0 | 完了 | Codex | WebSocket の参加完了前メッセージを遮断 |
| SEC-002 | P0 | 完了 | Codex | 注文 upsert の店舗境界を保証 |
| PLAY-001 | P0 | 完了 | Codex | account削除backendと関連data削除 |
| PLAY-002 | P0 | 進行中 | Claude Code | in-app削除UXと公開Web申請導線 |
| PLAY-003 | P1 | 未着手 | Codex | Data Safety・privacy・第三者SDKの整合監査 |
| PLAY-004 | P1 | 未着手 | Claude Code | TWA審査導線・store listing・screenshots |
| BUG-001 | P1 | 完了 | Codex | cron の存在しない列参照を修正 |
| TEST-001 | P1 | 未着手 | Codex | 仕入先順の仕様を決め App テストを復旧 |
| SEC-003 | P1 | 完了 | Codex | Push 購読 API の認証・検証を追加 |
| SEC-004 | P1 | 完了 | Codex | ホスト認可境界を fail-closed 化 |
| SEC-005 | P1 | 未着手 | Codex | 無制限な店舗作成経路を整理 |
| DO-001 | P1 | 未着手 | Codex | 品目追加要求を休止復帰対応にする |
| DATA-001 | P1 | 未着手 | Codex | 複数 D1 書き込みの原子性と入力制限を改善 |
| CI-001 | P1 | 未着手 | Codex | `develop` でtest/buildを自動実行 |
| DEP-001 | P1 | 未着手 | Codex | `xlsx` の high 脆弱性を解消または隔離 |
| TEST-002 | P1 | 未着手 | Codex | package test分離とcritical integration/E2E |
| OPS-001 | P1 | 未着手 | Codex | 最小observability・構造化log・互換日確認 |
| PRIV-001 | P1 | 未着手 | Codex | PostHog の収集内容と同意・規約を照合 |
| REF-001 | P2 | 保留 | 未割当 | 大型コンポーネントと composable を段階分割 |
| PERF-001 | P2 | 保留 | 未割当 | フロント bundle を分割 |
| SEC-006 | P2 | 保留 | 未割当 | 店舗コード・PIN・保存トークンを再評価 |
| DATA-002 | P2 | 保留 | 未割当 | 履歴検索と DO/D1 の成長時設計を検証 |
| DOC-001 | P2 | 保留 | 未割当 | 現行仕様書の鮮度差を解消 |
| CFG-001 | P2 | 保留 | 未割当 | Claude Code の古い hook/command を可搬化 |
| DOC-000 | P2 | 完了 | Codex | 共有監査・引き継ぎ基盤を作成 |
| REPO-001 | P3 | 完了 | Codex | ローカル生成物を `.gitignore` に追加 |

## タスク詳細

### PLAY-001 — account削除backendと関連data削除

- 着手: 2026-07-25 / Codex
- 完了: 2026-07-25 / Codex（backend。in-app / 公開Webは `PLAY-002`）
- 根拠: account作成API/UIは既に存在するが、削除API/UIがなく、`stores.deleted_at` だけでは
  Google Playのaccount deletion要件を満たさない。
- 主担当: Codex。UI contractはClaude Codeと実装前に固定する。
- 完了条件:
  - 有効な再認証と削除確認を要求する。
  - D1 table、DO state、Push購読、auth token、local cacheの削除/匿名化/保持mapを確定する。
  - 他店舗を削除できず、削除後の全tokenが無効になる。
  - 部分失敗時に再試行可能で、完了状態を一意に返す。
  - 正常、誤認証、越境、再送、途中失敗を自動testする。
- Checklist: [`google-play-readiness.md`](google-play-readiness.md)
- Contract: [`account-deletion-contract.md`](account-deletion-contract.md)
- 実装:
  - `DELETE /auth/account` にBearer、現在PIN、店舗code、UUID requestIdを要求。
  - pendingで通常アクセスを停止し、D1 13 data group、全token、Push購読を原子的に削除。
  - 棚卸/発注2 DOの接続・alarm・storageを削除。匿名tombstone/receiptは7日cron cleanup。
  - 同一requestId replay、別requestId競合、DO/D1部分失敗を明示状態で返す。
- 検証:
  - 失敗testを先に追加し、実装前はmodule未存在、DO内部pathは426で失敗することを確認。
  - `cd worker && npm test`: 12 files / 180 tests passed（2026-07-25）。
  - インメモリSQLite: 0001〜0011適用、削除列/receipt列、pending後INSERTの`account_inactive`を確認。
- 未実施: production migration、deploy、commit、push。User承認後に行う。

### PLAY-002 — in-app削除UXと公開Web申請導線

- 着手: 2026-07-25 / Claude Code
- 方針: 着手はアプリ内UXから。公開Webは vue-router 無しのため SPA 内 URL 起動ビュー方式（D-013 / User 承認 2026-07-25）。
- 主担当: Claude Code。backend contractは`PLAY-001`に従う。
- 実装(アプリ内UX・レビュー待ち 2026-07-25):
  - `DeleteAccountModal.vue`（再認証→最終確認→処理中→エラー/再試行→完了）＋設定内 danger 導線。
  - `useAuth.deleteAccount()`、`api.js` err.code 公開、`analytics.resetAnalytics()`、storageKeys/appMenuState 追加。
  - 契約準拠: requestId 保持・409 retryable:false・503 再試行・200 後のみローカル掃除。
  - `cd app && npm run build` 成功。commit/push なし。
  - Codex独立レビュー（2026-07-26）:
  - Blocker: `deleteRequestId`が店舗非依存の単一key。backend完了後の応答喪失→別店舗login時に、前店舗の
    匿名receipt replayを新店舗の削除成功と誤認し得る。`shopCode + requestId`を一体保存し、不一致時は破棄する。
  - Blocker: backend成功後はtokenが失効済みのため`unsubscribePush()`のAPI DELETEが401となり、
    browser `PushSubscription.unsubscribe()`へ到達しない。成功後はlocal-only解除、またはremote失敗でも必ず解除する。
  - Accessibility: dialog semantics、label関連付け、初期focus/focus trap、status/alert live regionを実機前に補う。
  - 検証: `api.test.js` 9 passed、production build成功。削除flow専用unit testは未追加。
- レビュー対応(2026-07-26): Blocker1(requestId 店舗scope化)・Blocker2(Push local-only解除)修正、a11y追加、
  純粋ロジックを `utils/accountDeletionFlow.js` へ切り出し unit test 12件。vitest/build 緑。
- Codex再レビュー（2026-07-26）: **Deliverable A（アプリ内削除UX）承認**。
  - requestIdの店舗scope化と、削除成功後のPush local-only解除を確認。前回Blocker 2件は解消。
  - dialog semantics、label関連付け、初期focus、status/alert live regionを確認。
  - 対象テスト `21 passed`、App production build成功。App全体は既知の`TEST-001`のみ1件失敗
    （58 files / 574 tests passed、1 file / 1 test failed）。PLAY-002由来の回帰なし。
  - 非Blocker残件: 保存requestIdのUUID形式検証、Service Worker未登録時もfinalizeを停止させない保証と
    local-only Push解除/finalizeの結合テスト、focus trap。
- 再レビュー残件の対応(2026-07-26): ①保存requestIdのUUID形式検証、②`unsubscribePushLocal`を
  `getRegistration()`化しSW未登録でのfinalize hangを回避。テスト計15緑・build成功。focus trapは据え置き。
- Codex追再レビュー（2026-07-26）: 上記2点を承認。Workerと同一のUUID形式、SW未登録時の即時完了、
  browser購読のlocal-only解除を確認。削除経路24 tests passed、App build成功。App全体は既知の
  `TEST-001`のみ失敗（59 files / 577 tests passed、1 file / 1 test failed）。
  - 低優先残件: Push非対応環境でも購読表示keyを必ず消すこと、およびremote API未呼出しをspyで固定するtest。
- 低優先残件の対応(2026-07-26): A=非対応環境でも購読表示keyを掃除（早期returnより前へ）、
  B=`apiFetch`未呼出しをモックで固定＋非対応環境testを追加（usePush.local 計3）。計16緑・build成功。
- Codex最終確認（2026-07-26）: 上記2点を承認。削除経路25 tests passed、App build成功。
  App全体は578 tests passed、既知`TEST-001`のみ1件失敗。Deliverable Aに追加指摘なし。
- Deliverable B 実装(レビュー待ち 2026-07-26): 公開Web削除ビュー。`App.vue` onMounted で `?delete-account`
  検出→`DeleteAccountPage.vue`（未ログインは店舗コード+PIN ログイン→承認済み `DeleteAccountModal` 再利用→
  完了表示）。build 成功・削除 unit test 16 緑。privacy/terms/support URL は設定値化（PLAY-003 確定待ち）。
- Deliverable B Codex独立レビュー（2026-07-26）: **changes requested**。
  - 公開routeの優先判定、未loginからの認証、承認済み削除flow再利用は妥当。
  - 修正1: `APP_NAME='棚卸管理'`をGoogle Play listing/PWA/法務文書の正式名「タナオロ」と一致させる。
  - 修正2: 新規route/viewの専用回帰test（未認証でのroute優先表示、login入力/遷移）を追加する。
  - 公開前gate: `PLAY-003`でprivacy/terms/supportのHTTPS URLと、7日tombstone/receipt、D1 backup、
    security recordの保持文面を確定・反映する。
  - 検証: App 582 tests passed、既知`TEST-001`のみ1 failed。production build成功。
    local URLのHTTP応答は確認、browser接続なしのため目視/click/mobile実機は未実施。
- Deliverable B レビュー対応(2026-07-26): 修正1=`APP_NAME`を manifest と同じ「タナオロ」へ（公開ページのみ。
  AuthPage/HomeScreen の「棚卸管理」表記は混在のままで統一は `PLAY-004`／User 判断）。修正2=URL判定を
  `utils/startupRoute.js` へ切り出し、`startupRoute.test.js` 7件＋`DeleteAccountPage.login.test.js` 3件を追加
  （@vue/test-utils は導入せず描画非依存でテスト）。削除経路 5 files / 35 tests passed・build 成功。
- 画面レベル回帰への作り直し(2026-07-26): 「描画せずcomposableを直接呼ぶだけ」という指摘を受け全面改訂。
  `vitest.config.js` に既存devDependencyの `@vitejs/plugin-vue` を追加＋`virtual:pwa-register/vue` を
  `src/test-stubs/` へ alias し、`createApp`+jsdom で実mount（@vue/test-utils は非導入）。
  `DeleteAccountPage.login.test.js` 5件（入力→ログインclick→削除対象表示→削除モーダル起動、失敗時非遷移）、
  `App.deleteRoute.test.js` 3件（未ログイン/ログイン済みでの `?delete-account` 優先表示、無指定時は非表示）。
  App 63 files / 597 passed（既知`TEST-001`のみ1件失敗）、Worker 191 passed、build 成功。
- 残り: 🖐実機UI、focus trap(全モーダル共通課題)、privacy/terms/support の確定URL反映（PLAY-003依存）。
- 完了条件:
  - account設定から見つけやすく、対象店舗と削除dataを明示する。
  - 再認証、誤操作防止、進行中、失敗、再試行、完了状態を扱う。
  - appをinstallしていなくても使える公開Web resourceを用意する。
  - privacy/terms/supportへの導線とmobile accessibilityを確認する。
  - Codexが認可・data削除・表示内容を独立reviewする。

### PLAY-003 — Data Safety・privacy・第三者SDKの整合監査

- 主担当: Codex。Claude Codeは公開画面と文言を反映する。
- 対象: PostHog、Push、位置情報、camera/microphone、upload、token、localStorage、log。
- 完了条件:
  - data typeごとに収集・利用・共有・保存・削除を一覧化する。
  - Data Safety申告案、privacy policy、実装が一致する。
  - 公開HTTPS policy URLとin-app導線を確認する。
  - 保持例外に目的と期間を明記する。

### PLAY-004 — TWA審査導線・store listing・screenshots

- 主担当: Claude Code。8/6のUI freeze後に画像を確定する。
- 完了条件:
  - TWAで価格・外部決済導線が露出しない。
  - reviewerがlogin、主要機能、account削除を確認できる。
  - store説明・画像が提出buildの実機能と一致する。
  - 実dataやsecretを含まない言語別screenshotsを準備する。
  - CodexがPlay checklistとの一致を独立reviewする。

### SEC-001 — WebSocket の参加完了前メッセージを遮断

- 着手: 2026-07-25 / Codex
- 完了: 2026-07-25 / Codex
- 根拠: `worker/src/RoomDO.js:156` の共通メッセージ処理には参加済みガードがなく、
  `join` は 173 行付近、在庫更新は 315 行付近、競合ロックは 778 行付近にある。
- 影響: ルームを知る未参加接続が更新系メッセージを送れる。空の `deviceId` は参加者上限の
  一意 ID 集計を回避する可能性がある。`conflict_lock` のホスト限定コメントと実装も不一致。
- 実装:
  - `join` 成功を Durable Object の WebSocket attachment に永続化し、`ping` 以外の
    参加前メッセージを `1008 / join_required` で拒否。
  - 空・空白 `deviceId`、二重 `join`、招待 session 不一致、偽 host token を拒否。
  - 未参加ソケットへの broadcast を遮断し、`leave` 時に認可状態を即時無効化。
  - `conflict_lock` を参加済みホスト専用にし、参加者公開値から内部rate-limit情報を除外。
- 検証:
  - `worker/src/RoomDO.joinAuth.test.js`: 33 tests passed。
  - `cd worker && npm test`: 11 files / 154 tests passed（2026-07-25）。
  - Workers runtimeに近い統合テストへの移行は、既存Node mock基盤全体を扱う `TEST-002` で継続。

### SEC-002 — 注文 upsert の店舗境界を保証

- 着手: 2026-07-25 / Codex
- 完了: 2026-07-25 / Codex
- 根拠: `worker/src/storeHandler.js:266` 以降の注文保存は
  `ON CONFLICT(id) DO UPDATE` を使うが、既存 ID の `shop_code` 所有確認がない。
- 影響: 認証済みの別店舗から既知または衝突した注文 ID を指定すると、別店舗の注文ヘッダーを
  更新できる可能性がある。
- 実装:
  - 既存order ownerを事前確認し、別店舗の同一IDを409で拒否。
  - `ON CONFLICT` 自体にも `orders.shop_code = excluded.shop_code` を付け、
    owner確認後の競合を原子的に拒否。ヘッダー成功確認前は明細を変更しない。
  - DELETEは不存在と他店舗所有を同じ404にし、HTTP routeへstatusを伝播。
- 検証:
  - 2店舗の越境POST、owner確認後の競合、同店舗再送、越境DELETE、HTTP 404をtest。
  - インメモリSQLite: 別店舗 `changes=0`、同店舗 `changes=1`、owner保持を確認。
  - `cd worker && npm test`: 11 files / 159 tests passed（2026-07-25）。

### BUG-001 — cron の存在しない列参照を修正

- 着手・完了: 2026-07-25 / Codex
- 根拠: `worker/src/pushHandler.js:115` は `sessions.updated_at` を参照するが、
  現在の sessions migrations に同列がない。
- 決定: 最終操作時刻はD1へ保存されていないため、既存の正である`started_at`を基準にし、
  開始から24時間超・7日以内のactive sessionを再開通知対象とする。
- 実装: queryを`started_at`へ整合させ、`deleted_at IS NULL`で論理削除済みsessionを除外。
- 検証:
  - 全migration 0001〜0011をNode SQLiteへ適用してcron全体を実行するtestを追加。
  - 修正前に`no such column: s.updated_at`で失敗することを確認。
  - 25時間、23時間、8日超の境界を固定し、`cd worker && npm test`: 13 files / 182 tests passed。
- 未実施: deploy、実環境変更、commit、push。
- 完了条件:
  - 「放置セッション」の基準時刻を仕様として決める。
    - query または schema を整合させる。
    - cron 全体を既存 schema で実行するテストを追加する。

### TEST-001 — 仕入先順の仕様を決め App テストを復旧

- 根拠: `deliveryImportCommit.test.js` の期待順と `localeCompare` による実装順が不一致。
- 未決: 入力順、Unicode/locale 順、正規化済み表示順のどれを製品仕様にするか。
- 完了条件: 判断を `decisions.md` に記録し、実装とテストを一致させ、App テストを全件成功させる。

### SEC-003 — Push 購読 API の認証・検証を追加

- 着手・完了: 2026-07-25 / Codex
- 根拠: `worker/src/index.js:201-209` の購読作成・削除が現在の soft auth 対象外。
- 実装:
  - 作成・削除とも対象店舗のBearer tokenを必須化。bodyはstream実測を含む8KiB上限。
  - endpointは2048文字以内の公開HTTPS URL（credential/fragment/非標準port/local・IP literalを拒否）。
  - `p256dh`はURL-safe base64の非圧縮P-256公開鍵（65 bytes / 0x04）、`auth`は16 bytesを要求。
  - endpoint ownerを確認し、UPSERTにも同一`shop_code`条件を付与。別店舗の奪取は409、DELETEは
    `shop_code + endpoint`条件で他店舗dataを変更しない。
- 検証:
  - 実装前に未認証、不正URL/keys、8KiB超、越境upsert/deleteの5失敗を確認。
  - 実SQLiteでvalidationとtenant境界、Worker routeで正常/401/400/413/409をtest。
  - `cd worker && npm test`: 13 files / 187 tests passed。
- 未実施: deploy、実環境変更、commit、push。
- 完了条件:
  - 店舗認証を必須化する。
  - endpoint、keys、payload size、許容 URL を検証する。
  - 未認証、異常 payload、別店舗操作、正常更新をテストする。

### SEC-004 — ホスト認可境界を fail-closed 化

- 着手・完了: 2026-07-26 / Codex
- 根拠: ルーム店舗確認と `RoomDO._isStoreProtected()` が D1 例外時に legacy 扱いへ倒れる。
- 実装:
  - Workerのルーム店舗確認はDB binding欠落・D1例外を503 `service_unavailable`で拒否し、DOを起動しない。
  - RoomDOは、D1で存在とPIN未設定を明示確認できた店舗だけlegacy扱い。不明・binding欠落・D1例外は
    保護店舗として扱い、有効auth tokenなしの新規host token発行を拒否する。
  - `ip_attempts`障害は認可判定ではないため従来どおりfail-openとし、店舗認可の成功要件と分離する（D-015）。
- 検証:
  - 実装前にD1例外・binding欠落でDO到達/host token発行する4失敗を確認。
  - 対象3 files / 86 tests、Worker全体13 files / 191 tests passed。
- 未実施: deploy、実環境変更、commit、push。
- 完了条件:
  - D1 障害時に保護店舗のホスト権限を新規取得できない。
  - 可用性を優先してよい読み取り処理と、閉じるべき認可処理を分離する。
  - D1 例外を注入したテストを追加する。

### SEC-005 — 無制限な店舗作成経路を整理

- 根拠: `/auth/register` と `worker/src/index.js:118-121` の legacy `/store/create` に、
  濫用防止と明確な廃止条件がない。
- 完了条件:
  - legacy 経路を廃止または明示的に保護する。
  - 登録の rate limit と bot 対策方針を決める。
  - 正常登録、過剰試行、legacy 呼び出しをテストする。

### DO-001 — 品目追加要求を休止復帰対応にする

- 根拠: `RoomDO.js:64` の `_itemAddRequests` はメモリ Map のみ。Cloudflare の
  WebSocket Hibernation では休止復帰時にインメモリ状態が失われる。
- 完了条件:
  - 応答先を attachment、device ID、または永続 storage から復元できる。
  - 未応答要求に件数上限と期限を設ける。
  - 休止復帰相当と大量未応答のテストを追加する。

### DATA-001 — 複数 D1 書き込みの原子性と入力制限を改善

- 対象: 注文、移動、棚卸完了。
- 完了条件:
  - ヘッダー・明細・完了状態が部分更新にならない。
  - payload 全体と主要文字列・配列件数の上限を server 側で強制する。
  - 中途失敗を注入し、更新前状態または一貫した再試行可能状態を確認する。

### CI-001 — `develop` の CI 方針を決定・適用

- 根拠: `.github/workflows/deploy.yml:7-10` は `main` と `claude/**` のみ。
- 未決: `develop` はテストだけか、preview も作るか。
- 完了条件: ユーザー判断を記録し、push / PR の対象と deploy 有無を workflow と文書で一致させる。

### DEP-001 — `xlsx` の high 脆弱性を解消または隔離

- 根拠: `npm audit --omit=dev` で prototype pollution / ReDoS。現行版に自動修正版なし。
- 完了条件:
  - 代替 library 移行、機能隔離、または明示的リスク受容を決める。
  - ユーザー提供ファイルの size・行列数・処理時間を制限する。
  - 実ファイル回帰テストを維持する。

### TEST-002 — App / Worker テスト責務を分離

- 根拠: `app/vitest.config.js:12` が `../worker/src/**/*.test.js` も含み、CI で重複する。
- 完了条件:
  - 各 package が単独で再現可能にテストできる。
  - Worker の runtime、D1、DO、WebSocket の重要経路に統合テストを加える。
  - account登録→削除、host/guest同期、再接続のcritical E2Eを最低1本安定実行する。
  - coverage全面導入はスプリント後でもよいが、P0/P1変更箇所の回帰testは必須。

### OPS-001 — Workers 互換日・observability・ログを整備

- 根拠: `worker/wrangler.toml:3` は `compatibility_date = 2025-01-01`。
- 完了条件:
  - 互換日をテスト付きで段階更新する。
  - observability と構造化ログ、機密値 masking、alert 対象を定義する。
  - Wrangler 3 から 4 への移行は別差分または明確な検証単位で行う。

### REF-001 — 大型コンポーネントと composable を段階分割

- 対象候補: `App.vue`、`SessionListPage.vue`、`InventoryTable.vue`、`ConfirmModal.vue`、
  `useConfig.js`、`useSync.js`、`RoomDO.js`。
- 完了条件: 先に責務と既存テスト境界を可視化し、挙動を変えない小さい差分で分割する。

### PERF-001 — フロント bundle を分割

- 根拠: build は成功するが 1 MB 超の JavaScript chunk 警告がある。
- 完了条件: 実測を取り、PDF/Excel/分析など重い機能を遅延 load し、主要導線の回帰を確認する。

### PRIV-001 — PostHog の収集内容と同意・規約を照合

- 根拠: autocapture 設定と、自由記述 feedback を分析基盤へ送るコードがある。
- 完了条件: 収集最小化、同意、保存期間、privacy policy との一致を確認し、必要なら設定を変更する。

### SEC-006 — 店舗コード・PIN・保存トークンを再評価

- 対象: `Math.random` の店舗コード、4桁 PIN、D1 と localStorage の bearer/host token。
- 完了条件: 脅威 model を作り、Web Crypto、試行制限、rotation、失効、保存方式の改善順を決める。

### DATA-002 — 履歴検索と DO/D1 の成長時設計を検証

- 対象: room result の全 snapshot 走査、同日履歴の一意性、DO の大きな単一値、
  serial な push 送信と保存期間。
- 完了条件: 実データ量の前提を定め、index・paging・保存上限・削除方針を設計する。

### DOC-001 — 現行仕様書の鮮度差を解消

- 入力: [`documentation-inventory.md`](documentation-inventory.md)
- 完了条件:
  - `要更新` の文書をコードと採用済み判断に合わせる。
  - 履歴文書は改変せず、snapshot 表示と現行文書への link だけを必要に応じて加える。
  - 「全テスト成功」などの実行事実に検証日・commit を付ける。

### CFG-001 — Claude Code の古い hook/command を可搬化

- 根拠: `.claude` 配下に `/home/user/Inventory` と旧固定ブランチを前提にした設定がある。
- 完了条件:
  - Windows と Linux の両方で、repository 相対 path から動く検証入口を用意する。
  - 失敗を `|| true` で隠さない。
  - hook の実行コストと発火条件を明文化する。

### DOC-000 — 共有監査・引き継ぎ基盤を作成

- 完了: 2026-07-25
- 成果物: `docs/quality-foundation/`、`AGENTS.md`、`CLAUDE.md` の共有導線。

### REPO-001 — ローカル生成物を `.gitignore` に追加

- 完了: 2026-07-25
- 対象: `/.wrangler/`、`/worker/dist/`、ルートの偶発的 `package-lock.json`。
- 注記: 既存ファイルは削除していない。
