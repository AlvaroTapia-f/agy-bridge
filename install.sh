#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# agy-bridge installer (canonical)
# Note: install-remote.sh provides a remote curl bootstrap that fetches the repo
# and delegates execution to this script.
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FORCE=false
WITH_AUTH=false

usage() {
  cat << USAGE
Usage: $0 [OPTIONS]

Options:
  --force       Overwrite existing agent configurations in ~/.gemini/config/agents/
  --with-auth   Auto-configure agy-bridge auth in opencode auth.json from AGY_TOKEN
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
    --with-auth)
      WITH_AUTH=true
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

# 5. Configure opencode provider (global only)
OPENCODE_CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}/opencode/opencode.json"
PLUGIN_SRC="$SCRIPT_DIR/plugins/agy-bridge.ts"
PLUGIN_HELPERS_SRC="$SCRIPT_DIR/plugins/agy-bridge-helpers.ts"
PLUGIN_DEST="${XDG_CONFIG_HOME:-$HOME/.config}/opencode/plugins/agy-bridge.ts"
PLUGIN_HELPERS_DEST="${XDG_CONFIG_HOME:-$HOME/.config}/opencode/plugins/agy-bridge-helpers.ts"
if [[ -f "$PLUGIN_SRC" ]]; then
  mkdir -p "$(dirname "$PLUGIN_DEST")"
  if [[ ! -f "$PLUGIN_DEST" ]] || ! cmp -s "$PLUGIN_SRC" "$PLUGIN_DEST"; then
    cp "$PLUGIN_SRC" "$PLUGIN_DEST"
    echo "  [✓] Installed opencode plugin at $PLUGIN_DEST"
  else
    echo "  [i] opencode plugin already up to date at $PLUGIN_DEST"
  fi
else
  echo "  [i] Plugin source not found at $PLUGIN_SRC (skipping plugin install)"
fi

if [[ -f "$OPENCODE_CONFIG" ]]; then
  if command -v python3 >/dev/null 2>&1; then
    python3 << 'PYEOF'
import json, pathlib, sys, os
p = pathlib.Path.home() / ".config/opencode/opencode.json"
try:
    data = json.load(open(p))
except Exception as e:
    print(f"  [!] Could not parse {p}: {e}", file=sys.stderr)
    sys.exit(0)
changed = False
if "provider" not in data:
    data["provider"] = {}
    changed = True
if "agy-bridge" not in data["provider"]:
    data["provider"]["agy-bridge"] = {
        "npm": "@ai-sdk/openai-compatible",
        "name": "AGY Bridge",
        "options": {"baseURL": "http://127.0.0.1:7421/v1"}
    }
    changed = True
    print("  [✓] Added provider.agy-bridge to opencode.json")
else:
    opts = data["provider"]["agy-bridge"].get("options", {})
    if opts.get("baseURL") != "http://127.0.0.1:7421/v1":
        data["provider"]["agy-bridge"]["options"]["baseURL"] = "http://127.0.0.1:7421/v1"
        changed = True
        print("  [✓] Updated provider.agy-bridge baseURL to http://127.0.0.1:7421/v1")
    if data["provider"]["agy-bridge"].get("npm") != "@ai-sdk/openai-compatible":
        data["provider"]["agy-bridge"]["npm"] = "@ai-sdk/openai-compatible"
        changed = True

# Generate static models from FALLBACK if missing (grouped 7 bases -> 14 ids with variants)
try:
    fallback = [
      "gemini-3.7-flash-high","gemini-3.7-flash-medium","gemini-3.7-flash-low",
      "gemini-3.6-flash-high","gemini-3.6-flash-medium","gemini-3.6-flash-low",
      "gemini-3.5-flash-high","gemini-3.5-flash-medium","gemini-3.5-flash-low",
      "gemini-3.1-pro-high","gemini-3.1-pro-low",
      "claude-sonnet-4-6","claude-opus-4-6-thinking","gpt-oss-120b-medium",
    ]
    suffixes = ["high","medium","low","thinking"]
    def strip(s):
        for suf in suffixes:
            if s.endswith(f"-{suf}"):
                return s[:-len(f"-{suf}")], suf
        return s, None
    from collections import defaultdict
    grouped=defaultdict(set)
    for s in fallback:
        base, var = strip(s)
        if var:
            grouped[base].add(var)
        else:
            grouped.setdefault(base, set())
    models={}
    for base, vars in grouped.items():
        for profile in ["ro","rw"]:
            id_=f"auto-{profile}-{base}"
            vmap={v:{"reasoningEffort":v} for v in sorted(vars)}
            entry={"name": id_, "variants": vmap}
            if vars:
                entry["capabilities"]={"reasoning": True}
            models[id_]=entry
    existing = data["provider"]["agy-bridge"].get("models")
    def _is_stale(m):
        if not m or len(m) < 14:
            return True
        for _id, _ent in m.items():
            _vars = _ent.get("variants")
            if _vars is None:
                return True
            _caps = _ent.get("capabilities", {}).get("reasoning") if isinstance(_ent.get("capabilities"), dict) else None
            _has = len(_vars) > 0
            if _has and _caps is not True:
                return True
            if not _has and _caps is not None:
                return True
            for _k, _v in _vars.items():
                if not isinstance(_v, dict) or _v.get("reasoningEffort") != _k:
                    return True
        return False
    if _is_stale(existing):
        data["provider"]["agy-bridge"]["models"]=models
        changed = True
        print(f"  [✓] Generated {len(models)} static models with variants")
        if existing and len(existing) >= 14:
            print(f"  [✓] Healed stale models (missing capabilities/reasoningEffort)")
