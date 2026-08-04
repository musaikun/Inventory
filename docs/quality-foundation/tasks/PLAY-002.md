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
- D-019 App実装(2026-08-02 / Claude Code / レビュー待ち): 端末固有データの自動削除を実装。
  - `useDeviceId.js`に`resetLocalData()`を追加。`_device_id`/`_device_name`を消し、`deviceId`は
    **メモリ上だけ新しい値へ差し替える**（`export const`→`export let`のlive binding）。永続化はしないため、
    次回起動で通常の初期化経路が新IDを採番・保存する（＝新規インストールと同じ状態）。
    メモリ上を空にせず差し替えるのは、削除後も同期・監査ログが送信元IDを参照するため。
    削除済みaccountのIDを送り続けることも、IDが空になることも避ける。
  - `useWeather.js`に`resetLocalData()`を追加。`weather_loc`/`weather_cache`に加え、
    module scopeの`state`（`loc`/`weather`/`updatedAt`/`error`/`loading`）も初期化する。
    stateを戻さないとリロードするまで前の位置・天気が表示され続けるため。
  - `accountData.js`に`clearDeviceLocalData()`を追加し、`clearDeletedAccountLocalData()`の`finally`から呼ぶ。
    片方が例外でももう片方の消去を試みる。`clearLocalAccountData()`（logout/account切替）には含めない。
  - 失敗時の保持: `finalize()`は200 deleted / alreadyDeleted の後にしか呼ばれないため、
    503・409・通信失敗では認証・業務data・端末設定がすべて残り、同一requestIdで再試行できる。実装変更なし。
  - 削除UX: 入力フォームの削除対象一覧へ「この端末の設定（端末名・端末ID・天気の位置情報）」を追加し、
    最終確認画面にも端末設定が消える旨を明記した。
  - テスト（実装を`git stash`した状態で**9件が失敗**することを確認済み）:
    - 新規`useDeviceId.test.js` 5件（初期化2・reset 3）、新規`useWeather.test.js` 3件。
    - `accountData.test.js` +3件（削除で消える／切替では消さない／logoutでは残す）。
    - `DeleteAccountPage.delete.test.js` +3件（画面レベル: 削除完了で端末dataが消える／503失敗で保持／
      確認画面の文言）。
  - 検証: 対象4 files / 25 tests passed。App 56 files / 481 tests passed。
    Worker 15 files / 196 tests passed。App production build成功（precache 2076.40 KiB）。
  - **同一release内の未完**: 公開`privacy.html:249`「アカウントとは独立した端末の設定として、ブラウザの
    サイトデータを消去するまで端末内に残ります」と`privacy.html:291`、および`support.html`の該当記述が
    実装と矛盾する状態になった。D-019の実装境界どおり、privacy/support/landing/正本`docs/legal/*`と
    Data Safety申告を自動削除の説明へ更新してから公開する必要がある。`legalPages.test.js`は
    `端末ID`の存在しか見ていないため、この矛盾を検出できない（アサーション追加が要る）。
## UI・アクセシビリティ(2026-08-04 / Claude Code / code review済み・実機待ち)

分担: Claude Codeが主担当（UI・a11y）。Codexは独立reviewとdata削除検証。進捗ボード上の担当はClaude Code。

- **focus trap を実装**: `composables/useFocusTrap.js` を新規追加し `DeleteAccountModal` へ適用。
  `role="dialog" aria-modal="true"` だけではブラウザは Tab の移動範囲を制限しないため、
  トラップ無しでは**削除処理中に背後の画面を操作できる**状態だった。
  - 可視性（`offsetParent`/`display`）では絞らない。局面ごとに `v-if` で要素そのものを差し替える構造のため
    「DOMにある＝操作できる」で判定してよく、jsdomでは `offsetParent` が常に null になるため。
  - `keydown` は capture で受け、他のハンドラより先に Tab を処理する。
- **フォーカス復帰**: モーダルを開く直前の `document.activeElement` を保持し、`onUnmounted` で戻す。
  元の要素がDOMから消えている場合（削除完了で導線ごと消えるなど）は何もしない。
- **局面切り替え時のフォーカス移動**: 局面が変わると前局面の要素は `v-if` で消え、フォーカスが body へ落ちる。
  `watch(phase)` で新しい局面の先頭へ移す。処理中は操作対象が無いため、`tabindex="-1"` を付けた
  ダイアログ自身へフォーカスを移して外へ出さない。
