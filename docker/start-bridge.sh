#!/usr/bin/env bash
set -euo pipefail

/app/docker/init-secrets.sh
AGY_SECRETS_DIR="${AGY_SECRETS_DIR:-/home/agy/.local/share/agy-secrets}"
bridge_token_file="$AGY_SECRETS_DIR/bridge_token"
keyring_password_file="$AGY_SECRETS_DIR/keyring_password"

[[ -s "$bridge_token_file" ]] || { echo "missing bridge token" >&2; exit 70; }
[[ -s "$keyring_password_file" ]] || { echo "missing keyring password" >&2; exit 70; }

AGY_TOKEN="$(cat "$bridge_token_file")"
[[ "$AGY_TOKEN" =~ ^[0-9a-f]{48}$ ]] || {
  echo "bridge token malformed; refusing to start without Bearer auth" >&2
  exit 65
}
export AGY_TOKEN
export KEYRING_PASSWORD_FILE="$keyring_password_file"

agents_dir="$HOME/.gemini/config/agents"
mkdir -p "$agents_dir"
for profile in raw worker-ro worker-rw; do
  src="/app/agents/$profile/agent.md"
  dst_dir="$agents_dir/$profile"
  [[ -f "$src" ]] || { echo "missing managed agent: $src" >&2; exit 66; }
  mkdir -p "$dst_dir"
  cp "$src" "$dst_dir/agent.md"
done

exec /app/docker/keyring-session.sh bash -lc '
  set -euo pipefail
  if ! timeout 45s "$AGY_BIN" models >/tmp/agy-models.tsv 2>/tmp/agy-models.err; then
    cat /tmp/agy-models.err >&2 || true
    echo "Antigravity authentication/model preflight failed. Run: docker compose run --rm agy-auth" >&2
    exit 78
  fi
  if [[ ! -s /tmp/agy-models.tsv ]]; then
    echo "agy models returned no models; refusing to start" >&2
    exit 78
  fi
  exec deno run \
    --allow-net=0.0.0.0:7421 \
    --allow-env \
    --allow-run="$AGY_BIN" \
    --allow-read="$HOME/.gemini/antigravity-cli/brain" \
    --allow-write="$STATE_DIR" \
    /app/agy-bridge.ts
'
