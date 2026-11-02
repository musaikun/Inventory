# AGENTS.md — 飲食店棚卸管理システム（全agent共通の指示）

飲食店の棚卸作業を高速化するスマホWebアプリ。音声入力→辞書変換→在庫記録、複数端末リアルタイム同期。

このファイルが Codex / Claude Code / その他の coding agent に**共通する指示の正本**です。
`CLAUDE.md` はこのファイルを読み込み、Claude Code 固有の差分だけを持ちます（→ D-029）。
共通ルールを `CLAUDE.md` や各 agent のユーザー設定（`~/.claude/` など）に書かないこと。
クラウドのセッションにはユーザー設定が無く、そこにだけ書いたルールは届きません。

## 読む順番（段階的に読む）

全部を最初に読まない。**段階1だけ読んで作業を始め、必要になったら段階2・3を読む。**

### 段階1 — 毎回読む（小さく保つ）

1. このファイル
2. [`docs/README.md`](docs/README.md) — docs全体の索引・正本の表・情報の優先順位
3. [`docs/quality-foundation/task-list.md`](docs/quality-foundation/task-list.md) — **状態の正本**（進捗ボード）
4. [`docs/quality-foundation/session-log.md`](docs/quality-foundation/session-log.md) の**先頭から数件だけ** — 直近の作業と再開地点

### 段階2 — 作業の種類に応じて読む

| 作業 | 読むもの |
|---|---|
| 既存タスクの続き | `docs/quality-foundation/tasks/<ID>.md` |
| 機能の追加・仕様変更 | 関係する現行仕様（`docs/README.md` の「現行仕様・設計」表）と [`docs/feature-checklist.md`](docs/feature-checklist.md) |
| 同期・WebSocket・DO | [`docs/sync-spec.md`](docs/sync-spec.md) と、このファイルの「同期の基本設計」 |
| API・認可・D1 | [`docs/api-design.md`](docs/api-design.md)、[`docs/security-review.md`](docs/security-review.md)、`worker/migrations/` |
| 公開gate・release | [`docs/quality-foundation/web-release-readiness.md`](docs/quality-foundation/web-release-readiness.md)、[`docs/ci-cd.md`](docs/ci-cd.md) |
| 他のagentと並行作業 | [`docs/quality-foundation/working-agreement.md`](docs/quality-foundation/working-agreement.md) |
| 過去の判断の根拠 | [`docs/quality-foundation/decisions.md`](docs/quality-foundation/decisions.md) を `D-0xx` で検索して該当項目だけ |
| Google Play（A1） | `google-play-readiness.md`、`quality-scorecard.md`（どちらも `docs/quality-foundation/`） |

### 段階3 — 必要なときだけ探す（通読しない）

- `docs/quality-foundation/archive/` — 前月以前の session log・提案の月別snapshot
- [`docs/proposals.md`](docs/proposals.md) — 提案箱。該当する提案の見出しだけ読む
- dated audit（`*-2026-07*.md`）、`docs/export/` — 当時の証拠。現在仕様として使わない

## 技術スタック（現在）

| レイヤー | 技術 |
|---|---|
| フロントエンド | Vue 3 + Vite（PWA） |
| 同期 | Cloudflare Durable Objects + WebSocket |
| DB | Cloudflare D1（SQLite）— セッション・認証・店舗データ永続化 |
| 認証 | Bearer トークン（D1 管理） |
| ストレージ | localStorage（高速cache）＋ D1（認証・店舗・在庫を永続化。履歴詳細read pathはDATA-002で未解消） |

- 型なし（TypeScriptは不使用）。Vue 3 `<script setup>` 記法で統一
- 構成: フロント = Cloudflare Pages ／ バックエンド = Cloudflare Worker + D1（すべて Cloudflare）
- Cloudflare Workers / Durable Objects の変更では、実装時点の公式ドキュメントと利用可能な
  Cloudflare skills を確認する

## 主要ファイル（入口だけ。全体は `app/src/` を見る）

```
app/src/
  App.vue                   # ルートコンポーネント・コールバック登録
  composables/
    useSync.js              # WebSocket同期・全クライアント状態
    useInventory.js         # 在庫CRUD・localStorage永続化
    useConfig.js            # 品目リスト・辞書・CSV取込
    useAuth.js              # 認証・セッションAPI
    useStore.js             # 店舗コード・D1連携
    importRecipes.js        # 取込レシピ（読み方の保存・自動適用／CSV・Excel・PDF共通）
  components/
    SyncModal.vue           # ルーム管理・変更履歴タブ
    ConfirmModal.vue        # 数量入力確認
    ChatModal.vue           # チャット
    ImportMapper.vue        # 列指定（問いを1つずつ→元データの上に色で対応を書く。PDF由来なら元の紙も出せる）
    ImportBuildPreview.vue  # 組み上がる棚卸カードの全画面プレビュー
    PdfGridSetup.vue        # PDFを表に均す画面（枚数を訊き、組んだ表を人がその場で直す）
    PdfPageViewer.vue       # PDFの描画・ページ送り・拡大（元の紙を見せる共通部品）
  utils/
    storageKeys.js          # localStorageキー一元管理
    importText.js           # 取込の文字の読み方（見出しの正規化・品目でない行の判定）
    pdfGrid.js              # PDFのトークンを行×列の表へ（段組み・行の高さ・列の境界。以降はCSVと同じ経路）
worker/src/
  index.js                  # Cloudflare Worker ルーター
  RoomDO.js                 # Durable Object（WS・在庫・auditLog）
  storeHandler.js           # 店舗データ・D1 クエリ
  authHandler.js            # 店舗認証
```

