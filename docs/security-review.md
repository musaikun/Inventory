# セキュリティレビュー — 飲食店棚卸システム

| Field | Value |
|---|---|
| Status | **Current security baseline**。W1 Web Free版は未公開判定 |
| Role | 実装済みsecurity境界と、Web公開前に閉じるgapの台帳。公開可否は[Web release gate](quality-foundation/web-release-readiness.md)を正とする |
| Source of truth | Worker/App code、migration、関連test、[task board](quality-foundation/task-list.md)、[decisions](quality-foundation/decisions.md) |
| Last verified | **2026-10-02 / `develop@49227ff`**（repository baseline。production状態はrelease前に再probeする） |

## 現行baseline

### 実装済みの境界

| 境界 | 現行実装 | 根拠 |
|---|---|---|
| PIN / token | 新規PINはPBKDF2-SHA-256（100,000反復・random salt）。旧SHA-256はlogin成功時に移行。Bearer tokenは30日、login成功時は同店舗の既存tokenを失効。2026-10-08からD1にはtokenのSHA-256（`h1:`）だけを保存し、生で保存した旧tokenは失効まで併用で照合（保存値そのものは照合に使わない）。**Workerを2026-10-08以前の版へ戻すと、それ以降に発行したtokenは無効になり再ログインが要る** | [`authHandler.js`](../worker/src/authHandler.js) |
| 総当たり | 店舗単位15分5失敗（2026-10-09から、ログインに成功したことのある端末＝信頼済み端末はその端末の失敗だけで数え、鍵の無い端末の失敗は店舗全体で数える。第三者の失敗で店主が締め出されない。上限に達したら店主・管理者の端末へ通知）、IP単位15分30失敗、登録はIP単位1時間5回（成否を問わず）。rate-limit table障害は補助制御としてfail-openだが、認証・店舗存在・host権限のD1照会はfail-closed | [`constants.js`](../worker/src/constants.js)、[`rateLimiter.js`](../worker/src/rateLimiter.js)、D-015 |
| HTTP tenant境界 | PIN設定店舗のconfig/inventory/history/room/orders/movementsは同店舗Bearerを要求。sessions/pushはstrict auth。order ownerは事前確認とconditional upsertで越境更新を拒否 | [`index.js`](../worker/src/index.js)、[`storeHandler.js`](../worker/src/storeHandler.js) |
| WebSocket | Workerがactive店舗をD1確認してからDOへ転送。join前はping以外を遮断し、PIN設定店舗のhost再発行は同店舗Bearer必須。D1障害・binding欠落は503/auth失敗で閉じる | [`RoomDO.js`](../worker/src/RoomDO.js)、[`RoomDO.joinAuth.test.js`](../worker/src/RoomDO.joinAuth.test.js) |
| guest data | 進行中WSのguest configから単価を除去し（キーごと。2026-10-08から金額を見られないスタッフのhostにも）、未参加socketにはbroadcastしない。金額（`money`）の無いスタッフにはHTTPでも単価・在庫金額を返さない。完了後の共有resultはUser判断により単価・小計・合計金額を含む。店舗code + session UUIDのURLを知る人が3日間閲覧できる | [`RoomDO.js`](../worker/src/RoomDO.js)、[`storeHandler.js`](../worker/src/storeHandler.js)、[`room-url-design.md`](room-url-design.md) |
| account削除 | Bearer + PIN + 店舗code + UUID requestId。削除中は通常accessを遮断し、stock/order DOの接続・alarm・storageを破棄後、D1関連data/tokenをbatch削除。匿名receipt/tombstoneは7日 | [account deletion contract](quality-foundation/account-deletion-contract.md)、[`accountDeletion.js`](../worker/src/accountDeletion.js) |
| payload / Push | config/inventory/history/order/movementは約1MB guard。Pushはstrict auth、8KiB、HTTPS endpoint/key形式、owner境界。`/pdf`は2026-10-08廃止 | [`index.js`](../worker/src/index.js)、[`storeHandler.js`](../worker/src/storeHandler.js)、[`pushHandler.js`](../worker/src/pushHandler.js) |
| 品目写真 | upload/deleteはstrict同店舗Bearer。thumb 64KiB/full 700KiB、JPEG/WebPの実byteを検証し、非公開R2へ保存。readは`<store>/<128-bit id>/<variant>`を鍵とする無認証URLで1年cache。account削除は店舗prefixをpurgeする | [`imageHandler.js`](../worker/src/imageHandler.js)、[`imageHandler.test.js`](../worker/src/imageHandler.test.js) |
| browser policy | Pages sourceにCSP、`nosniff`、frame拒否、referrer/permission policyがある。scriptはself、接続先はWorker、weather、PostHog EUへ限定 | [`_headers`](../app/public/_headers) |
| PostHog | SDKは3つのbuild条件（enabled/key/EU host）と明示同意が揃う場合だけ遅延初期化し、custom event/property allowlistを二重検証。自動capture/replay/error/logはoff | [`analytics.js`](../app/src/utils/analytics.js)、[`PRIV-001`](quality-foundation/tasks/PRIV-001.md) |

