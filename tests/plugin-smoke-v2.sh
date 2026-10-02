#!/usr/bin/env bash
set -euo pipefail

# tests/plugin-smoke-v2.sh
# Live OpenCode V2 plugin smoke harness.
#
# Same contract as tests/plugin-smoke.sh (temporary sandbox, real binary, never
# touches ~/.config/opencode) but for the V2 runtime and the V2 plugin bundle.
#
# Why the sandbox is shaped the way it is — all four points below were measured
# against opencode v2.0.20, not read off the docs:
#
#   1. The V2 server resolves `@opencode/plugin` from the *config* directory
#      upward. Without a node_modules there the plugin dies with
#      "Cannot find package '@opencode/plugin'" and the sandbox looks empty.
#   2. Service mode (`opencode models`) talks to the pre-existing background
#      service, which loaded its plugins at boot — a fresh sandbox project is
#      never picked up. The harness therefore boots its own private server with
#      `opencode serve --port N` and drives it with `--server`.
#   3. `XDG_CONFIG_HOME` / `XDG_DATA_HOME` / `XDG_STATE_HOME` fully relocate the
#      config, credential and state trees, so the real opencode.json and the real
#      credential store are never read or written.
#   4. V2 lists a provider's models only once that provider has a connection, so
#      the harness creates a throwaway credential in its isolated store first.
#
# Usage: tests/plugin-smoke-v2.sh [candidate-bundle]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CANDIDATE_PLUGIN="${1:-$SCRIPT_DIR/plugins/agy-bridge.v2.bundle.ts}"
CURRENT_PLUGIN="$SCRIPT_DIR/plugins/agy-bridge.v2.bundle.ts"

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

if [[ ! -f "$CANDIDATE_PLUGIN" ]]; then
  echo "Error: candidate bundle not found: $CANDIDATE_PLUGIN" >&2
  exit 1
fi

REAL_CONFIG="$HOME/.config/opencode/opencode.json"
REAL_CONFIG_SUM="absent"
if [[ -f "$REAL_CONFIG" ]]; then
  REAL_CONFIG_SUM="$(md5sum "$REAL_CONFIG" | cut -d' ' -f1)"
fi

SB="$(mktemp -d /tmp/opencode-smoke-v2.XXXXXX)"
SERVER_PID=""

cleanup() {
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill -9 "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  # Keep the sandbox when KEEP_SANDBOX=1 so a failing run can be inspected.
  if [[ "${KEEP_SANDBOX:-0}" == "1" ]]; then
    echo "==> KEEP_SANDBOX=1: sandbox preserved at $SB" >&2
  else
    rm -rf "$SB"
  fi
}
trap cleanup EXIT

echo "==> Live V2 plugin smoke gate using $OPENCODE_BIN"
echo "==> sandbox: $SB"
echo "==> real opencode.json md5 before: $REAL_CONFIG_SUM"

# The V2 runtime needs a resolvable @opencode/plugin. Reuse the one the real
# installation already has; the symlink is read-only usage and lives in $SB.
REAL_NODE_MODULES="$HOME/.config/opencode/node_modules"
if [[ ! -d "$REAL_NODE_MODULES/@opencode/plugin" ]]; then
  echo "FAIL: $REAL_NODE_MODULES/@opencode/plugin not found." >&2
  echo "      The V2 sandbox needs a node_modules with @opencode/plugin to load" >&2
  echo "      any plugin; without it every plugin fails with" >&2
  echo "      \"Cannot find package '@opencode/plugin'\"." >&2
  exit 1
fi

# Assert helpers ---------------------------------------------------------------

FAILURES=0
CHECKS=0

fail() {
  CHECKS=$((CHECKS + 1))
  FAILURES=$((FAILURES + 1))
  echo "FAIL: $*" >&2
}

pass() {
  CHECKS=$((CHECKS + 1))
  echo "PASS: $*"
}

check() {
  if eval "$2"; then
    pass "$1"
  else
    fail "$1"
  fi
}

