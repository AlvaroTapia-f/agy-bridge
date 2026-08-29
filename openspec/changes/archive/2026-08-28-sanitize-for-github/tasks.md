# Tasks: Sanitize for GitHub

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 360-410 (adds+dels) |
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
| 1 | Hygiene + secrets + agents | PR 1 | `grep -rn '7144bf7b' .` →0; `grep -rn '/usr/sbin' --include='*.ts' --include='*.service*' .` →0 | N/A — file hygiene only | Revert `.gitignore`, `.env.example`, `LICENSE`, `agy-bridge.service.template`, `agents/**` |
| 2 | Install automation + docs | PR 1 | `bash -n install.sh && deno check agy-bridge.ts` | `bash install.sh` twice (idempotency) + `systemctl --user status agy-bridge` | Revert `install.sh`, `README.md`, `agy-bridge.ts` |

## Phase 1: Foundation — Repo Hygiene & Secret Externalization

- [x] 1.1 Create `.gitignore` — ignore `.env`, state dirs, Deno cache, IDE. Spec: repo-hygiene:Ignored State. Done: `git check-ignore .env` matches.
- [x] 1.2 Create `.env.example` — all env vars from design schema with placeholders. Spec: secret-management:Secret Documentation. Done: file has `AGY_TOKEN`, `DENO_BIN`, `AGY_BIN`, `PORT` etc.
- [x] 1.3 Create `LICENSE` — MIT 2026. Spec: repo-hygiene:Project Licensing. Done: MIT text present.
- [x] 1.4 Create `agy-bridge.service.template` (`EnvironmentFile=%h/.config/agy-bridge/env`, `ExecStart=${DENO_BIN}`/`${AGY_BIN}`) and delete `agy-bridge.service`. Spec: secret-management:Token Externalization + repo-hygiene:Path Generalization. Done: no `7144bf7b` or `/usr/sbin` in template.

## Phase 2: Core Content — Agents & Path Generalization

- [x] 2.1 Bundle `agents/raw/agent.md`, `agents/worker-ro/agent.md`, `agents/worker-rw/agent.md` from `~/.gemini/config/agents/`. Spec: repo-hygiene:Agent Bundling. Done: 3 files exist in repo.
- [x] 2.2 Update `agy-bridge.ts` L10/L17 comments — replace `/usr/sbin/deno` and `/usr/sbin/agy` with `$DENO_BIN`/`$AGY_BIN`. Spec: repo-hygiene:Path Generalization. Done: `grep /usr/sbin agy-bridge.ts` →0; `deno check agy-bridge.ts` passes.
- [x] 2.3 Update `README.md` — replace hardcoded `/usr/sbin/*` examples, link `.env.example` and `install.sh`. Spec: repo-hygiene:Path Generalization. Done: `grep /usr/sbin --include='*.md'` →0.

## Phase 3: Install Automation

- [x] 3.1 Create `install.sh` — detect `deno`/`agy` via `which`, generate `~/.config/agy-bridge/env`, copy `agents/*` (skip-if-exists, `--force` overwrites), render template to `~/.config/systemd/user/agy-bridge.service`, `systemctl --user daemon-reload && enable --now`. Spec: install-automation:Installation Script Workflow. Done: `bash -n install.sh` passes.
- [x] 3.2 Update `README.md` — add Manual Install docs (env, agents, service) for non-systemd. Spec: install-automation:Manual Installation Fallback. Done: steps work without script.

## Phase 4: Verification & Publish Readiness

- [x] 4.1 Verify no leaked token — `grep -rn '7144bf7b' . --exclude-dir=.git` →0; `git log --all -p | grep -c '7144bf7b'` →0 on new repo. Spec: secret-management:Token Leak Prevention.
- [x] 4.2 Verify no hardcoded paths — `grep -rn '/usr/sbin' --include='*.ts' --include='*.service*' --include='*.md' .` →0. Spec: repo-hygiene:Path Generalization.
- [x] 4.3 Verify `.gitignore` — `touch .env && git status --ignored` shows ignored. Spec: repo-hygiene:Ignored State.
- [x] 4.4 Verify install idempotency — run `install.sh` twice without `--force` then with `--force`; check `systemctl --user status agy-bridge` + `curl http://127.0.0.1:7421/healthz`. Spec: install-automation:Idempotent and safe.