### repository CORSとproduction確認

- repositoryの`isAllowedOrigin()`はallowlist完全一致、旧project suffix、localhostだけを許可し、
  未知Originを403で拒否する。許可Originだけを`Access-Control-Allow-Origin`へ反映する回帰testがある。
- `worker/wrangler.toml`は`inventory-app-c40.pages.dev`、`develop.inventory-app-c40.pages.dev`を
  明示allowlistへ含める。2026-08-29の記録では固定originとpreview originの200を確認した。
- これは現在のrelease candidateのproduction証拠ではない。canonical確定後、対象SHAのWorker deployと
  許可/拒否Originの実probeをWEB-02で再実行する。

## Web公開前の既知gap

| 優先 | Gap / release影響 | 追跡先 |
|---|---|---|
| P0 | canonicalとrelease candidateを固定し、productionの許可/拒否Originを対象SHA付きで再確認していない | [`WEB-001`](quality-foundation/tasks/WEB-001.md) / WEB-02 |
| P1 | `/auth/register`のbot対策がない（IPごと1時間5回の制限とlegacy `/store/create`廃止は2026-10-08実装） | [`SEC-005`](quality-foundation/tasks/SEC-005.md) / WEB-05 |
| P2 | 店舗PINを変更する機能が無い。漏れた疑いがあっても変えられない（4桁PIN自体の強さも含め要検討） | 未起票（2026-10-09） |
| P1 | 共有resultは無認証URLで金額を含む。UI・privacy・運用説明を一致させ、URL漏洩時の扱いをrelease確認する | [`DOC-002`](quality-foundation/tasks/DOC-002.md) / WEB-09〜10 |
| P1 | 品目写真readは認証なしで、推測困難なURLをaccess境界とする。production R2 binding、別店舗upload/delete拒否、URL漏洩、account削除後404を実環境で確認していない | [`WEB-001`](quality-foundation/tasks/WEB-001.md) / WEB-09〜10 |
| P1 | 固定Free上限はApp/Workerとも無効。公開規約・画面文言・release contractを同じ状態に保つ | [`WEB-001`](quality-foundation/tasks/WEB-001.md) / WEB-06 |
| P1 | DATA-001/002・IMPORT-001の原子性/履歴修正は完了したが、release candidateの実D1・別browser確認は未完 | [`WEB-001`](quality-foundation/tasks/WEB-001.md) / WEB-07 |
| P1 | Workers LogsはUserが有効化済みだが、repositoryにobservability設定、統一structured log、機密masking、閲覧owner、alert/通知先がない | [`OPS-001`](quality-foundation/tasks/OPS-001.md) / WEB-08 |
| P1 | production migrationは0018までpreflightが必要。critical登録→同期/再接続→別browser履歴→削除E2Eも未完 | [`WEB-001`](quality-foundation/tasks/WEB-001.md) / [`TEST-002`](quality-foundation/tasks/TEST-002.md) |
| P2 | Appの`pdfjs-dist` 5.6.205は既知の脆弱性（GHSA-hq66-cqwq-w95j、修正は6.2.108）の範囲。前提（PDF内スクリプトを有効にした注釈レイヤー、スクリプトを許すCSP）にAppは当たらず、`pdfjsOptions.test.js`で固定。6系は対応ブラウザがSafari 18 / Chrome 125以上でPDF取込の対象端末が減るため、上げる時期はUser判断（2026-10-08 `proposals.md`） | `proposals.md` |
| P1 | W1 release buildでPostHog用変数を無効のままbuildし、artifactから外部通信が無いことをnetwork確認していない | [`PRIV-001`](quality-foundation/tasks/PRIV-001.md) / WEB-09〜10 |