# Boot a private opencode server against the isolated sandbox --------------------
# $1 label, $2 plugin filename to install, $3 baseURL for providers.agy-bridge.
boot_server() {
  local label="$1" plugin_name="$2" base_url="$3"
  local port password

  # Per-case root. Everything below is scoped to it, including the config path
  # itself. Reusing one path across cases makes later cases collide with the
  # shared ~/.cache (plugin discovery and package resolution are cached by
  # path), and a case that silently sees zero plugins is miserable to debug.
  CASE_ROOT="$SB/$label"
  rm -rf "$CASE_ROOT"
  mkdir -p "$CASE_ROOT/xc/opencode/plugins" "$CASE_ROOT/xd/opencode" \
           "$CASE_ROOT/xs/opencode" "$CASE_ROOT/proj" "$CASE_ROOT/tmp"
  ln -sfn "$REAL_NODE_MODULES" "$CASE_ROOT/xc/opencode/node_modules"
  cp "$CANDIDATE_PLUGIN" "$CASE_ROOT/xc/opencode/plugins/$plugin_name"

  # Native V2 provider shape: providers.<id> with package + settings.baseURL and
  # deliberately NO models — in V2 the plugin owns the catalog.
  cat << JSON > "$CASE_ROOT/xc/opencode/opencode.json"
{
  "providers": {
    "agy-bridge": {
      "package": "@opencode/ai/providers/openai-compatible",
      "settings": { "baseURL": "$base_url" }
    }
  }
}
JSON

  port="$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')"

  # Password: set it explicitly instead of scraping it out of stdout.
  # `opencode serve` only prints "server password <pw>" when it had to invent
  # one; when an incumbent background service is reachable it silently reuses
  # that service's password and prints nothing. On a machine with the
  # background service running (the normal case) that makes log-scraping a
  # coin flip. OPENCODE_SERVER_PASSWORD removes the race entirely.
  # Each server must be read AFTER it is started, and the readiness probe must
  # actually verify the credential — not just that the port answers. A previous
  # revision kept one global PASSWORD and a readiness loop that accepted any
  # HTTP response, so from case 2 onward every /api/plugin call used case 1's
  # stale password, got 401, and the plugin looked "not-discovered". The case
  # looked like a product bug and was not one. Both mistakes are guarded now.
  password="$(python3 -c 'import secrets;print(secrets.token_urlsafe(32))')"

  # `exec` matters: without it $! is the subshell, killing it orphans the
  # opencode server, which then keeps holding runtime state and makes every
  # later case in this script misbehave.
  #
  # TMPDIR is per-case on purpose. The runtime roots its temp dir at
  # os.tmpdir()/opencode (see /api/info "paths.tmp"), which is shared by every
  # opencode process on the machine — including the user's own service and any
  # concurrent session. Leaving it alone makes the second case in this script
  # collide with the first.
  (
    cd "$CASE_ROOT/proj"
    exec env XDG_CONFIG_HOME="$CASE_ROOT/xc" XDG_DATA_HOME="$CASE_ROOT/xd" XDG_STATE_HOME="$CASE_ROOT/xs" \
      TMPDIR="$CASE_ROOT/tmp" OPENCODE_SERVER_PASSWORD="$password" \
      "$OPENCODE_BIN" serve --port "$port"
  ) > "$SB/serve-$label.log" 2>&1 &
  SERVER_PID=$!

  PORT="$port"
  PASSWORD="$password"
  SERVER_URL="http://127.0.0.1:$port"

  # OPENCODE_PASSWORD must NOT be exported here. `opencode serve` prefers it
  # over OPENCODE_SERVER_PASSWORD (verified: with OPENCODE_PASSWORD=stale and
  # OPENCODE_SERVER_PASSWORD=good, the good password gets 401 and the stale one
  # gets 200). Exporting it made every later case's server adopt case 1's
  # credential, so its own password was rejected and the plugin read as
  # "not-discovered". Each server gets its password from its own
  # OPENCODE_SERVER_PASSWORD; the client authenticates with curl's -u below.
  unset OPENCODE_PASSWORD

  # Readiness = an AUTHENTICATED request returns 200. `curl` exits 0 on a 401,
  # so testing exit status alone accepts an unauthorized server as ready and
  # turns every later assertion into a mystery. Require the status code.
  local ready="" code=""
  for _ in $(seq 1 120); do
    code="$(curl -s -m 5 -o /dev/null -w '%{http_code}' \
      -u "opencode:$password" "$SERVER_URL/api/info" 2>/dev/null || echo 000)"
    if [[ "$code" == "200" ]]; then
      ready=1
      break
    fi
    if [[ "$code" == "401" ]]; then
      echo "FAIL: $label server answered 401 for the password we set" >&2
      echo "  another opencode service is probably intercepting this port" >&2
      sed 's/^/  /' "$SB/serve-$label.log" 2>/dev/null | head -10 >&2
      stop_server
      return 1
    fi
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
      echo "FAIL: $label server exited before becoming ready" >&2
      sed 's/^/  /' "$SB/serve-$label.log" 2>/dev/null | head -10 >&2
      stop_server
      return 1
    fi
    sleep 1
  done

  if [[ -z "$ready" ]]; then
    echo "FAIL: $label server never became ready on $SERVER_URL (last status: ${code:-none})" >&2
    echo "  alive: $(kill -0 "$SERVER_PID" 2>/dev/null && echo yes || echo no) (pid $SERVER_PID)" >&2
    echo "  server stdout:" >&2
    sed 's/^/    /' "$SB/serve-$label.log" 2>/dev/null | head -10 >&2
    stop_server
    return 1
  fi

  # Plugin reconciliation is async: the server answers /api/plugin before it has
  # finished loading plugins from the config directory. Poll until our plugin
  # reaches a terminal state instead of guessing a sleep.
  #
  # `unauthorized` is a harness failure, not a product one: stop immediately
  # instead of polling for 2 minutes on a request that can never authenticate.
  if ! wait_for_plugin_settled; then
    echo "FAIL: $label: plugin never reached a terminal state (last seen: $PLUGIN_STATUS)" >&2
    if [[ "$PLUGIN_STATUS" == "unauthorized" || "$PLUGIN_STATUS" == "api-error" ]]; then
      echo "  this is a harness/auth failure, not a plugin failure" >&2
    else
      diagnose_plugin_failure "$label"
    fi
    stop_server
    return 1
  fi
  return 0
}

