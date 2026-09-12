#!/usr/bin/env bash
set -euo pipefail
source /app/docker/tests/assert.sh

work="$(mktemp -d)"
trap 'kill ${bridge_pid:-0} 2>/dev/null || true; rm -rf "$work"' EXIT

export AGY_BIN=/app/docker/tests/fake-agy.sh
export AGY_TOKEN=0123456789abcdef0123456789abcdef0123456789abcdef
export HOSTNAME=127.0.0.1
export STATE_DIR="$work/state"
export HOME="$work/home"
export FAKE_AGY_CAPTURE_FILE="$work/agy-input.ndjson"
export FAKE_AGY_ARGS_FILE="$work/agy-args.txt"
export FAKE_AGY_CWD_FILE="$work/agy-cwd.txt"
export FAKE_AGY_ENV_FILE="$work/agy-env.txt"
export FAKE_AGY_COUNT_FILE="$work/agy-count.txt"
mkdir -p "$HOME/.gemini" "$STATE_DIR"

start_bridge() {
  local port="$1"
  export PORT="$port"
  deno run \
    --allow-net="127.0.0.1:$port" \
    --allow-env \
    --allow-run="$AGY_BIN,/app/docker/workspace-policy.sh" \
    --allow-read="$HOME/.gemini/antigravity-cli/brain" \
    --allow-write="$STATE_DIR" \
    /app/agy-bridge.ts >"$work/bridge-$port.out" 2>"$work/bridge-$port.err" &
  bridge_pid=$!

  for _ in $(seq 1 50); do
    curl -fsS "http://127.0.0.1:$port/healthz" >/dev/null 2>&1 && break
    sleep 0.1
  done
  curl -fsS "http://127.0.0.1:$port/healthz" >/dev/null || fail "bridge never became healthy on $port"
}

stop_bridge() {
  kill "$bridge_pid" 2>/dev/null || true
  wait "$bridge_pid" 2>/dev/null || true
  bridge_pid=0
}

# ----- default/no-workspace regression -----
unset AGY_WORKSPACE_ROOT AGY_WORKSPACE_MODE AGY_WORKSPACE_HOST_PATH
start_bridge 17421

code="$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:17421/v1/models)"
assert_eq "$code" 401

code="$(curl -sS -o /dev/null -w '%{http_code}' \
  -H 'Host: evil.example' \
  -H "Authorization: Bearer $AGY_TOKEN" \
  http://127.0.0.1:17421/v1/models)"
assert_eq "$code" 403

models="$(curl -fsS -H "Authorization: Bearer $AGY_TOKEN" http://127.0.0.1:17421/v1/models)"
[[ "$models" == *'gemini-test-high'* ]] || fail "model missing"

chat="$(curl -fsS \
  -H 'content-type: application/json' \
  -H "Authorization: Bearer $AGY_TOKEN" \
  -d '{"model":"gemini-test-high","messages":[{"role":"user","content":"ping"}]}' \
  http://127.0.0.1:17421/v1/chat/completions)"
[[ "$chat" == *'fake reply'* ]] || fail "non-stream reply missing"

stream="$(curl -fsS -N \
  -H 'content-type: application/json' \
  -H "Authorization: Bearer $AGY_TOKEN" \
  -d '{"model":"gemini-test-high","stream":true,"messages":[{"role":"user","content":"ping"}]}' \
  http://127.0.0.1:17421/v1/chat/completions)"
[[ "$stream" == *'data: [DONE]'* ]] || fail "stream missing DONE"
[[ "$stream" == *'fake reply'* ]] || fail "stream reply missing"

auto_ro="$(curl -fsS \
  -H 'content-type: application/json' \
  -H "Authorization: Bearer $AGY_TOKEN" \
  -d '{"model":"auto-ro-gemini-test","reasoning_effort":"high","messages":[{"role":"user","content":"Reply exactly WORKER_RO_OK. Do not use tools."}]}' \
  http://127.0.0.1:17421/v1/chat/completions)"
[[ "$auto_ro" == *'fake reply'* ]] || fail "auto-ro reply missing"
ro_args="$(cat "$FAKE_AGY_ARGS_FILE")"
[[ "$ro_args" == *'--agent worker-ro'* ]] || fail "default auto-ro did not route to worker-ro"
captured_prompt="$(deno eval --allow-read="$FAKE_AGY_CAPTURE_FILE" '
  const raw = await Deno.readTextFile(Deno.args[0]);
  const ev = JSON.parse(raw.trim());
  console.log(ev.message?.content ?? "");
' "$FAKE_AGY_CAPTURE_FILE")"
[[ "$captured_prompt" != *'# Bridge workspace contract'* ]] || fail "default prompt contains workspace contract"

curl -fsS \
  -H 'content-type: application/json' \
  -H "Authorization: Bearer $AGY_TOKEN" \
  -d '{"model":"auto-rw-gemini-test","reasoning_effort":"high","messages":[{"role":"user","content":"Reply exactly WORKER_RW_OK."}]}' \
  http://127.0.0.1:17421/v1/chat/completions >/dev/null
rw_args="$(cat "$FAKE_AGY_ARGS_FILE")"
[[ "$rw_args" == *'--agent worker-rw'* ]] || fail "default auto-rw did not route to worker-rw"
stop_bridge

