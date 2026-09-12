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

apply_ro() {
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

  updated="$(jq '
    .allowNonWorkspaceAccess = false
    | .trustedWorkspaces = ["/workspace"]
    | .toolPermission = "request-review"
    | .permissions = {
        allow: ["read_file(/workspace)"],
        deny: [
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
  apply-ro)
    apply_ro
    ;;
  restore)
    restore_policy
    ;;
  restore-if-needed)
    if [[ -e "$backup_file" ]]; then restore_policy; fi
    ;;
  *)
    fail "usage: $0 {apply-ro|restore|restore-if-needed}"
    ;;
esac