# Poll /api/plugin until the agy-bridge plugin is discovered and has settled on
# "active" or "failed". Echoes the final status. Measured: on opencode v2.0.20 a
# cold sandbox needs roughly 25s before the plugin leaves the pending state.
wait_for_plugin_settled() {
  local status="pending" i
  for i in $(seq 1 60); do
    status="$(plugin_status)"
    if [[ "$status" == "active" || "$status" == "failed" ]]; then
      PLUGIN_STATUS="$status"
      return 0
    fi
    # Auth/transport failures cannot resolve by waiting.
    if [[ "$status" == "unauthorized" || "$status" == "api-error" ]]; then
      PLUGIN_STATUS="$status"
      return 1
    fi
    if [[ -n "$SERVER_PID" ]] && ! kill -0 "$SERVER_PID" 2>/dev/null; then
      PLUGIN_STATUS="$status"
      return 1
    fi
    sleep 2
  done
  PLUGIN_STATUS="$status"
  return 1
}

plugin_status() {
  local raw
  raw="$(api plugin 2>/dev/null)" || raw=""
  if [[ -z "$raw" ]]; then
    echo "api-error"
    return
  fi
  # An unauthorized body is the single most confusing failure here: it parses as
  # valid JSON with no `data`, which reads as "not-discovered" and sends you
  # hunting a product bug that does not exist. Surface it as its own state.
  if printf '%s' "$raw" | grep -qiE '"(unauthor|error|401)"'; then
    echo "unauthorized"
    return
  fi
  printf '%s' "$raw" | python3 -c '
import json, sys
try:
    data = json.load(sys.stdin).get("data") or []
except Exception:
    print("bad-json"); raise SystemExit(0)
for p in data:
    if "agy-bridge" in (p.get("source", {}).get("path") or ""):
        print(p["state"].get("status")); break
else:
    print("not-discovered")
' 2>/dev/null || echo "unknown"
}

stop_server() {
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    for _ in $(seq 1 20); do
      kill -0 "$SERVER_PID" 2>/dev/null || break
      sleep 0.5
    done
    kill -9 "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  SERVER_PID=""
}

