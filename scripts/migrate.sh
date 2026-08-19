#!/usr/bin/env bash
# D1 マイグレーションを「未適用のみ」適用する（センチネル方式・冪等）。
# deploy.sh（手動backend deploy）から呼ぶマイグレーション一覧の単一の真実。
# 現行のdevelop GitHub Actionsはfrontend preview専用で、このscriptを呼ばない。
#
# 認証:
#   - ローカル : npx wrangler login 済みのセッション
#   - CI       : 環境変数 CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID
set -euo pipefail
cd "$(dirname "$0")/../worker"

DB_NAME="inventory-store"

# リモートにセンチネル（テーブル or インデックス）が無ければ、そのマイグレーションを適用する。
# 列追加マイグレーションは新テーブルを作らないため、同時に作るインデックスをセンチネルにする。
apply_if_missing() {
  local file="$1" sentinel="$2"
  if npx wrangler d1 execute "$DB_NAME" --remote --json \
      --command "SELECT name FROM sqlite_master WHERE name='$sentinel'" \
      | grep -q "\"$sentinel\""; then
    echo "  ✓ $file は適用済み（$sentinel あり）"
  else
    echo "  → $file を適用します"
    npx wrangler d1 execute "$DB_NAME" --remote --file="./migrations/$file"
  fi
}

apply_if_missing 0001_init.sql               stores
apply_if_missing 0002_auth_sessions.sql      auth_tokens
apply_if_missing 0003_login_attempts.sql     login_attempts
apply_if_missing 0004_v2_schema.sql          inventory_lines
apply_if_missing 0005_ip_attempts.sql        ip_attempts
apply_if_missing 0006_push_subscriptions.sql push_subscriptions
apply_if_missing 0007_session_type.sql       idx_sessions_shop_type
apply_if_missing 0008_orders.sql             orders
apply_if_missing 0009_store_plan.sql         idx_stores_plan
apply_if_missing 0010_movements.sql          idx_movement_lines_item
apply_if_missing 0011_account_deletion.sql   trg_movement_lines_active_insert
apply_if_missing 0012_history_session_key.sql idx_history_session
apply_if_missing 0013_import_batches.sql     idx_sessions_import_batch
apply_if_missing 0014_history_revision.sql   idx_history_revision
apply_if_missing 0015_import_replay.sql      import_batch_requests
apply_if_missing 0016_completion_claims.sql  session_completions
