#!/usr/bin/env bash
set -euo pipefail
curl --fail --silent --show-error --max-time 3 http://127.0.0.1:7421/healthz >/dev/null