api() {
  # api <path-without-location> [curl args...]
  local path="$1"; shift
  local loc
  loc="$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))' "location[directory]=$CASE_ROOT/proj")"
  curl -s -m 30 -u "opencode:$PASSWORD" "$@" "$SERVER_URL/api/$path?$loc"
}

# Report why a plugin failed to load, straight from the runtime log --------------
# The raw cause embeds the whole effect-Schema AST of Integration.Info.methods
# (tens of KB), so everything here is truncated and the useful part — which
# field path failed — is extracted explicitly.
diagnose_plugin_failure() {
  local label="$1"
  echo "" >&2
  echo "--- diagnostic: why did the plugin not become active? ---" >&2

  api plugin 2>/dev/null | python3 -c '
import json, re, sys
try:
    data = json.load(sys.stdin).get("data") or []
except Exception:
    print("  (could not parse /api/plugin response)")
    raise SystemExit(0)
for p in data:
    if p.get("source", {}).get("type") == "builtin":
        continue
    st = p["state"]
    name = p.get("source", {}).get("path", "?").split("/")[-1]
    err = st.get("error") or ""
    print("  plugin: %s" % name)
    print("  status: %s%s" % (st.get("status"), (" ref=%s" % st["ref"]) if st.get("ref") else ""))
    if err:
        # Keep the head of the message and the schema-issue path, drop the AST.
        head = err.split("cause:")[0].strip()[:160]
        print("  error:  %s" % head)
        paths = re.findall(r"\"path\":\[([^\]]*)\]", err)
        if paths:
            print("  failed schema field path(s): %s" % ", ".join(dict.fromkeys(paths)))
        if "Cannot find package" in err:
            print("  hint:   the sandbox config dir needs a node_modules with @opencode/plugin")
        if "Schema validation failed" in err:
            print("  hint:   setup() threw; the plugin never finished registering, so the")
            print("          provider and every model are missing. The rejected field is")
            print("          listed above as the failed schema field path(s).")
' >&2

  echo "--- runtime log (truncated) ---" >&2
  local runtime_log
  # Plugin load failures are WARNed into the opencode log, not to server stdout.
  # With the sandbox XDG trees that log lives inside the sandbox, so the real
  # ~/.local/share one is never read.
  runtime_log="$(ls -1 "$CASE_ROOT"/xd/opencode/log/*.log 2>/dev/null | tail -1 || true)"
  if [[ -n "$runtime_log" ]]; then
    echo "  opencode log: $runtime_log" >&2
    grep -aoE 'message="failed to (load|reload) plugin[s]?"[^\\]{0,220}' "$runtime_log" 2>/dev/null \
      | sed 's/^/  /' >&2 || true
    grep -aoE 'message="failed to reload plugins".{0,160}' "$runtime_log" 2>/dev/null \
      | sed 's/^/  /' >&2 || true
  else
    echo "  (no opencode log under $CASE_ROOT/xd/opencode/log)" >&2
  fi
  echo "--- server stdout ---" >&2
  grep -avE 'server (listening|password)' "$SB/serve-$label.log" 2>/dev/null \
    | cut -c1-160 | head -20 | sed 's/^/  /' >&2 || true
  echo "------------------------------------------------------" >&2
}

# The V2 auth flow: POST /api/integration/<id>/connect/key {key,label}.
# This is the V2 replacement for the V1 "/connect Other" + type:api form.
connect_throwaway_credential() {
  local code
  code="$(curl -s -m 30 -u "opencode:$PASSWORD" -o /dev/null -w '%{http_code}' \
    -X POST "$SERVER_URL/api/integration/agy-bridge/connect/key?location%5Bdirectory%5D=$CASE_ROOT/proj" \
    -H 'content-type: application/json' \
    -d '{"key":"agy-bridge-smoke-throwaway","label":"plugin-smoke-v2"}')"
  if [[ "$code" != "204" ]]; then
    fail "connect/key returned HTTP $code (expected 204)"
    return 1
  fi
  pass "connect/key accepted a throwaway credential (HTTP 204)"
  return 0
}