本更新ではlegal page契約test（59件）とApp production buildを実行して成功した。
App全test、Worker test、browser/remote probeは未実行。remote事実は2026-08-04および2026-08-29の
[WEB-001 read-only preflight](quality-foundation/tasks/WEB-001.md)を参照する。過去の成功件数は
[session log](quality-foundation/session-log.md)に対象commitとcommandを残しており、現在HEADやproductionの
成功へ読み替えない。

## 参考snapshot（旧監査本文）

以下は作成時点の監査記録として保持する。現行baselineと矛盾する場合は上のbaseline、code、
現行taskを優先する。特に旧S-Aの「D1障害時fail-open」はD-015と現行codeにより
**fail-closedへ置換済み**。旧CORSのproject suffix、PostHog状態、固定test件数も現況ではない。

多店舗展開前のセキュリティチェックリスト。
「対応済み」と「残課題」を一目で把握できるよう管理する。

---

## 対応済み ✅

### S-01 ログイン総当たり対策
- **リスク**: PIN 4桁 × 高速ハッシュ × 試行制限なし → 数秒で突破可能
- **対策**: `login_attempts` テーブルで失敗回数を記録。15分以内に5回失敗で429ブロック。成功でクリア
- **実装**: `authHandler.js` / migration `0003_login_attempts.sql`
- **テスト**: `authHandler.test.js` — 3ケース

### S-02 データ系APIの後方互換ソフト認証
- **リスク**: `config` / `inventory` / `history` / `room` が店舗コードだけで誰でも読み書きできた
- **対策**: `verifyStoreAccess` — PIN設定済み店舗はBearerトークン必須。レガシー（PIN未設定）店舗は従来通り許可
- **実装**: `authHandler.js` + `index.js` ルーターにゲート追加
- **テスト**: `authHandler.test.js` — 4ケース

### S-03 ペイロードサイズ上限
- **リスク**: サイズ無制限のJSONをPUT/POSTしてD1容量を圧迫する経済的DoS
- **対策**: `config` / `inventory` / `history` の書き込みを約1MB（1,000,000文字）で制限。超過時は413
- **実装**: `storeHandler.js` `_tooLarge()` + 各ハンドラの先頭でチェック
- **テスト**: `storeHandler.test.js` — 5ケース

### S-05 ✅ HTTPレート制限（IPベース）
- **リスク**: `/auth/login` の店舗単位制限（S-01）は店舗コードを変えながらの総当たりに無力だった
- **対策**: IP単位の失敗カウント（15分窓・30回）。超過で429。`kind='login'` と `kind='probe'` を独立管理
- **実装**: `rateLimiter.js`（`clientIp` / `isIpBlocked` / `recordIpFail`）+ `index.js` ログインルート + migration `0005_ip_attempts.sql`
- **テスト**: `rateLimiter.test.js` 8ケース + `index.test.js` 統合6ケース

### S-06 ✅ ルームコード総当たり対策
- **リスク**: ルームコード（24^6 ≈ 1.9億通り）をWebSocket接続で総当たりするとゲストとして入室可能。DO起動コストも攻撃者に握られていた
- **対策**:
  1. `/room/:code/(ws|status|dissolve)` で店舗コードの存在を Worker 層（D1）で先に確認。存在しなければ404で **DOを起動させない**
  2. 存在しないコードへのアクセスを IP 単位で記録（`kind='probe'`）。15分窓30回で429
- **実装**: `index.js` ルームルート共通ゲート + `rateLimiter.js`
- **テスト**: `index.test.js` — 404/DO非到達・転送・記録・429・別IP非ブロック

### S-A ✅ ホスト乗っ取り（DOトークン復旧の認可強化）
- **リスク**: `RoomDO` の join は hostToken 不一致でも「空室 / 同一deviceId / 他にホスト不在」のいずれかで
  トークンを再発行しホスト承認していた。店舗コードを知る第三者（招待URLを受け取った元ゲスト等）が
  正規ホストのオフライン中に `role: 'host'` で接続するだけで、在庫・**単価**・監査ログ・チャットの取得と
  ルーム解散が可能だった。②の deviceId は自己申告のため詐称も可能
- **対策**: PIN設定済み（保護）店舗はホスト権限の（再）発行に **D1認証トークンの検証を必須**化。
  ブラウザ WS はヘッダを付けられないため、認証トークンは join メッセージに載せ（WSS暗号化）、
  DO は自分の店舗コード（URLパス由来・Worker で存在検証済み）に対して `verifyAuthToken` で照合する。
  hostToken 一致の再接続は従来どおり高速パス（D1照合なし）。レガシー（PIN未設定）店舗は後方互換で
  従来のトポロジ判定を維持。D1障害時はフェイルオープン（レガシー扱い）で可用性を優先
