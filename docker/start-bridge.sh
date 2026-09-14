#!/usr/bin/env bash
set -euo pipefail

/app/docker/init-secrets.sh
AGY_SECRETS_DIR="${AGY_SECRETS_DIR:-/home/agy/.local/share/agy-secrets}"
STATE_DIR="${STATE_DIR:-/home/agy/.local/state/agy-bridge}"
bridge_token_file="$AGY_SECRETS_DIR/bridge_token"
keyring_password_file="$AGY_SECRETS_DIR/keyring_password"
verified_versions_file="/app/docker/workspace/verified-agy-versions.txt"

[[ -s "$bridge_token_file" ]] || { echo "missing bridge token" >&2; exit 70; }
[[ -s "$keyring_password_file" ]] || { echo "missing keyring password" >&2; exit 70; }

AGY_TOKEN="$(cat "$bridge_token_file")"
[[ "$AGY_TOKEN" =~ ^[0-9a-f]{48}$ ]] || {
  echo "bridge token malformed; refusing to start without Bearer auth" >&2
  exit 65
}
export AGY_TOKEN
export KEYRING_PASSWORD_FILE="$keyring_password_file"
export STATE_DIR

# Recover a transaction left behind by an abrupt prior workspace run. This is
# also required when returning to the default no-workspace deployment.
/app/docker/workspace-policy.sh restore-if-needed

workspace_enabled=false
if [[ -n "${AGY_WORKSPACE_ROOT:-}" || -n "${AGY_WORKSPACE_MODE:-}" ]]; then
  workspace_enabled=true
  [[ "${AGY_WORKSPACE_ROOT:-}" == "/workspace" ]] || {
    echo "workspace mode requires AGY_WORKSPACE_ROOT=/workspace" >&2
    exit 65
  }
  [[ "${AGY_WORKSPACE_MODE:-}" == "ro" ]] || {
    echo "workspace mode requires AGY_WORKSPACE_MODE=ro" >&2
    exit 65
  }
  [[ "${MAX_CONCURRENT:-}" == "1" ]] || {
    echo "workspace mode requires MAX_CONCURRENT=1" >&2
    exit 65
  }
  [[ -d /workspace ]] || { echo "workspace mount target is missing" >&2; exit 65; }

  mount_options="$(awk '$5 == "/workspace" { print $6; exit }' /proc/self/mountinfo)"
  [[ -n "$mount_options" ]] || {
    echo "workspace mode requires /workspace to be a distinct mount" >&2
    exit 65
  }
  case ",$mount_options," in
    *,ro,*) ;;
    *) echo "workspace mount must be read-only" >&2; exit 65 ;;
  esac

  for collision in \
    /workspace/.agents/agents/agy-bridge-worker-ro-v1.md \
    /workspace/.agents/agents/agy-bridge-worker-ro-v1/agent.md; do
    [[ ! -e "$collision" ]] || {
      echo "workspace contains reserved agent collision: $collision" >&2
      exit 65
    }
  done

  [[ -f "$verified_versions_file" ]] || {
    echo "workspace verified-version allowlist is missing" >&2
    exit 65
  }
  agy_version="$($AGY_BIN --version 2>/dev/null | grep -Eo '[0-9]+\.[0-9]+\.[0-9]+' | head -n 1 || true)"
  [[ -n "$agy_version" ]] || {
    echo "could not determine exact agy semantic version" >&2
    exit 65
  }
  grep -Fx -- "$agy_version" "$verified_versions_file" >/dev/null || {
    echo "agy $agy_version is not verified for explicit host workspace mode" >&2
    exit 65
  }
fi

agents_dir="$HOME/.gemini/config/agents"
mkdir -p "$agents_dir"
for profile in raw worker-ro worker-rw agy-bridge-worker-ro-v1; do
  src="/app/agents/$profile/agent.md"
  dst_dir="$agents_dir/$profile"
  [[ -f "$src" ]] || { echo "missing managed agent: $src" >&2; exit 66; }
  mkdir -p "$dst_dir"
  cp "$src" "$dst_dir/agent.md"
done

if [[ "$workspace_enabled" == true ]]; then
  echo "workspace_enabled=true workspace_mode=ro workspace_root=/workspace"
fi

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
    --allow-run="$AGY_BIN,/app/docker/workspace-policy.sh" \
    --allow-read="$HOME/.gemini/antigravity-cli/brain" \
    --allow-write="$STATE_DIR" \
    /app/agy-bridge.ts
'
