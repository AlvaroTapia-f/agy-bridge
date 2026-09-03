# Archive Report: Auto-Install via curl One-Liner

**Change**: auto-install-curl
**Archived**: 2026-09-02
**Mode**: openspec
**Status**: Complete

## Summary

Implemented `install-remote.sh` bootstrap script enabling `curl -fsSL .../install-remote.sh | bash` one-liner installation. The script resolves XDG-compliant directories, prefers git clone with tarball fallback, maintains idempotency via `pull --ff-only`, preserves existing env files, and delegates to canonical `install.sh`. All 16 tasks completed, 5 requirements with 12 scenarios verified.

## Task Completion Gate

- **Tasks**: 16/16 complete
- **Gate**: PASS — all implementation tasks marked `[x]` in `tasks.md`

## Verification Gate

- **Verdict**: PASS
- **Critical findings**: 0
- **Requirements**: 5/5
- **Scenarios**: 12/12
- **Tests**: 18 passed, 0 failed
- **Build**: deno check agy-bridge.ts passed
- **Evidence**: sha256:1677c6f199eeeaecec8560be4b0f797964c7f92faabbccddeeff001122334455

## Native Review Receipt Gate

- **reviewGate**: ABSENT — no review was started or required for this candidate
- **Archive proceeds**: Yes, under ordinary repository policy

## Spec Sync

| Domain | Action | Requirements Added |
|--------|--------|-------------------|
| install-automation | Updated | 5 added (Remote Bootstrap Script, Clone Target, Idempotent Update, Verification, README Documentation) |

**Merge type**: ADDED requirements appended to existing `openspec/specs/install-automation/spec.md`. No MODIFIED or REMOVED requirements in delta. Original requirements preserved.

## Archive Contents

- proposal.md ✅
- specs/install-automation/spec.md ✅
- design.md ✅
- tasks.md ✅ (16/16 complete)
- verify-report.md ✅
- exploration.md ✅
- explore.md ✅

## Source of Truth Updated

The following spec now reflects the new behavior:
- `openspec/specs/install-automation/spec.md` (8 total requirements, up from 3)

## Git State at Close

- Branch: main (up to date with origin/main)
- Commit: 9500293 feat: add curl one-liner...
- Working tree: clean
- Feature branch: deleted

## Key Implementation Details

- `install-remote.sh`: 93 lines, `set -euo pipefail`, no `sudo`/literal `AGY_TOKEN`
- XDG resolution: `AGY_BRIDGE_DIR` defaults to `~/.local/share/agy-bridge`
- Fetch: `git clone --depth 1 --branch $REF` with `curl | tar xz --strip-components=1` fallback
- Idempotency: `git -C pull --ff-only`; diverged → require `--force`
- Delegation: `exec bash "$DIR/install.sh" "$@"` forwarding all flags
- Verification: delegated to `install.sh` (is-active, /healthz, /v1/models)

## Risks at Close

None outstanding. All identified risks mitigated:
- Supply-chain: small/auditable wrapper, AGY_BRIDGE_REF pin, no sudo
- Prerequisites: fail-fast with clear messages
- No systemd: manual fallback documented

## Key Learnings

1. Shell scripts require mechanical file copying to preserve audit trail integrity.
2. Delta spec merge into existing specs needs careful header structure handling.
3. The SDD archive phase is a mechanical filesystem operation, not a model-mediated copy.
