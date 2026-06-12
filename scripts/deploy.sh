#!/usr/bin/env bash
# 一括デプロイ
#   フロント = Netlify（dist を手動アップロード）
#   バックエンド = Cloudflare Worker + D1（wrangler）
#
# 使い方:
#   ./scripts/deploy.sh            # 全部（テスト → D1 → Worker → フロントビルド）
#   ./scripts/deploy.sh backend    # バックエンドのみ（D1 マイグレーション + Worker）
#   ./scripts/deploy.sh frontend   # フロントのみ（テスト + ビルド）
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

DB_NAME="inventory-store"
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

build_frontend() {
  echo "════ フロントエンド ビルド ════"
  cd "$ROOT/app"
  npm run build
  cd "$ROOT"

  echo ""
  echo "════ Netlify へ手動アップロード ════"
  echo "  下記フォルダを Netlify にドラッグ&ドロップしてください:"
  echo ""
  echo "    $ROOT/app/dist"
  echo ""
  echo "  ・新規/更新ドロップ: https://app.netlify.com/drop"
  echo "  ・既存サイト更新   : 対象サイトの Deploys タブに dist をドロップ"
  echo ""
}

case "$TARGET" in
  all)
    run_tests
    deploy_backend
    build_frontend
    ;;
  backend)
    run_tests
    deploy_backend
    ;;
  frontend)
    run_tests
    build_frontend
    ;;
  *)
    echo "usage: ./scripts/deploy.sh [all|backend|frontend]" >&2
    exit 1
    ;;
esac

echo "════ 完了 ════"
