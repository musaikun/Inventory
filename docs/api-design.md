# API設計書 — 飲食店棚卸システム

このドキュメントは2つの役割を持つ：
1. **学習用** — 「APIとは何か」を、このアプリの実コードを教材に理解する
2. **設計書** — 現状のAPIを明文化し、v2（DB設計v2）で追加するAPIを設計する

---

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
そこから呼ばれる実処理は `storeHandler.js` / `authHandler.js` にある。

### 1.1 認証API（`authHandler.js`）

| メソッド | パス | リクエスト | レスポンス | 認証 |
|---|---|---|---|---|
| POST | `/auth/register` | `{ storeName?, pin }` | `{ shopCode, token, storeName }` | 不要 |
| POST | `/auth/login` | `{ shopCode, pin }` | `{ token, shopCode, storeName }` | 不要 |
| POST | `/auth/logout` | （Bearerトークン） | `{ ok: true }` | Bearer |

- `register` = 新規店舗を作りPINを設定、トークン発行（30日有効）
- `login` = 店舗コード＋PINを照合、トークン発行
- トークンは以後 `Authorization: Bearer <token>` ヘッダーで送る

### 1.2 店舗データAPI（`storeHandler.js`）

| メソッド | パス | リクエスト | レスポンス | 認証 |
|---|---|---|---|---|
| POST | `/store/create` | — | `{ shopCode }` | 不要（PIN必須化と合わせ廃止検討・監査②） |
| GET | `/store/:code` | — | `{ shopCode, activeRoom, plan, isPro, inTrial, ... }` / 404 | 不要 |
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
| POST | `/store/:code/push/subscribe` | 購読オブジェクト | `{ ok: true }` | ⚠️ ソフト認証ゲート外（監査 S-F・要修正） |
| DELETE | `/store/:code/push/subscribe` | — | `{ ok: true }` | ⚠️ 同上 |

> † **ソフト認証**（`verifyStoreAccess`・S-02）: PIN設定済み店舗は Bearer 必須。
> レガシー（PIN未設定）店舗は店舗コードのみで許可（後方互換・S-C の残課題）。

### 1.3 セッションAPI（`storeHandler.js`・要認証）

| メソッド | パス | リクエスト | レスポンス | 認証 |
|---|---|---|---|---|
| GET | `/store/:code/sessions` | — | `[ session, ... ]`（最新50件） | Bearer |
| POST | `/store/:code/sessions` | — | `{ id, shopCode, startedAt, status, itemCount }` | Bearer |
| PUT | `/store/:code/sessions/:id` | `{ status, itemCount? }` | `{ ok: true }` / 400 | Bearer |
| DELETE | `/store/:code/sessions/:id` | — | `{ ok: true }` | Bearer |
| POST | `/store/:code/sessions/:id/complete` | `{ inventory, totalValue, auditLog, participants }` | `{ ok, sessionId, itemCount }` | Bearer（§3.1 の実装・✅済み） |

### 1.4 リアルタイム・その他（`index.js` → RoomDO）

| メソッド | パス | 役割 |
|---|---|---|
| GET | `/room/:code/ws` | WebSocket接続（同期の本体・Durable Object）。店舗存在チェック＋probeレート制限（S-06） |
| GET | `/room/:code/status` | 退室中ホストのライブ品目数（`orderItemCount`＝発注済み品目数も返す） |
| POST | `/room/:code/dissolve` | 残存ルームの掃除 |
| GET | `/room/:code/result?s=...` | 完了後ゲスト閲覧（無認証・URLが鍵・金額除去 → `room-url-design.md`） |
| GET | `/api/push/vapid-key` | プッシュ公開鍵 |
| POST | `/pdf` | PDFから品目テキスト抽出 ⚠️ **無認証・サイズ無制限（監査 S-D・要対策）** |
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
| ✅ 認証の濃淡（対応済み） | ソフト認証（S-02）導入済み。**残**: レガシー店舗のフェイルオープン（S-C）・push/subscribe のゲート外（S-F） | `security-review.md` |
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
