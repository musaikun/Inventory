# API設計書 — 飲食店棚卸システム

| 項目 | 内容 |
|---|---|
| **Status** | 現行W1 API baseline（known gapを併記） |
| **Role** | Web Free版で実装済みのHTTP/WebSocket境界を一覧化する派生仕様 |
| **Source of truth** | [`worker/src/index.js`](../worker/src/index.js)、[`authHandler.js`](../worker/src/authHandler.js)、[`storeHandler.js`](../worker/src/storeHandler.js)、[`accountDeletion.js`](../worker/src/accountDeletion.js)、[migrations](../worker/migrations/) |
| **Last verified** | 2026-08-17 / `claude/data-002-worker-d1-api-bogzyq`（migration 0016 まで・本番未適用） |

実装と矛盾する場合は上記code/migrationを優先します。account削除の詳細は
[account deletion contract](quality-foundation/account-deletion-contract.md)、公開可否は
[Web公開準備](quality-foundation/web-release-readiness.md)を正とします。

## 現行W1 API baseline

### 共通境界

- JSON APIの成功はdataまたは`{ ok: true }`、失敗は主に`{ error, code? }`とHTTP statusで返す。
- repositoryのCORSはOriginをallowlist照合し、許可外を403でfail-closedにする。ただし実Pages hostとの
  設定不一致と旧production Workerは[WEB-001](quality-foundation/tasks/WEB-001.md)で未解消。
- Bearerは`Authorization: Bearer <token>`。token有効期間は30日で、削除中/削除済みstoreは無効。
- 「soft auth」はPIN設定storeで同店舗Bearer必須、PIN未設定legacy storeだけcodeで許可する。

### 認証・account

| Method / path | 現行contract | Auth |
|---|---|---|
| `POST /auth/register` | `{ storeName?, pin }` → `{ shopCode, token, storeName, plan, isPro, inTrial:false, trialEndsAt:null }`。PINは4桁、PBKDF2で保存 | 不要。rate limit/bot対策は未実装 |
| `POST /auth/login` | `{ shopCode, pin }` → 同上entitlement付きtoken。成功時は同storeの既存tokenを全失効 | 不要。store/IP単位の失敗制限あり |
| `POST /auth/logout` | 対象Bearerがあれば削除し`{ ok:true }`。tokenなしでも同じ応答 | 任意 |
| `DELETE /auth/account` | `{ requestId, pin, confirmation }`。UUID、現在PIN、認証store codeのcase-sensitive完全一致を要求 | active Bearer + 再認証 |
| `POST /store/create` | PINなしlegacy store codeを作る旧経路 | 不要。廃止/保護をSEC-005で未解消 |
| `GET /store/:code` | `{ shopCode, activeRoom, createdAt, plan, isPro, inTrial:false, trialEndsAt:null }` | 不要 |

`DELETE /auth/account`は棚卸/発注の2 Durable Objectsを内部認証付きでpurgeし、D1の
inventory/session/history/order/movement/config/Push/token等を削除します。store rowは匿名tombstone、
requestIdだけのreceiptは7日保持します。DOまたはD1失敗は成功扱いにせず503を返し、同じrequestIdで
再試行します。200/replay成功後だけAppがlocal業務data、端末ID/名、天気位置/cache、Push、authを消します。
本番利用にはmigration 0011が必要で、現時点のproductionには未適用です。

### Store data

