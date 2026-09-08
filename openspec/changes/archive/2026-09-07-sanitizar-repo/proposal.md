# Proposal: Repository Sanitation

## Intent

Eliminate triple model-logic duplication, installer overreach, stale 7/14 claims, and 44 lint findings while preserving the 56-test/clean-typecheck baseline. No behavior change without characterization tests.

## Scope

### In Scope
- Scoped lint/format gate: `deno.json` excludes for `openspec/changes/archive/**` (S6); zero lint findings on active code
- Dead code/test cleanup: unused imports, empty catches, `any` stubs, stale wording
- Plugin becomes a generated `deno bundle` artifact from `plugins/agy-bridge-helpers.ts` (S3/S4), gated by an installed-plugin smoke test first (S1)
- Installer: hard Deno prerequisite (`deno --version` + PATH check, fail fast, S5); inline Python model generator removed; any retained emergency path is grouped-ids-only with explicit failure semantics
- Active specs, README, installers reconciled to the code-verified 8-base/16-id contract
- Characterization tests for HTTP routing, SSE, process lifecycle, auth/host guard before seam changes

### Out of Scope
- Rewriting `openspec/changes/archive/**` (immutable by local convention)
- Feature changes beyond installer policy; TUI patch redesign; mass-formatting archives

## Capabilities

### New Capabilities
- `plugin-packaging`: generated self-contained plugin bundle plus installed-plugin smoke test

### Modified Capabilities
- `opencode-provider`: embedded 4-pass/drift-guard requirements replaced by bundle generation; stale 7-base scenario corrected to 8
- `model-sync`: Deno/Python parity clause replaced by single Deno source
- `install-automation`: Python mirror requirement replaced by hard Deno prerequisite, fail-fast
- `repo-hygiene`: added scoped lint/format gate; installer wording under documentation accuracy

## Approach

Six incremental slices (exploration Approach 1): (1) hygiene scoping, (2) dead code cleanup, (3) bundle consolidation behind smoke test, (4) installer Deno hardening + Python removal, (5) 8/16 reconciliation, (6) service characterization. Each slice stays under the 400-line review budget and reverts independently.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `plugins/` | Modified | Bundle-generated plugin; helpers sole model source |
| `install.sh` | Modified | Deno prerequisite; Python generator removed |
| `agy-bridge.ts`, `tests/` | Modified | Characterization tests; cleanup; coverage |
| `scripts/sync-models.ts`, `stubs/` | Modified | Dead code and typing cleanup |
| `README.md`, `openspec/specs/`, `deno.json` | Modified | 8/16 reconciliation; lint scoping |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Installed plugin rejects bundle | Med | Smoke test first; keep old copy until green |
| Deno-less install breaks | Med | Fail-fast message; README manual path |
| Untested HTTP/SSE regresses | Med | Characterization tests precede changes |
| Bundle drifts from helpers | Low | Parity check in `deno test` |

## Rollback Plan

One chained PR per slice; revert slice-wise. Plugin: restore prior plugin commit, re-run smoke test. Installer: restore prior `install.sh`. Every merge gates on `deno test` ≥56 and clean `deno check`.

## Dependencies

- `deno bundle` (Deno 2.9.5) for plugin generation (S3/S4)
- Live `opencode` instance for the smoke test

## Success Criteria

- [ ] Zero lint findings on active code; fmt clean outside archives
- [ ] Single model source; generated plugin passes smoke test
- [ ] Installer enforces Deno; no inline Python generator
- [ ] Active specs/README state verified 8 bases/16 ids
- [ ] `deno test` ≥56 passing with characterization tests
- [ ] `openspec/changes/archive/**` untouched
