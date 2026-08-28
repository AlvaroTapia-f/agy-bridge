#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# agy-bridge installer
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FORCE=false

usage() {
  cat << USAGE
Usage: $0 [OPTIONS]

Options:
  --force       Overwrite existing agent configurations in ~/.gemini/config/agents/
  -h, --help    Show this help message and exit
USAGE
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --force)
      FORCE=true
      shift
      ;;
    -h|--help)
      usage
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      ;;
  esac
done

echo "==> Installing agy-bridge..."

# 1. Detect Deno and Antigravity binaries
find_binary() {
  local name="$1"
  shift
  local candidates=("$@")
  local found=""

  if command -v "$name" >/dev/null 2>&1; then
    found="$(command -v "$name")"
  else
    for candidate in "${candidates[@]}"; do
      if [[ -x "$candidate" ]]; then
        found="$candidate"
        break
      fi
    done
  fi

  echo "$found"
}

DENO_BIN="$(find_binary deno "$HOME/.deno/bin/deno" "/usr/bin/deno" "/usr/local/bin/deno" "/usr/sbin/deno")"
if [[ -z "$DENO_BIN" ]]; then
  echo "Error: 'deno' binary not found in PATH or standard locations." >&2
  echo "Please install Deno: https://deno.land" >&2
  exit 1
fi
echo "  [✓] Deno binary detected: $DENO_BIN"

AGY_BIN="$(find_binary agy "$HOME/.local/bin/agy" "/usr/bin/agy" "/usr/local/bin/agy" "/usr/sbin/agy")"
if [[ -z "$AGY_BIN" ]]; then
  echo "Error: 'agy' binary not found in PATH or standard locations." >&2
  echo "Please ensure the Antigravity CLI is installed." >&2
  exit 1
fi
echo "  [✓] Antigravity binary detected: $AGY_BIN"

# 2. Setup environment configuration
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/agy-bridge"
ENV_FILE="$CONFIG_DIR/env"
mkdir -p "$CONFIG_DIR"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "  [+] Creating environment config at $ENV_FILE"
  # Generate random token if openssl / urandom available
  NEW_TOKEN=""
  if command -v openssl >/dev/null 2>&1; then
    NEW_TOKEN="$(openssl rand -hex 24)"
  elif [[ -r /dev/urandom ]] && command -v xxd >/dev/null 2>&1; then
    NEW_TOKEN="$(head -c 24 /dev/urandom | xxd -p)"
  else
    NEW_TOKEN="token_$(date +%s)_$RANDOM"
  fi

  cat << ENV_EOF > "$ENV_FILE"
# Required
AGY_TOKEN=${NEW_TOKEN}

# Binary paths
DENO_BIN=${DENO_BIN}
AGY_BIN=${AGY_BIN}

# Optional (defaults shown)
PORT=7421
MAX_CONCURRENT=1
PRINT_TIMEOUT=20m
AGY_TOOLS=on
AGY_TOOL_SCHEMA=full
AGY_REUSE=off
ENV_EOF
  chmod 600 "$ENV_FILE"
  echo "  [✓] Generated new AGY_TOKEN in $ENV_FILE"
else
  echo "  [i] Existing configuration found at $ENV_FILE (preserving)"
fi

# 3. Setup agent configurations
AGENTS_TARGET_DIR="$HOME/.gemini/config/agents"
mkdir -p "$AGENTS_TARGET_DIR"

for agent in raw worker-ro worker-rw; do
  AGENT_SRC="$SCRIPT_DIR/agents/$agent/agent.md"
  AGENT_DEST_DIR="$AGENTS_TARGET_DIR/$agent"
  AGENT_DEST="$AGENT_DEST_DIR/agent.md"

  if [[ ! -f "$AGENT_SRC" ]]; then
    echo "Warning: Agent source not found at $AGENT_SRC" >&2
    continue
  fi

  mkdir -p "$AGENT_DEST_DIR"
  if [[ -f "$AGENT_DEST" ]] && [[ "$FORCE" != true ]]; then
    echo "  [i] Agent '$agent' already exists at $AGENT_DEST (skipping, use --force to overwrite)"
  else
    cp "$AGENT_SRC" "$AGENT_DEST"
    echo "  [✓] Copied agent '$agent' -> $AGENT_DEST"
  fi
done

# 4. Render and register systemd user service
TEMPLATE_FILE="$SCRIPT_DIR/agy-bridge.service.template"
SYSTEMD_USER_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
SERVICE_FILE="$SYSTEMD_USER_DIR/agy-bridge.service"

if [[ -f "$TEMPLATE_FILE" ]]; then
  mkdir -p "$SYSTEMD_USER_DIR"
  sed \
    -e "s|\${DENO_BIN}|$DENO_BIN|g" \
    -e "s|\${AGY_BIN}|$AGY_BIN|g" \
    -e "s|\${INSTALL_DIR}|$SCRIPT_DIR|g" \
    "$TEMPLATE_FILE" > "$SERVICE_FILE"
  echo "  [✓] Rendered systemd service at $SERVICE_FILE"

  if command -v systemctl >/dev/null 2>&1; then
    echo "  [+] Reloading systemd user daemon and enabling agy-bridge..."
    systemctl --user daemon-reload
    systemctl --user enable --now agy-bridge.service || true
    echo "  [✓] agy-bridge service enabled and started"
  fi
else
  echo "Warning: Template $TEMPLATE_FILE not found, skipping service installation." >&2
fi

echo "==> Installation complete!"
echo "    Check health: curl http://127.0.0.1:7421/healthz"