| Method / path | 主なbody / response | Auth |
|---|---|---|
| `GET/PUT /store/:code/config` | 品目・辞書・価格等の設定JSON。PUTは1 MB（UTF-8 byte）guard | soft |
| `GET/PUT /store/:code/inventory` | 進行中在庫JSON。PUTは1 MB（UTF-8 byte）guard | soft |
| `GET/POST /store/:code/history` | GETは新しい順50件で各行に`serverRevision` / `serverSavedAt`を含む。POSTは`{ok,sessionId,date,serverRevision,serverSavedAt}`。sessionIdを持つ行は`(shop_code, session_id)`で一意、持たないlegacy行は日付で一意（migration 0012）。revisionは保存のたびに`shop_code`内の最大値+1（migration 0014） | soft |
| `DELETE /store/:code/history/:key` | `key`はsessionId（現行）または日付（legacy行）。日付指定では`session_id IS NULL`の行だけを消し、同日の別sessionを巻き込まない。sessionId指定では**対応する取込台帳の行も同じbatchで消す**（削除済み取込をreplayが「保存済み」と誤回答しないため）。`{ok,removed}`を返し、失敗は503 `history_delete_failed` | soft |
| `PUT /store/:code/room` | `{ roomCode }`でactive roomを更新 | soft |
| `GET/POST /store/:code/orders` | `sinceDays`は1〜1000日、default 400。header + lines | soft |
| `DELETE /store/:code/orders/:id` | header/linesを1 batchで削除。不在/他storeは404 `order_not_found`、rollbackは503 `order_delete_failed`（retryable） | soft |
| `GET/POST /store/:code/movements` | `{ id?,date?,type,note?,orderId?,savedAt?,lines[] }`。`type`は`in` / `out`必須（不正値は400 `invalid_type`）、`orderId`の形式不正も400。positive qty行をD1へ保存。GETはdefault 400日、最大1000件 | soft |
| `DELETE /store/:code/movements/:id` | header/linesを1 batchで削除。不在/他storeは404 `movement_not_found`、rollbackは503 `movement_delete_failed`（retryable）。**HTTP statusで返す**（旧実装は常に200） | soft |
| `GET/POST /store/:code/sessions` | 一覧または`type`が`stock` / `order`のbodyで作成。**不正な`type`はHTTP 400 `invalid_type`**（旧実装はrouterが200で包み直していた）。省略時のdefaultは`stock` | strict同store Bearer |
| `PUT/DELETE /store/:code/sessions/:uuid` | PUTは`active` / `incomplete`への更新だけ。**`completed`への遷移はこのAPIでは行わない**（409 `use_complete_endpoint`・書込み0件）。`completed`からの巻き戻しも409 `session_completed`。`completed`→`completed`は何も変えず冪等に200。不在/他storeは404。DELETEはsession・明細・snapshot・取込台帳・完了claimを1 batchで消す | strict同store Bearer |
| `POST /store/:code/sessions/:uuid/complete` | **`sessions.type`で契約が分かれる**（下記「§3.1 棚卸完了API」）。`stock`は`{ inventory, prices, takenAt?, snapshot }` → `{ok,sessionId,type:'stock',date,itemCount,totalValue,snapshotSaved:true,serverRevision,serverSavedAt}`。`order`は`{ itemCount }` → `{ok,sessionId,type:'order',itemCount,snapshotSaved:false}`で`store_history`を書かない。**確定できるのは最初の1要求だけ**。同一intentの再送は保存済み結果（`replay:true`）、内容の違う再送は409 `completion_intent_conflict`。intentの同一性は**保存するcanonical snapshot全体**（`savedAt` / `activeMs`を除く）で判定する。棚卸日は`takenAt`ひとつで決まり、`snapshot.date`が違えば400 `snapshot_date_mismatch` | strict同store Bearer |
| `GET /store/:code/sessions/:uuid/lines` | 完了済み棚卸の明細を`inventory_lines`から返す。`session_id`と`shop_code`の両方で絞り、他store/不在はどちらも404。単価・在庫金額を含むためguestには出さない | strict同store Bearer |
| `POST /store/:code/imports/:batchId/sessions` | 過去棚卸を1日ぶん取り込む。`{ date, items[], replaceSessionIds?[] }` → `{ok,sessionId,date,itemCount,totalValue,importBatchId,replaced,snapshotSaved,serverRevision,serverSavedAt}`。session / `inventory_lines` / `store_history` / 要求台帳を1つの`db.batch`で書く。sessionIdは`(shop_code,batchId,date)`から決まる決定的UUIDで、再送・並行要求でも1件へ収束する（migration 0014の一意index）。**まったく同じ要求の再送は、置換対象が削除済みでも同じ成功を返す**（`replay:true`）。同じ`batchId`+日付で内容が違えば409 `import_intent_conflict`（migration 0015の台帳）。上書きは文中の原子guardに全delete/insertを従属させ、1件でも条件を外れたら書込み0件（409 `replace_not_allowed`）。`replaceSessionIds`の上限は50件で、超過は書込み前に400 `invalid_replace`。**台帳を持たない既存取込（0015適用前・台帳削除後）は409 `legacy_import_unverified`**で、取消してからでないと上書きできない。snapshotはserverが検証済み行から生成する（clientの`snapshot`は保存しない） | strict同store Bearer |
| `DELETE /store/:code/imports/:batchId` | 取込バッチ単位の取消。`{ok,removed,sessionIds[],importBatchId}`。`import_batch_id`が一致するsessionと**要求台帳の行**だけを消し、通常の棚卸（NULL）と別バッチには触れない。2回目は`removed:0`で成功（冪等）。台帳も消すので、取消後は同じ内容で取り込み直せる | strict同store Bearer |
| `POST/DELETE /store/:code/push/subscribe` | 8 KiB以下のPushSubscription、または`{endpoint}` | strict同store Bearer |

movementのpersist正本はD1 migration 0010で、Appはlocal cacheへ即時保存後にPOSTし、auth後/画面表示時に
GET結果をid mergeします。WebSocketによるreal-time movement同期はありません。入出庫（movement）のclient recordの
`source` / `importBatchId`は現行API/schemaへ保存されません（**過去棚卸取込の`importBatchId`は
migration 0013 で `sessions.import_batch_id` として保存されます**。両者は別物）。
本番D1は0010〜0016が未適用です（適用順・rollback可否・切替境界は
[Web公開準備](quality-foundation/web-release-readiness.md)の「公開手順」を正とします）。

### Room / utility

| Method / path | 現行contract | Auth / guard |
|---|---|---|
| `GET /room/:code/ws` | WebSocket upgrade。join成功前はping以外を拒否 | store存在gate + join時のD1 token/session条件 |
| `GET /room/:code/status` | item/order件数、participants、room状態 | store存在 + IP probe制限 |
| `POST /room/:code/dissolve` | `{hostToken}`一致でroom破棄 | store存在 + DO hostToken |
| `GET /room/:code/result?s=:sessionId` | 最新完了結果の数量等を金額抜きで返す。3日または次回完了まで | 無認証。URL token相当 + IP probe制限 |
| `GET /api/push/vapid-key` | `{key}` | 不要 |
| `POST /pdf` | raw PDFを解析。active Bearer、宣言/実byteとも5 MiB以下 | Bearer + IP 30回/15分。全試行を計上 |
| `GET /health` | text `OK` | 不要 |

現行AppのPDF UIは`pdfjs-dist`によるclient解析で、`/pdf`を呼びません。endpointの存廃は
PLAY-003 / WEB-001で未決です。

