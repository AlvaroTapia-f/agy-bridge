#!/usr/bin/env bash
set -euo pipefail
file="${1:-/app/docker/tests/verify-all.ps1}"
identity_file="${2:-/app/docker/tests/assert-pr3-identity.ps1}"
identity_test="${3:-/app/docker/tests/test-verifier-identity.ps1}"
docs_file="${4:-/app/docs/docker-compose.md}"
suite_file="${5:-/app/docker/tests/run.sh}"

[[ -f "$file" ]] || {
  echo "missing full verifier: $file" >&2
  exit 1
}

[[ -f "$identity_file" ]] || {
  echo "missing PR3 identity gate: $identity_file" >&2
  exit 1
}

[[ -f "$identity_test" ]] || {
  echo "missing PR3 identity regression: $identity_test" >&2
  exit 1
}

[[ -f "$docs_file" ]] || {
  echo "missing Docker deployment guide: $docs_file" >&2
  exit 1
}

[[ -f "$suite_file" ]] || {
  echo "missing deterministic Docker suite: $suite_file" >&2
  exit 1
}

required=(
  '[string]$ExpectedHead'
  '[string]$Model'
  '[string]$BaseRef'
  '[switch]$SkipLive'
  '[switch]$SkipDockerRestart'
  'assert-pr3-identity.ps1'
  'test-build-context.ps1'
  'test-compose.ps1'
  'test-compose-workspace.ps1'
  'test-compose-workspace-rw.ps1'
  'compose.workspace.yaml'
  'compose.workspace-rw.yaml'
  'AGY_WORKSPACE_HOST_PATH'
  'verified-agy-versions.txt'
  'verified-rw-agy-versions.txt'
  'RW exact agy version and fixture setup'
  'RW intended workspace mutation'
  'RW generic deletion denial'
  'RW non-workspace read denial'
  'RW non-workspace write denial'
  'RW traversal denial'
  'RW symlink denial'
  'RW environment canary exclusion'
  'RW Docker control-surface assertions'
  'Workspace exact agy version gate and fixture setup'
  'Workspace read access'
  'Workspace host immutability'
  'Workspace auto-rw denial'
  'Workspace non-workspace canary denial'
  '/app/.workspace-app-canary/value.txt'
  '/workspace/../app/.workspace-app-canary/value.txt'
  'Get-WorkspaceFingerprint'
  'Get-Sha256Hex'
  'System.Security.Cryptography.SHA256'
  'auto-rw must return HTTP 403'
  'docker compose config'
  '--profile test build test'
  'dockerTestsMount'
  '/mnt/docker-tests:ro'
  'stageDockerTests'
  'test ! -e /app/docker/tests'
  "sed -i 's/\\r$//'"
  'dockerDocsMount'
  '/app/docs/docker-compose.md:ro'
  'sourceMount'
  '/workspace:ro'
  "'-w', '/workspace'"
  'docker/tests/run.sh'
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

identity_required=(
  '[string]$ExpectedHead'
  '[string]$BaseRef'
  'f5ae309fd1cfe11653753d9b62eb7da19abac767'
  'git rev-parse HEAD'
  '--untracked-files=all'
  'Base ref mismatch'
  'merge-base'
  '--is-ancestor'
  "'diff', '--name-only'"
  '^docker/tests/'
  'docs/docker-compose.md'
  '.github/workflows/linux-docker-deterministic.yml'
  "'diff', '--check'"
)

for needle in "${identity_required[@]}"; do
  grep -F -- "$needle" "$identity_file" >/dev/null || {
    echo "PR3 identity gate is missing required marker: $needle" >&2
    exit 1
  }
done

identity_regression_required=(
  'wrong frozen base'
  'non-ancestor base'
  'disallowed changed path'
  'arbitrary untracked local file'
  'allowed verifier/docs/workflow diff'
)

for needle in "${identity_regression_required[@]}"; do
  grep -F -- "$needle" "$identity_test" >/dev/null || {
    echo "PR3 identity regression is missing scenario: $needle" >&2
    exit 1
  }
done

grep -F -- 'f5ae309fd1cfe11653753d9b62eb7da19abac767' "$docs_file" >/dev/null || {
  echo 'Docker deployment guide must pin the final frozen main SHA' >&2
  exit 1
}

if grep -F -- '878bb90a16281cc66a0c8ef849bb4329c2fab665' "$docs_file" >/dev/null; then
  echo 'Docker deployment guide still references the obsolete PR2 SHA' >&2
  exit 1
fi

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

if grep -E 'upstream/main|origin/main' "$file" >/dev/null; then
  echo 'full verifier must require an explicit frozen main -BaseRef instead of guessing main' >&2
  exit 1
fi

if grep -F -- '...HEAD' "$identity_file" >/dev/null; then
  echo 'full verifier must prove ancestry before diffing PR2 -> PR3; triple-dot alone is not an identity gate' >&2
  exit 1
fi

grep -F -- 'check-workspace-security-patterns.sh' "$suite_file" >/dev/null || {
  echo 'deterministic Docker suite must invoke check-workspace-security-patterns.sh' >&2
  exit 1
}

echo 'PASS: full verifier retains required Docker runtime merge gates'
