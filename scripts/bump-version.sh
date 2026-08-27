#!/usr/bin/env bash
# アプリのバージョンを1桁だけ上げる（複数セッション同時開発用）。
#
# なぜ専用scriptなのか:
#   バージョンは6桁（例 0.87.0.0.0.0）で、セッションごとに担当する桁が違う。
#   `npm version` は semver（3桁）しか受け付けず `Invalid version` で落ちるため、
#   package.json と package-lock.json を直接そろえて書き換える。
#   （build・npm ci・画面表示は6桁でも問題なく動くことを確認済み）
#
# 桁の割り当ては docs/quality-foundation/decisions.md の D-025 が正。
#
# 使い方:
#   ./scripts/bump-version.sh 6        … 6桁目を +1（担当桁を上げる）
#   ./scripts/bump-version.sh 6 --show … 現在値を表示するだけ
set -euo pipefail
cd "$(dirname "$0")/.."

POS="${1:-}"
if ! [[ "$POS" =~ ^[1-6]$ ]]; then
  echo "使い方: $0 <1-6> [--show]" >&2
  echo "  上げる桁を 1〜6 で指定します（担当桁は D-025 を参照）" >&2
  exit 1
fi
SHOW="${2:-}"

python3 - "$POS" "$SHOW" <<'PY'
import json, sys, io, os

pos  = int(sys.argv[1])
show = sys.argv[2] == '--show' if len(sys.argv) > 2 else False

PKG  = 'app/package.json'
LOCK = 'app/package-lock.json'

def read_json(path):
    with io.open(path, encoding='utf-8') as f:
        return json.load(f)

cur = read_json(PKG)['version']
parts = cur.split('.')
# 3桁（従来のsemver）からの移行: 足りない桁は 0 で埋める
while len(parts) < 6:
    parts.append('0')
if len(parts) != 6:
    raise SystemExit(f'バージョンの桁数が想定外です: {cur}')
if not all(p.isdigit() for p in parts):
    raise SystemExit(f'数字以外が含まれています: {cur}')

if show:
    print(cur)
    raise SystemExit(0)

parts[pos - 1] = str(int(parts[pos - 1]) + 1)
# 上げた桁より下は 0 に戻す（上位が動いたら下位の枠は数え直し）
for i in range(pos, 6):
    parts[i] = '0'
new = '.'.join(parts)

def write_version(path, setter):
    with io.open(path, encoding='utf-8') as f:
        raw = f.read()
    data = json.loads(raw)
    setter(data)
    # 末尾の改行を元のファイルに合わせる
    with io.open(path, 'w', encoding='utf-8') as f:
        f.write(json.dumps(data, ensure_ascii=False, indent=2) + '\n')

write_version(PKG, lambda d: d.update(version=new))
if os.path.exists(LOCK):
    def set_lock(d):
        d['version'] = new
        if '' in d.get('packages', {}):
            d['packages']['']['version'] = new
    write_version(LOCK, set_lock)

print(f'{cur} → {new}（{pos}桁目）')
PY
