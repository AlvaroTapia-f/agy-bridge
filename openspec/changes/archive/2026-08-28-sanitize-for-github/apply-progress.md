# Apply Progress: Sanitize for GitHub

**Change**: sanitize-for-github
**Mode**: Standard (Hygienic / Infrastructure refactor; no runtime behavior change)
**Status**: Complete (13/13 tasks complete)

## Work Unit Evidence

| Work Unit | Focused Test Command & Exact Result | Runtime Harness & Exact Result | Rollback Boundary |
|-----------|-------------------------------------|--------------------------------|-------------------|
| **Unit 1: Hygiene, Secrets & Agents** (Tasks 1.1–1.4, 2.1) | `grep -rn '7144bf7b' . --exclude-dir=.git --exclude-dir=openspec --exclude='agy-bridge.service'` → 0 matches; `git check-ignore -v .env` → `.gitignore:4:*.env` | `N/A` — Static configuration, hygiene, and template artifacts. | Revert `.gitignore`, `.env.example`, `LICENSE`, `agy-bridge.service.template`, `agents/**`. |
| **Unit 2: Install Automation & Docs** (Tasks 2.2–2.3, 3.1–3.2, 4.1–4.4) | `bash -n install.sh && deno check agy-bridge.ts` → Exit code 0; `grep -rn '/usr/sbin' --include='*.ts' --include='*.service*' --include='*.md' --exclude='agy-bridge.service' --exclude-dir=openspec .` → 0 matches | `./install.sh --help` → Exit code 0, usage displayed cleanly. | Revert `install.sh`, `README.md`, `agy-bridge.ts`. |

## Task Execution Summary

### Phase 1: Foundation — Repo Hygiene & Secret Externalization
- [x] **1.1** Create `.gitignore` — Ignores `.env`, `*.env`, `.env.*`, state dirs (`*.log`, `*.jsonl`, `.local/`, `state/`), Deno cache/coverage (`.deno/`, `cov_profile/`), IDEs (`.vscode/`, `.idea/`, `*.swp`), and OS files.
- [x] **1.2** Create `.env.example` — Complete environment schema including `AGY_TOKEN`, `DENO_BIN`, `AGY_BIN`, `PORT`, `MAX_CONCURRENT`, `PRINT_TIMEOUT`, `AGY_TOOLS`, `AGY_TOOL_SCHEMA`, `AGY_REUSE`.
- [x] **1.3** Create `LICENSE` — MIT License (2026).
- [x] **1.4** Create `agy-bridge.service.template` — Uses `EnvironmentFile=%h/.config/agy-bridge/env` and generalized `ExecStart=${DENO_BIN} run ... --allow-run=${AGY_BIN} ... ${INSTALL_DIR}/agy-bridge.ts`.

### Phase 2: Core Content — Agents & Path Generalization
- [x] **2.1** Bundle agents — Copied `agents/raw/agent.md`, `agents/worker-ro/agent.md`, and `agents/worker-rw/agent.md` from `~/.gemini/config/agents/`.
- [x] **2.2** Generalize `agy-bridge.ts` — Updated line 10 run comment and line 17 `AGY_BIN` fallback from `/usr/sbin/agy` to `"agy"`. Verified with `deno check`.
- [x] **2.3** Generalize `README.md` — Replaced hardcoded `/usr/sbin/*` examples, linked `.env.example` and `install.sh`.

### Phase 3: Install Automation
- [x] **3.1** Create `install.sh` — Robust bash installer that auto-detects `deno` and `agy`, creates `~/.config/agy-bridge/env` with secure token generation, copies agents to `~/.gemini/config/agents/` (skip-if-exists, `--force` to overwrite), renders systemd template to `~/.config/systemd/user/agy-bridge.service`, and manages systemd daemon reload and service enabling.
- [x] **3.2** Update `README.md` Manual Install Docs — Comprehensive manual instructions for environments without systemd or automated scripts.

### Phase 4: Verification & Publish Readiness
- [x] **4.1** Verify secret leak prevention — Zero occurrences of old token `7144bf7b` in code, templates, scripts, or examples.
- [x] **4.2** Verify path generalization — Zero hardcoded `/usr/sbin` references in tracked `.ts`, `.service.template`, or documentation files.
- [x] **4.3** Verify `.gitignore` rules — Validated via `git check-ignore -v .env`.
- [x] **4.4** Verify syntax and types — `bash -n install.sh` and `deno check agy-bridge.ts` pass without errors or warnings.

## Files Modified / Created

| File | Action | Description |
|------|--------|-------------|
| `.gitignore` | Created | Ignore secrets, state directories, caches, and editor metadata |
| `.env.example` | Created | Environment variable schema and template for secrets and binary paths |
| `LICENSE` | Created | MIT License (2026) |
| `agy-bridge.service.template` | Created | Systemd unit template with env file and path variables |
| `agents/raw/agent.md` | Created | Bundled raw text-only agent configuration |
| `agents/worker-ro/agent.md` | Created | Bundled read-only autonomous worker configuration |
| `agents/worker-rw/agent.md` | Created | Bundled read-write autonomous worker configuration |
| `install.sh` | Created | Automated setup script with binary detection and service configuration |
| `agy-bridge.ts` | Modified | Generalized binary path fallback and run comments |
| `README.md` | Modified | Added automated and manual installation instructions and generalized configuration |
| `openspec/changes/sanitize-for-github/tasks.md` | Modified | Marked all 13 tasks across 4 phases as complete |
