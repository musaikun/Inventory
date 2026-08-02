# PLAY-004 — TWA審査導線・store listing・screenshots

- 状態の正本は [`../task-list.md`](../task-list.md)
- **統合**: TWA価格表示・無料版2台制限（D-016の公開面への反映）は新規IDを作らず本タスクで扱う。

- 着手: 2026-07-26 / Claude Code（前半＝TWA・reviewer導線・名称・store metadata の監査）
- 分割: 前半は監査のみ（コード変更は指摘として起票）。公開legalページとURL導線は `PLAY-003` 完了後に実装。
  screenshots は 8/6 の UI freeze 後。
- 主担当: Claude Code。8/6のUI freeze後に画像を確定する。

## 前半監査の結果(2026-07-26 / コード変更なし)

- **TWA課金導線: 問題なし。** 価格(¥1,980/月)と決済CTAは `UpgradeModal.vue` の1箇所に集約され、
  `twaMode` で分岐して非表示。呼び出しは `App.vue:2604` の1箇所のみで `:twa-mode="isTwaApp()"` を必ず渡す。
  `STRIPE_CHECKOUT_URL` は現在空文字（`planLimits.js:41`）で他からの参照なし。TWAでは
  `LandingPage` が「無料版＋PRO契約済みログイン入口」を出すのみ。
  ※この監査時点の構成。2026-07-28のD-016対応で `twaMode` 分岐ごと撤去された（後述）。
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

## 前半の実施(2026-07-26 / レビュー待ち)

- **名称統一を実施**。`index.html`(title / apple-mobile-web-app-title)、`AuthPage.vue`、`HomeScreen.vue`、
  `LandingPage.vue`、`StoreSetupModal.vue` を `タナオロ` へ。`app/` 配下の旧表記(`棚卸管理`/`棚卸アプリ`/
  `棚卸入力`/`棚卸`)は残存0。manifest(`vite.config.js`)・公開削除ページと5表記すべてが一致した。
- **reviewer手順書を作成**: [`../play-reviewer-guide.md`](../play-reviewer-guide.md)。Play Consoleへ貼る本文、
  社内実機チェック9手順、削除2経路、権限の発生条件、TWA課金非露出の根拠、未確定項目の一覧。
  test店舗のcode/PINと公開URLはUser記入待ち(`DS-08`依存)。
- 監査の補正: cameraは`BarcodeScanner.vue`が直接`getUserMedia`を呼ばず、`@zxing/browser`の
  `decodeFromConstraints`経由。位置情報は自動取得ではなくセッション一覧の
  「📍 現在地で天気を表示」押下時のみ`getCurrentPosition`（`SessionListPage.vue:636`）。
- 検証: App 64 files / 603 tests passed（既知`TEST-001`のみ1 failed）。production build成功。

## 後半の実施(2026-07-26 / レビュー待ち)

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

## 料金方針（D-016）の公開面への反映 — 統合項目

- 料金方針対応(2026-07-28 / Codex): UserがD-016を採用。無料でも1店舗コードを発行し、2台・150品目・
  履歴直近3回とした。14日/3か月トライアルと自動課金を撤回し、将来のWeb PROを月額2,980円とした。
  `LIMITS_DISABLED`とlocalStorage PRO自己申告、Workerの14日トライアル算出、アプリ内旧価格・決済導線を撤去。
  landing、公開/正本terms、support、reviewer guideを同期した。上限は主にApp側で実装され、
  Freeの2台制限はserver-sideで未強制（下記P1）。Stripeは将来タスク。
  → 上記Codex review指摘2（landing ¥1,980 と terms の矛盾）はこの対応で解消。
