#!/usr/bin/env bash
set -euo pipefail
source /app/docker/tests/assert.sh

work="$(mktemp -d)"
trap 'kill ${bridge_pid:-0} 2>/dev/null || true; rm -rf "$work"' EXIT

export AGY_BIN=/app/docker/tests/fake-agy.sh
export AGY_TOKEN=0123456789abcdef0123456789abcdef0123456789abcdef
export HOSTNAME=127.0.0.1
export PORT=17421
export STATE_DIR="$work/state"
export HOME="$work/home"
export FAKE_AGY_CAPTURE_FILE="$work/agy-input.ndjson"
export FAKE_AGY_ARGS_FILE="$work/agy-args.txt"
mkdir -p "$HOME/.gemini" "$STATE_DIR"

deno run \
  --allow-net=127.0.0.1:17421 \
  --allow-env \
  --allow-run="$AGY_BIN" \
  --allow-read="$HOME/.gemini/antigravity-cli/brain" \
  --allow-write="$STATE_DIR" \
  /app/agy-bridge.ts >"$work/bridge.out" 2>"$work/bridge.err" &
bridge_pid=$!

for _ in $(seq 1 50); do
  curl -fsS http://127.0.0.1:17421/healthz >/dev/null 2>&1 && break
  sleep 0.1
done
curl -fsS http://127.0.0.1:17421/healthz >/dev/null || fail "bridge never became healthy"

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
[[ -s "$FAKE_AGY_ARGS_FILE" ]] || fail "fake agy did not capture arguments"
ro_args="$(cat "$FAKE_AGY_ARGS_FILE")"
[[ "$ro_args" == *'--agent worker-ro'* ]] || fail "auto-ro did not route to worker-ro"
[[ -s "$FAKE_AGY_CAPTURE_FILE" ]] || fail "fake agy did not capture autonomous stdin"
captured_prompt="$(deno eval --allow-read="$FAKE_AGY_CAPTURE_FILE" '
  const raw = await Deno.readTextFile(Deno.args[0]);
  const ev = JSON.parse(raw.trim());
  console.log(ev.message?.content ?? "");
' "$FAKE_AGY_CAPTURE_FILE")"
[[ "$captured_prompt" != *'The absolute workspace root for this delegated task is'* ]] || \
  fail "autonomous prompt must not infer a caller workspace from the bridge cwd"
[[ "$captured_prompt" != *'Pass absolute paths rooted here to filesystem tools'* ]] || \
  fail "autonomous prompt must not inject deployment-specific workspace guidance"

auto_rw="$(curl -fsS \
  -H 'content-type: application/json' \
  -H "Authorization: Bearer $AGY_TOKEN" \
  -d '{"model":"auto-rw-gemini-test","reasoning_effort":"high","messages":[{"role":"user","content":"Reply exactly WORKER_RW_OK. Do not modify files and do not run commands."}]}' \
  http://127.0.0.1:17421/v1/chat/completions)"
[[ "$auto_rw" == *'fake reply'* ]] || fail "auto-rw reply missing"
rw_args="$(cat "$FAKE_AGY_ARGS_FILE")"
[[ "$rw_args" == *'--agent worker-rw'* ]] || fail "auto-rw did not route to worker-rw"

echo "PASS: bridge auth, host guard, models, chat, stream, and autonomous routing"
