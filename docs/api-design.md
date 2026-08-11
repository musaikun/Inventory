# API設計書 — 飲食店棚卸システム

| 項目 | 内容 |
|---|---|
| **Status** | 現行W1 API baseline（known gapを併記） |
| **Role** | Web Free版で実装済みのHTTP/WebSocket境界を一覧化する派生仕様 |
| **Source of truth** | [`worker/src/index.js`](../worker/src/index.js)、[`authHandler.js`](../worker/src/authHandler.js)、[`storeHandler.js`](../worker/src/storeHandler.js)、[`accountDeletion.js`](../worker/src/accountDeletion.js)、[migrations](../worker/migrations/) |
| **Last verified** | 2026-08-04 / `develop@bc9fb85` |

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
| `GET/PUT /store/:code/config` | 品目・辞書・価格等の設定JSON。PUTは約100万文字guard | soft |
| `GET/PUT /store/:code/inventory` | 進行中在庫JSON。PUTは約100万文字guard | soft |
| `GET/POST /store/:code/history` | GETは新しい順50件。sessionIdを持つ行は`(shop_code, session_id)`で一意、持たないlegacy行は日付で一意（migration 0012） | soft |
| `DELETE /store/:code/history/:key` | `key`はsessionId（現行）または日付（legacy行）。日付指定では`session_id IS NULL`の行だけを消し、同日の別sessionを巻き込まない | soft |
| `PUT /store/:code/room` | `{ roomCode }`でactive roomを更新 | soft |
| `GET/POST /store/:code/orders` | `sinceDays`は1〜1000日、default 400。header + lines | soft |
| `DELETE /store/:code/orders/:id` | 同store ownerだけ削除。不在/他storeは404 | soft |
| `GET/POST /store/:code/movements` | `{ id?,date?,type,note?,orderId?,savedAt?,lines[] }`。positive qty行をD1へ保存。GETはdefault 400日、最大1000件 | soft |
| `DELETE /store/:code/movements/:id` | 同storeのheader/linesを削除し`{ok:true}` | soft |
| `GET/POST /store/:code/sessions` | 一覧または`type`が`stock` / `order`のbodyで作成 | strict同store Bearer |
| `PUT/DELETE /store/:code/sessions/:uuid` | status/itemCount更新または削除 | strict同store Bearer |
| `POST /store/:code/sessions/:uuid/complete` | `{ inventory, prices, takenAt? }` → `{ok,sessionId,itemCount,totalValue}` | strict同store Bearer |
| `GET /store/:code/sessions/:uuid/lines` | 完了済み棚卸の明細を`inventory_lines`から返す。`session_id`と`shop_code`の両方で絞り、他store/不在はどちらも404。単価・在庫金額を含むためguestには出さない | strict同store Bearer |
| `POST /store/:code/imports/:batchId/sessions` | 過去棚卸を1日ぶん取り込む。`{ date, items[], replaceSessionIds?[], snapshot? }` → `{ok,sessionId,date,itemCount,totalValue,importBatchId,replaced}`。session / `inventory_lines` / `store_history` を1つの`db.batch`で書く。同じ`batchId`＋同じ`date`の再送は同じsessionを貼り直す（冪等） | strict同store Bearer |
| `DELETE /store/:code/imports/:batchId` | 取込バッチ単位の取消。`{ok,removed,sessionIds[],importBatchId}`。`import_batch_id`が一致するsessionだけを消し、通常の棚卸（NULL）と別バッチには触れない。2回目は`removed:0`で成功（冪等） | strict同store Bearer |
| `POST/DELETE /store/:code/push/subscribe` | 8 KiB以下のPushSubscription、または`{endpoint}` | strict同store Bearer |

