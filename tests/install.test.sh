#!/usr/bin/env bash
set -euo pipefail

SCRIPT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_SCRIPT="$SCRIPT_ROOT/install.sh"
SYNC_SCRIPT="$SCRIPT_ROOT/scripts/sync-models.ts"

FAILED=0
PASSED=0

assert() {
  local desc="$1"
  local cmd="$2"
  if eval "$cmd"; then
    echo "  [✓] $desc"
    PASSED=$((PASSED + 1))
  else
    echo "  [✗] $desc" >&2
    FAILED=$((FAILED + 1))
  fi
}

echo "Running tests for install.sh integration..."

# ------------------------------------------------------------------------------
# 1. Static Checks
# ------------------------------------------------------------------------------
echo "--- 1. Static Checks ---"
assert "install.sh exists" '[[ -f "$INSTALL_SCRIPT" ]]'
assert "install.sh is executable" '[[ -x "$INSTALL_SCRIPT" ]]'
assert "install.sh passes bash -n" 'bash -n "$INSTALL_SCRIPT"'
assert "install.sh does not contain literal token definitions" '! grep -E "AGY_TOKEN=[a-zA-Z0-9_-]{10,}" "$INSTALL_SCRIPT"'

# ------------------------------------------------------------------------------
# 2. Provider Provisioning: Missing opencode.json
# ------------------------------------------------------------------------------
echo "--- 2. Missing opencode.json Handling ---"
TMP_DIR="$(mktemp -d)"
MOCK_HOME="$TMP_DIR/home"
MOCK_CONFIG="$MOCK_HOME/.config"
mkdir -p "$MOCK_CONFIG"

assert "install.sh handles missing opencode.json without error" '
  OUTPUT=$(HOME="$MOCK_HOME" XDG_CONFIG_HOME="$MOCK_CONFIG" "$INSTALL_SCRIPT" 2>&1)
  echo "$OUTPUT" | grep -q "No opencode config at"
'

rm -rf "$TMP_DIR"

# ------------------------------------------------------------------------------
# 3. Provider Provisioning: Deno-First Model Sync
# ------------------------------------------------------------------------------
echo "--- 3. Deno-First Model Sync ---"
TMP_DIR2="$(mktemp -d)"
MOCK_HOME2="$TMP_DIR2/home"
MOCK_CONFIG2="$MOCK_HOME2/.config"
mkdir -p "$MOCK_CONFIG2/opencode"

# Seed existing opencode.json with another provider
cat << 'JSON' > "$MOCK_CONFIG2/opencode/opencode.json"
{
  "provider": {
    "openai": {
      "npm": "@ai-sdk/openai",
      "models": { "gpt-4o": {} }
    }
  }
}
JSON

HOME="$MOCK_HOME2" XDG_CONFIG_HOME="$MOCK_CONFIG2" "$INSTALL_SCRIPT" >/dev/null 2>&1 || true

assert "opencode.json contains provider.agy-bridge" 'grep -q "\"agy-bridge\"" "$MOCK_CONFIG2/opencode/opencode.json"'
assert "Other provider (openai) preserved" 'grep -q "\"openai\"" "$MOCK_CONFIG2/opencode/opencode.json"'
assert "Models synchronized with auto-ro-* prefix" 'grep -q "\"auto-ro-gemini-3.7-flash\"" "$MOCK_CONFIG2/opencode/opencode.json"'
assert "Models contain variants map" 'grep -q "\"variants\"" "$MOCK_CONFIG2/opencode/opencode.json"'
assert "Plugin reference added" 'grep -q "plugins/agy-bridge.ts" "$MOCK_CONFIG2/opencode/opencode.json"'

# ------------------------------------------------------------------------------
# 4. Idempotency Check
# ------------------------------------------------------------------------------
echo "--- 4. Idempotent Provider Provisioning ---"
# Run install.sh a second time on the same config
HOME="$MOCK_HOME2" XDG_CONFIG_HOME="$MOCK_CONFIG2" "$INSTALL_SCRIPT" >/dev/null 2>&1 || true

assert "Idempotent run maintains valid JSON" '
  python3 -c "import json; json.load(open(\"$MOCK_CONFIG2/opencode/opencode.json\"))"