- **誤操作防止**（既存挙動を回帰testで固定）: 処理中・完了表示ではESCとoverlayクリックで閉じない。
- **375px対応**: 長さを制御できないテキスト（店舗名・サーバー由来のエラー文）が横へはみ出さないよう
  `overflow-wrap: anywhere` を付与。`.da-actions .btn` に `min-width: 0` を追加（flex itemは
  これが無いと内容幅より縮まず、狭い端末で行から溢れる）。`.btn` の `line-height: 1` は
  折り返し時に文字が重なるため 1.35 へ戻した。`DeleteAccountPage` の店舗名・エラー文にも同様の対策。
- **文面の不整合を修正**: `SettingsModal` の「この端末に残るデータ（端末ID・端末名・天気の位置情報）の
  消去方法は…」がD-019の実装と矛盾していたため、「アカウント削除時に自動で消去される」旨へ改めた。
- 確認済みだった点: 公開ページの店舗コード入力は `[^A-Z]` を除去する正規化で、
  Workerの発行規則（`ABCDEFGHJKLMNPQRSTUVWXYZ` 6桁・数字なし）および `AuthPage.vue:75` と一致している。
- 検証:
  - 新規 `DeleteAccountModal.a11y.test.js` 12件（フォーカス管理6・誤操作防止4・dialogセマンティクス2）。
    実装を`git stash`した状態で**7件が失敗**することを確認（残り5件は既存挙動の回帰固定）。
  - App 59 files / 514 tests passed。App production build成功（precache 17 entries / 2474.95 KiB）。
  - `vite preview` で未ログインのHTTP応答を確認: `/?delete-account` `/privacy.html` `/terms.html`
    `/support.html` と拡張子なしの `/privacy` `/terms` `/support` がすべて **200**。
    配信物の `support.html` から「残るもの」表の端末ID行が消え、自動削除の記載が入っていることも確認。
- 未対応: canonical URL/contact確定後の絶対URL反映（`DS-08`待ち）。実機での目視・タップ確認（下記手順）。

## Data削除境界の独立review（2026-08-04 / Codex）

- **client cleanupを補強**:
  - `clearLocalAccountData()`をbest-effort化し、1つのcomposable resetが例外でも後続data・識別子を消し続ける。
  - `useStore.resetAccountData()`で旧店舗の未送信config/inventory/history/order/movement queueとretry timerを破棄。
    境界前に開始した通信が遅れて失敗してもgeneration guardでqueueを復活させない。
  - `useSync.resetAccountData()`でWebSocket、再接続timer、参加者・message・audit・競合dataを消去。
  - `useWeather`のfetch、逆geocode、位置情報callbackをgeneration/位置で失効させ、削除後に
    `weather_loc` / `weather_cache` / memory stateが復活するraceを防止。
- **Cache API / Service Worker監査**:
  - Workbox runtime cacheはfontとPDF cMapだけ、precacheはapp shell/static assetだけ。
  - `push-sw.js`は通知表示・clickだけを扱い、Cache API / IndexedDB / localStorageを使用しない。
  - account/API dataはbrowser cacheへ保存されないため、account削除時にSW解除や静的cache削除は不要。
    `accountDeletionCachePolicy.test.js`で方針を回帰固定した。
- **Worker / D1 / DO再照合**:
  - 公開Workerは `/room/:code/(dissolve|status|ws)` だけをDOへ転送し、DO内部削除pathは外部から到達しない。
  - stock/orderの2 DOでsocket close、`deleteAlarm()`、`deleteAll()`を実行。現行compatibility dateが
    2026-02-24より前でもalarmを明示削除している。
  - D1は`deletion_pending_at`で通常accessを遮断し、migration `0011`の全account-keyed INSERT triggerが
    認証通過済み遅延requestによる削除後のdata再生成も拒否する。追加Worker変更は不要と判断。
- **CC UI差分の独立review**:
  - focus trap、局面切替時focus、focus復帰、ESC/overlay防止、375px折返しは実装・testとも妥当。
  - **Android/browser Back blocker解消（2026-08-04 / Codex）**:
    `DeleteAccountModal`が現在のBack handlerを登録し、App共通制御がそれを消費する配線を追加した。
    入力・最終確認・errorでは既存closeを呼び、`deleting`・`done`ではmodalを維持してsentinelを再投入する。
    設定内のglobal stateと公開削除pageのlocal stateを同じmodal callbackで扱い、phaseをAppへ漏らさない。
    `App.deleteBack.test.js` 3件と`appMenuState.test.js` 3件で実結合・登録解除競合を回帰固定した。
