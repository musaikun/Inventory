# CLAUDE.md — 飲食店棚卸管理システム

飲食店の棚卸作業を高速化するスマホWebアプリ。音声入力→辞書変換→在庫記録、複数端末リアルタイム同期。

作業開始時は **`docs/quality-foundation/README.md` を最初に読む**。現状、優先タスク、担当、未決事項、
直近の再開地点を Codex / Claude Code と共有している。

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
  storeHandler.js           # 店舗データ・D1 クエリ
  authHandler.js            # 店舗認証
```

## 開発ルール

- **ブランチ**: 固定名を前提にせず、作業開始時に `git branch --show-current` で確認
- **ビルド確認**: `cd app && npm run build` をコミット前に必ず実行
- **品質集中期間**: 2026-07-27〜2026-08-08はGoogle Play要件と品質基盤以外の新機能を停止
- **共有タスク**: 着手前に `docs/quality-foundation/task-list.md` の状態・担当を更新し、
  完了時に検証結果と `docs/quality-foundation/session-log.md` を更新
- **新機能・仕様変更は `docs/feature-checklist.md`（共通DoD）でセルフチェック**してから完了とする。
  N/A 項目は理由を一言残す。取り込み時に PM セッションが再照合する
- **設計判断・仕様提案は `docs/proposals.md`（提案箱）へ投稿**する。テンプレに従い日付見出しで
  先頭に追記（1提案=概要/背景・根拠/影響範囲・実装状況/PM判断⬜）。恒久docsへの反映可否は
  PM セッションがトリアージする。**実装済みでも「合意済み」ではない**。
  ただし `docs/quality-foundation/` の共有作業記録と、採用済み仕様に対する鮮度修正は直接更新してよい
- **構成**: フロント = Cloudflare Pages ／ バックエンド = Cloudflare Worker + D1（すべて Cloudflare に統一）
- **develop preview（自動）**: GitHub Actions（`.github/workflows/develop-preview.yml`）
  - `develop` へ push → Worker/App test → App build → Pages preview
  - 固定URL: `https://develop.inventory-app-c40.pages.dev`
  - D1、Worker、本番Pagesは変更しない。preview frontendは本番Workerを参照する
- **本番デプロイ**: 現在は自動workflowなし。Userの明示承認後に手動フォールバックを使用
  - セットアップと仕組み → `docs/ci-cd.md`
- **デプロイ（手動・フォールバック）**: `./scripts/deploy.sh`（テスト → 未適用マイグレーションのみ適用 → Worker → Pages）
  - `./scripts/deploy.sh backend` … D1 マイグレーション + Worker のみ
  - `./scripts/deploy.sh frontend` … テスト + ビルド + Pages のみ
  - マイグレーション適用ロジックは `scripts/migrate.sh`（CI と共用）
- フロントは `VITE_SYNC_WORKER_URL` をビルド時に埋め込むため、ローカルビルド→`wrangler pages deploy` 方式（Pages 側のビルド設定・環境変数は不要）
- 型なし（TypeScriptは不使用）
- Vue 3 `<script setup>` 記法で統一

（コメント方針・コミット前の検証など全プロジェクト共通のルールは `~/.claude/CLAUDE.md`）

## 同期の基本設計（バグ調査時の参照用）

- `shopCode` = 店舗コード = DO ルームID（統一）
- `sessionId` で新旧セッションを区別（新規 = ID変化、再開 = ID同一）
- ゲスト参加時は**必ずホストの品目リスト・在庫に揃える**（ローカルを上書き）
- `hostToken` = DO が発行・localStorage に保存・再接続時に検証
- `updatedAt` タイムスタンプでオフラインマージ（ローカルが新しければ再送信）

## 詳細ドキュメント

- **共同品質基盤の入口 → `docs/quality-foundation/README.md`**
- **現況と方向性（全体の索引）→ `docs/project-status.md`**
- **長期戦略・設計原則（羅針盤）→ `docs/strategy-10yr.md`**
- 全体レビュー（PM/QA/セキュリティ横断・優先度の根拠）→ `docs/holistic-review-2026-07.md`
- セッション提案箱（実装/戦略→PM・上り）→ `docs/proposals.md` ／ 取り込みレビュー（PM→実装・下り）→ `docs/intake-reviews.md`
- 企業導入（多店舗）設計 → `docs/enterprise-design.md`
- CI/CD パイプライン → `docs/ci-cd.md`
- 実行計画（トラック別・ウェーブ）→ `docs/roadmap.md`
- 同期アーキテクチャ詳細 → `docs/sync-spec.md`
- 料金・獲得戦略（未実装メモ）→ `docs/pricing-strategy.md`
- DB設計v2（スケール・10年運用）→ `docs/db-design-v2.md`
- 新機能テスト項目一覧 → `docs/test-checklist-new-features.md`
