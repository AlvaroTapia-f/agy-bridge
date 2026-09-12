#!/usr/bin/env bash
set -euo pipefail
file="${1:-/app/agy-bridge.ts}"

runagy_start="$(grep -nF 'async function runAgy(' "$file" | head -1 | cut -d: -f1)"
runagy_end="$(grep -nF '// ---------- OpenAI response shapes ----------' "$file" | head -1 | cut -d: -f1)"

if [[ -z "$runagy_start" || -z "$runagy_end" || "$runagy_start" -ge "$runagy_end" ]]; then
  echo 'could not determine runAgy source range' >&2
  exit 1
fi

line_in_runagy() {
  local needle="$1"
  awk -v start="$runagy_start" -v end="$runagy_end" -v needle="$needle" '
    NR >= start && NR < end && index($0, needle) { print NR; exit }
  ' "$file"
}

apply_line="$(line_in_runagy 'await runWorkspacePolicy("apply-ro")')"
spawn_line="$(line_in_runagy 'const child = new Deno.Command(AGY_BIN')"
status_wait_line="$(line_in_runagy 'await workspaceChildStatus;')"
restore_line="$(line_in_runagy 'await runWorkspacePolicy("restore")')"
release_line="$(line_in_runagy 'release();')"

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
