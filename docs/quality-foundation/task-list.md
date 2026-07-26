# 横断改善タスクリスト

最終更新: 2026-07-26

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
| PLAY-003 | P1 | 進行中 | Codex | Data Safety・privacy・第三者SDKの整合監査 |
| PLAY-004 | P1 | 進行中 | Claude Code | TWA審査導線・store listing・screenshots |
| BUG-001 | P1 | 完了 | Codex | cron の存在しない列参照を修正 |
| TEST-001 | P1 | 完了 | Codex | 仕入先順の仕様を決め App テストを復旧 |
| SEC-003 | P1 | 完了 | Codex | Push 購読 API の認証・検証を追加 |
| SEC-004 | P1 | 完了 | Codex | ホスト認可境界を fail-closed 化 |
| SEC-005 | P1 | 未着手 | Codex | 無制限な店舗作成経路を整理 |
| DO-001 | P1 | 未着手 | Codex | 品目追加要求を休止復帰対応にする |
| DATA-001 | P1 | 未着手 | Codex | 複数 D1 書き込みの原子性と入力制限を改善 |
| CI-001 | P1 | 進行中 | Codex | `develop` でtest/buildとPages previewを自動実行 |
| DEP-001 | P1 | 未着手 | Codex | `xlsx` の high 脆弱性を解消または隔離 |
| TEST-002 | P1 | 未着手 | Codex | package test分離とcritical integration/E2E |
| OPS-001 | P1 | 進行中 | Codex | 最小observability・構造化log・互換日確認 |
| PRIV-001 | P1 | 進行中 | Codex | PostHog の収集内容と同意・規約を照合 |
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
- Codex再レビュー(2026-07-26): **Deliverable Bの画面レベル回帰を承認**。App実mount、入力event、
  login成功/失敗、削除対象表示、削除modal起動、通常route非干渉をコードとtestで照合した。
  削除関連6 files / 40 tests passed。画面回帰として追加blockerなし。
- 後続のPLAY-003横断監査で、削除成功後もlocalStorageの`_data_owner`（店舗code）が残る不整合を検出。
  Deliverable B承認は維持するが、account data削除の公開前gateとしてClaude Code修正→Codex再reviewへ戻す。
- DS-01対応(2026-07-26 / レビュー待ち): 削除完了後も`_data_owner`が残る不整合を修正。
  `accountData.js`に`clearDeletedAccountLocalData()`を追加し、`DeleteAccountModal.finalize()`から使用。
  ログアウト・アカウント切替では従来どおり`_data_owner`を残す（消すと再ログイン時に切替を検出できず、
  前アカウントのローカルデータが残るため）。
  - テスト: 修正前に公開削除ページの通しテストが`_data_owner="STOREA"`残留で失敗することを確認。
    `DeleteAccountPage.delete.test.js`新規2件（削除完了で`_data_owner`/`_shop_code`/`_auth_token`/
    requestIdが消える、503失敗時は認証と所有者を残す）＋`accountData.test.js`4件
    （削除掃除で消える、切替掃除では消さない、logoutでは残す、削除後の別accountログインで誤発火しない）。
  - 検証: 削除経路 6 files / 35 tests passed、App 64 files / 603 passed（既知`TEST-001`のみ1 failed）、build成功。
- 残り: 🖐実機UI、focus trap(全モーダル共通課題)、privacy/terms/support の確定URL反映（PLAY-003依存）、
  DS-01修正のCodex再review。
- 完了条件:
  - account設定から見つけやすく、対象店舗と削除dataを明示する。
  - 再認証、誤操作防止、進行中、失敗、再試行、完了状態を扱う。
  - appをinstallしていなくても使える公開Web resourceを用意する。
  - privacy/terms/supportへの導線とmobile accessibilityを確認する。
  - Codexが認可・data削除・表示内容を独立reviewする。

### PLAY-003 — Data Safety・privacy・第三者SDKの整合監査

