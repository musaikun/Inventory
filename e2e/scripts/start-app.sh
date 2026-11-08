#!/usr/bin/env bash
# E2E 用にアプリをローカル Worker 向けでビルドし、vite preview で配信する。
# 通常の dist/ を汚さないよう e2e/.dist へ出す。
set -euo pipefail
cd "$(dirname "$0")/../../app"

WORKER_PORT="${E2E_WORKER_PORT:-8787}"
APP_PORT="${E2E_APP_PORT:-4173}"
OUT="$(cd .. && pwd)/e2e/.dist"

VITE_SYNC_WORKER_URL="http://127.0.0.1:${WORKER_PORT}" npx vite build --outDir "$OUT" --emptyOutDir >/dev/null
exec npx vite preview --outDir "$OUT" --host 127.0.0.1 --port "$APP_PORT" --strictPort
