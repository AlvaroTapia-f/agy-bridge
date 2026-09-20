#!/usr/bin/env bash
set -euo pipefail
file="${1:-/app/docker/start-bridge.sh}"

grep -F -- '--allow-net=0.0.0.0:7421' "$file" >/dev/null || {
  echo 'missing scoped --allow-net=0.0.0.0:7421' >&2
  exit 1
}
grep -F -- '--allow-read="$HOME/.gemini/antigravity-cli/brain"' "$file" >/dev/null || {
  echo 'missing scoped transcript read permission' >&2
  exit 1
}
if grep -E -- '^[[:space:]]*--allow-net[[:space:]]*\\?$' "$file" >/dev/null; then
  echo 'bare --allow-net is forbidden' >&2
  exit 1
fi
if grep -F -- '--allow-read="$HOME/.gemini"' "$file" >/dev/null; then
  echo 'broad ~/.gemini read is forbidden' >&2
  exit 1
fi