- 着手: 2026-07-26 / Codex
- 主担当: Codex。Claude Codeは公開画面と文言を反映する。
- 対象: PostHog、Push、位置情報、camera/microphone、upload、token、localStorage、log。
- 監査台帳: `data-safety-audit.md`（収集・利用・共有・保存・削除・保持根拠とcode evidenceを記録）。
- 初回監査(2026-07-26 / Codex): data flow台帳、Data Safety申告候補、retention、privacy差分、
  CC/User/Codexの公開前gateを記録。`_data_owner`残存、security rowの期限なし保持、D1 Time Travel plan未確認、
  公開legal URL未実装をblockerとした。
- 実装・文書対応(2026-07-26 / Codex): `data-safety-form-draft.md`、`privacy-retention-draft.md`、
  `d1-recovery-runbook.md`を作成。PostHogを依存ごと無効化し、security rowを15分の判定窓後の日次cronで
  cleanupする実装とtestを追加。CCの`DS-01`修正は独立review済み。
- 実環境read-only確認(2026-07-26 / Codex): D1 Time Travel bookmark取得は成功（値は記録しない）。
  plan名とWorkers Logsの保存設定はCLIで取得できず、Dashboard用browserも未接続のためUser確認を残す。
  本番D1には0010/0011のtable/column/triggerがなく、未適用と確認した。remote writeは未実施。
- 残り: 公開URL/contact、端末設定保持、TWA microphone、`/pdf`存廃、Cloudflare plan/Logs、
  provider共有例外、0010/0011適用承認と公開build networkをUser/Codexで確定する。
- 完了条件:
  - data typeごとに収集・利用・共有・保存・削除を一覧化する。
  - Data Safety申告案、privacy policy、実装が一致する。
  - 公開HTTPS policy URLとin-app導線を確認する。
  - 保持例外に目的と期間を明記する。

### PLAY-004 — TWA審査導線・store listing・screenshots

- 着手: 2026-07-26 / Claude Code（前半＝TWA・reviewer導線・名称・store metadata の監査）
- 分割: 前半は監査のみ（コード変更は指摘として起票）。公開legalページとURL導線は `PLAY-003` 完了後に実装。
  screenshots は 8/6 の UI freeze 後。
- 主担当: Claude Code。8/6のUI freeze後に画像を確定する。
- 前半監査の結果(2026-07-26 / コード変更なし):
  - **TWA課金導線: 問題なし。** 価格(¥1,980/月)と決済CTAは `UpgradeModal.vue` の1箇所に集約され、
    `twaMode` で分岐して非表示。呼び出しは `App.vue:2604` の1箇所のみで `:twa-mode="isTwaApp()"` を必ず渡す。
    `STRIPE_CHECKOUT_URL` は現在空文字（`planLimits.js:41`）で他からの参照なし。TWAでは
    `LandingPage` が「無料版＋PRO契約済みログイン入口」を出すのみ。
  - **P0相当の指摘: アプリ名が5表記に分裂。** manifest=`タナオロ`／`index.html` title=`棚卸入力`／
    apple-mobile-web-app-title=`棚卸`／`AuthPage`・`HomeScreen`=`棚卸管理`／`LandingPage`・
    `StoreSetupModal`=`棚卸アプリ`／`UpgradeModal`・onboarding・公開削除ページ=`タナオロ`。
    store listing名とアプリ内表示・削除リソースの名称一致はPlay要件のため、`タナオロ`へ統一が必要。
  - **reviewer導線: 条件付きで可。** 削除導線は「設定→各種設定→アカウントの削除」で、
    `_showGeneral && isAuthenticated && !isGuest`（`SettingsModal.vue:360`）。**未ログインでは不可視**のため
    reviewer用test店舗の認証情報が必須。公開Web `?delete-account` は未ログインでも到達可でreview手順に使える。
  - **権限申告の要確認点（`PLAY-003`と突合）:** camera=`BarcodeScanner`(getUserMedia)、
    microphone=`useVoice`(SpeechRecognition)、通知=`usePush`、**位置情報=`useWeather`(geolocation)**。
    位置情報は棚卸の主機能と無関係に見えるため、Data Safety申告と機能説明の整合を要確認。
  - **store metadata:** manifest description は「音声でスピード入力・複数端末リアルタイム同期」で実機能と整合。
    icon 192/512/maskable あり。listing文言は画像確定と同時に照合する。