### Plan / trial

- 通常Workerの新規登録は`plan=free`。分離Pro Review環境だけ`DEFAULT_STORE_PLAN=pro`です。
- backend entitlementは保存planを`free|pro`へ正規化しますが、trialは常に
  `inTrial=false` / `trialEndsAt=null`で、Stripe/webhook/subscription処理はありません。
- migration 0009は適用時点の既存storeを`pro`へ更新するため、DB上の既存値まで一律Freeとは断定しません。
- 通常AppはAPI entitlementを機能gateへ保存せず、Pro Review用build変数以外をFree扱いします。
  150品目/履歴3回はclient gate、2台制限はserver未強制です。

### Known gaps

| Task | API上の未解消事項 |
|---|---|
| [SEC-005](quality-foundation/tasks/SEC-005.md) | `/auth/register`の濫用防止と`/store/create`の廃止/保護 |
| [DATA-001](quality-foundation/tasks/DATA-001.md) | order/movement header-lines、棚卸完了writeの原子性とfield/array上限 |
| [DATA-002](quality-foundation/tasks/DATA-002.md) | Phase 1（`GET /store/:code/sessions/:id/lines`）と Phase 2 は実装済み。history同日上書き（F-001）は migration 0012 の session 単位キー化で解消。孤児（F-004）・データ源二重（F-003）・`LIMIT 50`（F-002）は Phase 3 で公開後 |
| [IMPORT-001](quality-foundation/tasks/IMPORT-001.md) | 過去棚卸取込API（`/imports/:batchId/*`）は実装済み・**migration 0013 / 0015 / 0016 は未適用**。実D1での確認は release gate（`WEB-04` / `WEB-07`）に残る |
| [WEB-001](quality-foundation/tasks/WEB-001.md) | canonical/CORS/Pages、本番0010〜0016のmigration、Free server limits、E2E/smoke |

### 将来A1（現行APIではない）

