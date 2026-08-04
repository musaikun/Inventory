# PLAY-003 / PRIV-001 実装整合監査

最終更新: 2026-08-04
担当: Codex
状態: code対応・回答draft作成済み、DS-02整合完了、実環境/公開前 gate の確認待ち

## 1. 目的と監査基準

Google Play の Data Safety 申告、privacy policy、account deletion、実装上の送信・保存・削除を
同じ data type 単位で照合する。`docs/export/` と dated audit は履歴として扱い、現在実装の根拠にはしない。

- 監査branch: `develop`
- 基準commit: `2a8a801`（監査開始時のHEAD。作業treeにはCI-001/PLAY-004等の未commit差分あり）
- 対象: App、Worker、D1 migrations、Durable Objects、localStorage、第三者SDK、公開legal文書
- 公式基準:
  - [Google Play Data Safety](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en)
  - [Google Play User Data policy](https://support.google.com/googleplay/android-developer/answer/10144311?hl=en)
  - [Google Play account deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en)
  - [Cloudflare D1 limits](https://developers.cloudflare.com/d1/platform/limits/)
  - [Cloudflare D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)
  - [PostHog JavaScript configuration](https://posthog.com/docs/libraries/js/config)
  - [PostHog autocapture](https://posthog.com/docs/product-analytics/autocapture)
  - [PostHog data collection controls](https://posthog.com/docs/privacy/data-collection)

Google Playでは、端末外へ送信されたdataは、開発者のserverに保存しない一時処理でも「収集」の回答対象になる。
一方、端末内だけで処理して外部へ送らないdataは収集に含めない。第三者への「共有」は、service provider等の
例外条件を契約・用途ごとに最終確認してからPlay Consoleへ入力する。

## 2. 初回判定

| 判定 | 結論 |
|---|---|
| PLAY-002画面回帰 | Deliverable Bは承認。実mountした公開route、login成功/失敗、削除対象、modal起動、通常route非干渉を確認した。 |
| PLAY-003 | **進行中。** [Data Safety回答案](data-safety-form-draft.md)と[保持文面案](privacy-retention-draft.md)を作成。公開URL、任意機能data、provider/dashboardの確定待ち。 |
| PRIV-001 | **実装対応済み・最終確認待ち。** PostHog依存、key設定、CSP送信先を除去し、analytics moduleを常時no-opに固定した。 |
| 公開可否 | 現時点は不可。§7のgateを解消し、公開buildとURLを再監査する。 |

PLAY-002承認後の横断監査で発見した、account削除後も`_data_owner`に店舗codeが残る不整合は
Claude Codeが修正した。Codexの独立再reviewでは、削除時のみ`_data_owner`を消し、logout/account切替の
境界検出を維持する実装と、成功/失敗の画面回帰testを確認した。全体検証結果は§9へ記録する。

## 3. Data flow台帳

「申告候補」はPlay Console入力の下書きであり、Userの機能・保持方針決定後に確定する。

| data / Play候補 | 取得・発生 | 送信・保存先 | 目的 | 任意性 | 現在の保持・削除 | 申告候補 / 実装根拠 |
|---|---|---|---|---|---|---|
| 店舗code・店舗名（User ID候補） | 登録/login | Cloudflare Worker / D1 / localStorage | account識別、同期 | 必須 | D1はaccount削除時に店舗を匿名tombstone化し7日後削除。local authは削除成功時に消去 | collected / app functionality。`useAuth.js`、`stores` migration、`accountDeletion.js` |
| PIN hash・auth token | 登録/login | D1、tokenはlocalStorageにも保存 | 認証・security | 必須 | token有効期間30日。account削除で全token削除 | collected / account management, security。`authHandler.js`、`constants.js` |
| 棚卸・品目・価格・注文・移動・設定・履歴 | 利用者入力/import | D1、localStorage、同期中はDurable Objects | 主機能、同期 | 必須 | D1はaccount削除まで。DOは明示終了/削除または最終activityから24時間。local業務dataはaccount境界/削除時に消去 | collected / app functionality。migrations 0001〜0010、`RoomDO.js`、`accountData.js` |
| 端末名（Personal info候補） | 利用者が任意入力 | localStorage、DO接続attachment、audit/chat、他参加者 | 複数端末の識別 | 任意 | account削除成功時にlocalStorageとmemoryを消去。logout/account切替では保持。DOはaccount削除時にpurgeし、通常時も最大200件/24時間TTL | collected / app functionality。`useDeviceId.js`、`accountData.js`、`RoomDO.js` |
| 端末ID（Device or other IDs） | browserで生成 | localStorage、DO、他参加者への同期event | 再接続・参加者識別・監査 | 自動 | account削除成功時に保存値を消去しmemory上は別IDへ交換。次回起動で新IDを保存。logout/account切替では保持。DOはaccount削除時にpurge | collected / app functionality, fraud/security候補。`useDeviceId.js`、`accountData.js`、`useSync.js`、`RoomDO.js` |
| chat自由記述（Other user-generated content） | 同期roomで利用者入力 | Durable Objects、同室参加者 | collaboration | 任意 | 最大200件。room dissolve/account削除/24時間inactivityで削除 | collected / app functionality。`ChatModal.vue`、`RoomDO.js` |
| 操作audit | 同期room操作 | Durable Objects、同室参加者 | 変更者表示・監査 | 主機能利用時 | 最大200件。room dissolve/account削除/24時間inactivityで削除 | app interactions / user content候補。`RoomDO.js` |
| Push endpoint・P-256 key・auth secret（Device or other IDs） | 通知を許可・購読 | browser push service、Worker、D1 | 通知 | 任意 | unsubscribe/account削除/失効検知までD1保持。message TTLは24時間 | collected / app functionality, developer communications。`usePush.js`、`pushHandler.js` |
| 緯度・経度・地名（Precise location） | 「現在地で天気」を利用 | localStorage、Open-Meteo、BigDataCloud | 天気・地名表示 | 任意・permission | account削除成功時に位置・cacheとmemory stateを消去。logout/account切替では保持。天気cache TTLは再取得判定1時間 | collected。第三者共有は例外条件確認。`useWeather.js`、`accountData.js` |
| camera映像・barcode | barcode scan | 端末内のZXing/browser処理 | barcode入力 | 任意・permission | upload/server保存なし | 端末内処理だけならnot collected。`BarcodeScanner.vue` |
| microphone音声・認識結果 | 音声入力 | Web Speech API実装依存、認識結果はApp入力へ | 音声入力 | 任意・permission | App側は録音保存なし。browser/OSによるremote speech processing有無はTWA実機で確定が必要 | Audio候補。`useVoice.js` |
| PDF/Excel/CSV内容 | 利用者がfile選択 | 現行App importは端末内parse。正規化された業務dataはD1保存 | 一括入力 | 任意 | 原fileのserver保存なし。正規化dataはaccount削除まで | file自体は現行UIではnot collected、入力結果は業務data。`usePdfImporter.js`、`PdfImporterModal.vue` |
| `/pdf`へ送ったPDF | App外から認証済みWorker APIを直接利用した場合 | Workerで一時parse | PDF解析 | dormant endpoint | 永続保存なし、5MB制限 | endpointを残すならFiles/Documentsの収集候補。現行App未使用。`worker/src/index.js`、`pdfParser.js` |
| IP・失敗種別・時刻 | login/room/PDF失敗時 | D1 `ip_attempts` / `login_attempts` | abuse防止 | 自動 | 判定窓15分。期限切れrowを日次cronで全体cleanupし、実保持は最長約24時間15分 | collected / security。`rateLimiter.js`、`pushHandler.js` |
| platform access/error log | Worker実行、error | Cloudflare platform | security/運用 | 自動 | `console.error`はあるが、現行`wrangler.toml`にobservabilityの明示設定なし | collected候補。OPS-001でdashboardの有効/無効・plan・payloadを確認 |
| analytics custom events / feedback自由記述 | App内call site | 送信しない | — | — | `posthog-js`を除去し、`track()`を常時no-op化。旧PostHog localStorageだけをcleanup | 現行公開buildではnot collected。`analytics.js`、`analytics.test.js` |
| account削除receipt | 削除request | D1 | 冪等replay | 削除時必須 | account識別子を含めず7日でcleanup | account非連結の運用metadata。`0011_account_deletion.sql`、`accountDeletion.js` |

## 4. Account deletion / retention整合

| 保存先 | 実装事実 | 判定 |
|---|---|---|
| D1 account data | child tableを物理削除し、`stores`を匿名tombstoneへ変更。tombstoneと匿名receiptは7日でcleanup | 実装済み |
| Durable Objects | account削除でconnection close、alarm削除、storage全削除 | 実装済み |
| Push | D1購読削除、browser購読をbest-effort解除、local flag削除 | 実装済み |
| local業務data/auth/legacy PostHog identity | 業務data・token・旧PostHog identityを削除 | 実装済み |
| `_data_owner` | `clearDeletedAccountLocalData()`が削除成功時だけ店舗codeを削除。logout/account切替では境界検出のため保持 | CC修正をCodex再review済み |
| device ID/name・位置情報 | account削除成功時にlocalStorageとmemory stateを消去。logout/account切替では保持 | D-019のApp実装・unit/画面回帰・privacy/support反映済み。表示設定だけは端末に残る |
| D1 Time Travel | Cloudflareで常時有効。現行Workers Free planは7日 | D-020と公開privacyへ反映済み。復元時に削除済みaccountを再削除するrunbook作成済み |
| rate-limit/security rows | 判定窓15分。日次cronが全account/IPの期限切れrowを削除 | 実装・targeted test済み。privacy policyは最長約24時間15分へ修正 |

Cloudflare公式仕様（2026-08-04再確認）では、D1 Time Travelは常時有効で、復元可能期間はWorkers Freeで7日、
Workers Paidで30日。D-020で現行accountをFree planと確定した。復元すると削除済みdataも復活し得るため、
通常復元を避けるだけでなく、
匿名receiptだけでは店舗codeを復元できないため、restore前に削除抑止listをD1外へ退避し、削除を再適用する
[runbook](d1-recovery-runbook.md)を作成した。maintenance modeと外部削除ledgerが未実装の間は、本番restoreを
安全に完遂できないためOPS-001の公開前gateとする。

## 5. PRIV-001: PostHog判定

### 現在の実装

- `posthog-js`を`package.json` / lockfileから除去した。
- `analytics.js`はkeyやbuild環境に関係なく`initAnalytics()` / `track()`を常時no-opに固定した。
- 旧buildが作成した`ph_*_posthog*` / `__posthog*` localStorageだけを起動時とaccount削除時に消去する。
- `.env.example`からkey例、CSPの`app.posthog.com`接続許可を除去した。
- unit testで送信処理がなく、App固有の`_device_id`はlegacy cleanupで消えないことを確認した。
- productionの実networkはcode auditだけでは証明できないため、公開buildで最終確認する。

### 推奨release方針

品質凍結期間の公開では、**PostHogを無効のまま固定**する実装にした。PostHog SDKの公式defaultでは
`autocapture:true`、`opt_out_capturing_by_default:false`であり、keyの有無だけに依存する旧構成を残さない。

将来有効化する場合は、最低限以下を同じreleaseで実施する。

1. `autocapture:false`、`capture_pageleave:false`、`disable_session_recording:true`等を明示し、custom event allowlistだけにする。
2. default opt-outと同意撤回導線を実装し、PostHogの公式opt-in/out APIへ接続する。
3. 自由記述を送らない、または個人情報を入力しない注意・masking・保持期間を定める。
4. PostHogのregion、project retention、subprocessor/DPAを確定しprivacy policyとData Safetyへ反映する。
5. 公開buildでPostHog request、localStorage、reset後のidentityをnetwork/実機確認する。

## 6. 現行privacy policyとの差分

`docs/legal/privacy-policy.md` は公開前に次を実装事実へ合わせる必要がある。

| 現行文面 | 実装との差分 / 必要対応 |
|---|---|
| 操作logを最終sessionから1年保持 | DO auditは最大200件かつ24時間inactivity、D1業務履歴はaccount削除まで。data groupを分けて記載する。 |
| access logを90日保持 | D1失敗recordは15分の判定窓＋日次cleanup（最長約24時間15分）。Cloudflare logはdashboard設定未確認で、公式上はFree 3日/Paid 7日。 |
| email請求を30日以内に対応 | 実装済みのin-app/public web即時削除、7日tombstone/receipt、D1 Time Travelを追加する。 |
| Cloudflare / Stripe / 天気providerを記載 | Stripeは未実装。PostHogは除去済み。Push service、Web Speech、camera、file処理、DO chat/device IDsが未記載。 |
| localStorageはauth・業務data・天気 | 公開privacyはdevice ID/name、`_data_owner`、Push flag、旧PostHog identity cleanupと、D-019の削除範囲へ更新済み。表示設定はaccount削除後も残ると明記。 |
| 氏名等を収集しない | 端末名やchat/feedbackの自由記述へ個人名・個人情報を入力可能。断定を弱め、入力しない注意を検討する。 |

また、VAPIDのdefault contactは `support@tanaoro.com`、legal文書の問い合わせ先は
`ss_inventory@outlook.com` で不一致。利用規約・privacy・support・VAPIDの公式連絡先をUserが1つに決める。

## 7. 公開前gate / owner

| ID | gate | owner案 | 完了証拠 |
|---|---|---|---|
| DS-01 | account削除時に`_data_owner`を削除し、logoutでは保持する回帰testを追加 | Claude Code（PLAY-002 App lane）→ Codex再review | **実装・Codex再review済み**: `clearDeletedAccountLocalData()`＋unit/公開route成功・失敗test |
| DS-02 | account削除時にdevice ID/name・位置情報/cacheも自動削除する | User決定、Claude Code UI、Codex監査 | **完了（2026-08-04再照合）**。`useDeviceId.resetLocalData()`、`useWeather.resetLocalData()`、`accountData.clearDeviceLocalData()`、unit/公開削除画面test、privacy/support/legal文面を確認 |
| DS-03 | PostHogを公開時無効固定する | User決定、Codex実装/監査 | **code・unit test済み**。公開buildのnetwork確認待ち |
| DS-04 | `login_attempts` / `ip_attempts`を15分の判定窓後の日次cronでcleanup。platform logは別確認 | Codex Worker / User OPS | **code・cron test済み**。Workers LogsはUserが有効化済み、Free保持3日を公式再確認。閲覧担当・payload/masking・alert待ち |
| DS-05 | D1の本番planとTime Travel期間を確認し、復元後再削除runbookを作る | User/OPS、Codex文書 | **Free / 7日をD-020で確定**。[runbook作成済み](d1-recovery-runbook.md)。maintenance・外部削除ledger待ち。本番0010/0011未適用 |
| DS-06 | microphoneのTWA実機挙動と外部処理を確認 | User実機、Codex申告反映 | device/browser/build情報 + network観測 |
| DS-07 | dormant `/pdf` endpointを削除するか公開機能として申告するか決定 | User決定、Codex Worker lane | code/testまたはpolicy |
| DS-08 | privacy/terms/supportの確定HTTPS URLと統一contactを決め、公開routeとアプリ導線へ反映 | User決定、Claude Code（PLAY-004） | **ページ・導線はCC実装・Codex対象review済み（2026-07-26）**: `app/public/{privacy,terms,support}.html`、Landing/設定/削除ページから相対リンク。**残: canonical host/contactのUser決定、terms正本同期、実機確認** |
| DS-09 | Stripe未実装状態に合わせlegal文面を直すか、将来機能として明確化 | User決定、Claude Code文面 | **CC対応済み（2026-07-26）**: privacyは委託先からStripe/PostHogを削除し「現在利用していません」と明記。termsの第4条を「無料提供・決済機能なし」へ改定。`legalPages.test.js`で再発を固定 |
| DS-10 | Play Console Data SafetyをUserとCodexが独立照合 | User + Codex | console回答export / screenshot |

Claude Codeからの証拠補足（2026-07-26 / PLAY-004前半・コード確認）:

- 位置情報は**自動取得しない**。セッション一覧の「📍 現在地で天気を表示」押下時のみ
  `requestGeolocation()` → `getCurrentPosition`（`SessionListPage.vue:636`、`useWeather.js:72`）。
  拒否しても棚卸の主機能は完結する。→ `DS-02` の申告文はこの前提で作成できる。
- cameraは`BarcodeScanner.vue`が直接`getUserMedia`を呼ばず、`@zxing/browser`の
  `decodeFromConstraints`が内部で取得する（第三者libraryの権限利用として申告の際に留意）。
- reviewer向けの権限・削除導線の説明は [`play-reviewer-guide.md`](play-reviewer-guide.md) §4・§5 に集約した。
- 公開legalページ（2026-07-26 / PLAY-004後半）: 本台帳と[保持文面案](privacy-retention-draft.md)を
  `app/public/{privacy,terms,support}.html` へ反映した。保持期間（token 30日 / DO 200件・24時間 /
  失敗記録 最長約24時間15分 / receipt・tombstone 7日 / D1 Time Travel Free 7日）、
  外部送信先、任意権限の発生条件、端末内データの残存と消去手順を実装どおりに記載している。
  Workers Logsは当時有効/無効が未確認だったため、条件付き表現にした。その後Userが有効化済み。
  **`DS-02` はD-019に従い、App実装・test・公開privacy/support/legal文面をaccount削除成功時の
  自動削除へ更新済み。削除失敗、logout、account切替では端末設定を保持する。**

## 8. 作業分担

### Codex

- 本台帳、[Data Safety回答案](data-safety-form-draft.md)、[privacy保持文面](privacy-retention-draft.md)を維持する。
- PostHog無効固定、security record cleanup、[D1復元runbook](d1-recovery-runbook.md)のWorker/運用側を担当する。
- Claude Codeの`_data_owner`修正、公開legal route、URL導線を独立再reviewする。
- 最終buildで第三者request・権限・削除後localStorageを実機証拠と照合する。

### Claude Code

- PLAY-002 App laneで`_data_owner`の削除整合を修正し、account削除時のみ消えるtestを追加する。
- PLAY-004後半でprivacy/terms/supportを公開HTML routeとして実装し、削除pageとアプリ内導線へ確定URLを接続する。
- Userが決めたcontactを画面文言へ反映する。D-019の端末data削除方針とStripe表記は反映済み。

### User

- security log保持・閲覧担当・alert、`/pdf`存廃を決める。
- 本番D1 plan、canonical host、公式support contactを確定する。
- TWA実機のmicrophone/権限と最終URLを確認し、Play Console回答をCodexと照合する。

## 9. 検証記録

- PLAY-002初回再review: 削除関連 6 files / 40 tests passed。
- CC変更＋Codex変更targeted確認:
  - App: `analytics.test.js`、`DeleteAccountPage.delete.test.js`、`accountData.test.js` = 3 files / 13 tests passed。
  - Worker: `rateLimiter.test.js`、`pushHandler.test.js`、`accountDeletion.test.js` = 3 files / 21 tests passed。
- clean install: App `npm ci`成功。PostHog削除後にVitest 4 / Vite 8のoptional peerを再現可能にするため
  `esbuild@0.28.0`をdevDependencyへ明示し、`npm ls vitest vite esbuild posthog-js`成功。
- Worker全体: 15 files / 195 tests passed。
- App全体: 67 files / 658 tests passed（`TEST-001`解消後）。
- App production build成功（444 modules）。500 kB超chunk警告は既知の`PERF-001`。
- `git diff --check`成功。source/package/CSP/build成果物にPostHog import、key、hostがないことを`rg`で確認。
- D-019（2026-08-04再照合）: `useDeviceId.test.js`、`useWeather.test.js`、`accountData.test.js`、
  `DeleteAccountPage.delete.test.js`で、削除成功時の端末ID/name・位置/cache消去、失敗・logout・account切替時の保持を確認。
  `legalPages.test.js`を含む対象5 files / 81 tests、App全体58 files / 502 tests、App production buildが成功。
  privacy/support/legalとData Safety draftを同じ削除範囲へ更新し、`git diff --check`も成功した。
- 公式仕様再確認（2026-08-04）: D1 Time TravelはWorkers Free 7日、Workers LogsはFree 3日。
  Google Playは端末外への送信を原則collectionに含め、account削除時は関連dataも削除対象とする。
- Cloudflare read-only preflight: Time Travel info取得成功（bookmark値は非記録）。本番D1に0010/0011の
  schemaがないことを確認し、`migrate.sh`の列挙漏れを修正。migration coverage test 1 passed。remote writeなし。
- 公開URLの実network確認は未実施。
- production secret、Cloudflare dashboard、Play Consoleは変更していない。Dashboardはbrowser未接続で確認不可。
- deploy、D1 migration適用、commit、pushは実施していない。
