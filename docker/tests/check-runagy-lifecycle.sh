#!/usr/bin/env bash
set -euo pipefail
file="${1:-/app/agy-bridge.ts}"
write_line="$(grep -nF 'await stdinWriter.write(' "$file" | head -1 | cut -d: -f1)"
deadline_line="$(grep -nF 'watchdog = setTimeout(() => resolve("deadline")' "$file" | head -1 | cut -d: -f1)"
if [[ -z "$write_line" || -z "$deadline_line" || "$deadline_line" -ge "$write_line" ]]; then
  echo 'hard deadline is not armed before potentially blocking stdin write' >&2
  exit 1
fi
if grep -F 'if (escalateTimer !== null) clearTimeout(escalateTimer);' "$file" >/dev/null; then
  echo 'runAgy cleanup must not cancel SIGKILL escalation' >&2
  exit 1
fi
