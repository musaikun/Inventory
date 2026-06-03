# 飲食店棚卸管理システム — 開発者向け仕様書

## 1. プロジェクト概要

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

### 2.2 非機能要件

| 区分 | 要件 |
|------|------|
| パフォーマンス | 音声入力の遅延 < 500ms。在庫更新の他端末への反映 < 1秒（WebSocket） |
| オフライン | 接続断中も入力継続可能。再接続時に updatedAt タイムスタンプでマージ |
| モバイル最適化 | iPhone SE2 以上で動作。タップ領域 44px 以上。最小フォント 13px |
| PWA | ホーム画面追加・オフラインキャッシュ（vite-plugin-pwa + Workbox） |
| セキュリティ | Bearer トークン認証。shopCode を DO ルームID として使用（推測困難な英数字） |
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
| PDF解析 | pdfjs-dist | クライアント側処理（Worker 移行を検討中→ backlog.md） |
| HTTP + Auth | Cloudflare Workers | エッジ実行、D1/DO へのバインディングが標準機能 |
| リアルタイム同期 | Cloudflare Durable Objects | 1店舗 = 1 DO インスタンスで分離・WebSocket を集中管理 |
| DB | Cloudflare D1 (SQLite) | セッション履歴・認証。無料枠で十分 |
| ホスティング | Cloudflare Pages | Workers と同一プラットフォームでデプロイが単純 |

---

## 4. データモデル

### 4.1 D1 スキーマ

```sql
-- 店舗（認証）
CREATE TABLE stores (
  shop_code   TEXT PRIMARY KEY,  -- 英数字 6〜8 文字
  store_name  TEXT,
  pin_hash    TEXT NOT NULL,     -- bcrypt
  token       TEXT,              -- Bearer トークン（ログインごとに再発行）
  created_at  TEXT DEFAULT (datetime('now'))
);

-- 棚卸セッション
CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,  -- UUID v4
  shop_code   TEXT NOT NULL REFERENCES stores(shop_code),
  status      TEXT NOT NULL CHECK(status IN ('active', 'completed')),
  item_count  INTEGER DEFAULT 0,
  started_at  TEXT DEFAULT (datetime('now')),
  ended_at    TEXT
);
```

> `status = 'incomplete'` は旧バージョンとの後方互換のため Worker 側で受け付けるが、
> フロントエンドは `active` / `completed` のみ発行する。

### 4.2 localStorage キー（`utils/storageKeys.js` で一元管理）

| キー | 型 | 内容 |
|-----|----|------|
| `_auth_token` | string | Bearer トークン |
| `_auth_store_name` | string | 店舗名 |
| `shop_code` | string | 店舗コード |
| `pending_session` | JSON | 継続中セッション `{ id, status, itemCount, startedAt }` |
| `inventory_data` | JSON | 在庫数量 `{ [item]: { qty, unit, updatedAt } }` |
| `config_items` | JSON | 品目リスト `[{ name, unit, category }]` |
| `config_aliases` | JSON | 音声補正辞書 `{ [正規名]: string[] }` |
| `inventory_history` | JSON | 完了スナップショット配列（最新50件） |
| `device_id` | string | 端末固有 UUID（WebSocket の enteredById） |
| `_host_token_{shopCode}` | string | DO 発行のホスト認証トークン |

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

| メソッド | パス | 説明 |
|---------|------|------|
| POST | `/auth/register` | 店舗登録（shopCode 発行） |
| POST | `/auth/login` | ログイン（トークン発行） |
| POST | `/auth/logout` | ログアウト（トークン無効化） |
| GET | `/store/:code/sessions` | セッション一覧取得 |
| POST | `/store/:code/sessions` | セッション新規作成 |
| PUT | `/store/:code/sessions/:id` | ステータス・品目数更新 |
| DELETE | `/store/:code/sessions/:id` | セッション削除 |
| GET | `/store/:code/config` | 品目リスト・辞書取得 |
| PUT | `/store/:code/config` | 品目リスト・辞書保存 |
| GET | `/ws` + Upgrade | WebSocket（Durable Object へ転送） |

全エンドポイント（`/auth` 系を除く）は `Authorization: Bearer <token>` が必須。

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

`docs/backlog.md` に優先度付きで整理済み。主要なものを抜粋:

| 課題 | 影響 | 対応状況 |
|------|------|---------|
| PDF解析がクライアント側処理 | iPhone SE2 でタイムアウトする場合がある | Worker 側移行を検討中 |
| 在庫データが localStorage のみ | 端末変更・ブラウザ削除でデータ消失 | D1 移行を検討中 |
| PIN 忘れ時の復旧手段がない | shopCode + hostToken のエクスポート機能で対応予定 | 未実装 |
| Google OAuth 未対応 | PIN 管理が必要 | Phase 2 候補 |
