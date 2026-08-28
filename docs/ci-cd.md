# CI/CD パイプライン

- **Status:** 現行。ただしWeb production release経路は未完成
- **Role:** repositoryにあるCI、preview deploy、手動deploy候補と既知gapを説明する
- **Source of truth:** 実行内容は`.github/workflows/*.yml`、`app/package.json`、
  `app/vitest.config.js`、`worker/package.json`、`scripts/*.sh`。Web公開可否は
  [Web公開準備](quality-foundation/web-release-readiness.md)を正とする
- **Last verified:** 2026-08-04 / `develop@bc9fb85`

現在の自動化対象は`develop`のCloudflare Pages previewと、手動実行する分離Pro Review Pagesです。
D1、Worker、本番Pagesは自動変更しません。現在のscriptはproduction手順として未確定であり、
User承認だけでなく[Web公開準備](quality-foundation/web-release-readiness.md)のgate解消が必要です。

## 証拠と文書の責務

| 種別 | 正本 / 記録先 |
|---|---|
| 恒久回帰シナリオ | [`test-cases.md`](test-cases.md) |
| 変更task固有の検証 | `quality-foundation/tasks/<ID>.md` |
| Web release gate | [`web-release-readiness.md`](quality-foundation/web-release-readiness.md) / [`WEB-001.md`](quality-foundation/tasks/WEB-001.md) |
| 一回のCI・build・deploy実績 | GitHub Actions run / [`session-log.md`](quality-foundation/session-log.md) |

過去runの成功を現在HEADやproductionの成功へ読み替えません。証拠には対象commit、run URL、
command/step、環境、未検証範囲を残します。

## ブランチモデル

| イベント | 動作 | 反映先 |
|---|---|---|
| `develop` へ push | Worker/Appテスト → Appビルド → Pages **プレビュー** | `develop.inventory-app-c40.pages.dev` |
| Actionsの手動実行 | 同じdevelop preview workflowを再実行 | `develop.inventory-app-c40.pages.dev` |
| `Pro Review Pages`を手動実行 | Worker/App test → Pro build → Access保護Preview | `pro-review.inventory-app-pro-review.pages.dev` |
| `Production Backend`を手動実行 | test → 本番D1 preflight →（apply時のみ）migration → 本番Worker deploy | Worker `inventory-sync` / D1 `inventory-store` |
| `main` / その他branchへpush | 自動処理なし（2026-08-28に無ゲートの `deploy.yml` を削除・下記） | — |
| テスト失敗時 | デプロイは実行されない（ゲート） | — |

- `develop` pushはfrontend previewだけを更新し、D1・Worker・本番Pagesを変更しない。
- 固定preview URLで毎日の実機テストを行える。
- 連続 push は古い実行を自動キャンセル（`concurrency`）。

> **本番backendの経路は1本だけ**: `Production Backend (D1 + Worker)` の手動実行。
> 2段階（`preflight` → `apply`）で、`apply` は合言葉 `APPLY-PRODUCTION` と
> **branch = develop** の両方が揃ったときだけ通る。
>
> 以前は `.github/workflows/deploy.yml` が `main` への push で
> migration → Worker → Pages production を**承認ゲート無しに**実行していた
> （develop では 2026-07-26 に削除済み、`main` にだけ1か月前の版が残っていた）。
> `main` の `scripts/migrate.sh` も 0009 までの古い版で 0010〜0017 を当てられなかった。
> 二重の本番deploy経路を残さないため、`main` 側も 2026-08-28 に削除した。
>
> workflow は `main` にも置いてある。workflow_dispatch はデフォルトブランチに
> ファイルが無いと Actions のUIへ出ないため。**実行時の branch は develop を選ぶ**
> （`main` のコードは古い。workflow 側にもガードがある）。

> **プレビューの注意**: 現状プレビューのフロントは**本番 Worker / 本番 D1** を見る
> （`VITE_SYNC_WORKER_URL` が共通のため）。プレビューで実機テストする際は
> テスト用の店舗コードを使うこと。バックエンドも分離したプレビュー環境
> はPro Reviewで用意する。develop preview自体のbackend分離は未実施。

## 現行CIの検証範囲

`develop-preview.yml`と`pro-review.yml`は、Node 24で次を実行します。

| 対象 | workflowの実行 | 実際の範囲 |
|---|---|---|
| Worker | `worker`で`npm ci` → `npm test` | Worker packageのVitest |
| App | `app`で`npm ci` → `npm test` → `npm run build` | `app/vitest.config.js`の`src/**/*.test.js`とproduction build |
| Pages | 上記成功後に明示したpreview branchへdeploy | deploy commandの成功まで。公開routeの機能確認ではない |

App/Workerのtestはpackage分離済みで、件数は文書へ固定しません。一方、package scripts、依存、workflowに
Playwright/Cypress等のbrowser E2Eはなく、remote Worker/D1/DOと実browserを通すcritical E2Eもありません。
production URLへの自動smoke、失敗時の自動rollbackもありません。`npm test`とPages deploy成功だけで
`WEB-09` / `WEB-10`を完了にしません。

