#!/usr/bin/env bash
set -euo pipefail
file="${1:-/app/docker/tests/verify-all.ps1}"

[[ -f "$file" ]] || {
  echo "missing full verifier: $file" >&2
  exit 1
}

required=(
  '[string]$ExpectedHead'
  '[string]$Model'
  '[switch]$SkipLive'
  '[switch]$SkipDockerRestart'
  'git rev-parse HEAD'
  'git diff --check'
  'test-build-context.ps1'
  'test-compose.ps1'
  'docker compose config'
  '--profile test build test'
  '--profile test run --rm test'
  'deno lint'
  'deno task test'
  'http://127.0.0.1:7421'
  '/healthz'
  '/v1/models'
  '/v1/chat/completions'
  'data: [DONE]'
  'auto-ro-'
  'auto-rw-'
  'docker compose restart agy-bridge'
  '--force-recreate'
  'docker compose build agy-bridge'
  'verify-persistence-marker'
  'Read-Host'
  'docker info'
  'function Invoke-DockerInfoProbe'
  'WaitForExit($TimeoutMs)'
  '[Docker restart] waiting for daemon outage'
  '[Docker restart] daemon is UP'
  'function Wait-DockerUnavailable'
  'Docker daemon did not become unavailable during the restart checkpoint'
  'down -v'
  'PASS'
  'FAIL'
  'SKIP'
)

for needle in "${required[@]}"; do
  grep -F -- "$needle" "$file" >/dev/null || {
    echo "full verifier is missing required gate marker: $needle" >&2
    exit 1
  }
done

# The Docker Desktop checkpoint must prove an observed daemon outage rather
# than require a container StartedAt change. Desktop/daemon restarts can keep
# a container runtime alive, and prior gates already prove container restart,
# down/up, recreate, and rebuild persistence independently.
if grep -F -- 'container StartedAt did not change' "$file" >/dev/null; then
  echo 'full verifier must not use container StartedAt as Docker Desktop restart proof' >&2
  exit 1
fi

# Restart probes must be independently time-bounded. A synchronous
# Invoke-DockerCapture('info') can hang on the Windows Docker named pipe while
# Docker Desktop is restarting and freeze the whole verifier.
if grep -F -- "Invoke-DockerCapture -ArgumentList @('info')" "$file" >/dev/null; then
  echo 'Docker Desktop restart probe must not call blocking Invoke-DockerCapture docker info' >&2
  exit 1
fi

# The verifier must never require host Deno/Bash/Python for the Deno gates.
if grep -E '^[[:space:]]*&?[[:space:]]*deno[[:space:]]+(lint|task test)' "$file" >/dev/null; then
  echo 'full verifier must run Deno checks inside the Docker test service' >&2
  exit 1
fi

echo 'PASS: full verifier retains required PR #2 merge gates'
