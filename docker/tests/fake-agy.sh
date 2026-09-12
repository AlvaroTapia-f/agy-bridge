#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "models" ]]; then
  printf 'gemini-test-high\tGemini Test High\n'
  exit 0
fi
home="${HOME:-/tmp}"
args_file="${FAKE_AGY_ARGS_FILE:-$home/fake-agy-args.txt}"
capture_file="${FAKE_AGY_CAPTURE_FILE:-$home/fake-agy-input.ndjson}"
cwd_file="${FAKE_AGY_CWD_FILE:-$home/fake-agy-cwd.txt}"
env_file="${FAKE_AGY_ENV_FILE:-$home/fake-agy-env.txt}"
count_file="${FAKE_AGY_COUNT_FILE:-$home/fake-agy-count.txt}"

printf '%s\n' "$*" > "$args_file"
pwd -P > "$cwd_file"
env | sort > "$env_file"
count=0
if [[ -f "$count_file" ]]; then count="$(cat "$count_file")"; fi
printf '%s\n' "$((count + 1))" > "$count_file"

# The real bridge writes one NDJSON prompt to stdin before consuming output.
# Drain it so the writer cannot hit EPIPE if the fake exits too early.
input="$(cat || true)"
printf '%s\n' "$input" > "$capture_file"
printf '%s\n' '{"event":"step_update","step_update":{"step_type":"agent_response","text_delta":"fake reply"}}'
printf '%s\n' '{"event":"result","result":{"status":"SUCCESS","response":"fake reply","conversation_id":"fake-conversation","usage":{"input_tokens":1,"output_tokens":2,"total_tokens":3}}}'