'
assert "Idempotent run does not duplicate plugin entries" '
  python3 -c "import json; data=json.load(open(\"$MOCK_CONFIG2/opencode/opencode.json\")); assert len(data.get(\"plugin\", [])) == 1"
'

rm -rf "$TMP_DIR2"

# ------------------------------------------------------------------------------
# 5. Live Deno Model Sync via Mock agy
# ------------------------------------------------------------------------------
echo "--- 5. Dynamic Deno Model Sync ---"
TMP_DIR3="$(mktemp -d)"
MOCK_HOME3="$TMP_DIR3/home"
MOCK_CONFIG3="$MOCK_HOME3/.config"
MOCK_BIN3="$TMP_DIR3/bin"
mkdir -p "$MOCK_CONFIG3/opencode" "$MOCK_BIN3"

# Create mock agy that returns live TSV with ultra model
cat << 'MOCK' > "$MOCK_BIN3/agy"
#!/usr/bin/env bash
if [[ "${1:-}" == "models" ]]; then
  echo -e "id\tname\tdescription"
  echo -e "gemini-3.8-flash-high\tGemini 3.8 Flash High\tFast"
  echo -e "gemini-3.8-flash-ultra\tGemini 3.8 Flash Ultra\tUltra reasoning"
  exit 0
fi
exit 0
MOCK
chmod +x "$MOCK_BIN3/agy"

cat << 'JSON' > "$MOCK_CONFIG3/opencode/opencode.json"
{
  "provider": {}
}
JSON

PATH="$MOCK_BIN3:$PATH" HOME="$MOCK_HOME3" XDG_CONFIG_HOME="$MOCK_CONFIG3" "$INSTALL_SCRIPT" >/dev/null 2>&1 || true

assert "Live TSV dynamically syncs gemini-3.8-flash into opencode.json" 'grep -q "\"auto-ro-gemini-3.8-flash\"" "$MOCK_CONFIG3/opencode/opencode.json"'
assert "Live TSV includes ultra variant in reasoningEffort" 'grep -q "\"ultra\"" "$MOCK_CONFIG3/opencode/opencode.json"'

rm -rf "$TMP_DIR3"

# ------------------------------------------------------------------------------
# 6. Python Fallback on Deno Sync Failure
# ------------------------------------------------------------------------------
echo "--- 6. Python Fallback Guard ---"
TMP_DIR4="$(mktemp -d)"
MOCK_HOME4="$TMP_DIR4/home"
MOCK_CONFIG4="$MOCK_HOME4/.config"
MOCK_BIN4="$TMP_DIR4/bin"
mkdir -p "$MOCK_CONFIG4/opencode" "$MOCK_BIN4"

# Create mock deno that fails during sync
cat << 'MOCK' > "$MOCK_BIN4/deno"
#!/usr/bin/env bash
if [[ "$*" == *"scripts/sync-models.ts"* ]]; then
  echo "Simulated Deno sync failure" >&2
  exit 1
fi
exec "$(command -v deno 2>/dev/null || echo /usr/bin/deno)" "$@"
MOCK
chmod +x "$MOCK_BIN4/deno"

cat << 'JSON' > "$MOCK_CONFIG4/opencode/opencode.json"
{
  "provider": {}
}
JSON

PATH="$MOCK_BIN4:$PATH" HOME="$MOCK_HOME4" XDG_CONFIG_HOME="$MOCK_CONFIG4" "$INSTALL_SCRIPT" >/dev/null 2>&1 || true

assert "Fallback ensures 14 default models exist when Deno sync fails" '
  python3 -c "import json; data=json.load(open(\"$MOCK_CONFIG4/opencode/opencode.json\")); assert len(data[\"provider\"][\"agy-bridge\"][\"models\"]) >= 14"
'

rm -rf "$TMP_DIR4"


# ------------------------------------------------------------------------------
# Summary
# ------------------------------------------------------------------------------
echo "----------------------------------------"
echo "Test results: $PASSED passed, $FAILED failed"
if [[ $FAILED -gt 0 ]]; then
  exit 1
fi
exit 0

