#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
helper="${1:-$script_dir/../workspace-policy.sh}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
assert_json_eq() {
  local actual="$1" expected="$2" message="$3"
  diff -u <(jq -S . "$expected") <(jq -S . "$actual") >/dev/null || fail "$message"
}

run_case() {
  local name="$1" initial="$2"
  local home="$work/$name/home" state="$work/$name/state"
  mkdir -p "$home/.gemini/antigravity-cli" "$state"
  export HOME="$home" STATE_DIR="$state"
  local settings="$HOME/.gemini/antigravity-cli/settings.json"
  if [[ "$initial" != '__ABSENT__' ]]; then
    printf '%s\n' "$initial" > "$settings"
  fi

  local before="$work/$name-before.json"
  if [[ -f "$settings" ]]; then cp "$settings" "$before"; else printf '{}\n' > "$before"; fi

  "$helper" apply-ro
  [[ -f "$STATE_DIR/workspace-policy-backup.json" ]] || fail "$name: backup missing"
  jq -e '
    .allowNonWorkspaceAccess == false and
    .trustedWorkspaces == ["/workspace"] and
    .toolPermission == "request-review" and
    .permissions.allow == ["read_file(/workspace)"] and
    (.permissions.deny | index("read_file(/app)")) != null and
    (.permissions.deny | index("write_file(/home/agy/.local/state/agy-bridge)")) != null
  ' "$settings" >/dev/null || fail "$name: RO policy mismatch"
  if grep -Eq 'read_file\(\*\)|write_file\(\*\)|command\(\*\)' "$settings"; then
    fail "$name: wildcard permission present"
  fi

  if "$helper" apply-ro >/dev/null 2>&1; then
    fail "$name: second apply unexpectedly succeeded"
  fi

  "$helper" restore
  [[ ! -e "$STATE_DIR/workspace-policy-backup.json" ]] || fail "$name: backup not removed after restore"

  if [[ "$initial" == '__ABSENT__' ]]; then
    if [[ -f "$settings" ]]; then
      jq -e 'keys | length == 0' "$settings" >/dev/null || fail "$name: absent settings restored with content"
    fi
  else
    assert_json_eq "$settings" "$before" "$name: settings not restored exactly"
  fi
}

run_case absent '__ABSENT__'
run_case present '{"allowNonWorkspaceAccess":true,"trustedWorkspaces":["/old"],"toolPermission":"permissive","permissions":{"allow":["legacy"]},"unrelated":{"keep":1}}'
run_case mixed '{"trustedWorkspaces":["/elsewhere"],"permissions":{"deny":["legacy-deny"]},"unrelated":"keep"}'

# Stale-backup recovery: apply, then a new invocation restores it.
export HOME="$work/stale/home" STATE_DIR="$work/stale/state"
mkdir -p "$HOME/.gemini/antigravity-cli" "$STATE_DIR"
printf '%s\n' '{"unrelated":42,"toolPermission":"old"}' > "$HOME/.gemini/antigravity-cli/settings.json"
cp "$HOME/.gemini/antigravity-cli/settings.json" "$work/stale-before.json"
"$helper" apply-ro
"$helper" restore-if-needed
assert_json_eq "$HOME/.gemini/antigravity-cli/settings.json" "$work/stale-before.json" 'stale recovery mismatch'

# Corrupt backup fails closed and stays for inspection.
export HOME="$work/corrupt/home" STATE_DIR="$work/corrupt/state"
mkdir -p "$HOME/.gemini/antigravity-cli" "$STATE_DIR"
printf '%s\n' '{}' > "$HOME/.gemini/antigravity-cli/settings.json"
printf '%s\n' '{broken' > "$STATE_DIR/workspace-policy-backup.json"
if "$helper" restore-if-needed >/dev/null 2>&1; then
  fail 'corrupt backup unexpectedly restored'
fi
[[ -f "$STATE_DIR/workspace-policy-backup.json" ]] || fail 'corrupt backup should remain'

echo 'PASS: transactional workspace policy helper'
