#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "models" ]]; then
  printf 'gemini-test-high\tGemini Test High\n'
  exit 0
fi

if [[ -n "${FAKE_AGY_ARGS_FILE:-}" ]]; then
  printf '%s\n' "$*" > "$FAKE_AGY_ARGS_FILE"
fi

# The real bridge writes one NDJSON prompt to stdin before consuming output.
# Drain it so the writer cannot hit EPIPE if the fake exits too early.
input="$(cat || true)"
if [[ -n "${FAKE_AGY_CAPTURE_FILE:-}" ]]; then
  printf '%s\n' "$input" > "$FAKE_AGY_CAPTURE_FILE"
fi
printf '%s\n' '{"event":"step_update","step_update":{"step_type":"agent_response","text_delta":"fake reply"}}'
printf '%s\n' '{"event":"result","result":{"status":"SUCCESS","response":"fake reply","conversation_id":"fake-conversation","usage":{"input_tokens":1,"output_tokens":2,"total_tokens":3}}}'