- **Play課金誘導表現の除去**(2026-07-28 / Claude Code):
  - 判断根拠: Play Billingの義務は「アプリ内でデジタル商品を販売する場合」に発生する。決済導線・外部リンクは
    ゼロ（`app/src` に `href="http(s)://` の一致なし）で課金ポリシー違反には当たらない。残るリスクは
    **契約手段が存在しないPROの利用を促す誤認表示**であり、事実の告知へ置換して解消した。
  - `App.vue` 3か所: 「さらに登録するにはPROプランをご利用ください」→
    「無料プランの上限（150品目）に達しました。上限の緩和は将来提供予定です。」
  - `SessionListPage.vue`: 「過去N件の履歴はPROプランで閲覧できます」→「〜は無料プランでは表示されません」。
    **「アップグレード」ボタンを「詳しく」へ改称**（購入動作を示唆するCTAだった）。
  - 非対象: `UpgradeModal.vue`（Codexが価格・CTA撤去済み）、接続端末数の警告（`App.vue:225`。元から事実告知のみ）。
  - 検証: App 67 files / 657 tests passed。production build成功（precache 2075.73 KiB）。
    文言に依存するtestが存在しないことをgrepで確認済み。
- **無料枠の実装整合（P1・未修正）**: `LIMITS_DISABLED = !_IS_TEST` により従来buildは
  `isPro()===true`だったため、無料枠UIは2026-07-28の対応後に初めて有効になった。
  - 2台制限: `App.vue`は参加前に、参加しようとする端末の`participantList.length`を確認している。
    新規端末では通常0件のため3台目も通過し得る。Workerの`RoomDO`はplanを見ず一律20台まで許可するため、
    **利用規約の「2台」と実装が一致していない**。
  - 品目150件: Appの追加導線とCSV取込でcapする。150件超の既存店舗がCSVを再取込すると、
    `_capForPlan()`により151件目以降が切り捨てられる。
  - 履歴直近3回: Appの表示上限として実装。従来1回からの緩和。
  - 2台制限をserver-sideで有効化する前に、既存の3台以上利用店舗を猶予するかUser判断を記録する。
- **将来Pro販売時の設計前提**: `isTwaApp()`（`app/src/utils/appMode.js`）は `?twa=1` で誰でも詐称でき、
  localStorage消去で false にもなりうる。**「Webだけ価格を出す」分岐は判定ミスが即ポリシー抵触になる**ため、
  Play Billing実装か、アプリ内でProに一切触れないかの二択とする。

## 残り

- 前半: reviewer手順書へのtest店舗情報記入(User)。Codexによる手順書とPlay checklistの独立review。
- 後半: canonical hostと統一contactのUser決定→絶対URLをPlay Consoleへ登録(`DS-08`)。
  実機でのモバイル表示確認。8/6 UI freeze後にscreenshots。
- **terms正本の同期（Codex review指摘1・未解消）**: `docs/legal/terms.md` と公開/landing terms の
  第6条3・第7条2/5・第11条3（終了通知・免責・規約変更）に文面差が残る。第4条は2026-07-28に同期済み。
  正本を公開HTML側へ寄せる方向（連絡先を保持しない実装のため「通知」ではなく「掲示」が履行可能）。
  併せて `legalPages.test.js` へ条文単位の同期チェックを追加する（現在は事実キーワードのみで差分を検出できない）。
- **User判断**: ①terms第4条の「月額2,980円」表記を残すか、金額を落として「提供開始時に別途掲示」に留めるか
  （アプリ内から到達する法務ページに価格が載る状態。購入導線がないため通常は問題ないが、完全に安全側へ倒す選択肢）
  ②Play Consoleの「アプリ内購入」申告を**なし**に合わせる
  ③購入手段がない以上、上限到達でPROモーダルを開く体験自体の是非（トースト等へ変更するか）

## 完了条件

- TWAで価格・外部決済導線が露出しない。
- Free店舗の3台目をWorker側で拒否し、Pro Review・同一端末再接続は拒否しない自動testを追加する。
- reviewerがlogin、主要機能、account削除を確認できる。
- store説明・画像が提出buildの実機能と一致する。
- 実dataやsecretを含まない言語別screenshotsを準備する。
- CodexがPlay checklistとの一致を独立reviewする。
