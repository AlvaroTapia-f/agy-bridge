#!/usr/bin/env bash
set -euo pipefail

: "${KEYRING_PASSWORD_FILE:?KEYRING_PASSWORD_FILE is required}"
[[ -r "$KEYRING_PASSWORD_FILE" ]] || {
  echo "keyring password file is missing or unreadable: $KEYRING_PASSWORD_FILE" >&2
  exit 70
}
[[ $# -gt 0 ]] || {
  echo "usage: keyring-session.sh <command> [args...]" >&2
  exit 64
}

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp/agy-runtime-${UID}}"
mkdir -p "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"

exec dbus-run-session -- bash -c '
  set -euo pipefail
  eval "$(gnome-keyring-daemon --login < "$KEYRING_PASSWORD_FILE")"
  eval "$(gnome-keyring-daemon --start --components=secrets)"
  exec "$@"
' bash "$@"
