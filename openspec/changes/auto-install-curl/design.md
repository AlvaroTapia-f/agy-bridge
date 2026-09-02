# Design: Auto-Install via curl One-Liner

## Technical Approach

Thin wrapper `install-remote.sh` (`bash set -euo pipefail`, <120 lines) resolves `AGY_BRIDGE_DIR`/`AGY_BRIDGE_REF`, fetches repo (git-preferred + tarball fallback), then `exec`s canonical `install.sh "$@"`. No duplication of env/service/provider logic — `install.sh` stays sole installer. Wrapper adds fail-fast checks pre-clone; verification (`is-active`, `/healthz`, `/v1/models`) is delegated to `install.sh`. Implements delta `install-automation` ADDED requirements.

## Architecture Decisions

| Decision | Options (tradeoff) | Choice | Rationale |
|---|---|---|---|
| Wrapper vs. extend `install.sh` | Extend couples fetch+install, breaks SRP | **Separate `install-remote.sh` + `exec`** | Keeps `install.sh` canonical per proposal; isolates supply-chain surface and line budget |
| Fetch strategy | git-only fails without git; tarball-only loses `pull --ff-only` | **git clone --depth1 --branch $REF fallback tarball `curl \| tar xz --strip=1`** | Covers both toolsets; shallow is fast; fallback portable; required by spec |
| Dir/ref resolution | Hardcoded `~/agy-bridge` violates XDG | **`AGY_BRIDGE_DIR=${AGY_BRIDGE_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/agy-bridge}`, `REF=${REF:-main}`** | XDG-compliant, overridable for pinning/tests (`v0.2.0`, `/tmp/...`) |
| Idempotency + delegation | Always re-clone destructive | **`git -C pull --ff-only`; diverged → require `--force` re-clone; tarball needs `--force`; `exec bash "$DIR/install.sh" "$@"`** | Safe default; explicit force; preserves `~/.config/agy-bridge/env`; forwards all flags |

## Data Flow

```
curl -fsSL raw.githubusercontent.com/.../install-remote.sh | bash -s -- --with-auth
         │
         ▼
 install-remote.sh (set -euo pipefail)
 ├─ fail-fast: agy/deno present? ─no─▶ exit 1 + hint (no auto-install)
 ├─ resolve AGY_BRIDGE_DIR / AGY_BRIDGE_REF
 ├─ fetch: git clone --depth1 --branch $REF ─fail─▶ curl tarball | tar --strip=1
 ├─ exists: git -C pull --ff-only ─diverged─▶ error / --force re-clone
 └─ exec bash "$DIR/install.sh" "$@" → install.sh (env, agents, service, provider)
                                      └─ verify: is-active, /healthz, /v1/models
 systemd --user absent → print deno run fallback
```
No state file; FS is store. No changes to `agy-bridge.ts`/`service.template`/`plugins/`.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `install-remote.sh` | Create | Wrapper: resolve vars, fail-fast, git/tarball fetch, idempotent update, exec; `set -euo pipefail`, no `sudo`/literal `AGY_TOKEN` |
| `README.md` | Modify | One-liner `curl -fsSL .../install-remote.sh \| bash`, `bash -s -- --with-auth`, `AGY_BRIDGE_REF`/`AGY_BRIDGE_DIR` docs, `curl|less` audit, no-sudo, prereqs + `install.sh` canonical |
| `install.sh` | Modify | Header doc note only; no logic change |

## Interfaces / Contracts

```bash
AGY_BRIDGE_DIR="${AGY_BRIDGE_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/agy-bridge}"
AGY_BRIDGE_REF="${AGY_BRIDGE_REF:-main}"   # tag|branch|commit

git clone --depth 1 --branch "$AGY_BRIDGE_REF" https://github.com/AlvaroTapia-f/agy-bridge.git "$AGY_BRIDGE_DIR"
curl -fsSL "https://github.com/AlvaroTapia-f/agy-bridge/archive/${AGY_BRIDGE_REF}.tar.gz" | tar xz --strip-components=1 -C "$AGY_BRIDGE_DIR"
git -C "$AGY_BRIDGE_DIR" pull --ff-only   # --force → rm -rf + re-clone
exec bash "$AGY_BRIDGE_DIR/install.sh" "$@"  # passthrough --with-auth/--force/-h
```
Verification via `install.sh`: `systemctl --user is-active agy-bridge` (`active`), `curl /healthz` → `{"ok":true}`, `curl -H "Bearer $AGY_TOKEN" /v1/models` → 200.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit (static) | `bash -n` pass, `wc -l <120`, no `sudo`/literal `AGY_TOKEN`, has `set -euo pipefail` | bash lint harness; RED before file exists |
| Integration | defaults/custom `DIR`/`REF`, git→tarball fallback (stub git), `pull --ff-only`, `--force` re-clone, arg passthrough, env preservation, agy/deno fail-fast, no-systemd fallback | Temp dirs, stubbed `git`/`curl`/`tar`, `bash -s --` invocations |
| E2E | `curl|bash` → active, `/healthz`/`/v1/models` 200, idempotent re-run | Manual on VM; CI deferred |

Gate: `deno check agy-bridge.ts` unchanged.

## Threat Matrix

Shell/VCS boundary → matrix from `references/threat-matrix.md` applies (no PR/commit/push).

| Boundary | Applicability | Design response | Planned RED tests |
|---|---|---|---|
| Documentation-like paths | **N/A** — explicit `install-remote.sh` via `bash` only | — | — |
| Git repository selection | **Applicable** — `git clone "$DIR"`, `git -C "$DIR"`, `tar -C "$DIR"`; `$DIR` may be relative/with `..`/spaces | Resolve to absolute (`mkdir -p` + `pwd`), quote `"$DIR"` everywhere, validate before `git -C`/`tar -C`. Safe: normalized absolute. Fail: diverged → message need `--force` | RED per selector: absolute, relative, `..`, spaces — assert resolved == realpath and command receives quoted absolute |
| Commit state | **N/A** — no `git commit` | — | — |
| Push state | **N/A** — no `git push` | — | — |
| PR commands | **N/A** — no `gh pr` | — | — |

Extra shell boundary: URL pinned to `$AGY_BRIDGE_REF`; no literal `AGY_TOKEN`. RED: `grep -q sudo` fails; `grep AGY_TOKEN` only matches `$AGY_TOKEN`.

## Migration / Rollout

No migration. Fresh fetch to `~/.local/share/agy-bridge`; `~/.config/agy-bridge/env` preserved. Rollback: `systemctl --user disable --now agy-bridge; rm ~/.config/systemd/user/agy-bridge.service; daemon-reload; rm -rf "$AGY_BRIDGE_DIR"`; optionally remove `provider.agy-bridge`/`auth.json` key.

## Open Questions

- [ ] Should `--force` re-clone backup `AGY_BRIDGE_DIR` before `rm -rf`?
- [ ] Pin one-liner to versioned branch after first tag or keep `main`?
