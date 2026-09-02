# Exploration: auto-install-curl

## Current State

**agy-bridge** is a single-file Deno 2.9.5 service (`agy-bridge.ts`, 1178 lines) exposing an OpenAI-compatible HTTP API on `127.0.0.1:7421`. It spawns the official `agy` (Antigravity CLI) per request via `stream-json` NDJSON on stdin, guarded by `accessGuard` (Host `127.0.0.1:*`/`localhost:*` → 403, `Authorization: Bearer AGY_TOKEN` → 401 when `AGY_TOKEN` set).

**Current installation = local clone + `install.sh` (408 lines):**
1. Detects `deno` (`~/.deno/bin/deno`, `/usr/bin/deno`, etc.) and `agy` (`~/.local/bin/agy`, `/usr/bin/agy`, etc.) — hard-fails if missing.
2. Creates `~/.config/agy-bridge/env` from template (generates `AGY_TOKEN` via `openssl rand -hex 24` or `xxd`/`/dev/urandom`, `chmod 600`, preserves existing).
3. Copies agent profiles `raw`/`worker-ro`/`worker-rw` from `agents/*` to `~/.gemini/config/agents/` (skip unless `--force`).
4. Renders `agy-bridge.service.template` → `~/.config/systemd/user/agy-bridge.service` (substitutes `${DENO_BIN}`, `${AGY_BIN}`, `${INSTALL_DIR}`=`$SCRIPT_DIR`), then `systemctl --user daemon-reload && enable --now`.
5. Copies `plugins/agy-bridge.ts` (+ `agy-bridge-helpers.ts` if present) to `~/.config/opencode/plugins/`, then via `python3` patches `~/.config/opencode/opencode.json` (adds `provider.agy-bridge` with `npm:"@ai-sdk/openai-compatible"`, `baseURL:"http://127.0.0.1:7421/v1"`, 14 grouped `auto-ro/rw-*` models with `variants`, and `plugin` ref) and optionally `~/.local/share/opencode/auth.json` (`--with-auth` does upsert `agy-bridge:{type:"api", key:AGY_TOKEN}`, `600`, atomic write).
6. Installer is idempotent, supports `--force`/`--with-auth`, and relies on local `SCRIPT_DIR` for all source files. No network fetch, no version pinning, no tarball path.

**"Quede funcionando" today means:** `systemctl --user status agy-bridge` active, `curl -H "Authorization: Bearer $AGY_TOKEN" http://127.0.0.1:7421/v1/models` → 200, `curl http://127.0.0.1:7421/healthz` → `{"ok":true}`, and `opencode models` lists `agy-bridge/auto-*` (if opencode config exists). Verified manually; no automated smoke test in the installer beyond `systemctl enable --now`.

**Repo context:** `origin` is `git@github.com:AlvaroTapia-f/agy-bridge.git` (raw URL `https://raw.githubusercontent.com/AlvaroTapia-f/agy-bridge/main/`), no `deno.json` originally but now present for test imports, `deno.lock` pinned, `README.md` documents both Option A (`./install.sh`) and Option B (manual). Previous SDD changes (`sanitize-for-github`, `custom-opencode-provider-agy-bridge`) already archived; main specs are `install-automation`, `secret-management`, `opencode-provider`, `repo-hygiene`.

**Gap for curl one-liner:** No hosted bootstrap script exists. `install.sh` cannot be `curl | bash`'d directly because it expects sibling files (`agents/*`, `plugins/*`, `.env.example`, `agy-bridge.service.template`, `agy-bridge.ts`) on disk at `SCRIPT_DIR`. A raw `curl -fsSL .../install.sh | bash` would download only the script and fail on missing sources. The change must provide a network bootstrap path.

## Affected Areas

