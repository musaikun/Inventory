# PLAY-002 — in-app削除UXと公開Web申請導線

- 状態の正本は [`../task-list.md`](../task-list.md)

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
- DS-01のCodex独立review(2026-07-26): 承認済み。`_data_owner`はaccount削除成功時だけ消し、
  logout/account切替では保持する設計を確認。途中cleanupが例外でも owner削除を必ず試すよう
  `clearDeletedAccountLocalData()`を`finally`で補強した。
- 残り: 🖐実機UI、focus trap(全モーダル共通課題)、privacy/terms/support の確定URL反映（PLAY-003依存）、
  ~~DS-01修正のCodex再review~~ → 2026-07-26に完了（上記の「DS-01のCodex独立review」を参照）。
- User判断(2026-08-01): account削除時は端末ID・端末名・天気用位置情報も自動削除する。
  現行`clearDeletedAccountLocalData()`はこれらを保持するため、実装・test・privacy/support文面の更新が未完。
- 完了条件:
  - account設定から見つけやすく、対象店舗と削除dataを明示する。
  - 再認証、誤操作防止、進行中、失敗、再試行、完了状態を扱う。
  - appをinstallしていなくても使える公開Web resourceを用意する。
  - account削除完了時に端末ID・端末名・天気用位置情報を消去し、失敗時には認証・端末dataを保持する。
  - privacy/terms/supportへの導線とmobile accessibilityを確認する。
  - Codexが認可・data削除・表示内容を独立reviewする。
