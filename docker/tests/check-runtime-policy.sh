#!/usr/bin/env bash
set -euo pipefail

dockerfile="${1:-/app/Dockerfile}"
compose="${2:-/app/compose.yaml}"

[[ -f "$dockerfile" ]] || { echo "missing Dockerfile: $dockerfile" >&2; exit 1; }
[[ -f "$compose" ]] || { echo "missing compose file: $compose" >&2; exit 1; }

grep -F 'ARG AGY_VERSION=1.2.2' "$dockerfile" >/dev/null || {
  echo 'agy artifact version must stay explicitly pinned' >&2
  exit 1
}
grep -F 'ARG AGY_ARTIFACT_SHA512=' "$dockerfile" >/dev/null || {
  echo 'agy artifact checksum pin is missing' >&2
  exit 1
}
grep -F 'sha512sum -c -' "$dockerfile" >/dev/null || {
  echo 'agy artifact checksum is not verified before install' >&2
  exit 1
}
if grep -E 'curl[^|\r\n]*\|[^\r\n]*(ba)?sh' "$dockerfile" >/dev/null; then
  echo 'unchecked curl pipe to shell is forbidden' >&2
  exit 1
fi

if grep -E 'SSH_CONNECTION|SSH_TTY' "$dockerfile" "$compose" /app/docker/auth.sh >/dev/null; then
  echo 'Docker OAuth flow must not spoof SSH_CONNECTION/SSH_TTY' >&2
  exit 1
fi

grep -F '127.0.0.1:7421:7421' "$compose" >/dev/null || {
  echo 'bridge publication must remain loopback-only' >&2
  exit 1
}

[[ "$(id -u)" == "10001" ]] || {
  echo "test image must run as UID 10001, got $(id -u)" >&2
  exit 1
}
[[ "$(id -g)" == "10001" ]] || {
  echo "test image must run as GID 10001, got $(id -g)" >&2
  exit 1
}

echo 'PASS: pinned artifact, no SSH spoof, loopback publication, non-root runtime'