- 前半の実施(2026-07-26 / レビュー待ち):
  - **名称統一を実施**。`index.html`(title / apple-mobile-web-app-title)、`AuthPage.vue`、`HomeScreen.vue`、
    `LandingPage.vue`、`StoreSetupModal.vue` を `タナオロ` へ。`app/` 配下の旧表記(`棚卸管理`/`棚卸アプリ`/
    `棚卸入力`/`棚卸`)は残存0。manifest(`vite.config.js`)・公開削除ページと5表記すべてが一致した。
  - **reviewer手順書を作成**: [`play-reviewer-guide.md`](play-reviewer-guide.md)。Play Consoleへ貼る本文、
    社内実機チェック9手順、削除2経路、権限の発生条件、TWA課金非露出の根拠、未確定項目の一覧。
    test店舗のcode/PINと公開URLはUser記入待ち(`DS-08`依存)。
  - 監査の補正: cameraは`BarcodeScanner.vue`が直接`getUserMedia`を呼ばず、`@zxing/browser`の
    `decodeFromConstraints`経由。位置情報は自動取得ではなくセッション一覧の
    「📍 現在地で天気を表示」押下時のみ`getCurrentPosition`（`SessionListPage.vue:636`）。
  - 検証: App 64 files / 603 tests passed（既知`TEST-001`のみ1 failed）。production build成功。
- 後半の実施(2026-07-26 / レビュー待ち):
  - **公開legalページを実装**: `app/public/{privacy,terms,support}.html`。SPAを介さない静的HTMLで、
    未ログイン・未インストールでも到達できる。同一Pages配信のためアプリからは相対リンクで接続でき、
    canonical host未確定(`DS-08`)でも導線が完成する。
  - **配信設定**: `_redirects`へ`/privacy` `/terms` `/support`をcatch-allより前に追加（拡張子なしURLでも到達）。
    `vite.config.js`の`navigateFallbackDenylist`へ3 pathを追加し、インストール済みPWAでSPAに飲まれないようにした。
  - **文面を実装事実へ修正**: 保持期間（token 30日 / DO 200件・24時間 / 失敗記録 最長約24時間15分 /
    receipt・tombstone 7日 / D1 Time Travel 契約planに応じ最大30日）、外部送信先、任意権限の発生条件を反映。
    Stripe/PostHogを委託先から削除し「現在利用していません」と明記（`DS-09`）。旧記載の「操作ログ1年」
    「アクセスログ90日」を削除。termsの第4条を「無料提供・決済機能なし」へ改定。
  - **端末内データの消去導線**(`DS-02`): supportページに残存するデータ（端末ID・端末名・天気の位置情報）と
    Android/Chrome・PWA・iOS Safari・PCブラウザ別の消去手順を記載し、privacy §8・設定画面から接続。
  - **導線**: LandingPage下部、SettingsModal「法的情報・サポート」、公開削除ページの3か所から3ページへ。
  - 正本`docs/legal/*.md`と`landing/*.html`（+新規`landing/support.html`）にも文面を反映。
  - 検証: `legalPages.test.js` 47件（存在・viewport・外部リソースなし・contact統一・旧記載の再発防止・
    実装事実の記載・3導線・`_redirects`順序・PWA denylist）。公開削除ページの未ログイン導線test 1件追加。
    build後の`dist`に3ページと`_redirects`が出力され、`vite preview`で
    `/privacy.html` `/terms.html` `/support.html` `/?delete-account` が**未ログインでHTTP 200**を確認。
    App 67 files / 656 tests passed（既知`TEST-001`のみ1 failed）。
- Codex独立review(2026-07-26): 公開3 HTML、app内3導線、保持期間・外部送信・削除説明の主要事実を承認。
  targeted 5 files / 66 tests、App production build、`git diff --check`成功。追加blockerは次の2点。
  1. `docs/legal/terms.md`は正本と記載されるが、公開/landing termsと終了通知・免責・規約変更等の文面が未同期。
  2. `landing/index.html`の月額1,980円・解約表現は「現在無料・決済なし」のtermsと矛盾（User判断待ち）。
