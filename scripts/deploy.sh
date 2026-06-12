#!/usr/bin/env bash
# 一括デプロイ: テスト → 未適用マイグレーションだけ適用 → Worker → Pages
# 使い方: ./scripts/deploy.sh （リポジトリのどこからでも可・要 wrangler ログイン済み）
set -euo pipefail
cd "$(dirname "$0")/.."

DB_NAME="inventory-store"

echo "════ 1/4 テスト ════"
(cd app && npx vitest run)

echo "════ 2/4 D1 マイグレーション（未適用のみ）════"
cd worker

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

echo "════ 3/4 Worker デプロイ ════"
npx wrangler deploy

echo "════ 4/4 フロントエンド（Pages）デプロイ ════"
cd ../app
npm run build
npx wrangler pages deploy dist

echo "════ 完了 ════"
