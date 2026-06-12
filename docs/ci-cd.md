# CI/CD パイプライン

GitHub Actions による自動デプロイ。`./scripts/deploy.sh`（手動）を GitHub に肩代わりさせる仕組み。

## ブランチモデル

| イベント | 動作 | 反映先 |
|---|---|---|
| `main` へ push / merge | テスト → D1 マイグレーション → Worker → Pages **本番** | `inventory-app.pages.dev`（独自ドメイン） |
| `claude/**` へ push | テスト → Pages **プレビュー** | `<branch>.inventory-app.pages.dev` |
| テスト失敗時 | デプロイは実行されない（ゲート） | — |

- 本番は **main に取り込んだ瞬間だけ**。普段の作業ブランチへの push は本番を汚さない。
- 毎日の実機テストは **プレビューURL** で行える。
- 連続 push は古い実行を自動キャンセル（`concurrency`）。

> **プレビューの注意**: 現状プレビューのフロントは**本番 Worker / 本番 D1** を見る
> （`VITE_SYNC_WORKER_URL` が共通のため）。プレビューで実機テストする際は
> テスト用の店舗コードを使うこと。バックエンドも分離したプレビュー環境
> （staging Worker + staging D1）は将来の拡張余地。

## 初回セットアップ（一度だけ）

### 1. Cloudflare API トークンを発行

1. Cloudflare ダッシュボード → 右上アイコン → **My Profile** → **API Tokens**
2. **Create Token** → テンプレートではなく **Create Custom Token**
3. 権限（Permissions）を以下にする:
   - `Account` → `Cloudflare Pages` → **Edit**
   - `Account` → `Workers Scripts` → **Edit**
   - `Account` → `D1` → **Edit**
4. Account Resources を対象アカウントに限定 → **Create Token**
5. 表示されたトークン文字列をコピー（再表示不可なので注意）

### 2. GitHub にシークレットを登録

GitHub リポジトリ → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

| Name | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | 手順1でコピーしたトークン |

> `CLOUDFLARE_ACCOUNT_ID` と `VITE_SYNC_WORKER_URL` はワークフローに直書き済み
> （どちらも公開情報のためシークレット不要）。

### 3. Pages プロジェクトを作成（未作成なら）

```bash
npx wrangler pages project create inventory-app --production-branch=main
```

これで準備完了。以降は **main に merge するだけで本番デプロイ**される。

## 動作確認

1. `claude/**` ブランチに何か push → Actions タブで `test` と `deploy-preview` が走る
2. ログ末尾にプレビューURL（`https://<branch>.inventory-app.pages.dev`）が出る
3. 問題なければ main に merge → `deploy-production` が走り本番反映

## 手動デプロイ（フォールバック）

GitHub Actions が落ちている / ローカルから直接出したい場合は従来どおり:

```bash
./scripts/deploy.sh          # 全部
./scripts/deploy.sh backend  # D1 + Worker のみ
./scripts/deploy.sh frontend # ビルド + Pages のみ
```

CI と手動はマイグレーション適用ロジック（`scripts/migrate.sh`）を共有しているため、
どちらで実行しても「未適用のマイグレーションのみ適用」される。

## 仕組みのファイル

```
.github/workflows/deploy.yml  # CI/CD 定義（test / deploy-production / deploy-preview）
scripts/migrate.sh            # D1 マイグレーション（センチネル方式・CIと手動で共用）
scripts/deploy.sh             # 手動デプロイ（migrate.sh を呼ぶ）
```
