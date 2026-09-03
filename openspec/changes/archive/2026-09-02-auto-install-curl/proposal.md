# Proposal: Auto-Install via curl One-Liner

## Intent
One `curl -fsSL ... | bash` installs agy-bridge and leaves it running/verified — no `install.sh` duplication, `curl|bash` stays auditable.

## Scope
### In Scope
- `install-remote.sh` bootstrap (~100 lines, `bash set -euo pipefail`) at repo root
- Clone/tarball fetch + `exec "$DIR/install.sh" "$@"`
- `README.md` one-liner + prereqs + audit note
- Delta spec `install-automation`

### Out of Scope
- Auto-install `deno`/`agy`/`opencode`
- Releases tarball/checksums/CI
- Changes to `agy-bridge.ts`, `service.template`, `plugins/*`

## Capabilities
### New Capabilities
- None.

### Modified Capabilities
- `install-automation`: remote bootstrap via curl (dir, `AGY_BRIDGE_REF` pin, git/tarball fallback, verification).

## Approach
Wrapper `https://raw.githubusercontent.com/AlvaroTapia-f/agy-bridge/main/install-remote.sh` (<120 lines). Resolves `AGY_BRIDGE_DIR`=`~/.local/share/agy-bridge` (XDG, env override) and `AGY_BRIDGE_REF`=`main` (tag/branch/commit). Prefers `git clone --depth 1 --branch $REF`; fallback `curl .../archive/${REF}.tar.gz | tar xz --strip-components=1`. Idempotent: `git -C pull --ff-only` or `--force` re-clone; preserves `~/.config/agy-bridge/env`. Delegates `exec bash "$DIR/install.sh" "$@"` (`--with-auth`/`--force`/`-h`). `install.sh` stays canonical. Verifies `is-active`, `/healthz`, `/v1/models`. `agy` → fail-fast. No `sudo`.

## Affected Areas
| Area | Impact | Description |
|------|--------|-------------|
| `install-remote.sh` | New | Bootstrap, clone/tarball + exec |
| `README.md` | Modified | One-liner, `bash -s -- --with-auth`, `AGY_BRIDGE_REF`/`AGY_BRIDGE_DIR`, `curl|less` audit |
| `install.sh` | Modified | Doc note only; logic unchanged |
| `openspec/specs/install-automation/spec.md` | Modified | Delta: remote bootstrap |

## Risks
| Risk | Likelihood | Mitigation |
|------|------------|------------|
| `curl|bash` supply-chain | High | Small/auditable wrapper, `AGY_BRIDGE_REF` pin, doc `curl|less`, no sudo |
| `agy` gated | High | Fail-fast, no auto-install/auth |
| `deno` missing | Med | Fail-fast + doc prereq; defer auto-install |
| No `systemd --user` | Med | Detect, print `deno run` fallback |
| Clone collision | Low | `pull --ff-only` or `--force` re-clone |
| Port 7421 conflict | Low | Check `/healthz`, suggest `PORT` override |

## Rollback Plan
`systemctl --user disable --now agy-bridge; rm ~/.config/systemd/user/agy-bridge.service; daemon-reload`; `rm -rf $AGY_BRIDGE_DIR`; remove `provider.agy-bridge`/plugin and `auth.json` key if `--with-auth` used; `env` preserved.

## Dependencies
`bash`, `curl` + (`git`|`tar`), `systemd --user`, `python3` (warn+skip), `deno` 2.9.5, `agy` (fail-fast); `opencode` optional.

## Success Criteria
- [ ] `curl -fsSL .../install-remote.sh | bash` → `active`
- [ ] `curl .../healthz` → `{"ok":true}`; `curl -H "Bearer $AGY_TOKEN" .../v1/models` → 200
- [ ] `bash -n` passes; <150 lines; no literal `AGY_TOKEN`
- [ ] `bash -s -- --with-auth --force` and `AGY_BRIDGE_REF`/`AGY_BRIDGE_DIR` work; re-run idempotent

## Proposal question round
Interactive — answer, skip, or request second round.

1. Clone dir: `~/.local/share/agy-bridge` (XDG, proposed) vs `~/agy-bridge`?
2. Deno missing: fail-fast + hint (proposed) vs auto-install?
3. `--with-auth` default on curl or explicit `bash -s -- --with-auth`?
4. Versioned tarball+checksums: defer (proposed) vs include now?

Assumptions: XDG dir, fail-fast deno, explicit auth, defer tarball.
