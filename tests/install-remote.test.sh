#!/usr/bin/env bash
set -euo pipefail

SCRIPT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_SCRIPT="$SCRIPT_ROOT/install-remote.sh"

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

echo "Running tests for install-remote.sh..."

# ------------------------------------------------------------------------------
# 1. Static Checks
# ------------------------------------------------------------------------------
echo "--- 1. Static Checks ---"
assert "install-remote.sh exists" '[[ -f "$TARGET_SCRIPT" ]]'
assert "install-remote.sh is executable" '[[ -x "$TARGET_SCRIPT" ]]'
assert "install-remote.sh passes bash -n" 'bash -n "$TARGET_SCRIPT"'
assert "install-remote.sh has <120 lines" '[[ $(wc -l < "$TARGET_SCRIPT") -lt 120 ]]'
assert "install-remote.sh has set -euo pipefail" 'grep -E "set -(e.*u.*o.*pipefail|[a-z]*e[a-z]*u[a-z]*o[a-z]* pipefail)" "$TARGET_SCRIPT"'
assert "install-remote.sh does not contain sudo" '! grep -w "sudo" "$TARGET_SCRIPT"'
assert "install-remote.sh does not contain literal token definitions" '! grep -E "AGY_TOKEN=[a-zA-Z0-9_-]{10,}" "$TARGET_SCRIPT"'

# ------------------------------------------------------------------------------
# 2. Prerequisite Fail-Fast
# ------------------------------------------------------------------------------
echo "--- 2. Prerequisite Fail-Fast ---"
# Test missing agy
TMP_BIN_NO_AGY="$(mktemp -d)"
TMP_HOME_NO_BIN="$(mktemp -d)"
ln -s "$(command -v bash)" "$TMP_BIN_NO_AGY/deno"
if HOME="$TMP_HOME_NO_BIN" PATH="$TMP_BIN_NO_AGY" "$TARGET_SCRIPT" >/dev/null 2>&1; then
  echo "  [✗] Missing agy should fail" >&2
  FAILED=$((FAILED + 1))
else
  echo "  [✓] Missing agy fails fast"
  PASSED=$((PASSED + 1))
fi
rm -rf "$TMP_BIN_NO_AGY" "$TMP_HOME_NO_BIN"

# Test missing deno
TMP_BIN_NO_DENO="$(mktemp -d)"
TMP_HOME_NO_BIN="$(mktemp -d)"
ln -s "$(command -v bash)" "$TMP_BIN_NO_DENO/agy"
if HOME="$TMP_HOME_NO_BIN" PATH="$TMP_BIN_NO_DENO" "$TARGET_SCRIPT" >/dev/null 2>&1; then
  echo "  [✗] Missing deno should fail" >&2
  FAILED=$((FAILED + 1))
else
  echo "  [✓] Missing deno fails fast"
  PASSED=$((PASSED + 1))
fi
rm -rf "$TMP_BIN_NO_DENO" "$TMP_HOME_NO_BIN"

# ------------------------------------------------------------------------------
# 3. Dir & Ref resolution, fetch, and delegation
# ------------------------------------------------------------------------------
echo "--- 3. Dir Resolution and Delegation ---"
TMP_WORKSPACE="$(mktemp -d)"
MOCK_BIN="$TMP_WORKSPACE/mock_bin"
mkdir -p "$MOCK_BIN"

# Create mock agy and deno
cat << 'MOCK' > "$MOCK_BIN/agy"
#!/usr/bin/env bash
exit 0
MOCK
chmod +x "$MOCK_BIN/agy"

cat << 'MOCK' > "$MOCK_BIN/deno"
#!/usr/bin/env bash
exit 0
MOCK
chmod +x "$MOCK_BIN/deno"

# Create mock git that logs commands and creates a stub install.sh
LOG_FILE="$TMP_WORKSPACE/git.log"
cat << 'MOCK' > "$MOCK_BIN/git"
#!/usr/bin/env bash
echo "git $*" >> "$LOG_FILE"
if [[ "$1" == "clone" ]]; then
  TARGET_DIR="${@: -1}"
  mkdir -p "$TARGET_DIR/.git"
  cat << 'INSTALL' > "$TARGET_DIR/install.sh"
#!/usr/bin/env bash
echo "install.sh called with args: $*" > "$(dirname "$0")/installed.txt"
INSTALL
  chmod +x "$TARGET_DIR/install.sh"
  exit 0
elif [[ "$1" == "-C" && "$3" == "pull" ]]; then
  TARGET_DIR="$2"
  if [[ -f "$TARGET_DIR/.diverged" ]]; then
    exit 1
  fi
  cat << 'INSTALL' > "$TARGET_DIR/install.sh"
#!/usr/bin/env bash
echo "install.sh called with args: $*" > "$(dirname "$0")/installed.txt"
INSTALL
  chmod +x "$TARGET_DIR/install.sh"
  exit 0
fi
exit 0
MOCK
# Substitute LOG_FILE in mock git
sed -i "s|\$LOG_FILE|$LOG_FILE|g" "$MOCK_BIN/git"
chmod +x "$MOCK_BIN/git"

# Test default run with mock tools
CUSTOM_DATA_HOME="$TMP_WORKSPACE/xdg_data"
mkdir -p "$CUSTOM_DATA_HOME"

PATH="$MOCK_BIN:$PATH" XDG_DATA_HOME="$CUSTOM_DATA_HOME" AGY_BRIDGE_DIR="" "$TARGET_SCRIPT" --with-auth --force >/dev/null 2>&1 || true

