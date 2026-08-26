# Pro Review分離環境

更新日: 2026-08-23  
対象: `CI-001` / `PLAY-004`

## 現在の稼働状態

- 初回Pages Preview deploy: 2026-08-01 / `develop@e35c2ba`（未commit差分を含む）
- 現行Pages Preview deploy: 2026-08-23 / `develop@4add746`（App 0.68.0）+ manifest認証の未commit差分
- 固定URL: `https://pro-review.inventory-app-pro-review.pages.dev`
- 現行固有URL: `https://72feca8d.inventory-app-pro-review.pages.dev`
- 現行Pages deployment ID: `72feca8d-d46f-4646-939c-6349e0a98912`
- 固定URL・固有URLとも、未認証アクセスがCloudflare Access loginへ`302`となることを確認済み。
- 専用Workerの現行versionは`f8a063d2-4139-4081-9eb8-031d9af8e7a0`。healthは`200 OK`。
  固定URLのoriginだけにCORSを許可し、旧固有URL originには
  `Access-Control-Allow-Origin`を返さないことを確認済み。
- 専用D1は`PRO REVIEW TEST`（店舗code `EXCFGA`）1店舗のみ、`plan=pro`、削除されていない状態を
  read-only queryで確認済み。`0001`〜`0016`適用済み、未適用migrationは0件。PINはrepositoryへ記録しない。
- Cloudflare Access配下でもmanifestへ認証cookieを送るため、Pro Review buildだけ
  `<link rel=manifest ... crossorigin=use-credentials>`を生成する。
- Cloudflare PagesはPreviewへ既定で`X-Robots-Tag: noindex`を付ける。Access外からorigin responseを
  直接取得できないため、ログイン後のheader/画面目視はUser実機確認として残す。

## 目的

無料版の`develop` Reviewとは別に、PRO制限解除後の挙動を確認する。productionの店舗・D1・
Durable Objectsへ一切書き込まず、Cloudflare Free枠内のテスト環境として運用する。

## リソース境界

| 対象 | Pro Review | production/develop |
|---|---|---|
| Pages project | `inventory-app-pro-review` | `inventory-app` |
| Pages branch alias | `pro-review.inventory-app-pro-review.pages.dev` | `develop.inventory-app-c40.pages.dev` |
| Worker | `inventory-sync-pro-review` | `inventory-sync` |
| D1 | `inventory-store-pro-review` | `inventory-store` |
| Durable Objects | Pro Review Worker固有namespace | production Worker固有namespace |
| 新規店舗plan | `pro` | `free` |

Pro Review buildは`VITE_DEPLOYMENT_CHANNEL=pro-review`と`VITE_REVIEW_PLAN=pro`の完全一致時だけ
クライアント制限を解除する。URL parameterとlocalStorageでは解除できない。画面上部へ
`PRO REVIEW · テストデータ`を常時表示する。

## Access

Pagesへはproduction deployを作らず、`pro-review` branchのPreviewだけを配信する。Cloudflare Dashboardの
`Workers & Pages > inventory-app-pro-review > Settings > General > Enable access policy`を有効化する。
共有前に未認証ブラウザがCloudflare Access loginへ遷移することを確認する。

PagesのPreview Accessはproject内の全Previewを保護するが、production `*.pages.dev`は保護しない。
このためproduction branchへはdeployしない。Previewは既定で`X-Robots-Tag: noindex`が付く。

## 更新（通常はこちら）

`develop` へ push すると **`Pro Review Pages`** が自動で走り、Pro Reviewもdevelopに追随する。
通常はこれだけでよく、Actionsを開く必要はない。

`develop`以外の内容を入れたいときだけ`workflow_dispatch`を使う。
**実行時に選んだブランチをbuildする**ので、入れたいブランチを選ぶ。
ただしworkflowは`develop`にだけ存在し、default branchは`main`のままなので、
`main`へ配置されるまで`workflow_dispatch`はUI・APIとも使えない。
（Claude Codeのセッションからも`403 Resource not accessible by integration`になる。
push トリガはこれを迂回するために足した。）

