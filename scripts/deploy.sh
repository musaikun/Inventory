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

DB_NAME="inventory-store"
PAGES_PROJECT="inventory-app"
TARGET="${1:-all}"

run_tests() {
  echo "════ テスト ════"
  (cd app && npx vitest run)
}

deploy_backend() {
  echo "════ D1 マイグレーション（未適用のみ）════"
  cd "$ROOT/worker"

  # リモートにセンチネルテーブルが無ければそのマイグレーションを適用する
  apply_if_missing() {
    local file="$1" sentinel="$2"
    if npx wrangler d1 execute "$DB_NAME" --remote --json \
        --command "SELECT name FROM sqlite_master WHERE type='table' AND name='$sentinel'" \
        | grep -q "\"$sentinel\""; then
      echo "  ✓ $file は適用済み（$sentinel あり）"
    else
      echo "  → $file を適用します"
      npx wrangler d1 execute "$DB_NAME" --remote --file="./migrations/$file"
    fi
  }

  apply_if_missing 0001_init.sql           stores
  apply_if_missing 0002_auth_sessions.sql  auth_tokens
  apply_if_missing 0003_login_attempts.sql login_attempts
  apply_if_missing 0004_v2_schema.sql      inventory_lines
  apply_if_missing 0005_ip_attempts.sql    ip_attempts

  echo "════ Worker デプロイ ════"
  npx wrangler deploy
  cd "$ROOT"
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