- 残り(前半): reviewer手順書へのtest店舗情報記入(User)。Codexによる手順書とPlay checklistの独立review。
- 残り(後半): canonical hostと統一contactのUser決定→絶対URLをPlay Consoleへ登録(`DS-08`)。
  terms正本の同期、実機でのモバイル表示確認。8/6 UI freeze後にscreenshots。
- 要User判断: `landing/index.html`は「¥1,980/月」の料金表示を含み、改定後のterms（決済機能なし）と矛盾する。
  landingはdeploy scriptの対象外だが、公開する場合は料金表示の扱いを決める必要がある。
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

- 着手・完了: 2026-07-26 / Codex（User判断: 入力順）。
- 根拠: `deliveryImportCommit.test.js` の期待順と `localeCompare` による実装順が不一致。
- 決定: 日付昇順。同一日内はCSVで仕入先が最初に登場した順を保持し、同一日・仕入先の行は
  最初の登場位置に1件の入庫レコードとして集約する（D-005）。
- 実装: group作成時の`firstSeen`を保持し、日付→初出順でsort。locale依存の仕入先名sortを除去した。
- 検証: 対象4/4、App 67 files / 658 tests、Worker 15 files / 195 testsが全件成功。
  App production build成功（444 modules）、`git diff --check`成功。
- 未実施: commit、push、deploy。
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

- 着手: 2026-07-26 / Codex
- 根拠: 旧`.github/workflows/deploy.yml`は`a79ddec`で削除済みで、現行HEADに自動workflowがない。
- 決定: `develop` pushはWorker/App testとApp buildを通過後、Pagesの`develop` previewだけを自動更新する。
  D1 migration、Worker、本番Pagesは変更しない（D-006、User承認 2026-07-26）。
- ローカル適用: `.github/workflows/develop-preview.yml`と運用文書を追加・同期。
- migration安全性review: develop workflowはD1を変更しない。手動deploy用`migrate.sh`が0010/0011を
  列挙していない不備を修正し、migration directory全件の列挙を保証するWorker testを追加した。
- 検証: 2026-07-26にWorker 195/195、App 658/658、App production buildがlocalで成功。
- 残り: commit/push後のActions実行とPages preview更新確認。
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

- 着手: 2026-07-26 / Codex（実環境はread-only確認のみ）。
- 根拠: `worker/wrangler.toml:3` は `compatibility_date = 2025-01-01`。
- 確認(2026-07-26): remote Workerも`compatibility_date = 2025-01-01`。repository設定に
  `observability` sectionはなく、Wrangler CLIから保存済みWorkers Logs設定とaccount planは判定できなかった。
  D1 Time Travel infoは成功したが、plan名は返らない。Dashboard確認をUser gateとして残す。
- migration preflight: 本番D1で0010/0011未適用を確認。`migrate.sh`へ両fileを追加し、全migrationを
  順序どおり列挙する`worker/test/migrationScript.test.js`を追加（targeted 1 passed）。remote適用はしていない。
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

- 着手: 2026-07-26 / Codex（PLAY-003の第三者SDK監査と同じ証拠台帳で実施）。
- 根拠: autocapture 設定と、自由記述 feedback を分析基盤へ送るコードがある。
- 初回監査: 現行tracked build設定では`VITE_POSTHOG_KEY`未注入でno-op。ただしkey設定時は
  `autocapture` default=true、default opt-in、自由記述feedback送信となる。品質凍結期間は無効固定を推奨し、
  有効化する場合は明示off/allowlist、同意・撤回、保持期間、policy/Data Safetyの同時整備をgateとする。
- 対応(2026-07-26 / Codex): `posthog-js`依存、key例、CSP接続先を除去し、analytics moduleを
  build環境に関係なく常時no-op化。旧PostHog storageだけをcleanupするtestを追加。
- 残り: 公開buildでPostHog requestがないことをnetwork確認し、Data Safety/公開policyを最終照合する。
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
