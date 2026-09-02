#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# agy-bridge remote installer bootstrap
# ==============================================================================

REPO_URL="https://github.com/AlvaroTapia-f/agy-bridge.git"
TARBALL_URL_BASE="https://github.com/AlvaroTapia-f/agy-bridge/archive"

# 1. Prerequisite fail-fast checks (no auto-install)
if ! command -v agy >/dev/null 2>&1 && [[ ! -x "$HOME/.local/bin/agy" && ! -x "/usr/local/bin/agy" && ! -x "/usr/bin/agy" ]]; then
  echo "Error: 'agy' CLI not found in PATH or standard locations." >&2
  echo "Please ensure the Antigravity CLI is installed and authenticated." >&2
  exit 1
fi

if ! command -v deno >/dev/null 2>&1 && [[ ! -x "$HOME/.deno/bin/deno" && ! -x "/usr/local/bin/deno" && ! -x "/usr/bin/deno" ]]; then
  echo "Error: 'deno' binary not found in PATH or standard locations." >&2
  echo "Please install Deno: https://deno.land" >&2
  exit 1
fi

# 2. Target directory and ref resolution (XDG-compliant)
AGY_BRIDGE_DIR="${AGY_BRIDGE_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/agy-bridge}"
AGY_BRIDGE_REF="${AGY_BRIDGE_REF:-main}"

mkdir -p "$AGY_BRIDGE_DIR"
AGY_BRIDGE_DIR="$(cd "$AGY_BRIDGE_DIR" && pwd)"

FORCE=false
for arg in "$@"; do
  if [[ "$arg" == "--force" ]]; then
    FORCE=true
    break
  fi
done

# 3. Fetch or update repo
fetch_tarball() {
  echo "==> Fetching source tarball for ref '${AGY_BRIDGE_REF}'..."
  curl -fsSL "${TARBALL_URL_BASE}/${AGY_BRIDGE_REF}.tar.gz" | tar xz --strip-components=1 -C "$AGY_BRIDGE_DIR"
}

fetch_repo() {
  if command -v git >/dev/null 2>&1; then
    echo "==> Cloning agy-bridge (${AGY_BRIDGE_REF}) into $AGY_BRIDGE_DIR..."
    if ! GIT_TERMINAL_PROMPT=0 git clone --depth 1 --branch "$AGY_BRIDGE_REF" "$REPO_URL" "$AGY_BRIDGE_DIR" 2>/dev/null; then
      echo "  [i] git clone failed, falling back to source tarball..."
      fetch_tarball
    fi
  else
    fetch_tarball
  fi
}

if [[ -d "$AGY_BRIDGE_DIR/.git" ]]; then
  echo "==> Existing repository found at $AGY_BRIDGE_DIR"
  if command -v git >/dev/null 2>&1; then
    if ! GIT_TERMINAL_PROMPT=0 git -C "$AGY_BRIDGE_DIR" pull --ff-only 2>/dev/null; then
      if [[ "$FORCE" == true ]]; then
        echo "  [i] Fast-forward update failed. Re-cloning due to --force..."
        find "$AGY_BRIDGE_DIR" -mindepth 1 -delete 2>/dev/null || rm -rf "${AGY_BRIDGE_DIR:?}"/*
        fetch_repo
      else
        echo "Error: Repository at $AGY_BRIDGE_DIR has diverged or cannot fast-forward." >&2
        echo "Use --force to re-clone, or resolve changes manually." >&2
        exit 1
      fi
    fi
  else
    if [[ "$FORCE" == true ]]; then
      fetch_tarball
    fi
  fi
elif [[ -f "$AGY_BRIDGE_DIR/install.sh" ]]; then
  if [[ "$FORCE" == true ]]; then
    fetch_tarball
  fi
else
  fetch_repo
fi

# 4. Delegate to canonical install.sh
INSTALL_SCRIPT="$AGY_BRIDGE_DIR/install.sh"
if [[ ! -f "$INSTALL_SCRIPT" ]]; then
  echo "Error: $INSTALL_SCRIPT not found after fetch." >&2
  exit 1
fi

chmod +x "$INSTALL_SCRIPT"
echo "==> Executing canonical install.sh..."
exec bash "$INSTALL_SCRIPT" "$@"
