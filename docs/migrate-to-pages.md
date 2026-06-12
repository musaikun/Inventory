# フロントエンド移行: Netlify → Cloudflare Pages

バックエンド（Worker・D1・DO）が既に Cloudflare のため、フロントも Cloudflare Pages に統一する。
ねらい: 請求・ダッシュボードの一元化、Netlify 課金の停止、`deploy.sh` の完全1コマンド化。

## 前提

- フロントは `VITE_SYNC_WORKER_URL` を**ビルド時に埋め込む**ため、Pages 側にビルド設定・環境変数は不要
  （ローカルでビルドした `dist` を直接アップロードする方式。Netlify drag&drop と同じ考え方）
- ルーティングはクエリ方式（`?room=CODE` / `?store=CODE`）で全て `/` から配信。
  念のため `app/public/_redirects`（`/* /index.html 200`）を同梱済み（Netlify/Pages 両対応）

## 手順（手元で1回だけ）

```bash
# 0. wrangler ログイン（未ログインなら）
npx wrangler login

# 1. Pages プロジェクトを作成（初回のみ）
npx wrangler pages project create inventory-app --production-branch=main

# 2. 初回デプロイ（= スクリプトの frontend と同じ）
./scripts/deploy.sh frontend
#   → https://inventory-app.pages.dev が払い出される
```

## 独自ドメインの移行（Netlify で独自ドメインを使っている場合）

1. Cloudflare ダッシュボード → Pages → `inventory-app` → **Custom domains** → ドメインを追加
2. DNS を Cloudflare に向ける（ドメインが Cloudflare 管理ならワンクリック、外部レジストラなら CNAME 設定）
3. 反映を確認したら **Netlify 側のドメイン設定を解除**
4. SSL 証明書は Cloudflare が自動発行（数分〜）

## 移行後

- 以降のデプロイは `./scripts/deploy.sh`（テスト → D1 → Worker → Pages が全自動・drag&drop 不要）
- 動作確認（同期・ルーム参加・PWA インストール）が取れたら **Netlify のサブスクリプションを解約**
- `VITE_SYNC_WORKER_URL` は Worker のURL（`wss://inventory-sync.<account>.workers.dev`）のままで変更不要

## ロールバック

Pages で問題が出たら、Netlify サイトを消さずに残しておけば DNS を戻すだけで復帰できる。
移行直後しばらくは Netlify を解約せず並走させるのが安全。