[D-021](quality-foundation/decisions.md#d-021--web先行とplay向け将来フローの分離)で採用された
Android app内登録起点の14日trialと、Web Stripe契約を同一accountへ反映するserver entitlementは未実装です。
Web登録者へのtrial、Stripe/backendのrelease順、trial起算・再登録防止・grace、価格/上限は未決であり、
このbaselineのendpoint contractには含めません。

---

## 参考snapshot（旧学習・v2設計本文）

> 以下は従来の学習説明と将来v2案を履歴参照用に残したものです。現行contractや実装済み判定には使わず、
> 上の「現行W1 API baseline」とcode/migrationを優先してください。

## 0. APIとは何か（このアプリで理解する）

APIは **「この宛先にこの形式で送れば、この返事が来る」という約束** である。

このアプリには「フロント（Vue）」と「サーバー（Worker）」という2つのプログラムがある。
両者は別々の場所で動くので、直接関数を呼び合えない。あいだを **HTTP** でつなぐ。
その「呼び出しの約束」がAPIだ。

```
フロント (app/src/composables/useStore.js)
    │   fetch('/store/ABC123/inventory')      ← 約束に従って送る
    ▼
[ HTTP ネットワーク ]
    ▼
サーバー (worker/src/index.js)               ← 宛先を見て担当に振り分ける
    │   handleInventoryGet(db, code)
    ▼
D1 データベース                               ← データを取る
    │
    ▼   { "コーヒー豆": { qty: 5, unit: "kg" } }   ← 約束に従って返す
フロントに戻る
```

フロントは「サーバーが中でどうD1を読むか」を知らなくていい。
サーバーは「フロントがどの画面で使うか」を知らなくていい。
**この分離こそがAPIの価値**（片方を作り替えても、約束さえ守れば壊れない）。

### 1つのAPIを構成する4要素

| 要素 | 例 | このコードでの居場所 |
|---|---|---|
| **メソッド**（動詞） | `GET` `PUT` `POST` `DELETE` | `request.method` |
| **パス**（宛先） | `/store/:code/inventory` | `url.pathname` を正規表現で照合 |
| **リクエスト**（送るもの） | `{ inventory: {...} }` | `await request.json()` |
| **レスポンス**（返すもの） | `{ ok: true }` / `{ error }` | `jsonResponse(body, status)` |

メソッドの直感的な意味：
- **GET** = 取ってくる（読み取り・サーバーの状態を変えない）
- **PUT** = 置く（まるごと上書き）
- **POST** = 投稿する（新規作成・処理実行）
- **DELETE** = 消す

---

## 1. 現状のAPI一覧（v1）

`worker/src/index.js` がルーター（宛先を見て担当関数に振り分ける場所）。
そこから呼ばれる実処理は `storeHandler.js` / `authHandler.js` / `accountDeletion.js` にある。

### 1.1 認証API（`authHandler.js`）

| メソッド | パス | リクエスト | レスポンス | 認証 |
|---|---|---|---|---|
| POST | `/auth/register` | `{ storeName?, pin }` | `{ shopCode, token, storeName }` | 不要 |
| POST | `/auth/login` | `{ shopCode, pin }` | `{ token, shopCode, storeName }` | 不要 |
| POST | `/auth/logout` | （Bearerトークン） | `{ ok: true }` | Bearer |
| DELETE | `/auth/account` | Bearer + `{ requestId, pin, confirmation }` | `{ ok, status: deleted, requestId, deletedAt, alreadyDeleted }` | Bearer + 現在PIN + 店舗code再入力 |

- `register` = 新規店舗を作りPINを設定、トークン発行（30日有効）
- `login` = 店舗コード＋PINを照合、トークン発行
- トークンは以後 `Authorization: Bearer <token>` ヘッダーで送る
- `account` deletionは同じUUID `requestId` の再送を7日間冪等成功にし、D1関連data、全token、
  Push購読、棚卸/発注Durable Objectsを削除する。詳細は
  [`quality-foundation/account-deletion-contract.md`](quality-foundation/account-deletion-contract.md)。
- `deletion_pending_at` または `deleted_at` の店舗はlogin、通常token、store API、room gateで拒否する。

### 1.2 店舗データAPI（`storeHandler.js`）

| メソッド | パス | リクエスト | レスポンス | 認証 |
|---|---|---|---|---|
| POST | `/store/create` | — | `{ shopCode }` | 不要（PIN必須化と合わせ廃止検討・監査②） |
| GET | `/store/:code` | — | `{ shopCode, activeRoom, plan, isPro, inTrial:false, trialEndsAt:null, ... }` / 404 | 不要 |
| GET | `/store/:code/config` | — | 設定オブジェクト / `{}` | ソフト† |
| PUT | `/store/:code/config` | 設定オブジェクト | `{ ok: true }` | ソフト† |
| GET | `/store/:code/inventory` | — | 在庫オブジェクト / `{}` | ソフト† |
| PUT | `/store/:code/inventory` | `{ inventory, recountFlags, sessionId, savedAt }` | `{ ok: true }` | ソフト† |
| GET | `/store/:code/history` | — | `[ { ...snapshot, sessionId, serverRevision, serverSavedAt }, ... ]`（最新50件） | ソフト† |
| POST | `/store/:code/history` | スナップショット（`{ date, ... }`） | `{ ok, sessionId, date, serverRevision, serverSavedAt }` / 400 | ソフト† |
| DELETE | `/store/:code/history/:key` | — | `{ ok, removed }` / 400 / 503 | ソフト† |
| PUT | `/store/:code/room` | `{ roomCode }` | `{ ok: true }` | ソフト† |
| GET | `/store/:code/orders` | — | `[ order, ... ]` | ソフト† |
| POST | `/store/:code/orders` | 発注レコード | `{ ok: true, id }` | ソフト† |
| DELETE | `/store/:code/orders/:id` | — | `{ ok: true }` / 404 / 503 | ソフト† |
| POST | `/store/:code/push/subscribe` | PushSubscription JSON（最大8KiB） | `{ ok: true }` | Bearer必須 |
| DELETE | `/store/:code/push/subscribe` | `{ endpoint }` | `{ ok: true }` | Bearer必須 |

> † **ソフト認証**（`verifyStoreAccess`・S-02）: PIN設定済み店舗は Bearer 必須。
> レガシー（PIN未設定）店舗は店舗コードのみで許可（後方互換・S-C の残課題）。
> Push購読はレガシー例外を適用しないstrict認証。endpointは公開HTTPS、鍵はPush API / RFC 8291形式、
> 同一endpointを別店舗へ付け替える操作は409で拒否する。

### 1.3 セッションAPI（`storeHandler.js`・要認証）

| メソッド | パス | リクエスト | レスポンス | 認証 |
|---|---|---|---|---|
| GET | `/store/:code/sessions` | — | `[ session, ... ]`（最新50件） | Bearer |
| POST | `/store/:code/sessions` | `{ type? }`（`stock` / `order`） | `{ id, shopCode, startedAt, status, itemCount, type }` / 400 | Bearer |
| PUT | `/store/:code/sessions/:id` | `{ status, itemCount? }`（`active` / `incomplete` のみ。itemCountは0以上の整数） | `{ ok: true }` / 400 / 404 / 409 `use_complete_endpoint` / 409 `session_completed` | Bearer |
| DELETE | `/store/:code/sessions/:id` | — | `{ ok: true }` | Bearer |
| POST | `/store/:code/sessions/:id/complete` | stock: `{ inventory, prices, takenAt?, snapshot }` ／ order: `{ itemCount }` | stock: `{ ok, sessionId, type, date, itemCount, totalValue, snapshotSaved:true, serverRevision, serverSavedAt }` ／ order: `{ ok, sessionId, type, itemCount, snapshotSaved:false }` / 400 / 404 / 409 / 503 | Bearer（§3.1 の実装・✅済み） |
| GET | `/store/:code/sessions/:id/lines` | — | `{ sessionId, date, startedAt, endedAt, status, type, itemCount, totalValue, truncated, lines[] }` / 404 | Bearer（DATA-002 Phase 1・✅済み） |

### 1.3.1 過去棚卸の取込API（`pastImport.js`・要認証 / IMPORT-001）

| メソッド | パス | リクエスト | レスポンス | 認証 |
|---|---|---|---|---|
| POST | `/store/:code/imports/:batchId/sessions` | `{ date, items[], replaceSessionIds?[] }` | `{ ok, sessionId, date, itemCount, totalValue, importBatchId, replaced, snapshotSaved, serverRevision, serverSavedAt }` / 400 / 409 / 413 / 503 | Bearer |
| DELETE | `/store/:code/imports/:batchId` | — | `{ ok, removed, sessionIds[], importBatchId }` | Bearer |

取込で作るのは**通常の棚卸と同じ session** です（migration 0012 の sessionId identity をそのまま使う）。
`sessions.import_batch_id`（migration 0013）を持つ行だけが取込由来で、通常の棚卸は `NULL` です。

- **1リクエスト = 1日ぶん。** 複数日は client が同じ `batchId` で繰り返し呼びます。
  日数×品目数を1回のbatchへ入れると、D1 の 1 invocation あたりの statement 上限を超えるためです。
- **原子性**: session・`inventory_lines`・`store_history` を1つの `db.batch` で書きます。
  途中で落ちれば全部巻き戻り、`503` / `retryable: true` を返します。
- **冪等性**: `sessionId` は `(shop_code, batchId, date)` から決まる決定的UUID（SHA-256 由来のv5相当）です。
  応答を取りこぼした再送も、同時に届いた2本も、同じ行の upsert に収束します。
  DB側にも `UNIQUE(shop_code, import_batch_id, started_at) WHERE import_batch_id IS NOT NULL`
  （migration 0014）を置き、旧ランダムIDの行が割り込んだ場合は batch ごと失敗させて2件目を作りません。
  明細は貼り直し前に削除するので、品目が減った再取込で前回分が残りません。
- **snapshot はserverが作る**: client の `snapshot` は保存しません。検証済みの行から
  `items` を含む canonical snapshot を組み立てて `store_history` へ書きます。
  items を持たない snapshot を保存できると、「一覧には出るのに詳細が空」（R-001）を取込経路から作れるためです。
- **同日衝突**: 既定では何も消さず、別 session として共存します（0012 で同日複数 session が可能）。
  上書きは client が `replaceSessionIds` で**明示指定した session だけ**です。許可条件は
  **同じ店舗・同じ日付・`completed`・`stock`** の4つで、1件でも外れたら `409 replace_not_allowed`
  （`reason` = `not_found` / `date_mismatch` / `not_completed` / `not_stock`）で**全体を拒否し、何も削除しません**。
  他storeのIDと存在しないIDは同じ `not_found` にして実在を漏らしません。
  削除は件数によらず3文（`inventory_lines` / `store_history` / `sessions`）へ `IN` で集約するため、
  上限50件でも statement 数は増えません。
- **上書き許可の判定は文中の原子guardが持ちます**（DATA-002 §3 / §4）。preflight の SELECT は
  理由つき409を返すためだけのもので、削除権限の根拠にしません。SELECT と DELETE の間に対象が
  `active` へ戻る隙間があり、そこで入力中の棚卸を消せていました。
  「条件つきDELETEをcommitしてから `changes` を見る」方式も、DELETE 自体が成立してしまうため採りません。

  現在の構造は「台帳への claim → 以降の全文が claim に従属」です。

  1. **台帳 INSERT が唯一の判定点**。「指定IDのうち 同店舗・同日・`completed`・`stock` を
     満たすものが**ちょうどN件**」という件数条件を、この1文だけが評価します。
     PRIMARY KEY `(shop_code, batch_id, import_date)` により、1トランザクションで
     claim を取れるのは1要求だけです。
  2. session作成・明細・snapshot・上書き削除は、**自分の fingerprint の台帳行が存在すること**に
     従属します。claim を取れなかった側は1行も書けません。

  所有権 marker に**時刻を使いません**。以前は `sessions.ended_at = <この要求の時刻>` を
  印にしていましたが、ミリ秒精度の時刻は排他的 token にならず、同じミリ秒に届いた別内容の
  要求が同じ marker を満たします。409 を返した側の明細・snapshot だけが残る経路がありました。
  server 生成の fingerprint を持つ台帳行なら、同一ミリ秒でも勝者が一意に決まります。
- **応答喪失からの再送**（migration 0015）: 要求台帳 `import_batch_requests` に
  `(shop_code, batch_id, import_date)` をキーとして「日付・明細・上書き対象集合」の
  SHA-256 指紋を残します。まったく同じ要求の再送は、**上書き対象が既に削除済みでも**
  同じ成功結果を返します（`replay: true`）。同じ `batchId` + 同じ日付で内容が違う要求は
  `409 import_intent_conflict` で拒否し、既存の取込を黙って書き換えません。
  同じ `batchId` の**別日付**は設計上の別要求単位なので通ります。
  台帳の INSERT は取込本体と同じ batch にあり、並行した同一要求は PRIMARY KEY で
  片方が巻き戻ってから台帳を読み直し、同じ成功へ収束します。
  取消は台帳行も消すため、取り消したバッチは同じ内容で取り込み直せます。
- **stale な台帳で嘘をつきません**（DATA-002 再レビュー §5）。replay 成功には、台帳の一致に加えて
  **対応する session と `store_history` が今も存在すること**を要求します。どちらかが無ければ
  `409 import_record_missing` で fail-closed にし、`snapshotSaved: true` を返しません。
  合わせて、`DELETE /sessions/:id` と `DELETE /history/:sessionId` が対応する台帳行を
  同じトランザクションで消すため、この状態は通常操作では発生しません
  （復旧経路は `DELETE /imports/:batchId` → 再取込）。
- **台帳を持たない既存取込は、別内容で黙って上書きできません**（`409 legacy_import_unverified`）。
  0015 適用前に旧Workerが書いたバッチや、`DELETE /history/:sessionId` で台帳だけが消えた状態が該当します。
  台帳が無いと「前回と同じ要求か」を判定する材料が無く、明細から fingerprint を再計算しても
  当時の要求と同一である保証がありません。推測で replay 成功にすると取り込み済みの内容を
  黙って差し替えることになるため、fail-closed にします。
  取り込み直すには `DELETE /imports/:batchId` で**明示的に取り消して**から再取込します。
  同じバッチの**別日付**は影響を受けません。
- **取消**: `import_batch_id` の一致だけを条件に消すため、別バッチと通常の棚卸は残ります。
- **検証**: 日付は実在日（`2026-02-30` は拒否）、`items` は `MAX_LINES_PER_REQUEST`（500）まで、
  `replaceSessionIds` は `MAX_REPLACE_SESSIONS`（50）まで、
  数量は棚卸と同じ契約（`0` は正当・負数と非有限は拒否・`0` へ丸めない）、
  品目名 200 / 単位 50 文字で切り詰め、payload 全体は 1 MB（**UTF-8 byte**）guard。

`lines[]` は `{ item, qty, unit, unitPrice, subtotal, category }`。`rowid` 順＝完了時の挿入順で返します。
1回の上限は `MAX_SESSION_LINES`（2,000件）で、超過分は打ち切り `truncated: true` を返します
（`totalValue` は `sessions.total_value` を返すため、打ち切っても合計は過小になりません）。
店舗境界は `session_id` と `shop_code` の両方で絞ります。他storeのIDと存在しないIDは
同じ404にして、IDの存在有無を漏らしません。

### 1.4 リアルタイム・その他（`index.js` → RoomDO）

| メソッド | パス | 役割 |
|---|---|---|
| GET | `/room/:code/ws` | WebSocket接続（同期の本体・Durable Object）。店舗存在チェック＋probeレート制限（S-06） |
| GET | `/room/:code/status` | 退室中ホストのライブ品目数（`orderItemCount`＝発注済み品目数も返す） |
| POST | `/room/:code/dissolve` | 残存ルームの掃除 |
| GET | `/room/:code/result?s=...` | 完了後ゲスト閲覧（無認証・URLが鍵・金額除去 → `room-url-design.md`） |
| GET | `/api/push/vapid-key` | プッシュ公開鍵 |
| POST | `/pdf` | PDFから品目テキスト抽出。**active Bearer必須・5 MiB・IP 30回/15分**（現行Appは未使用） |
| GET | `/health` | 死活監視 |

> 補足：リアルタイム同期だけ「HTTP（一往復）」ではなく「WebSocket（つなぎっぱなし）」を使う。
> 在庫の同時編集は一往復では遅すぎるため。APIには「都度問い合わせ型（HTTP）」と
> 「つなぎっぱなし型（WebSocket）」の2種類があると理解すればよい。

---

## 2. 現状の設計から学べること（観察）

明文化すると、コードを読むだけでは気づきにくい **設計上の癖・課題** が見えてくる。
これがAPI設計を文書化する最大の効用。

### 2.1 規約（いまの暗黙ルール）

- パスは `/リソース名/:id/サブリソース` の階層型（REST的）
- 成功は `{ ok: true }` か対象データ、失敗は `{ error: '...' }` ＋ HTTPステータス
- 認証は `Authorization: Bearer <token>` ヘッダー
- 店舗コードはパスに大文字で正規化して入れる

### 2.2 課題（v2で直したい点）

| 課題 | 詳細 | 関連設計 |
|---|---|---|
| ✅ 認証の濃淡（対応済み） | ソフト認証（S-02）とPush strict認証（SEC-003）を導入済み。**残**: レガシー店舗のフェイルオープン（S-C） | `security-review.md` |
| 🟡 履歴がブロブまるごと | `GET /history` が50件分のJSONを全部返す。重い・分析できない。監査スケール#3（session_id 列）と同根 | DB設計v2 |
| ✅ 完了処理の分散（対応済み） | `POST /sessions/:id/complete` に集約（§3.1 実装済み） | API/トランザクション設計 |
| 🟡 エラー形式が半端 | `{ error }` のときと `{ _status, error }` のときがある | API規約 |

> 認証の穴（2.2）はソフト認証の導入で大枠は塞いだが、レガシー店舗の扱い（S-C）が残っている。
> 「API設計を文書化したら、セキュリティ設計の宿題が見つかった」という良い例。

---

## 3. v2で追加・変更するAPI（DB設計v2に対応）

`docs/db-design-v2.md` の3層アーキテクチャ（D1 + inventory_lines + R2）を
APIから見るとどう変わるかを設計する。

### 3.1 棚卸完了API ✅ 実装済み（`POST /store/:code/sessions/:id/complete`）

現状バラバラな「完了時の3処理」を1つのAPIに集約し、サーバー側で一括実行する。
途中失敗による不整合を防ぐ（トランザクション化）。

R2 は未導入のため、生スナップショットは D1 `store_history` へ同じ batch で書きます（現行の実装）。

**契約は `sessions.type` で分かれます**（DATA-002 第1修正セッション §1）。
種別を見ずに「snapshot 必須」を全経路へ課していたため、在庫入力を伴わない
発注セッションは完了できませんでした。

#### stock（棚卸）

```
POST /store/:code/sessions/:id/complete        （要認証・type=stock）

リクエスト:
{
  inventory: { "コーヒー豆": { qty: 5, unit: "kg" }, ... },
  prices:    { "コーヒー豆": 2000, ... },
  takenAt:   "2026-08-11",           // 省略時は当日。実在日でなければ 400
  snapshot:  { items[], ... }        // **必須**。無ければ 400 snapshot_required
                                     // date を入れる場合は takenAt と一致が必要
}

サーバー側の処理（1 db.batch = 1トランザクション）:
  1. INSERT INTO session_completions …（**claim**。status <> 'completed' が条件）
  2. UPDATE sessions … status='completed', ended_at, item_count, total_value
  3. DELETE + INSERT inventory_lines（複数行を1文へまとめる。持ち主は sessions への JOIN で確認）
  4. INSERT INTO store_history … SELECT … FROM sessions WHERE id=? AND shop_code=?
     （sessions を参照するので、直前にセッションが消えても snapshot だけが残らない）
  5. SELECT revision, updated_at FROM store_history …（**同じ batch 内**で読み戻す）

  2〜4 はすべて「自分の fingerprint の claim 行が存在すること」に従属します。

レスポンス:
{ ok: true, sessionId, type: 'stock', date, itemCount, totalValue,
  snapshotSaved: true, serverRevision, serverSavedAt }
```

- **棚卸日は `takenAt` ひとつで決まります**（DATA-002 再レビュー §2）。
  `snapshot.date` を送る場合は `takenAt` と一致していなければ **400 `snapshot_date_mismatch`**
  （書込み0件）。省略時は `takenAt` を使います。旧実装は両方を別々に受理していたため、
  `inventory_lines.taken_at = 08-09` と `store_history.snapshot_date = 08-10` という
  分裂した記録を保存できました。保存後は session / lines / history / snapshot JSON /
  一覧 / 詳細のすべてで同じ日付になります。
- **確定できるのは最初の1要求だけです**（DATA-002 再レビュー §3）。
  確定内容は `session_completions`（migration 0016）へ fingerprint として残ります。
  - まったく同じ intent の再送 → 保存済みの結果を返す（`replay: true`）
  - 数量・単価・日付・明細・件数・合計が違う再送 → **409 `completion_intent_conflict`**。
    既存の lines / snapshot / itemCount / totalValue / endedAt / revision は変更しません。
  - fingerprint は **server が検証・正規化した値だけ**から作ります。対象は
    「保存する canonical snapshot **そのもの**」から下の除外鍵を落としたもの＋種別・日付・件数・合計・明細行です。
    client が送る fingerprint は受け取りません。
    - **除外するのは `savedAt` と `activeMs` の2つだけ**。`savedAt` は server 時刻で毎回変わり、
      `activeMs` は同じ画面から再試行するたびに増えるため、含めると正当な再送が 409 になります。
    - それ以外（`items` の全列 = 数量・単位・単価・小計に加え `code` / `flagged` / `category` /
      `lotSize` / `prevMonth` / `tagA` / `tagB`、および `entryLog` / `auditLog` / `participants` /
      `flaggedItems` / `axisNames` / `locked`）は**すべて含めます**。
      保存対象なのに指紋から漏れていると、その項目だけを変えた再送が replay 成功になり、
      **サーバーは旧内容・端末は新内容**という食い違いを作ります。
  - 勝者判定に **timestamp を使いません**。claim の PRIMARY KEY と fingerprint が
    排他 token なので、同一ミリ秒に届いた2要求でも片方だけが確定し、混合状態になりません。
  - **0016 適用前に完了した session** は claim 行を持たないため、同じ内容の再送でも
    `409 completion_intent_conflict`（`reason: already_completed`）で fail-closed にします。
    保存済みデータは無傷で、詳細APIから内容を確認できます。
  - claim はあるのに `store_history` が消えている場合は `409 completion_record_missing`。
    `snapshotSaved: true` を返しません。

- **snapshot 必須**（第2セッション §1）。明細だけ書いて表示用 snapshot が無い状態が R-001 そのもので、
  完了要求に載せさせることで3テーブルを必ず同時に揃えます。
- **保存する snapshot は server が canonical 化します**（DATA-002 §1）。
  `sessionId` / `date` / `type` / `items` / `itemCount` / `totalValue` / `savedAt` は
  **client 値を採らず**、検証済みの `inventory` 行から組み立てます。
  client が偽った件数・合計・sessionId は履歴に残りません。
  - 数量・単位・単価・小計は明細行の値で**上書き**します（正規化）。
  - `qty` を持つ品目の集合が明細行と一致しない場合は保存せず **400 `snapshot_mismatch`**。
    多い＝サーバーに明細が無いものを「入力済み」と主張、少ない＝明細が履歴から欠ける。
    どちらも「一覧と詳細が食い違う」状態になります。
  - `qty: null`（棚卸で数えなかった品目）は表示のためそのまま残します。
  - 任意 metadata は allowlist のみ:
    `entryLog` / `auditLog`（各500件まで）、`participants`（50件まで）、`flaggedItems`、
    `activeMs`、`axisNames`、`locked`。それ以外の鍵（`dirty` / `synced` / `serverRevision` など）は捨てます。
- **inventory 0件の完了は 400 `empty_inventory`**。明細も items も無い「完了」は、
  一覧に出るのに詳細が空という R-001 そのものになるため、公開契約として拒否します。
- **孤児を作らない**: 事前の存在確認と batch の間にセッションが消える／他店舗のものになる競合でも、
  UPDATE が0行になり、`inventory_lines` と `store_history` も存在条件で0行になります。応答は404。
- **冪等**: 同じ `sessionId` へ同じ payload を再送しても、明細を貼り直し snapshot を上書きするだけです。
- **新旧判定**: `serverRevision` は `store_history` 保存のたびに `shop_code` 内の最大値+1 で採番されます。
  client の `updatedAt` / `savedAt`（端末時計）はサーバー側の判定に使いません。
- **revision は自分の write の値だけを返します**。読み戻しの SELECT を書き込みと同じ
  `db.batch()`（=1トランザクション）へ入れているため、batch の外で別要求が保存しても
  その revision が混ざりません。読み戻せない場合は `serverRevision: null` で成功させず、
  書込みごと巻き戻して 503 `complete_failed`（`retryable: true`）を返します。

#### order（発注確認）

```
POST /store/:code/sessions/:id/complete        （要認証・type=order）

リクエスト:
{ itemCount: 12 }                    // 発注行の件数。0〜500

レスポンス:
{ ok: true, sessionId, type: 'order', itemCount, snapshotSaved: false }
```

- **`store_history` も `inventory_lines` も書きません。** 発注の正本は `orders` / `order_lines`
  （`POST /store/:code/orders`）で、App の完了一覧も `type === 'order'` を除外しています。
  架空の marker snapshot を作ると、履歴・カレンダー・分析に発注が棚卸として現れます。
- `snapshot` または空でない `inventory` を送ると **400 `snapshot_not_allowed`**。
  「発注なのに棚卸の snapshot を作ってしまう」経路を API 側で塞ぎます。
- 一覧の `itemCount` は **client 値（検証済み）** を採ります。発注明細は別経路・別タイミングで
  冪等に書かれるため、完了を `order_lines` の到着に依存させると、未送信キューが残っている間だけ
  発注を完了できなくなります。detail の正本は `orders` 側です。
- 状態確定は単一 UPDATE（=原子的）。同じ要求の再送は冪等です。

#### 状態遷移（stock / order 共通）

`PUT /store/:code/sessions/:id` は **`active` / `incomplete` への更新だけ**を扱います。

- `completed` への遷移は **このAPIでは行いません**（409 `use_complete_endpoint`・書込み0件）。
  汎用PUTで completed にできると、`inventory_lines` も `store_history` も持たない
  completed session を作れてしまいます（＝一覧には出るのに詳細が空。R-001 そのもの）。
  完了は必ず `POST /sessions/:id/complete` を通します。
- 既に `completed` の session へ `completed` を送った場合は、**何も変更せず**冪等に 200。
- `completed` → `active` / `incomplete` は 409 `session_completed`。
  完了応答を取りこぼした端末は保留していた `touch()` をそのまま送ってくるため、
  旧実装はそれを適用して `status='active'` / `ended_at=NULL` / `item_count=<入力途中>` に
  巻き戻していました。`inventory_lines` と `store_history` は残るのに一覧だけ進行中へ戻るため、
  完了済みの詳細へ到達できなくなります。
- 不在・他店舗は 404（IDの実在を漏らしません）。

`DELETE /store/:code/sessions/:id` は session 行だけでなく、
`inventory_lines` / `store_history` / 取込台帳 / 完了 claim を**1 batch でまとめて**消します。
旧実装は session 行だけを消しており、孤児（F-004）と stale な台帳を残していました。

### 3.2 履歴詳細API（新設・R2から取得）

一覧は軽い `sessions` から、詳細は重いデータを R2 から都度取得する。

```
GET  /store/:code/sessions               → 一覧（メタのみ・既存を流用）
GET  /store/:code/sessions/:id/detail    → 詳細（R2の生JSONを返す）  ★新設
```

### 3.3 分析API（新設・Phase 2の核）

`inventory_lines` を集計して時系列を返す。インデックスが効くので一発。

```
GET /store/:code/analytics/item?name=コーヒー豆&from=2026-01-01&to=2026-06-30

レスポンス:
{
  item: "コーヒー豆",
  points: [
    { date: "2026-01-07", qty: 4.5, value: 4320 },
    { date: "2026-01-14", qty: 5.0, value: 4800 },
    ...
  ]
}
```

### 3.4 認証の統一（変更・セキュリティ）

`config` / `inventory` / `history`（→ `sessions/detail`）にも `verifyAuth` を必須化する。
「店舗コードを知っているだけ」では読み書きできないようにする。

### 3.5 v2 API差分まとめ

| 区分 | メソッド | パス | 状態 |
|---|---|---|---|
| 完了 | POST | `/store/:code/sessions/:id/complete` | ✅ 実装済み |
| 履歴詳細 | GET | `/store/:code/sessions/:id/detail` | ⬜ 未実装（R2アーカイブと同時） |
| 分析 | GET | `/store/:code/analytics/item` | ⬜ 未実装（フェーズ2） |
| 認証 | — | `config`/`inventory`/`history` | 🔧 ソフト認証済み・レガシー店舗の完全必須化が残（S-C） |
| 旧履歴 | POST/GET | `/store/:code/history*` | ⚠️ 段階的に非推奨 |

---

## 4. API設計の進め方（学習まとめ）

このドキュメントで実践した手順がそのまま「API設計のやり方」になる：

1. **リソースを洗い出す** … 店舗・設定・在庫・履歴・セッション・分析
2. **各リソースへの操作を決める** … 取得(GET)/保存(PUT)/作成(POST)/削除(DELETE)
3. **リクエストとレスポンスの形を決める** … 何を送り何が返るか（＝フロントとの契約）
4. **規約を統一する** … エラー形式・認証・命名を揃える
5. **実装前にこの表を確定する** … フロントとサーバーが並行で作れる

> ポイント：**API設計は「DB設計」と「画面設計」の橋渡し**。
> 画面が「何を表示したいか」→ APIが「それをどう受け渡すか」→ DBが「どう保存するか」。
> 3つは繋がっている。だからAPIを設計すると全体像が一気に見える。
