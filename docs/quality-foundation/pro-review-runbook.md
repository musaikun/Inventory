# Pro Review分離環境

更新日: 2026-08-23  
対象: `CI-001` / `PLAY-004`

## 現在の稼働状態

- 初回Pages Preview deploy: 2026-08-01 / `develop@e35c2ba`（未commit差分を含む）
- 固定URL: `https://pro-review.inventory-app-pro-review.pages.dev`
- 固有URL: `https://4e8cedd7.inventory-app-pro-review.pages.dev`
- Pages deployment ID: `4e8cedd7-2dbf-4ab6-b4b4-bee250fea610`
- 固定URL・固有URLとも、未認証アクセスがCloudflare Access loginへ`302`となることを確認済み。
- 専用Workerのhealthは`200 OK`。固定URLのoriginだけにCORSを許可し、develop originには
  `Access-Control-Allow-Origin`を返さないことを確認済み。
- 専用D1は`PRO REVIEW TEST`（店舗code `EXCFGA`）1店舗のみ、`plan=pro`、削除されていない状態を
  read-only queryで確認済み。PINはrepositoryへ記録しない。
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

GitHub Actions の **`Pro Review Pages`** を `workflow_dispatch` で実行する。
**実行時に選んだブランチをbuildする**ので、`develop` の内容を入れるなら `develop` を選ぶ。
push では動かない（自動更新は develop preview だけ）。

1 回の run で **Worker → Pages の順に両方**を更新する。Pages だけ新しい状態にすると、
config 中継の新フィールドがゲスト側から落ちるなどの不整合が出るため、分離して実行しない。

D1 マイグレーションはこの workflow に含めない。schema を変える変更を入れるときは、
先に `inventory-store-pro-review` へ適用する（現在の適用済みは `0001`〜`0011`）。

## 初期構築・手動更新

1. `inventory-store-pro-review`へ`0001`〜`0011`を順番に適用する。
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

初期構築後のフロント更新は`.github/workflows/pro-review.yml`を手動実行する。WorkerとD1は自動変更しない。

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
