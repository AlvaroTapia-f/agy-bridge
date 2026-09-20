#!/usr/bin/env bash
set -euo pipefail
source /app/docker/tests/assert.sh

root="$(mktemp -d)"
trap 'rm -rf "$root"' EXIT
export AGY_SECRETS_DIR="$root/secrets"

/app/docker/init-secrets.sh
assert_file "$AGY_SECRETS_DIR/bridge_token"
assert_file "$AGY_SECRETS_DIR/keyring_password"
assert_mode "$AGY_SECRETS_DIR/bridge_token" 600
assert_mode "$AGY_SECRETS_DIR/keyring_password" 600

first_token="$(cat "$AGY_SECRETS_DIR/bridge_token")"
first_keyring="$(cat "$AGY_SECRETS_DIR/keyring_password")"
[[ "$first_token" =~ ^[0-9a-f]{48}$ ]] || fail "bridge token format"
[[ "$first_keyring" =~ ^[0-9a-f]{64}$ ]] || fail "keyring password format"

/app/docker/init-secrets.sh
assert_eq "$(cat "$AGY_SECRETS_DIR/bridge_token")" "$first_token"
assert_eq "$(cat "$AGY_SECRETS_DIR/keyring_password")" "$first_keyring"
assert_eq "$(/app/docker/print-token.sh)" "AGY_TOKEN=$first_token"

echo "PASS: secrets are random, restrictive, and idempotent"
