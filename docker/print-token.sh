#!/usr/bin/env bash
set -euo pipefail

AGY_SECRETS_DIR="${AGY_SECRETS_DIR:-/home/agy/.local/share/agy-secrets}"
token_file="$AGY_SECRETS_DIR/bridge_token"
[[ -s "$token_file" ]] || { echo "bridge token not initialized" >&2; exit 70; }
token="$(cat "$token_file")"
[[ "$token" =~ ^[0-9a-f]{48}$ ]] || {
  echo "bridge token is malformed; refusing unauthenticated operation" >&2
  exit 65
}
printf 'AGY_TOKEN=%s\n' "$token"
