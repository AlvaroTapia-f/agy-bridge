#!/usr/bin/env bash
set -euo pipefail

production_files=(
  "agy-bridge.ts"
  "Dockerfile"
  "compose.yaml"
  "compose.workspace.yaml"
  "docker/start-bridge.sh"
  "docker/workspace-policy.sh"
  "agents/agy-bridge-worker-ro-v1/agent.md"
)

forbidden_patterns=(
  'read_file(*)'
  'write_file(*)'
  'command(*)'
  '--dangerously-skip-permissions'
  '--allow-read=/workspace'
  '--allow-write=/workspace'
)

failed=0

for path in "${production_files[@]}"; do
  if [[ ! -f "$path" ]]; then
    echo "missing production file: $path" >&2
    failed=1
  fi
done

for pattern in "${forbidden_patterns[@]}"; do
  if grep -nF -- "$pattern" "${production_files[@]}"; then
    echo "forbidden workspace security pattern found: $pattern" >&2
    failed=1
  fi
done

if (( failed != 0 )); then
  exit 1
fi

echo "PASS: workspace production sources contain no forbidden security patterns"
