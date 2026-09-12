#!/usr/bin/env bash
set -euo pipefail
file="${1:-/app/agy-bridge.ts}"

apply_line="$(grep -nF 'await runWorkspacePolicy("apply-ro")' "$file" | head -1 | cut -d: -f1)"
spawn_line="$(grep -nF 'const child = new Deno.Command(AGY_BIN' "$file" | head -1 | cut -d: -f1)"
status_wait_line="$(grep -nF 'await workspaceChildStatus;' "$file" | head -1 | cut -d: -f1)"
restore_line="$(grep -nF 'await runWorkspacePolicy("restore")' "$file" | head -1 | cut -d: -f1)"
release_line="$(grep -nF 'release();' "$file" | tail -1 | cut -d: -f1)"

for pair in \
  "$apply_line:$spawn_line:policy apply must happen before agy spawn" \
  "$spawn_line:$status_wait_line:workspace child terminal wait must happen after spawn" \
  "$status_wait_line:$restore_line:workspace policy restore must wait for child terminal status" \
  "$restore_line:$release_line:workspace policy restore must happen before concurrency release"; do
  IFS=: read -r first second message <<<"$pair"
  if [[ -z "$first" || -z "$second" || "$first" -ge "$second" ]]; then
    echo "$message" >&2
    exit 1
  fi
done

echo 'PASS: workspace runAgy policy lifecycle ordering'
