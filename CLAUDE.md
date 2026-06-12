# CLAUDE.md — 飲食店棚卸管理システム

飲食店の棚卸作業を高速化するスマホWebアプリ。音声入力→辞書変換→在庫記録、複数端末リアルタイム同期。

## 技術スタック（現在）

| レイヤー | 技術 |
|---|---|
| フロントエンド | Vue 3 + Vite（PWA） |
| 同期 | Cloudflare Durable Objects + WebSocket |
| DB | Cloudflare D1（SQLite）— セッション・認証・店舗データ永続化 |
| 認証 | Bearer トークン（D1 管理） |
| ストレージ | localStorage（高速キャッシュ）＋ D1（在庫・設定・履歴の正） |

## 主要ファイル

```
app/src/
  App.vue                   # ルートコンポーネント・コールバック登録
  composables/
    useSync.js              # WebSocket同期・全クライアント状態
    useInventory.js         # 在庫CRUD・localStorage永続化
    useConfig.js            # 品目リスト・辞書・CSV取込
    useAuth.js              # 認証・セッションAPI
    useStore.js             # 店舗コード・D1連携
  components/
    SyncModal.vue           # ルーム管理・変更履歴タブ
    ConfirmModal.vue        # 数量入力確認
    ChatModal.vue           # チャット
  utils/storageKeys.js      # localStorageキー一元管理
worker/src/
  index.js                  # Cloudflare Worker ルーター
  RoomDO.js                 # Durable Object（WS・在庫・auditLog）
  db.js                     # D1 クエリ
```

## 開発ルール

- **ブランチ**: `claude/restaurant-inventory-system-0XNHA`
- **ビルド確認**: `cd app && npm run build` をコミット前に必ず実行
- **構成**: フロント = Netlify（`dist` を手動アップロード）／ バックエンド = Cloudflare Worker + D1
- **デプロイ**: `./scripts/deploy.sh` を使う（テスト → 未適用マイグレーションのみ適用 → Worker → フロントビルドの順を自動化。手動デプロイは migration 漏れ事故の元）
  - `./scripts/deploy.sh backend` … D1 マイグレーション + Worker のみ
  - `./scripts/deploy.sh frontend` … テスト + フロントビルドのみ（後は `app/dist` を Netlify にドロップ）
- フロントは `VITE_SYNC_WORKER_URL` をビルド時に埋め込むため、ローカルでビルドした `dist` をそのまま Netlify に上げる（Netlify 側のビルド設定は不要）
- **コメントは書かない**（WHYが非自明な場合のみ1行）
- 型なし（TypeScriptは不使用）
- Vue 3 `<script setup>` 記法で統一

## 同期の基本設計（バグ調査時の参照用）

- `shopCode` = 店舗コード = DO ルームID（統一）
- `sessionId` で新旧セッションを区別（新規 = ID変化、再開 = ID同一）
- ゲスト参加時は**必ずホストの品目リスト・在庫に揃える**（ローカルを上書き）
- `hostToken` = DO が発行・localStorage に保存・再接続時に検証
- `updatedAt` タイムスタンプでオフラインマージ（ローカルが新しければ再送信）

## 詳細ドキュメント

- バックログ・優先度 → `docs/backlog.md`
- 同期アーキテクチャ詳細 → `docs/sync-spec.md`
- Phase 2 分析機能仕様 → `docs/phase2.md`
- DB設計v2（スケール・10年運用）→ `docs/db-design-v2.md`
