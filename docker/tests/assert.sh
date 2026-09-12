#!/usr/bin/env bash
set -euo pipefail

fail() { echo "FAIL: $*" >&2; exit 1; }
assert_eq() { [[ "$1" == "$2" ]] || fail "expected '$2', got '$1'"; }
assert_file() { [[ -f "$1" ]] || fail "missing file: $1"; }
assert_mode() {
  local got
  got="$(stat -c '%a' "$1")"
  [[ "$got" == "$2" ]] || fail "mode for $1: expected $2, got $got"
}
