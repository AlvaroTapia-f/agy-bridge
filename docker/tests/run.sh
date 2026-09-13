#!/usr/bin/env bash
set -euo pipefail
bash -n /app/docker/*.sh /app/docker/tests/*.sh
if LC_ALL=C grep -q $'\r' /app/docker/workspace/verified-agy-versions.txt; then
  echo "FAIL: verified agy version allowlist contains CRLF inside the image" >&2
  exit 1
fi
bash /app/docker/tests/check-runtime-policy.sh /app/Dockerfile /app/compose.yaml
bash /app/docker/tests/check-dockerignore-policy.sh /app/.dockerignore
bash /app/docker/tests/test-secrets.sh
bash /app/docker/tests/test-keyring.sh
bash /app/docker/tests/test-workspace-policy.sh /app/docker/workspace-policy.sh
bash /app/docker/tests/check-runtime-permissions.sh /app/docker/start-bridge.sh
bash /app/docker/tests/check-runagy-lifecycle.sh /app/agy-bridge.ts
bash /app/docker/tests/check-workspace-runagy-lifecycle.sh /app/agy-bridge.ts
bash /app/docker/tests/check-verify-all-policy.sh /app/docker/tests/verify-all.ps1
bash /app/docker/tests/test-bridge.sh
echo "PASS: deterministic Docker test suite"
