#!/usr/bin/env bash
set -euo pipefail

# scripts/smoke-picker.sh
# Non-interactive smoke check: fails if a non-declared effort reaches the
# picker path. Verifies, at minimum:
#   1. live opencode.json masked shape for sample model auto-ro-gemini-3.1-pro
#      (high/low enabled, medium {disabled:true}, reasoning_options ["high","low"])
#   2. ~/.gentle-ai/cache/model-variants.json agy-bridge rows contain only
#      declared efforts (compared against reasoning_options, the declared-truth
#      carrier in the live masked map)
#   3. `opencode models agy-bridge --verbose` picker output for the sample
#      model exposes no disabled effort (skipped gracefully with a warning
#      when the CLI is not available)
# Exit non-zero with a clear message on any violation.

SCRIPT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_JSON="${XDG_CONFIG_HOME:-$HOME/.config}/opencode/opencode.json"
CACHE_JSON="$HOME/.gentle-ai/cache/model-variants.json"
SAMPLE_MODEL="auto-ro-gemini-3.1-pro"

FAILED=0
PASSED=0

pass() {
  echo "  [✓] $1"
  PASSED=$((PASSED + 1))
}

fail() {
  echo "  [✗] $1" >&2
  FAILED=$((FAILED + 1))
}

warn_skip() {
  echo "  [!] $1 (skipped)"
}

echo "Running picker-path smoke check..."

# ------------------------------------------------------------------------------
# 1. Live opencode.json masked shape (sample model)
# ------------------------------------------------------------------------------
echo "--- 1. Live masked shape: $SAMPLE_MODEL ---"

if ! command -v python3 >/dev/null 2>&1; then
  fail "python3 not found — cannot verify masked shape"
else
  if [[ ! -f "$CONFIG_JSON" ]]; then
    fail "opencode config not found at $CONFIG_JSON"
  else
    if SAMPLE_MODEL="$SAMPLE_MODEL" CONFIG_JSON="$CONFIG_JSON" python3 << 'PYEOF'; then
import json, os
config = json.load(open(os.environ["CONFIG_JSON"]))
models = config.get("provider", {}).get("agy-bridge", {}).get("models", {})
sample = os.environ["SAMPLE_MODEL"]
m = models.get(sample)
assert m is not None, f"sample model {sample} missing from provider.agy-bridge.models"
v = m.get("variants", {})
assert v.get("high") == {"reasoningEffort": "high"}, f"high not enabled: {v.get('high')}"
assert v.get("low") == {"reasoningEffort": "low"}, f"low not enabled: {v.get('low')}"
assert v.get("medium") == {"disabled": True}, f"medium not masked as {{disabled:true}}: {v.get('medium')}"
assert m.get("reasoning_options") == ["high", "low"], f"reasoning_options drifted: {m.get('reasoning_options')}"
PYEOF
      pass "live $SAMPLE_MODEL has high/low enabled, medium {disabled:true}, reasoning_options [high, low]"
    else
      fail "live $SAMPLE_MODEL masked shape violated (see python assertion above)"
    fi
  fi
fi

# ------------------------------------------------------------------------------
# 2. model-variants.json agy-bridge rows are declared-only
# ------------------------------------------------------------------------------
echo "--- 2. Cache rows declared-only ---"

if ! command -v python3 >/dev/null 2>&1; then
  fail "python3 not found — cannot verify cache rows"
elif [[ ! -f "$CACHE_JSON" ]]; then
  warn_skip "cache file not found at $CACHE_JSON — nothing reached the picker path yet"
  pass "absent cache trivially satisfies declared-only (nothing to leak)"
elif [[ ! -f "$CONFIG_JSON" ]]; then
  fail "opencode config not found at $CONFIG_JSON — cannot derive declared truth"
else
  if SAMPLE_MODEL="$SAMPLE_MODEL" CONFIG_JSON="$CONFIG_JSON" CACHE_JSON="$CACHE_JSON" python3 << 'PYEOF'; then
import json, os
config = json.load(open(os.environ["CONFIG_JSON"]))
models = config.get("provider", {}).get("agy-bridge", {}).get("models", {})
cache = json.load(open(os.environ["CACHE_JSON"]))
rows = cache.get("agy-bridge")
assert isinstance(rows, dict), "agy-bridge cache rows missing or not an object"
violations = []
for model_id, efforts in rows.items():
    declared = models.get(model_id, {}).get("reasoning_options")
    if declared is None:
        violations.append(f"{model_id}: singleton/undeclared model leaked picker row {efforts}")
    elif sorted(efforts) != sorted(declared):
        violations.append(f"{model_id}: picker row {sorted(efforts)} != declared {sorted(declared)}")
assert not violations, "non-declared effort reached the picker path:\n  " + "\n  ".join(violations)
PYEOF
    pass "agy-bridge cache rows contain only declared efforts"
  else
    fail "agy-bridge cache rows contain non-declared efforts (see violation above)"
  fi
fi

# ------------------------------------------------------------------------------
# 3. Picker output via opencode CLI (when available)
# ------------------------------------------------------------------------------
echo "--- 3. Picker output: opencode models agy-bridge --verbose ---"

OPENCODE_BIN=""
if command -v opencode >/dev/null 2>&1; then
  OPENCODE_BIN="$(command -v opencode)"
elif [[ -x "$HOME/.local/bin/opencode" ]]; then
  OPENCODE_BIN="$HOME/.local/bin/opencode"
fi

if [[ -z "$OPENCODE_BIN" ]]; then
  warn_skip "opencode CLI not found — picker-output check skipped"
elif ! OUTPUT="$("$OPENCODE_BIN" models agy-bridge --verbose 2>&1)"; then
  fail "opencode models agy-bridge --verbose exited non-zero"
else
  # Extract the sample-model block (entry header line up to the next entry) and
  # assert no disabled effort key (medium) is exposed to the picker.
  BLOCK="$(echo "$OUTPUT" | awk -v sample="agy-bridge/$SAMPLE_MODEL" '$0 == sample {inblock=1; next} /^agy-bridge\// {inblock=0} inblock {print}')"
  if [[ -z "$BLOCK" ]]; then
    fail "sample model agy-bridge/$SAMPLE_MODEL missing from picker output"
  elif echo "$BLOCK" | grep -q '"medium"'; then
    fail "non-declared effort \"medium\" exposed for $SAMPLE_MODEL in picker output"
  else
    pass "picker output for $SAMPLE_MODEL exposes only declared efforts"
  fi
fi

# ------------------------------------------------------------------------------
# Summary
# ------------------------------------------------------------------------------
echo "----------------------------------------"
echo "Picker smoke results: $PASSED passed, $FAILED failed"
if [[ $FAILED -gt 0 ]]; then
  exit 1
fi
exit 0
