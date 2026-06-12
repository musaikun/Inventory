#!/usr/bin/env bash
# 一括デプロイ（すべて Cloudflare）
#   フロント = Cloudflare Pages（wrangler pages deploy）
#   バックエンド = Cloudflare Worker + D1（wrangler deploy）
#
# 使い方:
#   ./scripts/deploy.sh            # 全部（テスト → D1 → Worker → フロント）
#   ./scripts/deploy.sh backend    # バックエンドのみ（D1 マイグレーション + Worker）
#   ./scripts/deploy.sh frontend   # フロントのみ（テスト + ビルド + Pages）
#
# 前提: wrangler ログイン済み（npx wrangler login）。
#       初回のみ Pages プロジェクト作成が必要:
#         npx wrangler pages project create inventory-app --production-branch=main
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

PAGES_PROJECT="inventory-app"
TARGET="${1:-all}"

run_tests() {
  echo "════ テスト（worker）════"
  (cd worker && npx vitest run)
  echo "════ テスト（app）════"
  (cd app && npx vitest run)
}

deploy_backend() {
  echo "════ D1 マイグレーション（未適用のみ）════"
  "$ROOT/scripts/migrate.sh"

  echo "════ Worker デプロイ ════"
  (cd "$ROOT/worker" && npx wrangler deploy)
}

deploy_frontend() {
  echo "════ フロントエンド ビルド ════"
  cd "$ROOT/app"
  npm run build

  echo "════ Cloudflare Pages デプロイ ════"
  npx wrangler pages deploy dist --project-name="$PAGES_PROJECT"
  cd "$ROOT"
}

case "$TARGET" in
  all)
    run_tests
    deploy_backend
    deploy_frontend
    ;;
  backend)
    run_tests
    deploy_backend
    ;;
  frontend)
    run_tests
    deploy_frontend
    ;;
  *)
    echo "usage: ./scripts/deploy.sh [all|backend|frontend]" >&2
    exit 1
    ;;
esac

echo "════ 完了 ════"