except Exception as e:
    print(f"  [!] model generation failed: {e}", file=sys.stderr)

plugin_path = f"{os.path.expanduser('~')}/.config/opencode/plugins/agy-bridge.ts"
if "plugin" not in data or not isinstance(data["plugin"], list):
    data["plugin"] = []
    changed = True
# Keep both file:// and plain variants compatible, prefer plain
plain = plugin_path
file_uri = f"file://{plugin_path}"
# normalize: keep plain, remove file:// duplicates
if plain not in data["plugin"] and file_uri not in data["plugin"]:
    data["plugin"].append(plain)
    changed = True
    print(f"  [✓] Added plugin ref {plain}")
else:
    # ensure plain is present, remove file_uri if needed
    if file_uri in data["plugin"] and plain not in data["plugin"]:
        data["plugin"].append(plain)
        changed = True

if changed:
    json.dump(data, open(p, 'w'), indent=2)
    print(f"  [✓] Updated {p}")
else:
    print(f"  [i] provider.agy-bridge already configured in {p}")
PYEOF
  else
    echo "  [i] python3 not found — skipping opencode provider setup"
  fi
  if [[ "$WITH_AUTH" != true ]]; then
    echo "  [i] Auth: run 'opencode' → /connect → Other → agy-bridge → paste AGY_TOKEN from $ENV_FILE (type: api, 600)"
    echo "      Alt (env): set options.apiKey to \"{env:AGY_TOKEN}\" and source env before opencode"
    echo "      Verify: curl -H \"Authorization: Bearer \$AGY_TOKEN\" http://127.0.0.1:7421/v1/models && opencode models | grep agy-bridge"
  fi
else
  echo "  [i] No opencode config at $OPENCODE_CONFIG — skipping provider setup"
  if [[ "$WITH_AUTH" != true ]]; then
    echo "  [i] Auth: run 'opencode' → /connect → Other → agy-bridge → paste AGY_TOKEN from $ENV_FILE (type: api, 600)"
  fi
fi

# 6. Configure auth (optional, --with-auth)
if [[ "$WITH_AUTH" == true ]]; then
  AUTH_FILE="${XDG_DATA_HOME:-$HOME/.local/share}/opencode/auth.json"
  echo "  [+] Configuring auth (--with-auth)..."
  if [[ ! -f "$ENV_FILE" ]]; then
    echo "  [!] ENV file not found at $ENV_FILE — cannot configure auth" >&2
  elif ! command -v python3 >/dev/null 2>&1; then
    echo "  [!] python3 not found — cannot configure auth.json (manual: copy AGY_TOKEN to $AUTH_FILE)" >&2
  else
    ENV_FILE="$ENV_FILE" AUTH_FILE="$AUTH_FILE" python3 << 'PYEOF'
import json
import os
import pathlib
import sys

env_file = pathlib.Path(os.environ["ENV_FILE"])
auth_file = pathlib.Path(os.environ["AUTH_FILE"])

# Read AGY_TOKEN from env file (handles AGY_TOKEN=..., export, quotes)
token = None
try:
    for raw in env_file.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export "):].strip()
        if "=" not in line:
            continue
        k, v = line.split("=", 1)
        if k.strip() == "AGY_TOKEN":
            v = v.strip().strip('"').strip("'").strip()
            if v:
                token = v
            break
except Exception as e:
    print(f"  [!] Failed to read {env_file}: {e}", file=sys.stderr)
    sys.exit(0)

if not token:
    print(f"  [!] AGY_TOKEN not found in {env_file}", file=sys.stderr)
    sys.exit(0)

