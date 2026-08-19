# 飲食店棚卸管理システム — 開発者向け仕様書

| 項目 | 内容 |
|---|---|
| **Status** | 現行W1 baseline（既知の未解消事項を含む） |
| **Role** | Web Free版の機能・architecture・data境界を説明するdeveloper向けoverview |
| **Source of truth** | [App code](../app/src/)、[Worker code](../worker/src/)、[D1 migrations](../worker/migrations/)、採用済み[D-015/D-016/D-019/D-021](quality-foundation/decisions.md) |
| **Last verified** | 2026-08-17 / `claude/data-002-worker-d1-api-bogzyq`（migration 0016 まで・本番未適用） |

この文書はrelease可否の正本ではありません。Web公開判定は
[Web公開準備](quality-foundation/web-release-readiness.md)、endpoint契約は
[API設計書](api-design.md)、同期詳細は[同期仕様](sync-spec.md)を優先します。
コードと本文が食い違う場合はコードを推測で補わず、差分を
[DOC-001](quality-foundation/tasks/DOC-001.md)または該当taskへ戻します。

## 0. 現在の公開scope

現在のW1は**Web/PWAのFree版**です。account登録、店舗code+PIN login、棚卸、発注、
入出庫、複数端末同期、履歴、取込・書出しを対象とします。14日trial、Stripe、Pro販売、
自動課金、Google Play/TWAはW1に含みません。

