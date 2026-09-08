#!/usr/bin/env bash
set -euo pipefail

# tests/plugin-smoke.sh
# Live OpenCode plugin smoke harness.
# Tests candidate bundle in a temporary sandbox project against opencode models.
# Calibrates on current plugin first; never touches ~/.config/opencode or installed plugins.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CANDIDATE_PLUGIN="${1:-$SCRIPT_DIR/plugins/agy-bridge.ts}"
CURRENT_PLUGIN="$SCRIPT_DIR/plugins/agy-bridge.ts"

# Discover opencode binary
OPENCODE_BIN=""
if command -v opencode >/dev/null 2>&1; then
  OPENCODE_BIN="$(command -v opencode)"
elif [[ -x "/home/alvaro/.local/bin/opencode" ]]; then
  OPENCODE_BIN="/home/alvaro/.local/bin/opencode"
elif [[ -x "$HOME/.local/bin/opencode" ]]; then
  OPENCODE_BIN="$HOME/.local/bin/opencode"
fi

if [[ -z "$OPENCODE_BIN" ]]; then
  echo "Error: opencode binary not found on PATH or ~/.local/bin/opencode" >&2
  exit 1
fi

echo "==> Live plugin smoke gate using $OPENCODE_BIN"

# Helper to run smoke in sandbox
run_sandbox_smoke() {
  local plugin_src="$1"
  local label="$2"
  local tmp_dir
  tmp_dir="$(mktemp -d /tmp/opencode-smoke.XXXXXX)"
  
  trap 'rm -rf "$tmp_dir"' RETURN

  mkdir -p "$tmp_dir/plugins"
  cp "$plugin_src" "$tmp_dir/plugins/agy-bridge.ts"

  cat << JSON > "$tmp_dir/opencode.json"
{
  "plugin": [
    "./plugins/agy-bridge.ts"
  ],
  "provider": {
    "agy-bridge": {
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "http://127.0.0.1:7421/v1"
      }
    }
  }
}
JSON

  echo "--- Testing $label in sandbox: $tmp_dir ---"
  local output
  output="$(cd "$tmp_dir" && "$OPENCODE_BIN" models 2>&1)"

  # Assert agy-bridge/auto-* models are listed
  local count
  count="$(echo "$output" | grep -c "agy-bridge/auto-" || true)"
  if [[ "$count" -lt 14 ]]; then
    echo "FAIL: Expected at least 14 agy-bridge/auto-* models in $label, found $count" >&2
    echo "$output" >&2
    return 1
  fi

  # Assert specific representative auto-ro and auto-rw models
  if ! echo "$output" | grep -q "agy-bridge/auto-ro-gemini-3.7-flash"; then
    echo "FAIL: Missing agy-bridge/auto-ro-gemini-3.7-flash in $label" >&2
    return 1
  fi
  if ! echo "$output" | grep -q "agy-bridge/auto-rw-gemini-3.8-flash"; then
    echo "FAIL: Missing agy-bridge/auto-rw-gemini-3.8-flash in $label" >&2
    return 1
  fi
  if ! echo "$output" | grep -q "agy-bridge/auto-ro-claude-opus-4-6"; then
    echo "FAIL: Missing agy-bridge/auto-ro-claude-opus-4-6 in $label" >&2
    return 1
  fi

  echo "PASS: $label verified successfully ($count models found)."
  return 0
}

# Step 1: Calibrate on CURRENT plugin first
if [[ -f "$CURRENT_PLUGIN" ]]; then
  run_sandbox_smoke "$CURRENT_PLUGIN" "CURRENT plugin ($CURRENT_PLUGIN)"
fi

# Step 2: If candidate is different from current plugin, test CANDIDATE bundle
if [[ "$CANDIDATE_PLUGIN" != "$CURRENT_PLUGIN" && -f "$CANDIDATE_PLUGIN" ]]; then
  run_sandbox_smoke "$CANDIDATE_PLUGIN" "CANDIDATE plugin ($CANDIDATE_PLUGIN)"
fi

echo "==> All plugin smoke checks passed."
