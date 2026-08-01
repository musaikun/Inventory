# CI/CD パイプライン

現在の自動化対象は`develop`のCloudflare Pages previewと、手動実行する分離Pro Review Pagesです。
D1、Worker、本番Pagesは自動変更せず、Userの明示承認後に手動デプロイします。

## ブランチモデル

| イベント | 動作 | 反映先 |
|---|---|---|
| `develop` へ push | Worker/Appテスト → Appビルド → Pages **プレビュー** | `develop.inventory-app-c40.pages.dev` |
| Actionsの手動実行 | 同じdevelop preview workflowを再実行 | `develop.inventory-app-c40.pages.dev` |
| `Pro Review Pages`を手動実行 | Worker/App test → Pro build → Access保護Preview | `pro-review.inventory-app-pro-review.pages.dev` |
| `main` / その他branchへpush | 現在は自動処理なし | — |
| テスト失敗時 | デプロイは実行されない（ゲート） | — |

- `develop` pushはfrontend previewだけを更新し、D1・Worker・本番Pagesを変更しない。
- 固定preview URLで毎日の実機テストを行える。
- 連続 push は古い実行を自動キャンセル（`concurrency`）。

> **プレビューの注意**: 現状プレビューのフロントは**本番 Worker / 本番 D1** を見る
> （`VITE_SYNC_WORKER_URL` が共通のため）。プレビューで実機テストする際は
> テスト用の店舗コードを使うこと。バックエンドも分離したプレビュー環境
> はPro Reviewで用意する。develop preview自体のbackend分離は未実施。

## Pro Review

Pro Reviewは`inventory-sync-pro-review`、`inventory-store-pro-review`、専用Durable Objectsへ接続し、
production dataと分離する。通常buildは無料枠のままで、専用build変数2つが一致した場合だけPRO制限を解除する。
初期構築、Access、Free枠、手動更新手順は
[`quality-foundation/pro-review-runbook.md`](quality-foundation/pro-review-runbook.md)を正とする。

## 初回セットアップ（一度だけ）

### 1. Cloudflare API トークンを発行

1. Cloudflare ダッシュボード → 右上アイコン → **My Profile** → **API Tokens**
2. **Create Token** → テンプレートではなく **Create Custom Token**
3. 権限（Permissions）を以下にする:
   - `Account` → `Cloudflare Pages` → **Edit**
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

これで準備完了。以降は`develop`へpushすると、テストとビルド成功後にpreviewが更新される。

## 動作確認

1. `develop`へpush → Actionsタブで`Develop Pages Preview`が走る
2. Worker/AppテストとAppビルドが成功した場合だけPages deployへ進む
3. `https://develop.inventory-app-c40.pages.dev`で反映を確認する

`TEST-001`は2026-07-26に解消し、localでWorker 195/195、App 658/658、App build成功を確認済みです。
最終的なCI-001完了には、commit/push後のActions成功とpreview URL更新を確認します。

## 手動デプロイ（フォールバック）

GitHub Actions が落ちている / ローカルから直接出したい場合は従来どおり:

```bash
./scripts/deploy.sh          # 全部
./scripts/deploy.sh backend  # D1 + Worker のみ
./scripts/deploy.sh frontend # ビルド + Pages のみ
```

現行のdevelop CIはD1 migrationを実行しない。手動の`backend`/全体deployだけが
`scripts/migrate.sh`を呼び、schema sentinelを確認して未適用分を適用する。

`npx wrangler d1 migrations list`の結果は使用しない。このrepositoryはWrangler標準の
migration履歴tableではなくschema sentinel方式を使うため、適用状態は実table/index/triggerで判定する。

## 仕組みのファイル

```
.github/workflows/develop-preview.yml  # developのtest / build / Pages preview
.github/workflows/pro-review.yml       # 手動のPro Review frontend更新
scripts/migrate.sh            # D1 マイグレーション（センチネル方式・手動backend deploy用）
scripts/deploy.sh             # 手動デプロイ（migrate.sh を呼ぶ）
```
