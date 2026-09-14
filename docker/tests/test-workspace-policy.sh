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

run_rw_restore_case() {
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

  "$helper" apply-rw
  [[ -f "$STATE_DIR/workspace-policy-backup.json" ]] || fail "$name: backup missing"
  jq -e '
    .permissions.allow == ["read_file(/workspace)", "write_file(/workspace)"]
  ' "$settings" >/dev/null || fail "$name: RW allow list mismatch"

  if "$helper" apply-ro >/dev/null 2>&1; then
    fail "$name: apply-ro after apply-rw unexpectedly succeeded"
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

# Bare routes in a workspace deployment use a transactional access=none policy
# that denies the workspace as well as the existing non-workspace surfaces.
export HOME="$work/none-policy/home" STATE_DIR="$work/none-policy/state"
mkdir -p "$HOME/.gemini/antigravity-cli" "$STATE_DIR"
printf '%s\n' '{"unrelated":{"keep":2}}' > "$HOME/.gemini/antigravity-cli/settings.json"
cp "$HOME/.gemini/antigravity-cli/settings.json" "$work/none-policy-before.json"
"$helper" apply-none
[[ -f "$STATE_DIR/workspace-policy-backup.json" ]] || fail 'none policy backup missing'
jq -e '
  .unrelated == {"keep":2} and
  .allowNonWorkspaceAccess == false and
  .trustedWorkspaces == [] and
  .toolPermission == "request-review" and
  .permissions.allow == [] and
  .permissions.deny == [
    "read_file(/workspace)",
    "write_file(/workspace)",
    "read_file(/app)",
    "write_file(/app)",
    "read_file(/home/agy/.gemini)",
    "write_file(/home/agy/.gemini)",
    "read_file(/home/agy/.local/share/agy-secrets)",
    "write_file(/home/agy/.local/share/agy-secrets)",
    "read_file(/home/agy/.local/share/keyrings)",
    "write_file(/home/agy/.local/share/keyrings)",
    "read_file(/home/agy/.local/state/agy-bridge)",
    "write_file(/home/agy/.local/state/agy-bridge)"
  ]
' "$HOME/.gemini/antigravity-cli/settings.json" >/dev/null || fail 'none policy mismatch'
if "$helper" apply-ro >/dev/null 2>&1; then
  fail 'apply-ro after apply-none unexpectedly succeeded'
fi
"$helper" restore
assert_json_eq "$HOME/.gemini/antigravity-cli/settings.json" "$work/none-policy-before.json" 'none policy restore mismatch'

rm -f "$HOME/.gemini/antigravity-cli/settings.json" "$STATE_DIR/workspace-policy-backup.json"
"$helper" apply-none
[[ -f "$HOME/.gemini/antigravity-cli/settings.json" ]] || fail 'none policy did not create managed settings from absent state'
"$helper" restore
[[ ! -e "$HOME/.gemini/antigravity-cli/settings.json" ]] || fail 'none policy restore did not remove settings that were initially absent'
[[ ! -e "$STATE_DIR/workspace-policy-backup.json" ]] || fail 'none policy backup remained after absent-state restore'

# RW policy must use the same managed settings as RO except for the scoped
# workspace write grant. This is intentionally separate from run_case so the
# new action is proven RED before workspace-policy.sh learns apply-rw.
export HOME="$work/rw-policy/home" STATE_DIR="$work/rw-policy/state"
mkdir -p "$HOME/.gemini/antigravity-cli" "$STATE_DIR"
printf '%s\n' '{"unrelated":{"keep":1}}' > "$HOME/.gemini/antigravity-cli/settings.json"
"$helper" apply-rw
jq -e '
  .unrelated == {"keep":1} and
  .allowNonWorkspaceAccess == false and
  .trustedWorkspaces == ["/workspace"] and
  .toolPermission == "request-review" and
  .permissions.allow == ["read_file(/workspace)", "write_file(/workspace)"] and
  .permissions.deny == [
    "write_file(/workspace/.agents/agents/agy-bridge-worker-ro-v1.md)",
    "write_file(/workspace/.agents/agents/agy-bridge-worker-ro-v1/agent.md)",
    "write_file(/workspace/.agents/agents/agy-bridge-worker-rw-v1.md)",
    "write_file(/workspace/.agents/agents/agy-bridge-worker-rw-v1/agent.md)",
    "read_file(/app)",
    "write_file(/app)",
    "read_file(/home/agy/.gemini)",
    "write_file(/home/agy/.gemini)",
    "read_file(/home/agy/.local/share/agy-secrets)",
    "write_file(/home/agy/.local/share/agy-secrets)",
    "read_file(/home/agy/.local/share/keyrings)",
    "write_file(/home/agy/.local/share/keyrings)",
    "read_file(/home/agy/.local/state/agy-bridge)",
    "write_file(/home/agy/.local/state/agy-bridge)"
  ] and
  ([.permissions.allow[], .permissions.deny[]] | all(contains("*") | not)) and
  ([.permissions.allow[], .permissions.deny[]] | all(startswith("command(") | not))
' "$HOME/.gemini/antigravity-cli/settings.json" >/dev/null || fail 'RW policy mismatch'
"$helper" restore

# Request-time reserved-agent assertions are symlink-safe and mode-specific.
rm -rf /workspace/.agents
"$helper" assert-agent-paths-ro
"$helper" assert-agent-paths-rw

mkdir -p /workspace/.agents/agents/agy-bridge-worker-ro-v1
printf '%s\n' shadow > /workspace/.agents/agents/agy-bridge-worker-ro-v1/agent.md
if "$helper" assert-agent-paths-ro >/dev/null 2>&1; then
  fail 'assert-agent-paths-ro accepted reserved RO agent collision'
fi
rm -rf /workspace/.agents

mkdir -p /workspace/.agents/agents
ln -s /workspace/DOES-NOT-EXIST /workspace/.agents/agents/agy-bridge-worker-ro-v1.md
if "$helper" assert-agent-paths-ro >/dev/null 2>&1; then
  fail 'assert-agent-paths-ro accepted dangling reserved RO agent symlink'
fi
rm -rf /workspace/.agents

mkdir -p /workspace/.agents/agents/agy-bridge-worker-rw-v1
printf '%s\n' shadow > /workspace/.agents/agents/agy-bridge-worker-rw-v1/agent.md
"$helper" assert-agent-paths-ro
if "$helper" assert-agent-paths-rw >/dev/null 2>&1; then
  fail 'assert-agent-paths-rw accepted reserved RW agent collision'
fi
rm -rf /workspace/.agents

mkdir -p /workspace/.agents/agents
ln -s /workspace/DOES-NOT-EXIST /workspace/.agents/agents/agy-bridge-worker-rw-v1.md
if "$helper" assert-agent-paths-rw >/dev/null 2>&1; then
  fail 'assert-agent-paths-rw accepted dangling reserved RW agent symlink'
fi
rm -rf /workspace/.agents

run_rw_restore_case rw-absent '__ABSENT__'
run_rw_restore_case rw-present '{"allowNonWorkspaceAccess":true,"trustedWorkspaces":["/old"],"toolPermission":"permissive","permissions":{"allow":["legacy"],"deny":["legacy-deny"]},"unrelated":{"keep":7}}'

# The nested-transaction guard is shared in both directions.
export HOME="$work/ro-then-rw/home" STATE_DIR="$work/ro-then-rw/state"
mkdir -p "$HOME/.gemini/antigravity-cli" "$STATE_DIR"
printf '%s\n' '{"unrelated":"keep"}' > "$HOME/.gemini/antigravity-cli/settings.json"
"$helper" apply-ro
if "$helper" apply-rw >/dev/null 2>&1; then
  fail 'apply-rw after apply-ro unexpectedly succeeded'
fi
"$helper" restore

# A stale RW transaction is restored through the same startup recovery action.
export HOME="$work/stale-rw/home" STATE_DIR="$work/stale-rw/state"
mkdir -p "$HOME/.gemini/antigravity-cli" "$STATE_DIR"
printf '%s\n' '{"unrelated":84,"toolPermission":"old"}' > "$HOME/.gemini/antigravity-cli/settings.json"
cp "$HOME/.gemini/antigravity-cli/settings.json" "$work/stale-rw-before.json"
"$helper" apply-rw
"$helper" restore-if-needed
assert_json_eq "$HOME/.gemini/antigravity-cli/settings.json" "$work/stale-rw-before.json" 'stale RW recovery mismatch'

# Corrupting an RW transaction backup must fail closed and retain evidence.
export HOME="$work/corrupt-rw/home" STATE_DIR="$work/corrupt-rw/state"
mkdir -p "$HOME/.gemini/antigravity-cli" "$STATE_DIR"
printf '%s\n' '{"unrelated":"keep"}' > "$HOME/.gemini/antigravity-cli/settings.json"
"$helper" apply-rw
printf '%s\n' '{broken' > "$STATE_DIR/workspace-policy-backup.json"
if "$helper" restore-if-needed >/dev/null 2>&1; then
  fail 'corrupt RW backup unexpectedly restored'
fi
[[ -f "$STATE_DIR/workspace-policy-backup.json" ]] || fail 'corrupt RW backup should remain'

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
