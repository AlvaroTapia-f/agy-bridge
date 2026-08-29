# Proposal: Sanitize for GitHub

## Intent

agy-bridge cannot be published to GitHub (even privately) because the repo contains a hardcoded bearer token in `agy-bridge.service:L29`, has no `.gitignore` (risks leaking state/IDE files), no `.env.example`, hardcoded absolute paths (`/usr/sbin/deno`, `/usr/sbin/agy`), an undocumented dependency on `~/.gemini/config/agents/{raw,worker-ro,worker-rw}/agent.md`, no LICENSE, and no install automation. Publishing the existing 3-commit history would expose the token permanently.

## Scope

### In Scope
- Remove hardcoded token from service file; templatize as `agy-bridge.service.template` reading from env/file
- Create `.gitignore` (state dir, IDE, Deno cache, `.env`)
- Create `.env.example` with all env vars documented
- Generalize hardcoded `/usr/sbin/deno` and `/usr/sbin/agy` paths to env-driven
- Bundle example agent configs (`agents/raw/agent.md`, `agents/worker-ro/agent.md`, `agents/worker-rw/agent.md`)
- Add LICENSE (MIT)
- Create `install.sh` automated setup script + manual install docs in README
- Sanitization verification checklist
- Publish as NEW repo (no old history; rotate/invalidate leaked token)

### Out of Scope
- Rewriting git history (BFG) — decision: clean repo instead
- Open-source community features (CONTRIBUTING, CoC, issue templates) — deferred until public
- Tests or TDD baseline — separate change
- Refactoring `agy-bridge.ts` internals
- CI/CD pipeline
- Multi-user or multi-account support

## Capabilities

### New Capabilities
- `secret-management`: env-based token config with `.env.example` and service template
- `install-automation`: `install.sh` script + manual install docs for setup on any Linux box

### Modified Capabilities
None (no existing specs)

## Approach

1. **Secret extraction**: Replace `AGY_TOKEN=<value>` in service with `EnvironmentFile=%h/.config/agy-bridge/env`; create `.env.example`
2. **Path generalization**: Service template uses `$DENO_BIN` / `$AGY_BIN` with sane defaults from `install.sh` detection
3. **Agent bundling**: Ship example agent.md files under `agents/` in repo; `install.sh` copies to `~/.gemini/config/agents/` if not present
4. **Repo hygiene**: `.gitignore`, LICENSE (MIT), sanitized README
5. **Install script**: `install.sh` — detect deno/agy paths, generate `.env`, install service, copy agents, enable systemd unit
6. **Verification**: Pre-publish checklist script or manual grep pass for secrets/absolute paths
7. **Publish**: Init new repo, push to GitHub private remote

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `agy-bridge.service` | Modified→Template | Remove token, generalize paths → `agy-bridge.service.template` |
| `.gitignore` | New | Ignore `.env`, state, IDE, Deno cache |
| `.env.example` | New | Document all env vars with placeholder values |
| `agents/` | New | Bundled example agent configs (raw, worker-ro, worker-rw) |
| `LICENSE` | New | MIT license file |
| `install.sh` | New | Automated install/setup script |
| `README.md` | Modified | Add manual install docs, remove hardcoded paths from examples |
| `agy-bridge.ts` | Modified | Update default path comment (L10, L17) |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Token already in git history | High | New clean repo; rotate token immediately |
| RCE if port exposed beyond localhost | Med | README warning; service binds 127.0.0.1; install.sh validates |
| Google ban if instance shared | Med | README invariants; MAX_CONCURRENT=1 enforced |
| Agent configs diverge from shipped examples | Low | Version-stamp; document as reference configs |
| install.sh breaks on non-systemd distros | Low | Manual install docs as fallback; detect systemd |

## Rollback Plan

New clean repo publish: delete the GitHub remote and clone. The original working directory `~/.zcode/workspace/default/agy-bridge` with its current service file stays untouched. If the new token breaks, revert to old token in the local service file.

## Dependencies

- GitHub CLI or web UI for private repo creation
- New bearer token generation (rotate old one)
- Access to `~/.gemini/config/agents/` to snapshot current agent configs

## Success Criteria

- [ ] `grep -rn 'AGY_TOKEN=7144' .` returns zero matches in the new repo
- [ ] `git log --all -p | grep -c '7144bf7b'` returns 0 in the new repo
- [ ] `.gitignore` prevents `.env` and state dirs from being tracked
- [ ] `install.sh` completes on a clean machine with deno+agy installed
- [ ] Manual install docs in README are sufficient to set up without the script
- [ ] Service starts successfully after install with env-based token
- [ ] No absolute `/usr/sbin/` paths remain in tracked files (all env-driven)