# ==============================================================================
# Case 1 — bridge reachable at 127.0.0.1:7421, sandboxed credential connected
# ==============================================================================
run_case_bridge() {
  local label="bridge"
  echo ""
  echo "--- Case 1: bridge at 127.0.0.1:7421, native V2 config ---"

  if ! boot_server "$label" "agy-bridge.v2.bundle.ts" "http://127.0.0.1:7421/v1"; then
    return 1
  fi

  # A0 — the plugin must load. Everything else is meaningless if it does not.
  local status="$PLUGIN_STATUS"
  if [[ "$status" != "active" ]]; then
    fail "plugin did not become active (status: $status)"
    diagnose_plugin_failure "$label"
    stop_server
    return 1
  fi
  pass "plugin loaded and is active"

  # A1 — the provider transform registered the provider under the plugin's name.
  local prov
  prov="$(api "provider/agy-bridge" 2>/dev/null || true)"
  check "provider agy-bridge is served by the plugin" \
    'echo "$prov" | grep -q "\"id\":\"agy-bridge\""'
  check "provider carries the plugin package @opencode/ai/providers/openai-compatible" \
    'echo "$prov" | grep -q "@opencode/ai/providers/openai-compatible"'
  check "provider carries the bridge baseURL" \
    'echo "$prov" | grep -q "127.0.0.1:7421"'

  # A2 — the auth transform replaced the default key method.
  local methods
  methods="$(api integration | python3 -c '
import json, sys
data = json.load(sys.stdin)["data"]
for i in data:
    if i["id"] == "agy-bridge":
        print(json.dumps(i["methods"])); break
else:
    print("[]")
')"
  echo "    integration methods: $methods"
  check "auth method registered with the V2 shape (type \"key\")" \
    'echo "$methods" | grep -q "\"type\": \"key\""'
  check "auth method is not the V1 pseudo-type \"api-key\"" \
    '! echo "$methods" | grep -q "api-key"'

  # A3 — V2 hides a provider's models until it has a connection.
  connect_throwaway_credential || true
  sleep 3

  # A4 — the catalog. `opencode models` is a CLI wrapper that can die on a
  # non-2xx from a *single* provider and print nothing at all, so the HTTP
  # endpoint is queried directly and the CLI output is kept only as extra
  # evidence. A 500 here means the runtime rejected something in the catalog;
  # the server log carries the cause, so surface it instead of just the count.
  api model > "$SB/modelapi-$label.json" 2>/dev/null || true
  ( cd "$CASE_ROOT/proj" && "$OPENCODE_BIN" models --server "$SERVER_URL" ) > "$SB/models-$label.txt" 2>&1 || true

  if grep -q '"status":500\|UnexpectedStatus: 500\|"error"' "$SB/modelapi-$label.json" 2>/dev/null; then
    fail "GET /api/model returned an error: $(head -c 300 "$SB/modelapi-$label.json")"
    echo "  server log tail:" >&2
    grep -aiE "error|invalid|fail" "$CASE_ROOT"/xd/opencode/log/*.log 2>/dev/null \
      | tail -8 | cut -c1-240 | sed 's/^/    /' >&2 || true
  fi

  local count
  count="$(python3 -c '
import json, sys
try:
    data = json.load(open(sys.argv[1])).get("data") or []
except Exception:
    print(0); raise SystemExit(0)
print(sum(1 for m in data if m.get("providerID") == "agy-bridge"))
' "$SB/modelapi-$label.json" 2>/dev/null || echo 0)"
  if [[ "$count" -lt 14 ]]; then
    fail "expected at least 14 agy-bridge models in /api/model, found $count"
    echo "  'opencode models' output:" >&2
    sed -n '1,25p' "$SB/models-$label.txt" | sed 's/^/    /' >&2
  else
    pass "$count agy-bridge models listed by /api/model"
  fi

  for m in auto-ro-gemini-3.7-flash auto-rw-gemini-3.8-flash auto-ro-claude-opus-4-6; do
    check "model agy-bridge/$m is in the catalog" \
      "grep -q '\"$m\"' '$SB/modelapi-$label.json'"
  done

  # A5 — THE assert that matters: in V1 the effort variants were silently lost.
  #      V2 must expose them, and they must survive the runtime unchanged.
  python3 "$SCRIPT_DIR/tests/assert-v2-variants.py" "$SB/modelapi-$label.json"
  if [[ $? -ne 0 ]]; then
    fail "variant/effort assertions failed (see above)"
  else
    pass "effort variants are visible and preserved through the V2 runtime"
  fi

  stop_server
  return 0
}

# ==============================================================================
# Case 2 — bridge down. The plugin must fall back to FALLBACK_MODELS.
# ==============================================================================
run_case_bridge_down() {
  local label="bridgedown"
  local dead_port
  echo ""
  echo "--- Case 2: bridge unreachable (fallback catalog) ---"

  dead_port="$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')"

  if ! boot_server "$label" "agy-bridge.v2.bundle.ts" "http://127.0.0.1:$dead_port/v1"; then
    return 1
  fi

  check "plugin stays active with the bridge down" '[[ "$PLUGIN_STATUS" == "active" ]]'

  connect_throwaway_credential || true
  sleep 3

  api model > "$SB/modelapi-$label.json" 2>/dev/null || true
  local count
  count="$(python3 -c '
import json, sys
try:
    data = json.load(open(sys.argv[1])).get("data") or []
except Exception:
    print(0); raise SystemExit(0)
print(sum(1 for m in data if m.get("providerID") == "agy-bridge"))
' "$SB/modelapi-$label.json" 2>/dev/null || echo 0)"
  if [[ "$count" -lt 14 ]]; then
    fail "bridge down: expected the fallback catalog (>=14 models), found $count"
    echo "  /api/model body: $(head -c 300 "$SB/modelapi-$label.json")" >&2
  else
    pass "bridge down: fallback catalog still lists $count agy-bridge models"
  fi

  # A bridge that is down must not make the plugin disappear.
  check "no plugin load error logged with the bridge down" \
    '! grep -aq "failed to load plugin" "$SB/serve-$label.log"'

  stop_server
  return 0
}

# ==============================================================================
# Case 3 — informational: a leftover V1 config shape is silently ignored.
#
# The plugin must be ABSENT here. The question is whether the V1 `provider`
# block alone registers anything, and a loaded V2 plugin would register the
# same `agy-bridge` id, making the two indistinguishable. Installing the bundle
# under a name the runtime will not load is a broken-plugin test, so the plugin
# directory is simply left empty.
# ==============================================================================
run_case_v1_leftover() {
  local label="v1leftover"
  echo ""
  echo "--- Case 3 (informational): leftover V1 config shape, no plugin ---"

  rm -rf "$CASE_ROOT"
  mkdir -p "$CASE_ROOT/xc/opencode/plugins" "$CASE_ROOT/xd/opencode" \
           "$CASE_ROOT/xs/opencode" "$CASE_ROOT/proj" "$CASE_ROOT/tmp"
  ln -sfn "$REAL_NODE_MODULES" "$CASE_ROOT/xc/opencode/node_modules"

  # Overwrite the config with the V1 shape the old installer wrote.
  cat << JSON > "$CASE_ROOT/xc/opencode/opencode.json"
{
  "provider": {
    "agy-bridge": {
      "npm": "@ai-sdk/openai-compatible",
      "options": { "baseURL": "http://127.0.0.1:7421/v1" },
      "models": { "auto-ro-claude-opus-4-6": { "name": "stale" } }
    }
  }
}
JSON

  echo "    booting a fresh server: V1-shaped config, no plugin installed"

  local restart_password port
  restart_password="$(python3 -c 'import secrets;print(secrets.token_urlsafe(32))')"
  port="$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')"
  PASSWORD="$restart_password"
  PORT="$port"
  SERVER_URL="http://127.0.0.1:$port"
  (
    cd "$CASE_ROOT/proj"
    exec env XDG_CONFIG_HOME="$CASE_ROOT/xc" XDG_DATA_HOME="$CASE_ROOT/xd" XDG_STATE_HOME="$CASE_ROOT/xs" \
      TMPDIR="$CASE_ROOT/tmp" OPENCODE_SERVER_PASSWORD="$restart_password" \
      "$OPENCODE_BIN" serve --port "$PORT"
  ) > "$SB/serve-$label-restart.log" 2>&1 &
  SERVER_PID=$!
  PASSWORD="$restart_password"
  local ready="" rcode=""
  for _ in $(seq 1 120); do
    rcode="$(curl -s -m 5 -o /dev/null -w '%{http_code}' \
      -u "opencode:$restart_password" "$SERVER_URL/api/info" 2>/dev/null || echo 000)"
    if [[ "$rcode" == "200" ]]; then
      ready=1
      break
    fi
    if [[ "$rcode" == "401" ]]; then
      echo "FAIL: $label restart answered 401 for the password we set" >&2
      break
    fi
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then break; fi
    sleep 1
  done
  if [[ -z "$ready" ]]; then
    echo "FAIL: $label: server did not come back up" >&2
    sed 's/^/  /' "$SB/serve-$label-restart.log" 2>/dev/null | head -10 >&2
    stop_server
    return 1
  fi
  # No plugin is installed in this case, so nothing should have registered the
  # provider: /api/provider must report it missing (or omit it) and /api/model
  # must contain zero agy-bridge entries even though the config still carries a
  # populated V1 `models` map.
  local prov mcount
  prov="$(api "provider/agy-bridge" 2>/dev/null || true)"
  api model > "$SB/modelapi-$label.json" 2>/dev/null || true
  mcount="$(python3 -c '
import json, sys
try:
    data = json.load(open(sys.argv[1])).get("data") or []
except Exception:
    print(-1); raise SystemExit(0)
print(sum(1 for m in data if m.get("providerID") == "agy-bridge"))
' "$SB/modelapi-$label.json" 2>/dev/null || echo -1)"

  if echo "$prov" | grep -q '"id":"agy-bridge"'; then
    fail "V1 provider block registered a provider with NO plugin installed"
  else
    pass "V1 provider block alone does not register agy-bridge"
  fi

  if [[ "$mcount" == "0" ]]; then
    pass "the V1 models map is ignored: 0 agy-bridge models in /api/model"
  else
    fail "expected 0 agy-bridge models from a V1 config alone, got $mcount"
  fi

  # Where config problems surface: the runtime log, not server stdout.
  local runtime_log warnings
  runtime_log="$(ls -1 "$CASE_ROOT"/xd/opencode/log/*.log 2>/dev/null | tail -1 || true)"
  warnings=0
  if [[ -n "$runtime_log" ]]; then
    warnings="$(grep -aciE "unknown key|invalid config|unsupported|deprecat" "$runtime_log" 2>/dev/null || true)"
  fi
  echo "    config-validation warnings mentioning the V1 block: $warnings"
  if [[ "$warnings" -eq 0 ]]; then
    echo "    FINDING: V2 accepts a leftover V1 \"provider\" block with NO warning."
    echo "    \"provider.agy-bridge\" is simply ignored; only \"providers\" is read."
    echo "    That is the silent-failure mode T1 was written to remove: a user who"
    echo "    upgrades to V2 with a V1 config sees no provider and no models, and"
    echo "    no error either. sync-models.ts prunes these entries on install."
  fi

  stop_server
  return 0
}

# ==============================================================================
# Main
# ==============================================================================
if [[ -f "$CURRENT_PLUGIN" ]]; then
  run_case_bridge || true
  run_case_bridge_down || true
  run_case_v1_leftover || true
fi

if [[ "$CANDIDATE_PLUGIN" != "$CURRENT_PLUGIN" ]]; then
  echo ""
  echo "==> Re-running case 1 against the candidate bundle: $CANDIDATE_PLUGIN"
  CANDIDATE_PLUGIN="$CANDIDATE_PLUGIN"
  run_case_bridge || true
fi

# The whole point of the sandbox is that the real config is untouched.
AFTER_SUM="absent"
if [[ -f "$REAL_CONFIG" ]]; then
  AFTER_SUM="$(md5sum "$REAL_CONFIG" | cut -d' ' -f1)"
fi
if [[ "$AFTER_SUM" != "$REAL_CONFIG_SUM" ]]; then
  fail "real opencode.json changed during the smoke run ($REAL_CONFIG_SUM -> $AFTER_SUM)"
else
  pass "real opencode.json untouched (md5 $AFTER_SUM)"
fi

echo ""
if [[ "$FAILURES" -gt 0 ]]; then
  echo "==> $FAILURES of $CHECKS checks FAILED." >&2
  exit 1
fi
echo "==> All V2 plugin smoke checks passed ($CHECKS checks)."
