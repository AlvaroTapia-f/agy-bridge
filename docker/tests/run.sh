#!/usr/bin/env bash
set -euo pipefail
bash -n /app/docker/*.sh /app/docker/tests/*.sh
bash /app/docker/tests/test-secrets.sh
bash /app/docker/tests/test-keyring.sh
bash /app/docker/tests/check-runtime-permissions.sh /app/docker/start-bridge.sh
bash /app/docker/tests/check-runagy-lifecycle.sh /app/agy-bridge.ts
bash /app/docker/tests/check-verify-all-policy.sh /app/docker/tests/verify-all.ps1
deno fmt --check /app/tests/runagy-blocked-stdin.test.ts /app/tests/service.test.ts
bash /app/docker/tests/test-bridge.sh
echo "PASS: deterministic Docker test suite"