将来A1のAndroid trial / Web Stripeフローは[将来A1](#将来a1の境界現行仕様ではない)へ分離し、
未実装機能を現在形で記述しません。

## 現行W1 code baseline

| 領域 | `develop@bc9fb85`の実装 | 公開前のknown gap |
|---|---|---|
| 認証 | `/auth/register`で4桁PINをPBKDF2保存し30日Bearerを発行。`/auth/login`成功時は同店舗の旧tokenを全失効。config/inventory/history/orders/movementsはPIN設定店舗で同店舗Bearer必須、sessions/push/`/pdf`はstrict Bearer | [SEC-005](quality-foundation/tasks/SEC-005.md): 登録rate limit/bot対策なし、無認証legacy `/store/create`が残る |
| account削除 | `DELETE /auth/account`がBearer、現在PIN、店舗code完全一致、UUID requestIdを要求。棚卸/発注DOをpurge後、D1関連dataとtokenを削除し、匿名receipt/tombstoneを7日保持。200後だけAppが業務data、端末ID/名、天気位置/cache、Push、authをlocalから消す | 本番D1の0011適用、公開URL/canonical、実機確認は未完。[PLAY-002](quality-foundation/tasks/PLAY-002.md) / [WEB-001](quality-foundation/tasks/WEB-001.md) |
| 入出庫 | localStorage cacheに即時保存し、`GET/POST/DELETE /store/:code/movements*`でD1へ保存。auth後と入出庫page表示時にremoteをid mergeする。real-time WS同期は行わない | repositoryはmigration 0010前提だが本番未適用。header/linesの原子性と入力上限は[DATA-001](quality-foundation/tasks/DATA-001.md) |
| PDF | 現行App UIは`pdfjs-dist`でclient解析。Worker `POST /pdf`も残るがAppからの呼出しはない。endpointはactive Bearer必須、5 MiB上限、IP 30回/15分で制限 | endpointを公開面として残すかは[PLAY-003](quality-foundation/tasks/PLAY-003.md) / WEB-001で確定する |
| plan/trial | 通常登録は`plan=free`。backend応答は`{plan,isPro,inTrial:false,trialEndsAt:null}`で、trial/Stripe処理はない。通常Appの機能gateはbackend応答を保存せず、Pro Review用build変数以外をFree扱いする | 150品目・履歴3回はclient gate。2台制限は参加前client checkだけで、RoomDOは一律20接続まで許す。server entitlement整合はWEB-001 |
| 棚卸履歴 | `sessions`、`inventory_lines`、日付keyの`store_history`、端末local historyを併用 | snapshot保存とsession完了は独立write。同日上書き、孤児、別端末で詳細を読めない問題を[DATA-001](quality-foundation/tasks/DATA-001.md) / [DATA-002](quality-foundation/tasks/DATA-002.md)で未解消 |

repositoryのCORS実装はfail-closedですが、許可host設定と稼働中production Workerは現行repositoryと
一致していません。migration 0010〜0016、Pages routing、CORS、smokeを含む公開状態は
[Web公開準備](quality-foundation/web-release-readiness.md)だけで判定します。

## 将来A1の境界（現行仕様ではない）

[D-021](quality-foundation/decisions.md#d-021--web先行とplay向け将来フローの分離)で確定した将来像は、
Android app内登録を起点とする14日Pro trial、終了後Free、Webで明示契約したStripe entitlementの
同一accountへの反映です。Web登録者へのtrial、Stripe/backendの単独公開順、起算・再登録防止・grace、
価格と上限は未決です。W1 codeにこれらの処理はありません。

---

## 1. 参考snapshot（旧オンボーディング本文）

> 以下は従来の設計説明を履歴参照用に残したものです。現行挙動・認証・公開可否の判断には使用せず、
> 上の「現行W1 code baseline」とAPI設計書、code/migrationを優先してください。

### 背景と課題

飲食店の棚卸作業は月1〜2回、閉店後に手作業で行われる。紙に在庫を書き出しながら複数スタッフが分担するが、集計のタイピングミス・転記漏れ・複数端末の結果マージが属人化しており、1回の棚卸に2〜3時間かかるケースも珍しくない。

### 解決アプローチ

- **音声入力**: 棚の前でスマホに話しかけるだけで数量を登録
- **辞書変換**: 音声認識の誤認識を品目別辞書で自動補正
- **リアルタイム同期**: 複数スタッフが別エリアを同時に担当し、結果が即時合算される
- **完了履歴**: 過去セッションのスナップショットをカテゴリ別に閲覧・CSV出力できる

### 対象ユーザー

飲食店オーナー・店長・パート従業員。技術知識は不要。スマートフォン（iOS/Android）のブラウザで動作する PWA として提供する。

---

## 2. システム要件

### 2.1 機能要件

| # | 機能 | 詳細 |
|---|------|------|
| F-01 | 店舗登録・ログイン | 店舗コード + PIN 認証。複数端末から同一店舗にアクセス可能 |
| F-02 | 品目リスト管理 | PDF / CSV / Excel からインポート。カテゴリ付き品目マスタを D1 に保存 |
| F-03 | 棚卸セッション | セッション単位で開始・中断・再開・完了を管理 |
| F-04 | 在庫入力 | テキスト入力・音声入力（Web Speech API）。数量・単位を登録 |
| F-05 | 辞書補正 | 音声認識結果を品目ごとの別名辞書で正規化 |
| F-06 | リアルタイム同期 | WebSocket（Durable Object）でホスト/ゲスト間の在庫を即時共有 |
| F-07 | 変更履歴 | 誰がいつ何を変更したかの auditLog を Durable Object に保持 |
| F-08 | 完了・スナップショット | セッション完了時に在庫をカテゴリ別スナップショットとして保存 |
| F-09 | 履歴閲覧・CSV出力 | 完了スナップショットをカテゴリアコーディオンで表示し CSV ダウンロード |
| F-10 | チャット | セッション中のスタッフ間テキストチャット（WebSocket 経由） |
| F-11 | 発注 | 発注セッション、発注履歴、入庫への反映を管理 |
| F-12 | 入出庫 | 入庫・出庫をlocal cacheとD1へ保存し、棚卸と合わせて理論在庫を算出 |
| F-13 | account削除 | App内または公開Web画面から再認証し、account関連dataを削除 |

### 2.2 非機能要件

| 区分 | 要件 |
|------|------|
| パフォーマンス | 音声入力の遅延 < 500ms。在庫更新の他端末への反映 < 1秒（WebSocket） |
| オフライン | 接続断中も入力継続可能。再接続時に updatedAt タイムスタンプでマージ |
| モバイル最適化 | iPhone SE2 以上で動作。タップ領域 44px 以上。最小フォント 13px |
| PWA | ホーム画面追加・オフラインキャッシュ（vite-plugin-pwa + Workbox） |
| セキュリティ | Bearer token、PIN再認証、店舗境界、CORS fail-closed。shopCodeだけを秘密情報とは扱わない |
| スケーラビリティ | Cloudflare のエッジで自動スケール。1 DO = 1 店舗ルームで他店舗との完全分離 |

---

## 3. アーキテクチャ

### 3.1 全体構成

```
┌─────────────────────────────────────────────────────────────────┐
│                         ブラウザ (PWA)                           │
│                                                                   │
│  App.vue ─── SessionListPage / InventoryView / Modals            │
│               │                                                   │
│  Composables: useSession / useInventory / useConfig               │
│               useSync / useAuth / useHistory / useStore           │
│               │                                                   │
│  localStorage: 在庫・品目・認証トークン・履歴スナップショット      │
└──────────────────────┬───────────────────────────────────────────┘
                       │ HTTPS REST / WebSocket
┌──────────────────────▼───────────────────────────────────────────┐
│                  Cloudflare Workers (index.js)                    │
│  ルーティング・認証検証・D1 クエリ・Durable Object 転送            │
└───────────────────┬──────────────────────────┬───────────────────┘
                    │                          │
        ┌───────────▼──────────┐  ┌───────────▼────────────┐
        │  D1 (SQLite)         │  │  Durable Object        │
        │  stores / sessions   │  │  RoomDO                │
        │  セッション履歴・認証  │  │  WebSocket ハブ         │
        │                      │  │  在庫デルタ同期          │
        │                      │  │  auditLog              │
        └──────────────────────┘  └────────────────────────┘
```

### 3.2 技術スタック

| レイヤー | 技術 | 選定理由 |
|---------|------|---------|
| フロントエンド | Vue 3 + Vite | Composition API の composable パターンが状態分離に適している |
| PWA | vite-plugin-pwa + Workbox | ホーム画面追加・オフラインキャッシュ |
| 音声認識 | Web Speech API | ネイティブ API のため追加 SDK 不要 |
| PDF解析 | pdfjs-dist | クライアント側処理（Worker 移行を検討中→ roadmap.md） |
| HTTP + Auth | Cloudflare Workers | エッジ実行、D1/DO へのバインディングが標準機能 |
| リアルタイム同期 | Cloudflare Durable Objects | 1店舗 = 1 DO インスタンスで分離・WebSocket を集中管理 |
| DB | Cloudflare D1 (SQLite) | セッション履歴・認証。無料枠で十分 |
| ホスティング | Cloudflare Pages | Workers と同一プラットフォームでデプロイが単純 |

---

## 4. データモデル

### 4.1 D1 スキーマ

スキーマの正は `worker/migrations/`（0001〜0016）。主要テーブルの概要:

| テーブル | 役割 | 補足 |
|---|---|---|
| `stores` | 店舗・認証・プラン・削除状態 | `pin_hash` は **PBKDF2**（100,000反復・ランダムsalt、旧SHA-256からログイン時に透過移行）。削除中は`deletion_pending_at` / `deletion_request_id`、完了後は7日匿名tombstone |
| `auth_tokens` | Bearer トークン（30日有効） | ログインごとに発行。`stores` とは分離 |
| `sessions` | 棚卸/発注セッション | `type` 列で棚卸(stock)/発注(order)を区別。status は `active`/`completed`（旧 `incomplete` は後方互換で受理のみ） |
| `store_history` | 完了スナップショット | 最新50件。R2アーカイブ移行が将来課題（db-design-v2） |
| `inventory_lines` | 1品目1行の時系列（分析用） | db-design-v2 Step 1 |
| `orders` | 発注レコード | v0.48 |
| `movements` / `movement_lines` | 入出庫レコード | 0010 |
| `login_attempts` / `ip_attempts` | レート制限 | フェイルオープン実装 |
| `push_subscriptions` | プッシュ通知購読 | |
| `account_deletion_receipts` | 削除再送の冪等receipt | account識別子なし、7日後cron削除（0011） |
| `import_batch_requests` | 過去棚卸取込の要求台帳（応答喪失からの再送判定） | 0015。**本番未適用** |
| `session_completions` | 棚卸完了のclaim（確定は最初の1要求だけ） | 0016。**本番未適用** |

### 4.2 localStorage キー（`utils/storageKeys.js` で一元管理）

キーの正（名前・一覧）は `app/src/utils/storageKeys.js` の `STORAGE_KEYS`。ここでは分類のみ:

| 分類 | キー例 | 備考 |
|-----|----|------|
| 業務データ | `inventory_v1` / `inventory_config_v1` / `inventory_history_v1` / `inventory_orders_v1` / `inventory_movements_v1` / `inventory_aliases_v1` / `inventory_master_v1` | **アカウント切替時に全消去**（`_data_owner` マーカー・S-10 対策、`composables/accountData.js`） |
| 認証・セッション | `_auth_token` / `_auth_store_name` / `_shop_code` / `_pending_session_v1` / `_sync_session_v1` / `_host_token_<shopCode>` | `_auth_token` は平文保存。CSPは`app/public/_headers`に設定済み |
| 端末固有（保持） | `_device_id` / `_device_name` / UI設定 | アカウント切替でも消さない |

### 4.3 Durable Object 状態

DO Storage（永続化）とメモリ（接続中のみ）の2層。

```
DO Storage:
  inventory      → Map<item, { qty, unit, updatedAt }>
  auditLog       → Array<AuditEntry>（最大200件）
  hostToken      → string（ホスト認証用）
  config         → { items[], aliases{} }

メモリ（WebSocket セッション）:
  connections    → Map<ws, { role, deviceId, displayName, sessionUUID }>
  sessionId      → 現在の D1 sessions.id（ゲストへの通知用）
```

---

## 5. コンポーネント構成

### 5.1 画面遷移

```
landing
  └─ sessions（SessionListPage.vue）
       ├─ [新規開始] → session-view
       └─ [再開]    → session-view
            ├─ SyncModal.vue   （ルーム作成・参加・履歴）
            ├─ ConfirmModal.vue （数量確認ダイアログ）
            ├─ ChatModal.vue   （スタッフチャット）
            └─ HistoryModal.vue（完了履歴閲覧・CSV）
```

### 5.2 Composable 責務

| Composable | 責務 | シングルトン |
|------------|------|------------|
| `useSession.js` | D1 sessions テーブルへの書き込み集約。`_finalized` フラグで完了後の上書きを防止 | ✅ |
| `useInventory.js` | 在庫 CRUD・localStorage 永続化・`filledCount` 算出 | ✅ |
| `useConfig.js` | 品目リスト・辞書・CSV/PDF インポート・D1 設定同期 | ✅ |
| `useSync.js` | WebSocket 接続管理・ホスト/ゲスト役割・在庫デルタ配信 | ✅ |
| `useAuth.js` | Bearer トークン管理・セッション CRUD API | ✅ |
| `useHistory.js` | 完了スナップショット保存・CSV エクスポート | ✅ |
| `useStore.js` | `shopCode` リアクティブ ref（他 composable で共有） | ✅ |

> シングルトン = モジュールスコープで状態を保持。`useXxx()` は同一インスタンスを返す。

---

## 6. セッションライフサイクル

```
SessionListPage
  │
  ├─[新規開始]─▶ createSession(D1) → begin() → resetToDefault() → session-view
  │                                                  ↑ 品目リストをリセット（毎回インポート必須）
  │
  └─[再開]─────▶ resume(session)  → loadConfig(D1) → session-view
                                      ↑ 前回の品目リストを復元

session-view（入力中）
  │  filledCount が変化するたびに touch(count) → 2秒デバウンス → updateSession(active)
  │
  ├─[完了]──────▶ complete(count) → updateSession(completed) → saveSnapshot() → sessions
  │
  └─[一覧へ戻る]▶ leaveRoom()（ゲストはそのまま継続）
                   markActive(count) → updateSession(active)
                   clearSession() → sessions
```

### `useSession.js` の不変条件

- `_finalized = true` になった後は `touch()` / `markActive()` が D1 への書き込みをスキップする
- `complete()` は必ず保留中の `touch()` タイマーをキャンセルしてから `_finalized = true` にセットする
- `begin()` / `resume()` / `clear()` は `_finalized` をリセットする

---

## 7. リアルタイム同期

詳細は `docs/sync-spec.md` を参照。ここでは概要のみ記載。

### 接続トポロジー

```
ホスト ─── WebSocket ─── Durable Object (RoomDO) ─── WebSocket ─── ゲスト A
                                                 └── WebSocket ─── ゲスト B
```

### ホスト退出時の動作（v2 以降）

ホストが「一覧へ戻る」を選択した場合:
1. ホスト側: `leaveRoom()` → WebSocket 切断。DO はルームを維持する
2. ゲスト側: `host_left` イベントを受信 → ゲストは接続継続し入力を継続できる
3. ホストが再度ルームに入室した場合: `hostToken` で再認証しホスト権限を回復

> `dissolveRoom()` はルームを完全破棄（全員切断）。ホストが「完了」した場合のみ使用する。

### 在庫マージ（オフライン対応）

再接続時に `_disconnectedAt` タイムスタンプと各エントリの `updatedAt` を比較する三方向マージを実施。ローカル優先・サーバー優先のどちらが適切かを品目ごとに判定する。

---

## 8. Worker API 一覧

**API の正は `docs/api-design.md`**（認証区分・リクエスト/レスポンス形式を含む）。
主な系統: `/auth/*`（認証）、`/store/:code/*`（config・inventory・history・sessions・orders・
push/subscribe・sessions/:id/complete）、`/room/:code/*`（ws・status・dissolve・result）、
`/pdf`、`/health`。

認証は3段階: Bearer必須（sessions、push、`/pdf`）／ソフト認証（PIN設定店舗のみ同店舗Bearer必須 =
`verifyStoreAccess`）／無認証（resultはURLが鍵＋IPレート制限）。`/pdf`は5 MiBとIP 30回/15分でも制限する。

---

## 9. 開発・デプロイ手順

### ローカル開発

```bash
# フロントエンド
cd app
cp .env.example .env.local   # VITE_SYNC_WORKER_URL を設定
npm install
npm run dev

# Worker（ローカル）
cd worker
npx wrangler dev
```

### ビルド・デプロイ

```bash
# フロントエンド
cd app && npm run build       # コミット前に必ず実行（型チェック兼）

# Worker
cd worker && npx wrangler deploy
```

### ブランチ戦略

- 開発ブランチ: `claude/restaurant-inventory-system-0XNHA`
- main へのマージは動作確認後に手動 PR

---

## 10. 既知の制限・今後の課題

実行計画は `docs/roadmap.md`・現在地は `docs/project-status.md`。主要な既知課題を抜粋（2026-07-15更新）:

| 課題 | 影響 | 対応状況 |
|------|------|---------|
| 入出庫はlocal cache + D1だが本番0010未適用 | repository実装は端末間取得に対応するが、production schemaでは利用不可 | WEB-001でmigration preflight・適用・smoke |
| PIN 忘れ時の復旧手段がない | 完全ロックアウト（連絡先を保持していない） | リカバリーコード or メールを検討（C-07） |
| `/pdf`はguard済みだが現行App未使用 | 不要な公開endpointならattack surfaceが残る | PLAY-003 / WEB-001で存廃を決定 |
| CSPあり・tokenはlocalStorage平文 | XSS成立時のtoken漏洩riskは残る | production responseでCSPをsmokeし、XSS対策を継続 |
| Google OAuth 未対応 | PIN 管理が必要 | Phase 2 候補 |
| App.vue 3,400行 | 同期バグ混入率 | R-01 分割（専用セッション推奨） |
