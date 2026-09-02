# Tasks: Auto-Install via curl One-Liner

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 120–160 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | `install-remote.sh` + README one-liner + `install.sh` header | PR 1 | `bash -n install-remote.sh && wc -l install-remote.sh` | `AGY_BRIDGE_DIR=/tmp/test bash install-remote.sh -- --force` on VM | Delete `install-remote.sh`, revert `README.md`/`install.sh` |

## Phase 1: Foundation & RED Harness

- [x] 1.1 RED static checks for `install-remote.sh` — `bash -n`, `wc -l <120`, `grep sudo` fails, `grep AGY_TOKEN` only `$AGY_TOKEN`, `set -euo pipefail` present
- [x] 1.2 RED harness for dir resolution — `AGY_BRIDGE_DIR` default XDG, absolute/relative/`..`/spaces → quoted absolute `"$DIR"` for `git -C`/`tar -C` (stub `git`/`curl`/`tar`)
- [x] 1.3 RED harness for fail-fast — `agy`/`deno` missing → exit 1 before clone with hint; no `systemd --user` → print `deno run` fallback

## Phase 2: Core — `install-remote.sh`

- [x] 2.1 Create `install-remote.sh` (root, `chmod +x`) with `#!/usr/bin/env bash`, `set -euo pipefail`, no `sudo`/literal `AGY_TOKEN`
- [x] 2.2 Implement XDG resolution — `AGY_BRIDGE_DIR=${AGY_BRIDGE_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/agy-bridge}`, `AGY_BRIDGE_REF=${AGY_BRIDGE_REF:-main}`, normalize to absolute, quote `"$DIR"`
- [x] 2.3 Implement fail-fast before fetch — `command -v agy`/`deno` else `exit 1` with prereq message (no auto-install)
- [x] 2.4 Implement fetch — `git clone --depth 1 --branch "$AGY_BRIDGE_REF" ... "$AGY_BRIDGE_DIR"`; fallback `curl -fsSL .../archive/${REF}.tar.gz | tar xz --strip-components=1 -C "$DIR"`
- [x] 2.5 Implement idempotent update — `git -C "$DIR" pull --ff-only`; diverged → error unless `--force` re-clone; tarball needs `--force`; preserve `~/.config/agy-bridge/env`
- [x] 2.6 Implement delegation — `exec bash "$AGY_BRIDGE_DIR/install.sh" "$@"` passthrough `--with-auth`/`--force`/`-h`; `bash -s --` compatible; keep <120 lines, `bash -n` clean

## Phase 3: Docs & Wiring

- [x] 3.1 Update `README.md` — one-liner `curl -fsSL .../install-remote.sh | bash`, `bash -s -- --with-auth`, `AGY_BRIDGE_REF`/`AGY_BRIDGE_DIR` examples, `curl|less` audit, no-sudo
- [x] 3.2 Update `README.md` prereqs — `deno 2.9.5` + `agy` required, `install.sh` canonical
- [x] 3.3 Update `install.sh` header — doc note that `install-remote.sh` bootstraps and `exec`s this file; no logic change

## Phase 4: Verification

- [x] 4.1 Static gate — `bash -n install-remote.sh`, `wc -l` (<120), `! grep -q sudo`, `grep AGY_TOKEN` only `$AGY_TOKEN`, `deno check agy-bridge.ts`
- [x] 4.2 Integration — defaults vs `AGY_BRIDGE_DIR=/tmp/c AGY_BRIDGE_REF=v0.2.0`, git→tarball fallback (stub `git`), `pull --ff-only`/`--force` re-clone, arg passthrough, env preserved
- [x] 4.3 Verification scenarios — delegated `install.sh` checks `is-active`→`active`, `curl /healthz`→`{"ok":true}`, `curl -H "Bearer $AGY_TOKEN" /v1/models`→200, no-systemd fallback
- [x] 4.4 Final gate — `deno lint`/`fmt --check`, idempotent re-run (`main` already cloned → ff-only + exec)