ここに載せたファイルの実在は `node scripts/check-docs-links.mjs` で検査する。
rename・削除したら同じcommitでこの一覧も直す。

## 作業の進め方

- **ブランチ**: 固定名を前提にせず、作業開始時に `git branch --show-current` で確認する
- **共有タスク**: 着手前に `task-list.md` の状態を `進行中`、担当を自分にする。進行中・未着手・保留P0/P1の
  作業記録は `tasks/<ID>.md` へ。優先度・状態・担当は `task-list.md` だけに置く（詳細fileへ複製しない）
- 同じタスクを複数agentが同時に編集しない。ユーザーの既存差分を保持し、担当外の変更を巻き戻さない
- **完了時**: 検証結果を `tasks/<ID>.md` に、変更・検証・残件・次の一手を `session-log.md` の先頭に追記する
- **現在の優先（2026-09-30 User → D-027）**: 機能の不足と実使用の不具合の修正を、公開gateより優先する。
  公開gateは廃止せず後回し。Stripe、trial、TWA、Google Play提出は保留
- **新機能・仕様変更**: [`docs/feature-checklist.md`](docs/feature-checklist.md)（共通DoD）でセルフチェックしてから完了とする。
  N/A 項目は理由を一言残す
- **設計判断・仕様提案**: [`docs/proposals.md`](docs/proposals.md)（提案箱）の先頭に、テンプレに従って追記する。
  **実装済みでも「合意済み」ではない**。採否はPMセッションが決める。
  ただし `docs/quality-foundation/` の共有作業記録と、採用済み仕様に対する鮮度修正は直接更新してよい
- **文書の同期**: API、DB、認可、動作、運用を変えたら、関連する現行文書も同じタスクで更新する（→ D-028）
- dated audit と `docs/export/` は履歴であり、現在仕様へ上書きしない

## コミット前の検証

実行していない test を成功と報告しない。報告には対象 commit と command を残す。

- `cd app && npm run build` — 必ず実行
- 変更した側のtest: `cd app && npm test` ／ `cd worker && npm test`
- docsを触ったら: `node scripts/check-docs-links.mjs`（相対リンク切れ・主要ファイル一覧の実在）

## バージョン（D-026）

- `app/package.json` の `version` は**変更を push するたびに上げる**。
  上げ幅: 修正・微調整・docsのみ = patch ／ まとまった機能・仕様変更 = minor
- **上げる前に必ず `git fetch origin develop` して、origin の値を見てから +1 する。**
  複数セッションが同時に上げると採番が衝突し、値が同じだと merge で競合すらしない（D-025 の背景）
- lockfile の自アプリ情報2箇所（先頭と `packages.""`）も同じ値へ合わせる
- どのビルドかは commit SHA が示す（画面に `v0.97.1 (ff708a6)` の形で出る）

## デプロイ・権限

- deploy、DB migration 適用、commit、push は明示依頼なしに行わない（Claude Code の `develop` push だけ例外 → `CLAUDE.md`）
- **develop preview（自動）**: `.github/workflows/develop-preview.yml`。`develop` へ push → Worker/App test →
  App build → Pages preview（`https://develop.inventory-app-c40.pages.dev`）。D1・Worker・本番Pagesは変更しない
- **本番 Worker（手動ボタン）**: `.github/workflows/production-backend.yml`。step=preflight → step=apply・
  confirm=`APPLY-PRODUCTION`。押すのは User（セッションからは起動不可）
- **本番フロント**: 自動workflowなし。公開判定は `web-release-readiness.md` を正とする
- `./scripts/deploy.sh`（`backend` / `frontend`）は手動・要事前確認。Pages branch、Wrangler版、rollbackは
  WEB-001で未確定のため、production手順としてそのまま実行しない
- フロントは `VITE_SYNC_WORKER_URL` をビルド時に埋め込む（ローカルビルド→`wrangler pages deploy`）
- Web release判定は `web-release-readiness.md` を正とする。Google Play release判定では
  `quality-scorecard.md` を双方が独立採点し、低い方の点数を採用する

## 同期の基本設計（バグ調査時の参照用）

- `shopCode` = 店舗コード = DO ルームID（統一）
- `sessionId` で新旧セッションを区別（新規 = ID変化、再開 = ID同一）
- ゲスト参加時は**必ずホストの品目リスト・在庫に揃える**（ローカルを上書き）
- `hostToken` = DO が発行・localStorage に保存・再接続時に検証
- `updatedAt` タイムスタンプでオフラインマージ（ローカルが新しければ再送信）

詳細は [`docs/sync-spec.md`](docs/sync-spec.md)。

## session log の運用

- `session-log.md` には**当月分だけ**を置く。月が変わったら前月分を
  `docs/quality-foundation/archive/session-log-YYYY-MM.md` へ移し、末尾の「履歴archive」索引に足す（→ D-029）
- 1件は再開に必要な事実だけ（User の依頼、原因、変更、検証、version、残件）。会話の全文を書かない