movementのpersist正本はD1 migration 0010で、Appはlocal cacheへ即時保存後にPOSTし、auth後/画面表示時に
GET結果をid mergeします。WebSocketによるreal-time movement同期はありません。入出庫（movement）のclient recordの
`source` / `importBatchId`は現行API/schemaへ保存されません（**過去棚卸取込の`importBatchId`は
migration 0013 で `sessions.import_batch_id` として保存されます**。両者は別物）。
本番D1は0010・0011・0012・0013が未適用です。

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
| [IMPORT-001](quality-foundation/tasks/IMPORT-001.md) | 過去棚卸取込API（`/imports/:batchId/*`）は実装済み・**migration 0013 は未適用**。実D1での確認は release gate（`WEB-04` / `WEB-07`）に残る |
| [WEB-001](quality-foundation/tasks/WEB-001.md) | canonical/CORS/Pages、本番0010/0011、Free server limits、E2E/smoke |

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
| GET | `/store/:code/history` | — | `[ snapshot, ... ]`（最新50件） | ソフト† |
| POST | `/store/:code/history` | スナップショット（`{ date, ... }`） | `{ ok: true }` | ソフト† |
| DELETE | `/store/:code/history/:date` | — | `{ ok: true }` | ソフト† |
| PUT | `/store/:code/room` | `{ roomCode }` | `{ ok: true }` | ソフト† |
| GET | `/store/:code/orders` | — | `[ order, ... ]` | ソフト† |
| POST | `/store/:code/orders` | 発注レコード | `{ ok: true, id }` | ソフト† |
| DELETE | `/store/:code/orders/:id` | — | `{ ok: true }` | ソフト† |
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
| POST | `/store/:code/sessions` | — | `{ id, shopCode, startedAt, status, itemCount }` | Bearer |
| PUT | `/store/:code/sessions/:id` | `{ status, itemCount? }` | `{ ok: true }` / 400 | Bearer |
| DELETE | `/store/:code/sessions/:id` | — | `{ ok: true }` | Bearer |
| POST | `/store/:code/sessions/:id/complete` | `{ inventory, totalValue, auditLog, participants }` | `{ ok, sessionId, itemCount }` | Bearer（§3.1 の実装・✅済み） |
| GET | `/store/:code/sessions/:id/lines` | — | `{ sessionId, date, startedAt, endedAt, status, type, itemCount, totalValue, truncated, lines[] }` / 404 | Bearer（DATA-002 Phase 1・✅済み） |

### 1.3.1 過去棚卸の取込API（`pastImport.js`・要認証 / IMPORT-001）

| メソッド | パス | リクエスト | レスポンス | 認証 |
|---|---|---|---|---|
| POST | `/store/:code/imports/:batchId/sessions` | `{ date, items[], replaceSessionIds?[], snapshot? }` | `{ ok, sessionId, date, itemCount, totalValue, importBatchId, replaced }` | Bearer |
| DELETE | `/store/:code/imports/:batchId` | — | `{ ok, removed, sessionIds[], importBatchId }` | Bearer |

取込で作るのは**通常の棚卸と同じ session** です（migration 0012 の sessionId identity をそのまま使う）。
`sessions.import_batch_id`（migration 0013）を持つ行だけが取込由来で、通常の棚卸は `NULL` です。

- **1リクエスト = 1日ぶん。** 複数日は client が同じ `batchId` で繰り返し呼びます。
  日数×品目数を1回のbatchへ入れると、D1 の 1 invocation あたりの statement 上限を超えるためです。
- **原子性**: session・`inventory_lines`・`store_history` を1つの `db.batch` で書きます。
  途中で落ちれば全部巻き戻り、`503` / `retryable: true` を返します。
- **冪等性**: 同じ `(shop_code, batchId, date)` は既存 session を貼り直します。再送でsessionは増えません。
  明細は貼り直し前に削除するので、品目が減った再取込で前回分が残りません。
- **同日衝突**: 既定では何も消さず、別 session として共存します（0012 で同日複数 session が可能）。
  上書きは client が `replaceSessionIds` で**明示指定した session だけ**を、`shop_code` の内側で削除します。
- **取消**: `import_batch_id` の一致だけを条件に消すため、別バッチと通常の棚卸は残ります。
- **検証**: 日付は実在日（`2026-02-30` は拒否）、`items` は `MAX_LINES_PER_REQUEST`（500）まで、
  数量は棚卸と同じ契約（`0` は正当・負数と非有限は拒否・`0` へ丸めない）、
  品目名 200 / 単位 50 文字で切り詰め、payload 全体は約100万文字guard。

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

```
POST /store/:code/sessions/:id/complete        （要認証）

リクエスト:
{
  inventory:    { "コーヒー豆": { qty: 5, unit: "kg", ... }, ... },
  totalValue:   48000,
  auditLog:     [ ... ],
  participants: [ ... ]
}

サーバー側の処理（1トランザクション相当）:
  1. inventory を inventory_lines に1品目1行で展開INSERT（当時の単価を焼き込む）
  2. 生スナップショット（auditLog含む）を R2 に保存
  3. sessions を status='completed', total_value, archive_key で更新

レスポンス:
{ ok: true, sessionId, itemCount, archiveKey }
```

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
