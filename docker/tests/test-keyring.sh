#!/usr/bin/env bash
set -euo pipefail
source /app/docker/tests/assert.sh

root="$(mktemp -d)"
trap 'rm -rf "$root"' EXIT
export KEYRING_PASSWORD_FILE="$root/keyring_password"
printf '%s' 'test-only-keyring-password' > "$KEYRING_PASSWORD_FILE"
chmod 600 "$KEYRING_PASSWORD_FILE"

/app/docker/keyring-session.sh bash -lc '
  printf %s "round-trip-secret" | secret-tool store --label="agy-bridge-test" service agy-bridge-test
  value="$(secret-tool lookup service agy-bridge-test)"
  [[ "$value" == "round-trip-secret" ]]
'

echo "PASS: keyring secret-service round trip"
