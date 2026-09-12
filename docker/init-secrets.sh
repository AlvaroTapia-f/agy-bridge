#!/usr/bin/env bash
set -euo pipefail

AGY_SECRETS_DIR="${AGY_SECRETS_DIR:-/home/agy/.local/share/agy-secrets}"
umask 077
mkdir -p "$AGY_SECRETS_DIR"
chmod 700 "$AGY_SECRETS_DIR"

generate_hex() {
  local bytes="$1"
  od -An -N "$bytes" -tx1 /dev/urandom | tr -d ' \n'
}

if [[ ! -s "$AGY_SECRETS_DIR/bridge_token" ]]; then
  generate_hex 24 > "$AGY_SECRETS_DIR/bridge_token"
fi
if [[ ! -s "$AGY_SECRETS_DIR/keyring_password" ]]; then
  generate_hex 32 > "$AGY_SECRETS_DIR/keyring_password"
fi
chmod 600 "$AGY_SECRETS_DIR/bridge_token" "$AGY_SECRETS_DIR/keyring_password"