- `install.sh` — source of truth for all install steps; must stay the canonical idempotent local installer. Any curl path will delegate to it after fetching sources.
- `agy-bridge.service.template` — contains `${INSTALL_DIR}` placeholder; remote clone location determines this value (currently `$(pwd)` / `$SCRIPT_DIR`). New default clone dir (e.g. `~/.local/share/agy-bridge`) must be chosen and documented.
- `agents/*` and `plugins/*` — copied verbatim; no code change but their paths become network-fetched in the bootstrap case.
- `README.md` — currently documents `./install.sh` and manual steps; will need a top-banner one-liner `curl -fsSL https://raw.githubusercontent.com/AlvaroTapia-f/agy-bridge/main/install-remote.sh | bash` (or direct `install.sh`+tarball variant) plus prerequisites.
- `deno.json` / `deno.lock` — not directly affected but version pinning for Deno itself matters if the bootstrap auto-installs Deno.
- `openspec/specs/install-automation/spec.md` — defines install script workflow, idempotency, manual fallback, and provider provisioning; will need delta for remote bootstrap semantics.
- `openspec/specs/secret-management/spec.md` — token generation (`AGY_TOKEN`, `600` perms) must survive unattended curl install; no literal token in hosted script.
- `openspec/specs/opencode-provider/spec.md` — provider/Auth steps are already automated by `install.sh`; curl path inherits them, no spec change needed unless `--with-auth` becomes default for bootstrap.
- `openspec/specs/repo-hygiene/spec.md` — hygiene checks (`grep -r AGY_TOKEN`, no `.env` leak) apply to any new hosted script.
- `.gitignore` — already ignores `.env`; new installer must not create trackable secrets.
- GitHub hosting surface — `raw.githubusercontent.com` URL stability depends on branch/tag; no release artifact exists yet. A `curl | bash` installer is itself a supply-chain surface.
- Prerequisite CLIs — `agy` (Antigravity) is not publicly auto-installable today (subscription-gated, `agy models` must work pre-install). `deno`, `opencode`, `python3`, `systemd --user`, `openssl`/`xxd`, `git`/`curl`/`tar` availability varies per machine.

## Approaches

### 1. Thin bootstrap wrapper (`install-remote.sh`) that clones and delegates — RECOMMENDED

Host a small (~80-120 line) `install-remote.sh` at repo root, fetched via `curl -fsSL https://raw.githubusercontent.com/AlvaroTapia-f/agy-bridge/main/install-remote.sh | bash`. It detects prerequisites (`curl`/`git`/`tar`/`python3`/`systemd`), chooses a clone dir (`${AGY_BRIDGE_DIR:-$HOME/.local/share/agy-bridge}` or `$HOME/agy-bridge` if former not writable), does `git clone --depth 1 https://github.com/AlvaroTapia-f/agy-bridge.git <dir>` (or `curl -fsSL https://github.com/.../archive/main.tar.gz | tar xz` fallback if `git` missing), then `exec bash <dir>/install.sh "$@"` forwarding flags (`--with-auth`, `--force`). Supports `AGY_BRIDGE_REF`/`AGY_BRIDGE_VERSION` env to pin tag/branch, and `AGY_BRIDGE_DIR` override. `install.sh` remains unchanged except for documenting the new entry point.

- Pros: Minimal change, reuses battle-tested `install.sh` (408 lines) without duplication; `git` path preserves `INSTALL_DIR` semantics (service `ExecStart` points at cloned `agy-bridge.ts`); tarball fallback covers `git`-less machines; version pinning is a one-var change; easy to keep `curl | bash` surface auditable (wrapper is short, delegates to versioned file on disk); idempotency inherited.
- Cons: Requires network + `git` or `tar` at bootstrap time; two HTTP fetches (wrapper + clone/tarball); raw URL still branch-dependent unless user pins `AGY_BRIDGE_REF=vX.Y.Z`; does not auto-install `deno`/`agy` (still fails fast — correct for `agy` gating but may frustrate `deno`-less users).
- Effort: Low — new file `install-remote.sh` + `README.md` banner + `install-automation` delta spec; `install.sh` untouched aside from optional `INSTALL_DIR` default note.

Example invocation the wrapper enables:
```sh
curl -fsSL https://raw.githubusercontent.com/AlvaroTapia-f/agy-bridge/main/install-remote.sh | bash
curl -fsSL https://raw.githubusercontent.com/AlvaroTapia-f/agy-bridge/main/install-remote.sh | bash -s -- --with-auth
AGY_BRIDGE_REF=v0.2.0 curl -fsSL https://raw.githubusercontent.com/AlvaroTapia-f/agy-bridge/main/install-remote.sh | bash
```

### 2. Self-contained remote installer (single-file `curl | bash` that fetches only needed files)

Host a standalone `install.sh` that is itself curl-safe: on `curl | bash` it detects it has no sibling files and fetches each required file individually via `curl -fsSL raw.githubusercontent.com/.../agents/...`, `plugins/...`, `agy-bridge.service.template`, `agy-bridge.ts`, etc., into a temp dir, then runs the embedded install logic inline. No `git` required.

- Pros: Works with only `curl` (no `git`/`tar`); single URL is the whole installer; no clone dir to manage (can install service pointing at `~/.local/share/agy-bridge` assembled from fetches).
- Cons: Duplicates install logic across two files (wrapper vs embedded), drift risk — any change to `install.sh` must be mirrored; many sequential HTTP fetches (agents ×3 + plugins ×2 + template + service + .env.example) increase failure surface and latency; harder to pin a consistent snapshot (individual files could be from different commits if fetched at different moments); larger script (200-300 lines) harder to audit as `curl | bash`; still needs `INSTALL_DIR` decision for the service.
- Effort: Medium — new 250-line self-contained script, or refactor `install.sh` to be dual-mode (local vs remote-fetch), plus tests for fetch failures.

