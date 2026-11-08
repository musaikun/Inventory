#!/usr/bin/env bash
# E2E 用のローカル Worker を起動する（Miniflare: DO・D1・R2 をすべて手元で模擬）。
# 毎回まっさらな D1 から始める。前回の店舗やレート制限（登録は IP あたり 5 回）を持ち越さないため。
# 本番・preview の D1 には触れない（--local のみ）。
set -euo pipefail
cd "$(dirname "$0")/../../worker"

STATE_DIR="${E2E_STATE_DIR:-$(cd .. && pwd)/e2e/.state}"
PORT="${E2E_WORKER_PORT:-8787}"

rm -rf "$STATE_DIR"
mkdir -p "$STATE_DIR"
for f in migrations/*.sql; do
  npx wrangler d1 execute inventory-store --local --persist-to "$STATE_DIR" --file="$f" >/dev/null
done

exec npx wrangler dev --local --persist-to "$STATE_DIR" --ip 127.0.0.1 --port "$PORT"