- **実装**: `RoomDO.js`（`canGrantHost` / `_isStoreProtected` / `_hostAuthOk` / fetch で店舗コード記録）、
  `authHandler.js`（`verifyAuthToken` 分離）、`useSync.js`（ホスト join に `authToken` 同梱）
- **テスト**: `RoomDO.hostAuth.test.js` — 保護店舗8ケース（認証必須の確認）／レガシー後方互換

---

### S-04 ✅ PINハッシュ強化（PBKDF2）
- **リスク**: 旧実装は SHA-256(shopCode:pin)（高速ハッシュ・saltは公開情報の店舗コードのみ）。
  D1流出時に全店舗のPINが総当たりで即割れる。S-01/S-05 のオンライン制限をかいくぐれた場合も脆弱
- **対策**: PBKDF2（`crypto.subtle.deriveBits`・SHA-256ベース・100,000反復・16バイトのランダムsalt）へ移行。
  保存形式 `pbkdf2$<iter>$<saltB64>$<hashB64>`。照合は定数時間比較（`_ctEqual`）
- **透過移行**: 新規登録は即PBKDF2。既存の旧SHA-256店舗は**次回ログイン成功時に自動で再ハッシュ**して
  `stores.pin_hash` を更新（ユーザー操作・強制ログアウト不要）。反復回数を将来引き上げた場合も同経路で更新
- **実装**: `authHandler.js`（`_hashPin` / `_verifyPin` / `_legacySha256` / login の rehash）、`constants.js`（`PBKDF2_ITERATIONS`）
- **テスト**: `authHandler.test.js` — PBKDF2形式・衝突しない・旧hash移行成功・誤PINは非移行
- **残**: PIN 4桁の空間は依然 10^4。総当たりスプレー（1234等×全店舗）への追加対策（6桁化 or 頻出PIN拒否）は別途検討

### S-10 ✅ クロスアカウントのデータ漏洩（同一ブラウザでの残存）
- **リスク**: 品目マスタ・棚卸・発注・入出庫・履歴・辞書が shopCode で名前空間を分けない
  固定 localStorage キー（`inventory_config_v1` 等）＋モジュールスコープのメモリに保持され、
  `logout()` は認証キーのみ削除・`login()` は新 shopCode を設定するだけ。さらに発注は
  `applyRemoteOrders` がマージ、入出庫は D1 非同期で localStorage 専用。結果、**同一ブラウザで
  アカウントを切り替えると前アカウントの全データが見えてしまう**（実報告あり）
- **原因の切り分け**: サーバー(D1)は全クエリ `WHERE shop_code = ?` でテナント分離済み。
  入出庫（サーバーに存在しない localStorage 専用データ）まで漏れていた事実が、原因が
  **クライアントのローカル永続化**であることの決定的証拠
- **対策**: 「この端末の業務データが属する店舗」を示す `_data_owner` マーカーを導入。
  ログイン/登録時に `_data_owner`（無ければ直前の `_shop_code`）と異なるアカウントなら、
  前アカウントのローカルデータ（メモリ＋localStorage）を全消去してから新アカウントを確立する。
  対象: config/inventory/orders/movements/history/aliases/master/進行中セッション/下書き/
  ホストトークン/同期セッション/PDFレシピ。端末固有設定（deviceId/deviceName/UI設定）は保持
- **実装**: 各 composable の `resetLocalData()`、`composables/accountData.js`
  （`clearLocalAccountData`）、`useAuth.js`（`_ensureAccountData` / `setAccountResetHandler`）、
  `App.vue`（ハンドラ登録）
- **テスト**: `accountData.test.js` — 全消去・別アカウント切替で消去・同一アカウントは保持・
  旧インストール移行
- **残（別対応）**: ①入出庫は D1 非同期のため、切替時に消えると復元不可 → 入出庫の D1 同期が必要
  （耐久性・分離の両面）。②`tanaoro_push_subscribed` はアカウント跨ぎで残り、プッシュの
  宛先ズレの可能性（表示漏洩ではない）。③プレーンなログアウトでは消さない設計（同一アカウント
  再ログイン時のローカル専用データ保持のため）。共有端末での「ログアウト後・未ログイン時」の
  残存は入出庫の D1 同期後にログアウト全消去へ引き上げる
  → **2026-07-21: 入出庫の D1 同期が実装され前提が揃った。ログアウト全消去への引き上げは実施可能・未着手**