# Load existing auth.json or start empty
data = {}
if auth_file.exists():
    try:
        text = auth_file.read_text()
        if text.strip() == "":
            data = {}
        else:
            data = json.loads(text)
            if not isinstance(data, dict):
                print(f"  [!] {auth_file} is not a JSON object — resetting", file=sys.stderr)
                data = {}
    except Exception as e:
        print(f"  [!] Could not parse {auth_file}: {e} — backing up and recreating", file=sys.stderr)
        try:
            backup = auth_file.with_suffix(".bak")
            # avoid overwriting existing backup
            if not backup.exists():
                auth_file.rename(backup)
                print(f"  [i] Backed up corrupted file to {backup}", file=sys.stderr)
        except Exception:
            pass
        data = {}
else:
    try:
        auth_file.parent.mkdir(parents=True, exist_ok=True)
    except Exception as e:
        print(f"  [!] Cannot create {auth_file.parent}: {e}", file=sys.stderr)
        sys.exit(0)

# Idempotency: if already correct, ensure perms and exit
existing = data.get("agy-bridge")
if isinstance(existing, dict) and existing.get("type") == "api" and existing.get("key") == token:
    try:
        auth_file.chmod(0o600)
    except Exception:
        pass
    print(f"  [i] auth.json already configured for agy-bridge (unchanged, preserved {len(data)-1} other entries)")
    sys.exit(0)

# Upsert agy-bridge entry, preserve other keys
other_count = len([k for k in data.keys() if k != "agy-bridge"])
data["agy-bridge"] = {"type": "api", "key": token}

# Atomic write with 600 perms
try:
    tmp = auth_file.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2) + "\n")
    tmp.chmod(0o600)
    tmp.replace(auth_file)
    try:
        auth_file.chmod(0o600)
    except Exception:
        pass
    print(f"  [✓] Configured agy-bridge auth in {auth_file} (preserved {other_count} other entries, 600)")
except Exception as e:
    print(f"  [!] Failed to write {auth_file}: {e}", file=sys.stderr)
    sys.exit(0)
PYEOF
    # If python succeeded, show verify hint
    if [[ -f "$AUTH_FILE" ]]; then
      echo "  [i] Auth auto-configured — verify: opencode models | grep agy-bridge"
    fi
  fi
fi

# 7. Patch gentle-ai TUI for agy-bridge effort (workaround for SDK overwriting capabilities.reasoning)
# The @ai-sdk/openai-compatible provider enriches models and sets capabilities.reasoning=false
# for agy-bridge, even though we set it true. The gentle-ai TUI gates on that flag.
# This idempotent patch makes listReasoningEffortsFromModel accept variants.*.reasoningEffort
# even when capabilities.reasoning is false, so /sdd-model effort works on fresh installs.
TUI_JS="$HOME/.cache/opencode/packages/opencode-sdd-engram-manage@latest/node_modules/opencode-sdd-engram-manage/dist/tui.js"
if [[ -f "$TUI_JS" ]]; then
  if grep -q "hasReasoningEffort" "$TUI_JS" 2>/dev/null; then
    echo "  [i] gentle-ai TUI already patched for agy-bridge effort"
  else
    if command -v python3 >/dev/null 2>&1; then
      TUI_JS="$TUI_JS" python3 << 'PYEOF'
import pathlib
p = pathlib.Path(__import__("os").environ["TUI_JS"])
try:
    text = p.read_text()
    old = "function listReasoningEffortsFromModel(modelDef) {\n  if (!modelDef || modelDef?.capabilities?.reasoning !== true) return [];"
    new = "function listReasoningEffortsFromModel(modelDef) {\n  if (!modelDef) return [];\n  const hasReasoningEffort = modelDef?.variants && typeof modelDef.variants === 'object' && Object.values(modelDef.variants).some(v => typeof v?.reasoningEffort === 'string' && v.reasoningEffort.trim());\n  if (modelDef?.capabilities?.reasoning !== true && !hasReasoningEffort) return [];"
    if old in text:
        text = text.replace(old, new)
        p.write_text(text)
        print("  [✓] Patched gentle-ai TUI for agy-bridge effort (listReasoningEffortsFromModel)")
    else:
        print("  [i] gentle-ai TUI patch not applied (pattern not found, may be already updated upstream)")
except Exception as e:
    print(f"  [!] TUI patch failed: {e}")
PYEOF
    else
      echo "  [i] python3 not found — skipping gentle-ai TUI patch (manual: see docs)"
    fi
  fi
else
  echo "  [i] gentle-ai TUI not found at $TUI_JS (will be patched on first opencode run)"
fi

echo "==> Installation complete!"
echo "    Check health: curl http://127.0.0.1:7421/healthz"
echo "    Verify provider: curl -H \"Authorization: Bearer \$(grep AGY_TOKEN $ENV_FILE | cut -d= -f2)\" http://127.0.0.1:7421/v1/models | head"
echo "    Then: opencode models (should list agy-bridge/auto-ro-* and agy-bridge/auto-rw-*)"
