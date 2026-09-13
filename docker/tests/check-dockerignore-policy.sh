#!/usr/bin/env bash
set -euo pipefail

file="${1:-.dockerignore}"

[[ -f "$file" ]] || {
  echo "missing dockerignore: $file" >&2
  exit 1
}

normalized_file="/tmp/dockerignore-policy.$$"
tr -d '\r' < "$file" > "$normalized_file"
file="$normalized_file"

grep -Fx -- '**' "$file" >/dev/null || {
  echo 'dockerignore must deny everything by default' >&2
  exit 1
}

expected_allowlist=(
  '!.dockerignore'
  '!.env.example'
  '!Dockerfile'
  '!compose.yaml'
  '!deno.json'
  '!deno.lock'
  '!agy-bridge.ts'
  '!agents/'
  '!agents/raw/'
  '!agents/raw/agent.md'
  '!agents/worker-ro/'
  '!agents/worker-ro/agent.md'
  '!agents/worker-rw/'
  '!agents/worker-rw/agent.md'
  '!plugins/'
  '!plugins/agy-bridge-helpers.ts'
  '!docker/'
  '!docker/auth.sh'
  '!docker/healthcheck.sh'
  '!docker/init-secrets.sh'
  '!docker/keyring-session.sh'
  '!docker/print-token.sh'
  '!docker/start-bridge.sh'
  '!agents/agy-bridge-worker-ro-v1/'
  '!agents/agy-bridge-worker-ro-v1/agent.md'
  '!docker/workspace-policy.sh'
  '!docker/workspace/'
  '!docker/workspace/verified-agy-versions.txt'
)

mapfile -t actual_allowlist < <(grep '^!' "$file")
if [[ ${#actual_allowlist[@]} -ne ${#expected_allowlist[@]} ]]; then
  echo "dockerignore allowlist entry count mismatch: expected ${#expected_allowlist[@]}, got ${#actual_allowlist[@]}" >&2
  exit 1
fi

for i in "${!expected_allowlist[@]}"; do
  if [[ "${actual_allowlist[$i]}" != "${expected_allowlist[$i]}" ]]; then
    echo "dockerignore allowlist mismatch at entry $i: expected ${expected_allowlist[$i]}, got ${actual_allowlist[$i]}" >&2
    exit 1
  fi
done

for pattern in 'agents/**' 'agents/raw/**' 'agents/worker-ro/**' 'agents/worker-rw/**' 'plugins/**' 'docker/**' 'agents/agy-bridge-worker-ro-v1/**' 'docker/workspace/**'; do
  grep -Fx -- "$pattern" "$file" >/dev/null || {
    echo "dockerignore must re-close allowlisted parent subtree: $pattern" >&2
    exit 1
  }
done

echo 'PASS: dockerignore uses a closed positive allowlist for the production build context'
