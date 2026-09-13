#!/usr/bin/env bash
set -euo pipefail

/app/docker/init-secrets.sh
export KEYRING_PASSWORD_FILE="${KEYRING_PASSWORD_FILE:-/home/agy/.local/share/agy-secrets/keyring_password}"

cat >&2 <<'MSG'
Starting Antigravity account OAuth inside Docker.
Open the authorization URL printed by agy in your host browser, complete Google sign-in, then paste the authorization code back into this terminal.
After authentication completes, exit agy with Ctrl+D or /exit.
MSG

exec /app/docker/keyring-session.sh "$AGY_BIN"
