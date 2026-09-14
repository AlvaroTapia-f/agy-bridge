#!/usr/bin/env bash
set -euo pipefail
umask 077

action="${1:-}"
settings_file="$HOME/.gemini/antigravity-cli/settings.json"
backup_file="$STATE_DIR/workspace-policy-backup.json"
settings_dir="$(dirname "$settings_file")"
backup_dir="$(dirname "$backup_file")"
managed_keys='["allowNonWorkspaceAccess","trustedWorkspaces","toolPermission","permissions"]'

fail() {
  echo "workspace policy: $*" >&2
  exit 1
}

assert_agent_paths() {
  local mode="$1"
  local paths=(
    /workspace/.agents/agents/agy-bridge-worker-ro-v1.md
    /workspace/.agents/agents/agy-bridge-worker-ro-v1/agent.md
  )
  if [[ "$mode" == "rw" ]]; then
    paths+=(
      /workspace/.agents/agents/agy-bridge-worker-rw-v1.md
      /workspace/.agents/agents/agy-bridge-worker-rw-v1/agent.md
    )
  fi

  local path
  for path in "${paths[@]}"; do
    if [[ -e "$path" || -L "$path" ]]; then
      fail "reserved workspace agent collision: $path"
    fi
  done
}

read_settings() {
  if [[ -f "$settings_file" ]]; then
    jq -e 'type == "object"' "$settings_file" >/dev/null 2>&1 || fail "settings.json is not a valid JSON object"
    cat "$settings_file"
  else
    printf '{}\n'
  fi
}

atomic_json_write() {
  local target="$1" input="$2" dir tmp
  dir="$(dirname "$target")"
  mkdir -p "$dir"
  tmp="$(mktemp "$dir/.workspace-policy.XXXXXX")"
  trap 'rm -f "${tmp:-}"' RETURN
  printf '%s\n' "$input" > "$tmp"
  jq -e . "$tmp" >/dev/null 2>&1 || fail "refusing to write invalid JSON"
  mv -f "$tmp" "$target"
  trap - RETURN
}

apply_policy() {
  local mode="$1" allow trusted_workspaces extra_deny
  case "$mode" in
    none)
      allow='[]'
      trusted_workspaces='[]'
      extra_deny='[
        "read_file(/workspace)",
        "write_file(/workspace)"
      ]'
      ;;
    ro)
      allow='["read_file(/workspace)"]'
      trusted_workspaces='["/workspace"]'
      extra_deny='[]'
      ;;
    rw)
      allow='["read_file(/workspace)","write_file(/workspace)"]'
      trusted_workspaces='["/workspace"]'
      extra_deny='[
        "write_file(/workspace/.agents/agents/agy-bridge-worker-ro-v1.md)",
        "write_file(/workspace/.agents/agents/agy-bridge-worker-ro-v1/agent.md)",
        "write_file(/workspace/.agents/agents/agy-bridge-worker-rw-v1.md)",
        "write_file(/workspace/.agents/agents/agy-bridge-worker-rw-v1/agent.md)"
      ]'
      ;;
    *)
      fail "unsupported workspace policy mode: $mode"
      ;;
  esac

  [[ ! -e "$backup_file" ]] || fail "backup already exists; refusing nested policy transaction"
  mkdir -p "$settings_dir" "$backup_dir"

  local settings backup updated settings_present
  settings="$(read_settings)"
  if [[ -f "$settings_file" ]]; then settings_present=true; else settings_present=false; fi

  backup="$(jq -cn \
    --argjson settings "$settings" \
    --argjson keys "$managed_keys" \
    --argjson settings_present "$settings_present" '
      {
        version: 1,
        settingsFilePresent: $settings_present,
        managed: (reduce $keys[] as $k ({};
          .[$k] = {
            present: ($settings | has($k)),
            value: (if ($settings | has($k)) then $settings[$k] else null end)
          }
        ))
      }
    ')"
  atomic_json_write "$backup_file" "$backup"

  updated="$(jq --argjson allow "$allow" --argjson trusted_workspaces "$trusted_workspaces" --argjson extra_deny "$extra_deny" '
    .allowNonWorkspaceAccess = false
    | .trustedWorkspaces = $trusted_workspaces
    | .toolPermission = "request-review"
    | .permissions = {
        allow: $allow,
        deny: ($extra_deny + [
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
        ])
      }
  ' <<<"$settings")"
  atomic_json_write "$settings_file" "$updated"
}

restore_policy() {
  [[ -f "$backup_file" ]] || fail "backup missing"
  jq -e \
    --argjson keys "$managed_keys" '
      . as $backup
      | .version == 1
        and (.settingsFilePresent | type == "boolean")
        and (.managed | type == "object")
        and all($keys[]; . as $k |
          ($backup.managed | has($k))
          and ($backup.managed[$k].present | type == "boolean")
          and ($backup.managed[$k] | has("value"))
        )
    ' "$backup_file" >/dev/null 2>&1 || fail "backup is corrupt; leaving it in place"

  local settings restored
  settings="$(read_settings)"
  restored="$(jq \
    --slurpfile backup "$backup_file" \
    --argjson keys "$managed_keys" '
      reduce $keys[] as $k (.;
        if $backup[0].managed[$k].present
        then .[$k] = $backup[0].managed[$k].value
        else del(.[$k])
        end
      )
    ' <<<"$settings")"
  atomic_json_write "$settings_file" "$restored"

  if [[ "$(jq -r '.settingsFilePresent' "$backup_file")" == "false" ]] && \
     jq -e 'keys | length == 0' "$settings_file" >/dev/null 2>&1; then
    rm -f "$settings_file"
  fi
  rm -f "$backup_file"
}

case "$action" in
  assert-agent-paths-ro)
    assert_agent_paths ro
    ;;
  assert-agent-paths-rw)
    assert_agent_paths rw
    ;;
  apply-none)
    apply_policy none
    ;;
  apply-ro)
    apply_policy ro
    ;;
  apply-rw)
    apply_policy rw
    ;;
  restore)
    restore_policy
    ;;
  restore-if-needed)
    if [[ -e "$backup_file" ]]; then restore_policy; fi
    ;;
  *)
    fail "usage: $0 {assert-agent-paths-ro|assert-agent-paths-rw|apply-none|apply-ro|apply-rw|restore|restore-if-needed}"
    ;;
esac