## Web production release（未完成）

現時点で「安全に再現できるproduction deploy」は完成していません。

| Gap | 2026-08-04のrepository / remote evidence | 完了条件 |
|---|---|---|
| canonical / production | `inventory-app.pages.dev`は実projectと一致せず、`inventory-app-c40.pages.dev`のproductionは旧build | Userがcanonical/resourceを固定し、対象SHAをproduction URLで確認 |
| routing | develop previewの`/privacy`、`/terms`、`/support`はredirect loop | extensionless/`.html`の最終200、本文、CSPを実probe |
| Worker/CORS | remote Workerは任意Originを反射する旧状態。repositoryの許可Originも実Pages hostと不一致 | 設定/test更新後にWorkerをdeployし、許可/拒否Originを実probe |
| production branch | workflowのpreview branchは明示済みだが、`scripts/deploy.sh`のPages deployは`--branch`なし。setup例の`main`は実project状態の証拠ではない | production branchをrepositoryと実projectで固定し、deploy commandへ明示 |
| Wrangler | workflowは`wrangler-action@v3`だけを指定し、Pages用Wrangler versionを固定していない。手動frontendはWrangler依存のない`app`から`npx wrangler`を実行 | 使用versionを固定し、release記録へ`wrangler --version`を保存 |
| rollback | last-known-goodのdeployment ID、Worker version、切戻しcommand、判定手順がない | Pages/WorkerのrollbackをD1 recoveryと分離して実演・記録 |
| D1 | 本番0010〜0016は未適用 | read-only preflight後、User承認下で**0010→0016の順に**適用しschema確認。0012は`DROP TABLE`を含む不可逆点。0015/0016はmigration適用〜Worker deployの間に取込・完了を行わせないmaintenance条件つき（[Web公開準備](quality-foundation/web-release-readiness.md)の「切替境界」） |
| critical E2E | browser E2Eのdependency/script/workflowなし | 登録→棚卸→同期/再接続→別browser履歴→削除を本番相当環境で安定実行 |
| production smoke | 公開URLを検証するscript/jobなし | 主要route、API、CORS、PWA、legal、削除を対象SHA付きで確認 |

修正後の標準順序は、clean test/build/audit → D1 preflight/migration → Worker/CORS probe →
Pages production deploy → public smoke → observability確認です。実行証拠は
[WEB-001](quality-foundation/tasks/WEB-001.md)へ残します。

Cloudflare公式では、`wrangler pages deploy`の`--branch`を省略するとGit branchを推論します。
またPagesは`.html`をextensionless URLへredirectします。現在のscript/routingはこの挙動を前提に修正します。

- [Wrangler Pages configuration](https://developers.cloudflare.com/pages/functions/wrangler-configuration/)
- [Serving Pages](https://developers.cloudflare.com/pages/configuration/serving-pages/)

## Pro Review

Pro Reviewは`inventory-sync-pro-review`、`inventory-store-pro-review`、専用Durable Objectsへ接続し、
production dataと分離する。通常buildは無料枠のままで、専用build変数2つが一致した場合だけPRO制限を解除する。
初期構築、Access、Free枠、手動更新手順は
[`quality-foundation/pro-review-runbook.md`](quality-foundation/pro-review-runbook.md)を正とする。

## develop preview初回セットアップ（production正本ではない）

以下はpreview workflowを動かすための構成メモです。既存projectへ再実行せず、実resource、権限、
production branchはWEB-001のpreflightでread-only確認してから扱います。

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

ここまででdevelop preview workflowを動かす前提が揃います。production公開準備の完了は意味しません。

## 動作確認

1. `develop`へpush → Actionsタブで`Develop Pages Preview`が走る
2. Worker/AppテストとAppビルドが成功した場合だけPages deployへ進む
3. `https://develop.inventory-app-c40.pages.dev`で反映を確認する

[`develop Actions run 30882005257`](https://github.com/musaikun/Inventory/actions/runs/30882005257)は
`develop@bc9fb85`を対象に、Worker/App test、App build、develop Pages preview deploy stepが成功しました。
これはpreview pipelineの履歴証拠だけです。production deploy、production smoke、legal routeの最終200、
critical E2Eの証拠ではありません。実際に同previewのlegal 3 routeにはredirect loopが残っています。

## 手動デプロイ候補（productionでは使用不可）

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

> **注意:** WEB-001でproduction branch、resource、Wrangler版、rollbackが固定されるまで、
> 上記`deploy.sh`をproduction公開手順として実行しません。

## 仕組みのファイル

```
.github/workflows/develop-preview.yml  # developのtest / build / Pages preview
.github/workflows/pro-review.yml       # 手動のPro Review frontend更新
scripts/migrate.sh            # D1 マイグレーション（センチネル方式・手動backend deploy用）
scripts/deploy.sh             # 手動デプロイ（migrate.sh を呼ぶ）
```
