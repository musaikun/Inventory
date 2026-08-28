#!/usr/bin/env bash
# 本番D1の read-only preflight（web-release-readiness.md 手順3 / WEB-04）。
#
# **書き込みを一切しない**。適用状況・データ量・Time Travel の復元可能期間を読むだけ。
# migration を当てる前に、この出力を人が見て判断するためのもの。
#
# 認証:
#   - ローカル : npx wrangler login 済みのセッション
#   - CI       : CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID
#
# 使い方:
#   ./scripts/preflight-prod.sh
#   DB_NAME=inventory-store-pro-review ./scripts/preflight-prod.sh
set -uo pipefail
cd "$(dirname "$0")/../worker"

DB_NAME="${DB_NAME:-inventory-store}"
echo "対象DB: $DB_NAME"
echo

# 失敗しても止めない。列やtableが無い＝そのmigrationが未適用、という情報そのものになる。
q() {
  echo "--- $1"
  npx wrangler d1 execute "$DB_NAME" --remote --command "$2" 2>&1 || echo "（クエリ失敗＝未適用の可能性）"
  echo
}

q "適用済みsentinel（scripts/migrate.sh と同じ並び）" \
  "SELECT name FROM sqlite_master WHERE name IN (
     'stores','auth_tokens','login_attempts','inventory_lines','ip_attempts',
     'push_subscriptions','idx_sessions_shop_type','orders','idx_stores_plan',
     'idx_movement_lines_item','trg_movement_lines_active_insert','idx_history_session',
     'idx_sessions_import_batch','idx_history_revision','import_batch_requests',
     'session_completions','session_audit'
   ) ORDER BY name"

q "データ量（0012は store_history を作り直すため、行数を控えておく）" \
  "SELECT (SELECT COUNT(*) FROM stores) AS stores,
          (SELECT COUNT(*) FROM sessions) AS sessions,
          (SELECT COUNT(*) FROM store_history) AS history,
          (SELECT COUNT(*) FROM inventory_lines) AS lines"

q "既存の取込バッチ件数（切替境界の判断材料・0013適用後のみ意味を持つ）" \
  "SELECT COUNT(*) AS legacy_import_sessions FROM sessions WHERE import_batch_id IS NOT NULL"

echo "--- D1 Time Travel（**0012 を当てる前に必ず確認する**。DROP TABLE を含み戻せない）"
npx wrangler d1 time-travel info "$DB_NAME" 2>&1 || echo "（time-travel info を取得できませんでした）"