# Invalid workspace contracts must fail before the HTTP server starts.
assert_workspace_config_rejected() {
  local name="$1" root="$2" mode="$3" max="$4"
  if env \
    AGY_WORKSPACE_ROOT="$root" \
    AGY_WORKSPACE_MODE="$mode" \
    MAX_CONCURRENT="$max" \
    PORT=17429 \
    deno run \
      --allow-net=127.0.0.1:17429 \
      --allow-env \
      --allow-run="$AGY_BIN,/app/docker/workspace-policy.sh" \
      --allow-read="$HOME/.gemini/antigravity-cli/brain" \
      --allow-write="$STATE_DIR" \
      /app/agy-bridge.ts >"$work/reject-$name.out" 2>"$work/reject-$name.err"; then
    fail "invalid workspace config was accepted: $name"
  fi
}
assert_workspace_config_rejected bad-root /not-workspace ro 1
assert_workspace_config_rejected bad-mode /workspace rw 1
assert_workspace_config_rejected bad-concurrency /workspace ro 2

# ----- explicit read-only workspace runtime -----
rm -f "$work"/agy-{input.ndjson,args.txt,cwd.txt,env.txt,count.txt}
export AGY_WORKSPACE_ROOT=/workspace
export AGY_WORKSPACE_MODE=ro
export AGY_WORKSPACE_HOST_PATH='HOST_PATH_MUST_NOT_REACH_CHILD'
export AGY_WORKSPACE_BRIDGE_CANARY='BRIDGE_CANARY_MUST_NOT_REACH_CHILD'
export AGY_SECRETS_DIR="$work/secrets"
export KEYRING_PASSWORD_FILE="$work/keyring-password"
mkdir -p "$AGY_SECRETS_DIR"
start_bridge 17422

workspace_ro="$(curl -fsS \
  -H 'content-type: application/json' \
  -H "Authorization: Bearer $AGY_TOKEN" \
  -d '{"model":"auto-ro-gemini-test","reasoning_effort":"high","messages":[{"role":"user","content":"Inspect the caller project."}]}' \
  http://127.0.0.1:17422/v1/chat/completions)"
[[ "$workspace_ro" == *'fake reply'* ]] || fail "workspace auto-ro reply missing"

workspace_args="$(cat "$HOME/fake-agy-args.txt")"
[[ "$workspace_args" == *'--agent agy-bridge-worker-ro-v1'* ]] || fail "workspace auto-ro did not use reserved agent"
assert_eq "$(cat "$HOME/fake-agy-cwd.txt")" /workspace
workspace_prompt="$(deno eval --allow-read="$HOME/fake-agy-input.ndjson" '
  const raw = await Deno.readTextFile(Deno.args[0]);
  const ev = JSON.parse(raw.trim());
  console.log(ev.message?.content ?? "");
' "$HOME/fake-agy-input.ndjson")"
[[ "$workspace_prompt" == *'# Bridge workspace contract'* ]] || fail "workspace contract missing"
[[ "$workspace_prompt" == *'The operator explicitly exposed one caller project at /workspace in read-only mode.'* ]] || fail "workspace contract root missing"

workspace_env="$HOME/fake-agy-env.txt"
for secret_name in AGY_TOKEN AGY_SECRETS_DIR KEYRING_PASSWORD_FILE STATE_DIR AGY_WORKSPACE_HOST_PATH AGY_WORKSPACE_BRIDGE_CANARY; do
  ! grep -q "^${secret_name}=" "$workspace_env" || fail "workspace child leaked $secret_name"
done
grep -q '^HOME=' "$workspace_env" || fail "workspace child missing HOME"
grep -q '^PATH=' "$workspace_env" || fail "workspace child missing PATH"

count_before="$(cat "$HOME/fake-agy-count.txt")"
code="$(curl -sS -o "$work/rw-denied.json" -w '%{http_code}' \
  -H 'content-type: application/json' \
  -H "Authorization: Bearer $AGY_TOKEN" \
  -d '{"model":"auto-rw-gemini-test","reasoning_effort":"high","messages":[{"role":"user","content":"modify a file"}]}' \
  http://127.0.0.1:17422/v1/chat/completions)"
assert_eq "$code" 403
count_after="$(cat "$HOME/fake-agy-count.txt")"
assert_eq "$count_after" "$count_before"
[[ ! -e "$STATE_DIR/workspace-policy-backup.json" ]] || fail "workspace policy backup remained after successful request"

# A child-side failure must still restore the policy transaction.
code="$(curl -sS -o "$work/child-failure.json" -w '%{http_code}' \
  -H 'content-type: application/json' \
  -H "Authorization: Bearer $AGY_TOKEN" \
  -d '{"model":"auto-ro-gemini-test","messages":[{"role":"user","content":"FAKE_CHILD_FAILURE"}]}' \
  http://127.0.0.1:17422/v1/chat/completions)"
assert_eq "$code" 502
[[ ! -e "$STATE_DIR/workspace-policy-backup.json" ]] || fail "workspace policy backup remained after child failure"
stop_bridge

# A hard-deadline path uses a fake child that ignores SIGTERM. The bridge must
# wait for terminal child status (SIGKILL escalation) before restoring policy.
export PRINT_TIMEOUT=1ms
export AGY_HARD_MARGIN_MS=50
start_bridge 17423
code="$(curl -sS -o "$work/hard-deadline.json" -w '%{http_code}' \
  -H 'content-type: application/json' \
  -H "Authorization: Bearer $AGY_TOKEN" \
  -d '{"model":"auto-ro-gemini-test","messages":[{"role":"user","content":"FAKE_HANG"}]}' \
  http://127.0.0.1:17423/v1/chat/completions)"
assert_eq "$code" 502
[[ ! -e "$STATE_DIR/workspace-policy-backup.json" ]] || fail "workspace policy backup remained after hard deadline"
stop_bridge
unset PRINT_TIMEOUT AGY_HARD_MARGIN_MS

echo "PASS: bridge default regression and explicit read-only workspace runtime"