### 3. Distribution-aware installer with auto-install of prerequisites (Deno/opencode)

Extend Approach 1 to also auto-install missing prerequisites: if `deno` not found, run `curl -fsSL https://deno.land/install.sh | sh` (Deno's official installer) and add `~/.deno/bin` to `PATH` for the session; if `opencode` not found, optionally run its installer; if `systemd --user` absent, fall back to printing a `deno run` command for manual supervision. Wrapper attempts to make "quede funcionando" true even on a bare VM.

- Pros: True one-command promise on a clean Ubuntu/Debian/Fedora — user does not need to pre-install Deno; reduces support burden ("just run curl"); aligns with `rustup`/`deno` installer UX users expect.
- Cons: Expands scope and risk significantly: auto-installing `deno` mutates shell profile (`.bashrc`/`.zshrc`), requires re-sourcing `PATH`, may conflict with existing Deno versions; `agy` still cannot be auto-installed (private subscription) so the "fully automatic" claim is partially hollow — installer must still abort with "install agy first" guidance, which confuses the one-liner narrative; more code to maintain per distro; security surface grows (two nested `curl | bash` invocations); idempotency and rollback more complex; exceeds 400-line review budget if done in one PR.
- Effort: High — wrapper grows to 200+ lines, needs distro detection, shell-profile patching, and extensive error messaging; should be a follow-up after Approach 1 is proven.

### 4. GitHub Releases artifact + versioned install URL (tarball per tag)

Publish a `agy-bridge-vX.Y.Z.tar.gz` asset per GitHub Release (via `git archive` or `gh release upload`), and document `curl -fsSL https://github.com/AlvaroTapia-f/agy-bridge/releases/latest/download/agy-bridge.tar.gz | tar xz && ./agy-bridge/install.sh`. The bootstrap wrapper can prefer this tarball over `git clone` when `AGY_BRIDGE_REF` is a semver tag, enabling checksum verification (`sha256sum`) against a checked-in `checksums.txt`.

- Pros: Immutable, version-pinned installs; `latest` redirect gives stable one-liner; checksum verification mitigates `curl | bash` supply-chain concern; no `git` needed; aligns with standard release engineering.
- Cons: Requires release automation (GitHub Actions workflow to build tarball on tag push) — new CI surface not currently present; `releases/latest` is eventually consistent; users on `main` still need raw path; adds maintenance (cutting releases, signing checksums).
- Effort: Medium — new workflow `.github/workflows/release.yml` + wrapper tarball branch + `README` version table; can be incremental after Approach 1.

## Recommendation

**Approach 1 (thin bootstrap wrapper) as the implementation for this change, with Approach 4 as a fast follow-up.**

Rationale: Approach 1 reuses the existing, tested `install.sh` without duplication, keeps the `curl | bash` payload small and auditable, and satisfies the user's literal request — "cualquier persona puede ejecutar un comando en su terminal y que automáticamente se instale el bridge y quede funcionando" — under the real constraint that `agy` (Antigravity CLI) cannot be auto-installed (subscription-gated) and `deno` is a soft prerequisite. The wrapper's job is to make the *bridge* install automatic; prerequisites remain fail-fast with actionable messages, which is the correct anti-baneo posture (never fake `agy` auth). Approach 2 duplicates logic and risks drift; Approach 3 overreaches on day one and blows the 400-line budget; Approach 4 is valuable but requires CI that should not block the initial one-liner.

**Proposed file layout for this change:**
- `install-remote.sh` (new, ~100 lines, `bash`, `set -euo pipefail`) at repo root — the curl entry point.
- `README.md` — add top-section one-liner banner with `curl -fsSL .../install-remote.sh | bash` and `-s -- --with-auth` variant, plus prerequisites box (deno, agy authenticated, systemd, python3).
- `openspec/specs/install-automation/spec.md` delta — new requirement "Remote bootstrap via curl".
- No change to `agy-bridge.ts`, `agy-bridge.service.template`, `plugins/*`, or `deno.json`.

**Bootstrapping semantics to specify in proposal:**
- Clone dir default `~/.local/share/agy-bridge` (XDG data home, not `~/agy-bridge` which pollutes `$HOME`), override via `AGY_BRIDGE_DIR`.
- Ref pinning via `AGY_BRIDGE_REF` (branch/tag/commit, default `main`), passed as `git clone --branch $REF --depth 1` or tarball URL interpolation.
- Delegation: `exec bash "$CLONE_DIR/install.sh" "$@"` so `--with-auth`/`--force` flow through; wrapper itself supports `-h/--help` passthrough.
- `git`-less fallback: `curl -fsSL https://github.com/AlvaroTapia-f/agy-bridge/archive/${REF}.tar.gz | tar xz --strip-components=1 -C "$CLONE_DIR"`.
- Verification after install: wrapper runs `systemctl --user is-active agy-bridge` and `curl -fsS http://127.0.0.1:7421/healthz` and prints `opencode models | grep agy-bridge` hint.
- Security note in README: show `curl -fsSL <url> | bash` with `-fsSL` flags, recommend inspecting `install-remote.sh` first (`curl -fsSL <url> | less`), and note no `sudo` is used (user service only).

## Risks

- **Supply-chain (`curl | bash`) trust:** Raw `curl | bash` executes remote code without verification. Mitigate by keeping wrapper small and auditable, pinning via `AGY_BRIDGE_REF` tag, documenting `curl ... | less` inspection step, and adding checksum verification in Approach 4 follow-up. Never pipe through `sudo`.
- **`agy` prerequisite cannot be automated:** Antigravity CLI requires a Google subscription and interactive `agy` login; the wrapper MUST fail fast with `agy not found` / `agy models failed` guidance, not attempt to install or authenticate. Messaging must be explicit in Spanish and English so "quede funcionando" is not mis-promised on machines without `agy`.
- **`deno` missing on clean machines:** Today `install.sh` hard-fails if `deno` absent. For curl UX, decide whether to also fail fast (simplest, keeps scope low) or auto-install Deno (Approach 3). Recommendation is fail fast now, document `curl -fsSL https://deno.land/install.sh | sh` prerequisite, defer auto-install to follow-up.
- **No `systemd --user` (WSL1, containers, macOS):** `systemctl --user` will fail; wrapper must detect absence and print Option B manual `deno run` command instead of aborting. Service `Restart=on-failure` not applicable there.
- **`opencode` absent:** `install.sh` already skips provider setup if `~/.config/opencode/opencode.json` missing and prints a hint; wrapper should preserve this and not error. Document that `opencode` is optional for bridge operation.
- **`python3` absent:** Provider/auth patching requires `python3`; installer currently warns and skips. Curl path inherits same behavior but should surface the warning prominently so users know to install `python3` for `auto-ro/rw` models.
- **Clone dir collision / idempotency:** Re-running the curl one-liner must not corrupt an existing clone. Wrapper should `git -C "$CLONE_DIR" pull --ff-only` if git dir exists, or `rm -rf` + re-clone only on `--force`, never delete user's existing `~/.config/agy-bridge/env` (install.sh already preserves it).
- **Port `7421` conflict:** If port is occupied, `systemctl --user status` will show failed. Wrapper should `curl --fail http://127.0.0.1:7421/healthz` and on failure suggest `PORT=...` in `~/.config/agy-bridge/env` + `systemctl --user restart`.
- **Token generation entropy:** Wrapper delegates to `install.sh`'s `openssl`/`xxd`/`/dev/urandom` chain; on minimal containers lacking all three, token falls back to weak `token_$(date +%s)_$RANDOM`. Acceptable for local loopback but should be noted; recommend `openssl` prerequisite.
- **Idempotent `AGY_TOKEN` handling via pipe:** When run as `curl ... | bash`, `install.sh`'s `ENV_FILE` preservation prevents token rotation on re-run — correct. `--with-auth` via `bash -s -- --with-auth` must be documented explicitly because `curl | bash` without `-s --` drops flags.
- **Raw URL branch drift:** `main` moves; users who installed via `main` at T0 may get different code at T1. Mitigate by encouraging `AGY_BRIDGE_REF=vX.Y.Z` for reproducible installs and documenting `git -C $DIR log --oneline -1` to verify.

## Ready for Proposal

Yes — ready for `sdd-propose`. The change is scoped to a new `install-remote.sh` bootstrap + `README.md` banner + `install-automation` delta spec, with no `agy-bridge.ts` or Deno permission changes. Proposal should define the wrapper contract (clone dir, `AGY_BRIDGE_REF` pinning, `git`/tarball fallback, delegation to `install.sh`, verification steps), include rollback (remove clone dir + `systemctl --user disable --now` + provider/auth cleanup already documented), and capture open questions for the proposal question round: (1) default clone dir (`~/.local/share/agy-bridge` vs `~/agy-bridge`), (2) fail fast vs auto-install Deno, (3) default `--with-auth` for curl path vs explicit flag, (4) whether to publish versioned tarball in this change or defer to follow-up.