---

### S-07 ✅ CSP（XSS時のトークン漏洩・外部通信制限）（2026-07-21）
- **対策**: `app/public/_headers` に CSP。`script-src 'self'`（インライン無し確認済み）、
  `connect-src` は self＋Worker(https/wss)＋Open-Meteo＋BigDataCloud＋PostHog に限定。
  X-Content-Type-Options / X-Frame-Options: DENY / frame-ancestors 'none' / Referrer-Policy /
  Permissions-Policy（geolocation/camera/microphone=self）も付与。
- **検証**: dist を CSP ヘッダ付き配信で実ブラウザ起動 → CSP違反0・正常mount。
- **残**: トークン保存方式の強化（httpOnly Cookie 等）は S-H と併せ将来。

### S-E/S-08 ✅ CORS フェイルクローズ（2026-07-21）
- **対策**: `isAllowedOrigin()` 導入。本番/プレビュー（*.inventory-app.pages.dev）＋localhost＋
  ALLOWED_ORIGIN（カンマ区切り完全一致）のみ許可、他は 403。ACAO はワイルドカード不使用で
  許可 Origin を個別反映。Origin 無し（同一/WS/S2S）は許可。wrangler.toml を本番ドメインに設定。
- **テスト**: `index.test.js` — 許可/拒否/なりすまし/カンマ区切り/403 の6ケース。

### S-D ✅ /pdf のガード（経済的DoS対策）（2026-07-21）→ 2026-10-08 endpointごと廃止
- **2026-10-08**: User決定（DS-07）で`/pdf`と`worker/src/pdfParser.js`、Workerの`pdfjs-dist`依存を削除した。
  `pdfjs-dist` 5.6系の既知の脆弱性（GHSA-hq66-cqwq-w95j）をサーバー側に持たない。以下は当時の記録。
- **対策**: ①IPレート制限（kind='pdf'・15分/30回）②認証必須 ③サイズ上限5MB
  （Content-Length＋arrayBuffer.byteLength）。重い処理前に安価なゲートで弾く順序。
  現行クライアントはPDFをローカル解析するため本EPは未使用だがDoS面を塞ぐため強化。
- **テスト**: `index.test.js` — 401/413/200/429 の4ケース。

### S-G ✅ ゲストへ単価を渡さない（2026-07-21）
- **対策**: DOで接続ごとの `isHost` を見て、ゲスト宛送信は prices を空に
  （`_broadcastPriceAware`/`_stripPricesForGuest`）。storage には保持しホストは受領。
  result API の `_sanitizeForGuest` と同水準を WS 経路でも適用（C-02 の商業懸念も解消）。
- **テスト**: `RoomDO.prices.test.js` — 3ケース。

## 残課題（優先度順）

### S-09 🟢 セッション完了処理のトランザクション化
- **リスク**: `sessions更新` → `inventory_lines INSERT` → `R2保存` の途中失敗で不整合が残る
- **対策案**: API設計v2 3.1 の `POST /sessions/:id/complete` で1エンドポイントに集約（DB設計v2 Step 3 と連動）
- **備考**: DB設計v2の実装フェーズで対応予定

---

## デプロイチェックリスト

```bash
./scripts/deploy.sh
```

スクリプトが「テスト → 未適用マイグレーションのみ適用 → Worker → Pages」の順序を保証する（すべて Cloudflare）。
手動デプロイは migration 漏れで /room 全ルートが落ちる事故（2026-06-12 発生）の再発リスクがあるため非推奨。

なお、レート制限（login_attempts / ip_attempts）は**フェイルオープン**実装:
テーブル未作成・D1障害時は制限を素通しし、ログイン・ルーム接続自体は止めない。

> **注意（S-06）**: ルーム接続は店舗コードの存在チェックを通るようになった。
> stores テーブルに無いコードのルームは接続不可（ルームID = 店舗コードの統一設計が前提）。

---

## テスト状況

| ファイル | ケース数 | カバー範囲 |
|---|---|---|
| `worker/src/authHandler.test.js` | 18件 | 登録・ログイン・トークン検証・総当たり対策・ソフト認証 |
| `worker/src/storeHandler.test.js` | 5件 | ペイロードサイズ上限 |
| `app/src/composables/useInventory.test.js` | 既存 | 在庫CRUD |
| `app/src/composables/useSync.conflict.test.js` | 既存 | 競合検知 |
| `app/src/composables/useSync.reconnect.test.js` | 既存 | 再接続 |

合計 **43件** / 全パス
