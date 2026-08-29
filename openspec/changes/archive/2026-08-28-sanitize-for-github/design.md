# Design: Sanitize for GitHub

## Technical Approach

Transform agy-bridge from a personal working directory into a publishable repository by: (1) extracting the hardcoded token into a systemd `EnvironmentFile`, (2) templatizing paths via env vars, (3) bundling agent configs as repo examples, (4) adding repo hygiene files, and (5) providing `install.sh` for automated setup. Maps directly to proposal approach items 1–7. Runtime code (`agy-bridge.ts`) changes are cosmetic only (default path comments); no behavioral changes.

## Architecture Decisions

| Decision | Choice | Alternatives | Rationale |
|----------|--------|-------------|-----------|
| Secret storage | `EnvironmentFile=%h/.config/agy-bridge/env` | Inline `Environment=` (current), `systemd-creds`, SOPS | systemd-native, user-scoped (`%h`), no extra tooling; `.config/` follows XDG for user config |
| Path generalization | Env vars `DENO_BIN`/`AGY_BIN` in env file; template uses `${DENO_BIN}` | Hardcoded paths (current), `which` at service start | Template stays static; detection happens once at install time; runtime resolves from env |
| Agent bundling | `agents/{name}/agent.md` in repo root | Ship as embedded strings in install.sh, separate repo | Files are inspectable, diffable, versionable; `install.sh` copies with skip-if-exists |
| LICENSE | MIT | Apache-2.0, AGPL-3.0 | Proposal specifies MIT; single-file project, no patent concerns |
| History strategy | New clean repo (no BFG) | BFG + force-push | Proposal decision: 3-commit history contains token; clean repo is simpler and guaranteed safe |
| Env file location | `~/.config/agy-bridge/env` | `~/.env`, project `.env` | XDG-compliant; systemd `%h` expansion; separate from project dir |

## Data Flow

```
install.sh
    │
    ├─ detect deno/agy ──→ which deno, which agy
    │
    ├─ generate env ──→ ~/.config/agy-bridge/env
    │    (DENO_BIN, AGY_BIN, AGY_TOKEN=<placeholder>, PORT, etc.)
    │
    ├─ copy agents ──→ ~/.gemini/config/agents/{raw,worker-ro,worker-rw}/
    │    (skip-if-exists / --force)
    │
    ├─ render service ──→ sed template vars → ~/.config/systemd/user/agy-bridge.service
    │
    └─ enable service ──→ systemctl --user daemon-reload && enable --now
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `agy-bridge.service` | Delete | Replaced by template; contains leaked token |
| `agy-bridge.service.template` | Create | Systemd unit using `EnvironmentFile=%h/.config/agy-bridge/env`; `ExecStart` uses `${DENO_BIN}` and env-driven paths |
| `.env.example` | Create | Documents all env vars with placeholder values and comments |
| `.gitignore` | Create | Ignores `.env`, `*.local`, state dirs, IDE, Deno cache |
| `LICENSE` | Create | MIT license, year 2026 |
| `agents/raw/agent.md` | Create | Copy of current `~/.gemini/config/agents/raw/agent.md` |
| `agents/worker-ro/agent.md` | Create | Copy of current `~/.gemini/config/agents/worker-ro/agent.md` |
| `agents/worker-rw/agent.md` | Create | Copy of current `~/.gemini/config/agents/worker-rw/agent.md` |
| `install.sh` | Create | Setup script: detect, generate, copy, install |
| `README.md` | Modify | Add manual install section; remove hardcoded `/usr/sbin/` paths from examples; reference `.env.example` and `install.sh` |
| `agy-bridge.ts` | Modify | L10: update run example comment to use `$DENO_BIN`; L17: default `AGY_BIN` comment. Cosmetic only |

## Interfaces / Contracts

**Service template variables** (rendered by `install.sh` via `sed` or `envsubst`):

```ini
# agy-bridge.service.template
[Service]
EnvironmentFile=%h/.config/agy-bridge/env
ExecStart=${DENO_BIN} run \
  --allow-net=127.0.0.1 \
  --allow-run=${AGY_BIN} \
  --allow-write=%h/.local/state/agy-bridge \
  --allow-read=%h/.gemini/antigravity-cli/brain \
  --allow-env \
  --unstable-no-legacy-abort \
  %h/<INSTALL_DIR>/agy-bridge.ts
```

**`.env.example` schema:**

```bash
# Required
AGY_TOKEN=your-bearer-token-here

# Binary paths (auto-detected by install.sh)
DENO_BIN=/usr/sbin/deno
AGY_BIN=/usr/sbin/agy

# Optional (defaults shown)
PORT=7421
MAX_CONCURRENT=1
PRINT_TIMEOUT=20m
AGY_TOOLS=on
AGY_TOOL_SCHEMA=full
AGY_REUSE=off
```

**`agents/` layout:**

```
agents/
├── raw/agent.md          # text-only endpoint, tools: [view_file]
├── worker-ro/agent.md    # read-only autonomous, 6 tools
└── worker-rw/agent.md    # read-write autonomous, 10 tools
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | N/A for this change | No runtime code changes to test |
| Integration | `install.sh` idempotency | Manual: run twice, verify no overwrite without `--force` |
| E2E | Full install → service start | Manual: clean dir, run `install.sh`, verify `systemctl --user status agy-bridge` and `curl healthz` |
| Verification | No leaked secrets | `grep -rn '7144bf7b' .` returns 0; `grep -rn '/usr/sbin/' --include='*.ts' --include='*.service*' .` returns 0 in tracked files |

## Threat Matrix

N/A — this change does not modify routing, shell commands, subprocesses, VCS/PR automation, executable-file classification, or process-integration boundaries in the runtime application. `install.sh` is a user-invoked setup script, not application process integration. The existing `agy-bridge.ts` subprocess spawning of `agy` is unchanged.

## Migration / Rollout

1. **Pre-publish**: Rotate the leaked token (`7144bf7b53d94a70c92af426e3d823b2cebc6fef1af52f3e`) — generate a new one, update local `~/.config/agy-bridge/env` and `opencode.json`
2. **Publish**: `git init` new repo, add all sanitized files, push to GitHub private remote
3. **Existing install**: The current local service file remains functional until the user runs `install.sh` or manually switches to the template-based approach
4. No data migration required; no feature flags needed

## Open Questions

- [ ] Where should the repo clone/install dir live? Template uses `%h/<INSTALL_DIR>` — `install.sh` needs to know (default: current working directory, or a fixed path like `~/.local/share/agy-bridge`)
- [ ] Should `install.sh` generate a random token if none is provided, or require the user to supply one?