- **検証**:
  - data削除境界の追加・関連client test: 5 files / 27 tests passed。
  - Back/UI関連: 5 files / 28 tests passed。
  - App全体: 63 files / 531 tests passed。
  - Worker全体: 15 files / 196 tests passed。
  - App production build成功（448 modules、PWA precache 17 entries / 2476.36 KiB）。
  - `git diff --check`成功。deploy、migration適用、commit、pushは未実施。
- **判定**: Codex担当の認可・data削除・Cache/SW境界、CCのUI/a11y差分、Back制御のcode reviewは承認。
  PLAY-002はcanonical URL/contact確定とUser実機確認が残るため、進行中を維持する。

### 実機確認手順（375px相当・User実施）

対象は Android Chrome または iOS Safari の実機、もしくは DevTools のデバイス эмуレーション（iPhone SE / 375×667）。
**reviewer用ではなく破棄してよいtest店舗**で行う（削除すると7日間は同じ店舗コードで再ログインできない）。

**A. アプリ内の削除導線**

1. test店舗でログインし、「ダッシュボード」タブ →「各種設定」を開く。
2. 画面下部までスクロールし、赤枠の「アカウントの削除」区画が**スクロールだけで見つかる**こと。
3. 「アカウントを削除する…」をタップ。モーダルが下から出ること。
4. 削除対象の**店舗名と店舗コードが読める**こと（折り返して枠外へ出ていない）。
5. 削除対象の一覧に「この端末の設定（端末名・端末ID・天気の位置情報）」が含まれること。
6. PIN欄に自動でフォーカスが当たり、**数字キーボード**が出ること。
7. 店舗コード欄に小文字で入力しても**大文字へ変換**されること。
8. 4桁未満のPIN、または店舗コード不一致では「削除に進む」が**押せない**こと。
9. 「削除に進む」→ 最終確認画面に「端末の設定も消去される」旨が出ること。
10. 「戻る」で入力画面へ戻れること。

**B. 誤操作防止（Aの続き）**

11. 「完全に削除する」をタップ後、処理中の表示になること。
12. 処理中に**画面外（オーバーレイ）をタップしても閉じない**こと。
13. 処理中に端末の戻る操作をしても、削除が中断されないこと。
14. 完了表示が出たら「閉じる」でランディング画面へ戻ること。

**C. 失敗時（機内モードで再現）**

15. 機内モードにしてから「完全に削除する」をタップ。
16. エラー文が**枠内に収まって**表示され、「再試行する」が出ること。
17. 機内モードを解除して「再試行する」→ 削除が完了すること。
18. 失敗した時点では**まだログイン状態が保たれている**こと（アカウント切替やデータ消失が起きていない）。

**D. 公開Web削除ページ（未ログイン）**

19. **ログアウト状態またはシークレットウィンドウ**で `<公開URL>/?delete-account` を開く。
20. アプリ名「タナオロ」と削除対象の説明が読めること。
21. 店舗コード・PINを入力してログイン → 削除対象アカウントが表示されること。
22. 画面下部の「プライバシーポリシー」「利用規約」「お問い合わせ」の3リンクが**未ログインでも開ける**こと。
23. 以降は A-3 以降と同じ。

**E. キーボード操作（PC or Bluetoothキーボード）**

24. モーダルを開いた状態で Tab を連打し、**フォーカスがモーダルの外へ出ない**こと。
25. Shift+Tab でも同様に循環すること。
26. Escape でモーダルが閉じ、**開く前のボタンへフォーカスが戻る**こと。
27. 処理中は Escape で閉じないこと。

記録: 実施日・端末・OS・ブラウザ版と、NGがあれば番号と症状をこのファイルへ追記する。

- 完了条件:
  - account設定から見つけやすく、対象店舗と削除dataを明示する。
  - 再認証、誤操作防止、進行中、失敗、再試行、完了状態を扱う。
  - appをinstallしていなくても使える公開Web resourceを用意する。
  - account削除完了時に端末ID・端末名・天気用位置情報を消去し、失敗時には認証・端末dataを保持する。
  - privacy/terms/supportへの導線とmobile accessibilityを確認する。
  - Codexが認可・data削除・表示内容を独立reviewする。
