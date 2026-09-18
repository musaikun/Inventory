#!/usr/bin/env bash
#
# 公開中のWorkerが「生きているか」「CORSを正しく返すか」を外から確かめる。
#
# なぜ要るか:
#   フロントから見た障害は、原因が何であれ `Failed to fetch` の一語になる。
#   ブラウザはCORSヘッダーの無い応答を読めないので、Workerが消えていても、
#   originの許可が外れていても、画面上は同じに見える。実際に2回起きている。
#     - 2026-08-28 本番: ALLOWED_ORIGIN と実host名の食い違い（403にCORSが付かない）
#     - 2026-09-18 Pro Review: Workerのscriptが消え、Cloudflareの404が返っていた
#   どちらも「誰かが画面を開くまで気付けなかった」。ここで定期的に外から叩く。
#
# 落とし方:
#   1つでも欠けたら非ゼロで終わる。GitHub Actions のscheduleで走らせると、
#   失敗がそのまま通知になる（これが気付くための導線）。
#
# 使い方:
#   ./scripts/health-check.sh
#   PROD_WORKER=... PRO_REVIEW_WORKER=... ./scripts/health-check.sh
#
set -uo pipefail

PROD_WORKER="${PROD_WORKER:-https://inventory-sync.yuya-takaki.workers.dev}"
PROD_ORIGIN="${PROD_ORIGIN:-https://develop.inventory-app-c40.pages.dev}"
PRO_REVIEW_WORKER="${PRO_REVIEW_WORKER:-https://inventory-sync-pro-review.yuya-takaki.workers.dev}"
PRO_REVIEW_ORIGIN="${PRO_REVIEW_ORIGIN:-https://pro-review.inventory-app-pro-review.pages.dev}"
# 許可されていないoriginの代表。ここへCORSを返すなら、fail-closeが緩んでいる
STRANGER_ORIGIN="${STRANGER_ORIGIN:-https://not-allowed.example.com}"

CURL_MAX_TIME="${CURL_MAX_TIME:-20}"
FAILED=0

ok()   { printf '  \033[32mOK\033[0m   %s\n' "$1"; }
ng()   { printf '  \033[31mNG\033[0m   %s\n' "$1"; FAILED=$((FAILED + 1)); }
head2() { printf '\n== %s\n' "$1"; }

# /health が 200 と OK を返すか。Workerがそのhostに載っていなければ、
# Cloudflareが本文の無い404を返す（＝これで「消えている」が分かる）。
check_health() {
  local name="$1" base="$2" body status
  body="$(curl -sS --max-time "$CURL_MAX_TIME" -w '\n%{http_code}' "$base/health" 2>/dev/null)" || {
    ng "$name: /health へ到達できない（$base）"
    return
  }
  status="${body##*$'\n'}"
  body="${body%$'\n'*}"
  if [ "$status" != "200" ]; then
    ng "$name: /health が $status（200 以外。Workerがそのhostに載っていない可能性）"
    return
  fi
  if [ "$body" != "OK" ]; then
    ng "$name: /health の本文が想定外（'$body'）"
    return
  fi
  ok "$name: /health 200 OK"
}

# 許可originへのpreflightで Access-Control-Allow-Origin が返るか。
# 返らないと、ブラウザは応答を読めず `Failed to fetch` になる。
check_cors_allowed() {
  local name="$1" base="$2" origin="$3" allow
  allow="$(curl -sS --max-time "$CURL_MAX_TIME" -o /dev/null -D - \
    -X OPTIONS -H "Origin: $origin" \
    -H 'Access-Control-Request-Method: POST' \
    -H 'Access-Control-Request-Headers: content-type' \
    "$base/auth/login" 2>/dev/null \
    | tr -d '\r' | awk 'BEGIN{IGNORECASE=1} /^access-control-allow-origin:/ {print $2}')" || true
  if [ "$allow" = "$origin" ]; then
    ok "$name: $origin へCORSを返す"
  else
    ng "$name: $origin へCORSを返さない（受け取った値: '${allow:-なし}'）"
  fi
}

# 許可していないoriginへはCORSを返さないか（fail-close）。
# 旧Workerが任意のoriginを反射していたため、host名の食い違いが長く隠れていた。
check_cors_denied() {
  local name="$1" base="$2" origin="$3" allow
  allow="$(curl -sS --max-time "$CURL_MAX_TIME" -o /dev/null -D - \
    -X OPTIONS -H "Origin: $origin" \
    -H 'Access-Control-Request-Method: POST' \
    "$base/auth/login" 2>/dev/null \
    | tr -d '\r' | awk 'BEGIN{IGNORECASE=1} /^access-control-allow-origin:/ {print $2}')" || true
  if [ -z "$allow" ]; then
    ok "$name: 許可外originにはCORSを返さない"
  else
    ng "$name: 許可外originへCORSを返している（'$allow'）。許可が緩んでいる"
  fi
}

printf '公開中のWorkerを外から確認します（%s）\n' "$(date -u '+%Y-%m-%d %H:%M:%SZ')"

head2 "本番 Worker"
check_health       "本番" "$PROD_WORKER"
check_cors_allowed "本番" "$PROD_WORKER" "$PROD_ORIGIN"
check_cors_denied  "本番" "$PROD_WORKER" "$STRANGER_ORIGIN"

head2 "Pro Review Worker"
check_health       "Pro Review" "$PRO_REVIEW_WORKER"
check_cors_allowed "Pro Review" "$PRO_REVIEW_WORKER" "$PRO_REVIEW_ORIGIN"
check_cors_denied  "Pro Review" "$PRO_REVIEW_WORKER" "$STRANGER_ORIGIN"

printf '\n'
if [ "$FAILED" -eq 0 ]; then
  printf 'すべて正常です。\n'
  exit 0
fi
printf '%d 件が異常です。\n' "$FAILED"
printf 'Workerが消えている場合は、develop への push（または Actions の手動実行）で\n'
printf '該当 workflow を通せば同じ run で再 deploy されます。\n'
exit 1