EXPECTED_DEFAULT_DIR="$CUSTOM_DATA_HOME/agy-bridge"
assert "Default dir resolved to XDG_DATA_HOME/agy-bridge" '[[ -d "$EXPECTED_DEFAULT_DIR" ]]'
assert "install.sh delegated with passthrough args" 'grep -q -- "--with-auth --force" "$EXPECTED_DEFAULT_DIR/installed.txt"'

# Test custom DIR and REF with relative / .. / spaces
CUSTOM_DIR="$TMP_WORKSPACE/nested/../custom dir with spaces"
PATH="$MOCK_BIN:$PATH" AGY_BRIDGE_DIR="$CUSTOM_DIR" AGY_BRIDGE_REF="v0.2.0" "$TARGET_SCRIPT" --force >/dev/null 2>&1 || true
assert "Custom dir with spaces handled and cloned" '[[ -d "$CUSTOM_DIR" ]]'
assert "Git clone called with custom branch ref" 'grep -q "branch v0.2.0" "$LOG_FILE"'

# Test idempotent git pull --ff-only
PATH="$MOCK_BIN:$PATH" AGY_BRIDGE_DIR="$CUSTOM_DIR" AGY_BRIDGE_REF="v0.2.0" "$TARGET_SCRIPT" >/dev/null 2>&1 || true
assert "Idempotent run uses git pull --ff-only" 'grep -q "pull --ff-only" "$LOG_FILE"'

# Test diverged git without --force fails
touch "$CUSTOM_DIR/.diverged"
if PATH="$MOCK_BIN:$PATH" AGY_BRIDGE_DIR="$CUSTOM_DIR" AGY_BRIDGE_REF="v0.2.0" "$TARGET_SCRIPT" >/dev/null 2>&1; then
  echo "  [✗] Diverged git pull without --force should fail" >&2
  FAILED=$((FAILED + 1))
else
  echo "  [✓] Diverged git pull without --force fails"
  PASSED=$((PASSED + 1))
fi

# Test diverged git with --force succeeds (re-clone)
if PATH="$MOCK_BIN:$PATH" AGY_BRIDGE_DIR="$CUSTOM_DIR" AGY_BRIDGE_REF="v0.2.0" "$TARGET_SCRIPT" --force >/dev/null 2>&1; then
  echo "  [✓] Diverged git with --force re-clones and delegates"
  PASSED=$((PASSED + 1))
else
  echo "  [✗] Diverged git with --force should succeed" >&2
  FAILED=$((FAILED + 1))
fi

# Clean up
rm -rf "$TMP_WORKSPACE"

# ------------------------------------------------------------------------------
# 4. Tarball Fallback when git fails / missing
# ------------------------------------------------------------------------------
echo "--- 4. Tarball Fallback ---"
TMP_WORKSPACE2="$(mktemp -d)"
MOCK_BIN2="$TMP_WORKSPACE2/mock_bin"
mkdir -p "$MOCK_BIN2"

cat << 'MOCK' > "$MOCK_BIN2/agy"
#!/usr/bin/env bash
exit 0
MOCK
chmod +x "$MOCK_BIN2/agy"

cat << 'MOCK' > "$MOCK_BIN2/deno"
#!/usr/bin/env bash
exit 0
MOCK
chmod +x "$MOCK_BIN2/deno"

# Mock git that always fails
cat << 'MOCK' > "$MOCK_BIN2/git"
#!/usr/bin/env bash
exit 1
MOCK
chmod +x "$MOCK_BIN2/git"

# Mock curl and tar to simulate tarball download and extraction
MOCK_ARCHIVE_DIR="$TMP_WORKSPACE2/archive_source"
mkdir -p "$MOCK_ARCHIVE_DIR/agy-bridge-main"
cat << 'INSTALL' > "$MOCK_ARCHIVE_DIR/agy-bridge-main/install.sh"
#!/usr/bin/env bash
echo "install.sh tarball called with args: $*" > "$(dirname "$0")/tarball_installed.txt"
INSTALL
chmod +x "$MOCK_ARCHIVE_DIR/agy-bridge-main/install.sh"

TARBALL_PATH="$TMP_WORKSPACE2/archive.tar.gz"
tar -czf "$TARBALL_PATH" -C "$MOCK_ARCHIVE_DIR" agy-bridge-main

cat << MOCK > "$MOCK_BIN2/curl"
#!/usr/bin/env bash
cat "$TARBALL_PATH"
MOCK
chmod +x "$MOCK_BIN2/curl"

TARBALL_TARGET="$TMP_WORKSPACE2/tarball_target"
PATH="$MOCK_BIN2:$PATH" AGY_BRIDGE_DIR="$TARBALL_TARGET" "$TARGET_SCRIPT" >/dev/null 2>&1 || true

assert "Tarball fallback creates target directory" '[[ -d "$TARBALL_TARGET" ]]'
assert "Tarball fallback extracts install.sh and runs it" '[[ -f "$TARBALL_TARGET/tarball_installed.txt" ]]'

rm -rf "$TMP_WORKSPACE2"

# ------------------------------------------------------------------------------
# Summary
# ------------------------------------------------------------------------------
echo "----------------------------------------"
echo "Test results: $PASSED passed, $FAILED failed"
if [[ $FAILED -gt 0 ]]; then
  exit 1
fi
exit 0