1 回の run で **Worker → Pages の順に両方**を更新する。Pages だけ新しい状態にすると、
config 中継の新フィールドがゲスト側から落ちるなどの不整合が出るため、分離して実行しない。

D1 マイグレーションも同じ run で当てる。`scripts/migrate.sh` をセンチネル方式で回し、
**未適用のものだけ**を `inventory-store-pro-review` へ適用する（冪等・既存は触らない）。
**対象は Pro Review の D1 だけで、本番 D1 には一切触れない**（D-018 の分離）。
人手で当て忘れると、新しい Worker が存在しない table を参照して Pro Review だけ壊れるため、
検証環境はここで自動的に揃える。**本番は `WEB-04` の手順**（preflight → User承認 → 順に適用）
を維持し、この workflow からは適用しない。

`scripts/migrate.sh` は `DB_NAME` で対象を差し替える（既定は本番）:
`DB_NAME=inventory-store-pro-review ./scripts/migrate.sh`

push トリガも使えない状況（`develop`以外を入れる／workflowが落ちる）では、次の手動更新を使う。

## 初期構築・手動更新

1. `inventory-store-pro-review`へ`0001`〜`0017`を順番に適用する（`DB_NAME=inventory-store-pro-review ./scripts/migrate.sh` で未適用のみ）。
2. `cd worker && npx wrangler@latest deploy --env pro_review`で専用Workerだけを更新する。
3. 次の3変数を設定してAppをbuildする。
   - `VITE_SYNC_WORKER_URL=wss://inventory-sync-pro-review.yuya-takaki.workers.dev`
   - `VITE_DEPLOYMENT_CHANNEL=pro-review`
   - `VITE_REVIEW_PLAN=pro`
4. `npx wrangler@latest pages deploy dist --project-name=inventory-app-pro-review --branch=pro-review`で
   Previewへ配信する。
5. Access、`noindex`、Worker URL、登録応答`plan=pro`、production D1非更新を確認する。

2026-08-01の初回deployでは、Access、build内Worker URL、既存review店舗の`plan=pro`、専用D1への
read-only queryを確認した。ログイン後の画面目視とDevToolsでの`X-Robots-Tag`確認は未実施。

2026-08-22〜23の復旧では、Time Travel bookmarkを取得後、実schemaと一致する`0001`〜`0011`を
`d1_migrations`へ基準登録し、`0012`〜`0016`をWranglerで適用した。店舗1件、
session/history 0件は適用前後で不変。専用Worker、Pagesの順で更新し、health、固定origin CORS、
Access `302`、build内Pro条件、manifest認証属性を確認した。

今回の復旧時点では`.github/workflows/pro-review.yml`がdefault branchに存在せず、GitHub APIから
`workflow_dispatch`できなかったため、上記手順2〜4をWranglerで直接実行した。workflow経路を使う場合は、
先にworkflowをdefault branchへ配置する。現行workflowはWorkerとPagesを更新し、D1は自動変更しない。

## Free枠と制限

- Pages Free: 月500 build、同時build 1、最大100 project。
- Zero Trust Free: 50 userまで。
- D1 Free: account合計5GB、1日500万row read・10万row write。
- SQLite Durable Objects Free: 1日10万request等の無料上限内。

無料上限を超えると追加課金ではなく、その種類の処理が翌リセットまで失敗する。Pro Reviewは少数の
テスト店舗・短時間の実機確認に限定し、負荷試験には使用しない。

## 意図的に無効な機能

Pro Review WorkerにはproductionのVAPID secretとcronを継承しない。Push通知の送受信確認はproduction用の
審査テスト店舗で別途行い、Pro Reviewから実利用者へ通知しない。

## 公式資料

- [Pages limits](https://developers.cloudflare.com/pages/platform/limits/)
- [Pages preview deployments and Access](https://developers.cloudflare.com/pages/configuration/preview-deployments/)
- [Cloudflare Zero Trust plans](https://www.cloudflare.com/plans/zero-trust-services/)
- [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)
- [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)
