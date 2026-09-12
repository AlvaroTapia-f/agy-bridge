#!/usr/bin/env bash
set -euo pipefail
file="${1:-.dockerignore}"
required=(
  '*.env'
  '*.jsonl'
  '.local/'
  'state/'
  '.codegraph'
  '.deno/'
  'cov_profile/'
  '.atl/'
  'Thumbs.db'
  '*.swp'
  '*.swo'
  '*~'
)
for pattern in "${required[@]}"; do
  grep -Fx -- "$pattern" "$file" >/dev/null || {
    echo "missing dockerignore pattern: $pattern" >&2
    exit 1
  }
done
