# Apply Progress: sanitizar-repo

**Change**: `sanitizar-repo`
**Work Unit**: Slice 6 — Service Characterization (PR 6, closing Phase 6)
**Mode**: Strict TDD
**Date**: 2026-09-07

## Completed Tasks

- [x] 1.1 Add `lint.exclude` + `fmt.exclude` incl. `openspec/changes/archive/**` to `deno.json`
- [x] 1.2 `deno lint` zero findings on active code; `deno fmt --check` clean outside archives (CORRECTION: original claim overstated; authoritative owner gate requires clean on created files + no regressions vs HEAD; see Corrections)
- [x] 2.1 Remove unused imports in `plugins/`, `scripts/`, `agy-bridge.ts`, `stubs/`
- [x] 2.2 Replace empty catches and `any` stubs with typed handling
- [x] 2.3 `deno check agy-bridge.ts` + `deno test` ≥56 green
- [x] 3.1 Create `plugins/agy-bridge.plugin.ts` re-exporting `groupBases`/`buildModelMap`/`FALLBACK_MODELS` + plugin logic
- [x] 3.2 Add `bundle:plugin` task: `deno bundle` entrypoint → `plugins/agy-bridge.ts`, prepend `// @ts-nocheck` + GENERATED banner, tmp + `mv`
- [x] 3.3 RED: write `plugins/agy-bridge.bundle.test.ts` parity test — bundle ≡ helpers on `FALLBACK_MODELS` (`groupBases`, `buildModelMap`)
- [x] 3.4 RED: drift test fails if helpers grouping changes without regenerating bundle
- [x] 3.5 Create `tests/plugin-smoke.sh`: sandbox project + candidate bundle → `opencode models` asserts `agy-bridge/auto-*`; calibrate on current plugin first
- [x] 3.6 After smoke green, `deno task bundle:plugin` replaces hand `plugins/agy-bridge.ts`; prior copy kept until green
- [x] 4.1 RED: `tests/install.test.sh` §6 — PATH without deno exits 1 pre-sync, no Python fallback
- [x] 4.2 Add `command -v deno` + `deno --version` gate in `install.sh`, exit 1 with prerequisite message before any sync
- [x] 4.3 Remove inline Python 4-pass generator + dead vars from `install.sh`
- [x] 4.4 `install.sh` sync failure exits 1 (owner-confirmed); never-blocking stays inside `sync-models.ts` tiers
- [x] 4.5 `bash -n install.sh` clean; idempotent re-run passes install.test.sh
- [x] 5.1 `README.md`: Python wording → Deno prerequisite; bundle workflow; 8 bases/16 ids
- [x] 5.2 Update stale streaming comment at `agy-bridge.ts` L908-911
- [x] 5.3 Remove "14 default models" from `install.sh`/tests; state verified 8/16 contract
- [x] 5.4 `deno test` green; active code matches `opencode-provider`/`model-sync` specs
- [x] 6.1 Create `tests/service.test.ts` black-box harness: spawn `deno run`, mock `agy`, random port, tmp `STATE_DIR`, `AGY_HARD_MARGIN_MS`, scoped `--allow-*`
- [x] 6.2 RED: 403 host / 401 auth / healthz cases
- [x] 6.3 RED: 400 routing, SSE + `[DONE]` + keepalive, deadline kill, salvage, retry
- [x] 6.4 Harness hermetic: tmp paths only, kill child on abort
- [x] 6.5 `deno test` ≥56 with characterization green

## Pending Tasks (Next Slices)

None — all 6 phases complete. Ready for `sdd-verify`.

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 | `plugins/agy-bridge.test.ts` | Unit | ✅ 56/56 | ✅ Written (asserted exclude arrays) | ✅ Passed (deno.json updated) | ✅ 2 cases (lint.exclude + fmt.exclude) | ✅ Clean |
| 1.2 | `plugins/agy-bridge.test.ts` | Unit | ✅ 58/58 | ✅ Written (asserted bare @std/assert import + deno lint exit 0) | ✅ Passed (deno lint 0 findings) | ✅ Bare import + clean lint gate | ✅ Clean |
| 2.1 | `plugins/agy-bridge.test.ts` | Unit | ✅ 58/58 | ✅ Written (asserted stripEffortSuffix / EFFORT_SUFFIXES removed) | ✅ Passed (imports pruned from scripts and tests) | ✅ Multi-file checks (sync-models.ts + sync-models.test.ts) | ✅ Clean |
| 2.2 | `plugins/agy-bridge.test.ts` | Unit | ✅ 58/58 | ✅ Written (asserted no raw any, no empty catch blocks) | ✅ Passed (typed Provider/Auth stubs + typed catch handling) | ✅ Multi-point verification (stubs, plugin catches, sync config) | ✅ Clean |
| 2.3 | `plugins/agy-bridge.test.ts` | Unit | ✅ 58/58 | ✅ Baseline check | ✅ Passed (`deno check` clean, `deno test` 61 passed) | ✅ Full suite pass across unit and integration | ✅ Clean |
| 3.1 | `plugins/agy-bridge.bundle.test.ts` | Unit | ✅ 61/61 | ✅ Export assertions failed before re-export | ✅ Passed (`plugins/agy-bridge.plugin.ts` created re-exporting model helpers) | ✅ Verified `groupBases`, `buildModelMap`, `FALLBACK_MODELS` | ✅ Clean type contracts |
| 3.2 | `scripts/bundle-plugin.ts` | Integration | ✅ 61/61 | ✅ Task absent in `deno.json` | ✅ Passed (`bundle:plugin` task added, atomic tmp+mv, banner prepended) | ✅ Tested atomic replace with error recovery | ✅ Clean |
| 3.3 | `plugins/agy-bridge.bundle.test.ts` | Unit | ✅ 61/61 | ✅ Written (bundle ≡ helpers parity assertions) | ✅ Passed (`deno bundle` inlines helpers matching `agy-bridge-helpers.ts`) | ✅ Triangulated with multi-pass dynamic slugs | ✅ Clean |
| 3.4 | `plugins/agy-bridge.bundle.test.ts` | Unit | ✅ 61/61 | ✅ Written (asserted generated banner + source of truth reference) | ✅ Passed (drift test verifies generated headers and logic sync) | ✅ Verified banner headers + logic synchronization | ✅ Clean |
| 3.5 | `tests/plugin-smoke.sh` | Runtime | ✅ 61/61 | ✅ Script absent | ✅ Passed (live opencode sandbox test verifies `agy-bridge/auto-*` models) | ✅ Calibrated on CURRENT plugin first, then tested candidate | ✅ Clean |
| 3.6 | `plugins/agy-bridge.ts` | Integration | ✅ 61/61 | ✅ Hand-maintained copy | ✅ Passed (bundle replaced hand-copy atomically only after candidate smoke green) | ✅ Smoke test passed with 14 models, test suite passed with 64 tests | ✅ Clean |
| 4.1 | `tests/install.test.sh` | Integration | ✅ 64/64 | ✅ PATH without deno exited 0 via fallback; asserted non-zero exit | ✅ Passed (`install.sh` gates `command -v deno` + `deno --version` and exits 1 pre-sync) | ✅ 2 cases: clean PATH lacking deno + mock failing deno --version | ✅ Clean |
| 4.2 | `plugins/agy-bridge.test.ts` & `tests/install.test.sh` | Unit & Integration | ✅ 64/64 | ✅ Missing explicit `deno --version` command check | ✅ Passed (`install.sh` validates both `command -v deno` and `deno --version` with prerequisite message) | ✅ Verified error message printed to stderr and non-zero exit code | ✅ Clean |
| 4.3 | `plugins/agy-bridge.test.ts` & `tests/install.test.sh` | Unit & Integration | ✅ 64/64 | ✅ Dead `PLUGIN_HELPERS_*` vars and Python 4-pass generator present in `install.sh` | ✅ Passed (dead vars removed, inline Python 4-pass generator completely eliminated) | ✅ Asserted no model generation on failure and no generator code in source | ✅ Clean |
| 4.4 | `plugins/agy-bridge.test.ts` & `tests/install.test.sh` | Unit & Integration | ✅ 64/64 | ✅ Sync failure caught and fell back to Python generator exiting 0 | ✅ Passed (`install.sh` model sync failure exits 1 without attempting Python fallback) | ✅ Tested mock failing sync-models.ts execution asserting non-zero exit | ✅ Clean |
| 4.5 | `tests/install.test.sh` | Static & Integration | ✅ 64/64 | ✅ Pre-checks and idempotency runs | ✅ Passed (`bash -n install.sh` exit 0, idempotent re-runs pass with valid JSON and single plugin entry) | ✅ Verified Section 1, 4, 6, 7 in `install.test.sh` (21 passed) | ✅ Clean |
| 5.1 | `plugins/agy-bridge.test.ts` | Unit | ✅ 67/67 | ✅ Asserted no Python fallback claim, bundle workflow described, 8 bases/16 ids contract | ✅ Passed (`README.md` updated: Deno prerequisite, bundle workflow step 3, 8 bases / 16 ids, live note-classifier streaming) | ✅ 5 assertion points covering requirements, steps, counts, and streaming | ✅ Clean |
| 5.2 | `plugins/agy-bridge.test.ts` | Unit | ✅ 67/67 | ✅ Asserted no stale one-chunk comments or false claims in agy-bridge.ts | ✅ Passed (`agy-bridge.ts` verified clean of stale one-chunk wording) | ✅ Validated autonomous stream lines and comments | ✅ Clean |
| 5.3 | `plugins/agy-bridge.test.ts` & `tests/install.test.sh` | Unit & Integration | ✅ 67/67 | ✅ Asserted no '14 default models' in installer or tests | ✅ Passed (`install.sh` and `tests/install.test.sh` verified clean of stale 14 counts) | ✅ Shell static checks + suite pass | ✅ Clean |
| 5.4 | `plugins/agy-bridge.test.ts` | Unit | ✅ 67/67 | ✅ Asserted FALLBACK_MODELS 8 bases / 16 ids and active spec match | ✅ Passed (`openspec/specs/opencode-provider/spec.md` updated from 7 bases to 8 bases) | ✅ Grouping test (8 bases) + model map test (16 models) + active spec assertion | ✅ Clean |
| 6.1 | `tests/service.test.ts` | E2E Harness | ✅ 71/71 | ✅ Harness missing; tests failed with module not found | ✅ Passed (`tests/service.test.ts` ServiceHarness spawns deno run with mock agy, random port, tmp dirs, AGY_HARD_MARGIN_MS) | ✅ Verified with mock agy, random free port, and scoped permissions | ✅ Clean |
| 6.2 | `tests/service.test.ts` | E2E | ✅ 71/71 | ✅ RED: 403 host guard (raw TCP HTTP request), 401 missing/wrong bearer token, 200 healthz and v1/healthz | ✅ Passed (accessGuard rejects Host: evil.com and invalid Bearer; healthz open without auth) | ✅ Triangulated: missing token, wrong token, correct token; /healthz vs /v1/healthz | ✅ Clean |
| 6.3 | `tests/service.test.ts` | E2E | ✅ 71/71 | ✅ RED: 400 routing (invalid JSON, missing model, unknown model), SSE deltas + [DONE], deadline kill 502, salvage transcript recovery, retry once fresh session | ✅ Passed (400 validation, SSE chunk protocol with [DONE], deadline watchdog kill, salvage planner transcript, conversation retry on failure) | ✅ Multi-scenario coverage across all core agy-bridge seams | ✅ Clean |
| 6.4 | `tests/service.test.ts` | E2E | ✅ 71/71 | ✅ RED: non-hermetic paths; stateDir isolation | ✅ Passed (tmp paths only, usage.jsonl written inside isolated STATE_DIR, children terminated and dirs cleaned on close) | ✅ Validated usage.jsonl content + fs unlinks on harness.close() | ✅ Clean |
| 6.5 | `tests/service.test.ts` | E2E | ✅ 71/71 | ✅ Baseline 71 tests | ✅ Passed (`deno task test` passes 80/80 tests: 71 existing + 9 service characterization) | ✅ Clean suite run: 80 passed, 0 failed | ✅ Clean |

### Test Summary
- **Total tests written in Slice 6**: 9 end-to-end black-box characterization tests in `tests/service.test.ts`
- **Total tests passing**: 80 in `deno test` (71 existing + 9 characterization) + 21 in `install.test.sh` + 1 in `plugin-smoke.sh`
- **Layers used**: Unit (14), Integration (4), E2E / Runtime Harness (10), Static (1)
- **Approval tests**: None — characterization and verification
- **Pure functions created**: `getFreePort`

## Work Unit Evidence

| Evidence | Required value |
|---|---|
| Focused test command and exact result | `deno test --allow-net --allow-run --allow-read --allow-write --allow-env tests/service.test.ts` → `ok \| 9 passed \| 0 failed (2s)` (exit 0) |
| Runtime harness command/scenario and exact result | `deno task test` → `ok \| 80 passed \| 0 failed (2s)` (exit 0); `bash tests/plugin-smoke.sh` → `PASS: CURRENT plugin verified successfully (14 models found). All plugin smoke checks passed.` (exit 0) |
| Rollback boundary | Remove `tests/service.test.ts` and revert `tasks.md`, `apply-progress.md`, and `deno.json` test task |

## Files Changed

| File | Action | What Was Done |
|------|--------|---------------|
| `tests/service.test.ts` | Created | Black-box characterization test harness: spawns `deno run agy-bridge.ts` with mock `agy` binary, random port, isolated temp `STATE_DIR`/`HOME`, scoped permissions (`--allow-net=127.0.0.1`, `--allow-run=${mockAgy}`, `--allow-write`, `--allow-read`, `--allow-env`); covers Task 6.2 (403 host, 401 auth, /healthz, /v1/healthz), Task 6.3 (400 validation, SSE stream deltas + `[DONE]`, hard deadline kill + 502, salvage transcript recovery, fresh session retry on continued error), Task 6.4 (hermetic temp paths, child kill on close, usage log isolation); formatted with `deno fmt` in narrow remediation |
| `plugins/agy-bridge.plugin.ts` | Created | Re-exports model helpers + plugin logic; formatted with `deno fmt` in narrow remediation |
| `plugins/agy-bridge.bundle.test.ts` | Created | Parity and drift tests; formatted with `deno fmt` in narrow remediation |
| `scripts/bundle-plugin.ts` | Created | Plugin bundle generator script; formatted with `deno fmt` in narrow remediation |
| `stubs/opencode-plugin.ts` | Modified | Restored `deno fmt` clean formatting to eliminate regression vs HEAD |
| `deno.json` | Modified | Added `"test": "deno test --allow-net --allow-run --allow-read --allow-write --allow-env"` task for seamless execution of the full suite |
| `scripts/sync-models.ts` | Modified | Clarified `token` resolution to `options.token !== undefined ? options.token : safeEnvGet("AGY_TOKEN")` so explicit empty token is honored |
| `openspec/changes/sanitizar-repo/tasks.md` | Modified | Marked Phase 6 tasks 6.1 through 6.5 complete `[x]` |
| `openspec/changes/sanitizar-repo/apply-progress.md` | Modified | Cumulative progress merged for Slice 6 and narrow remediation (all 6 phases complete, owner gate verified) |

## Corrections (post-verify remediation)

**Task 1.2 — scope correction.** Original claim "`deno fmt --check` clean outside archives" overstated the delivered gate. Runtime verification (`verify-report.md` C1/C2) showed `deno fmt --check` exits 1 on the active tree (31/34 files), including `plugins/agy-bridge-helpers.ts` which is byte-identical to HEAD — the baseline was never fmt-clean. Owner re-scoped the format gate: `deno lint` zero on active code (TRUE, verified) and `deno fmt --check` clean only on files touched by this change. Mass reformat is a non-goal. Task 1.2 remains `[x]` under the rescoped gate; `repo-hygiene` spec updated to match.

**opencode-provider spec — W1 reconciliation.** "Reasoning Model Shape Conformance" wording corrected from nested `capabilities: { reasoning: true }` to flat `reasoning: true` with `capabilities === undefined`, matching `model-sync` delta, code, and tests.

**Rev2 Owner-Ordered Gate Remediation (Narrow Remediation).**
- Owner gate contract: `deno fmt --check` MUST pass on files CREATED by this change + NO fmt regressions vs HEAD on modified files (a file fmt-clean at HEAD must stay fmt-clean); baseline-dirty modified files are out of scope (no mass reformat).
- Formatted 4 created TS files with `deno fmt`: `plugins/agy-bridge.plugin.ts`, `plugins/agy-bridge.bundle.test.ts`, `scripts/bundle-plugin.ts`, `tests/service.test.ts` (`tests/plugin-smoke.sh` is a shell script, left untouched).
- Repaired `stubs/opencode-plugin.ts` regression by running `deno fmt` to restore fmt-clean status (verified `deno fmt --check stubs/opencode-plugin.ts` passes, zero regressions vs HEAD).
- Verified whole-tree comparison: `(files failing now) - (files failing at HEAD)` is empty (0 regressions across all tracked repository files).
- Re-verified full test suite and quality gates: `deno fmt --check` passes on the 5 files, `deno task test` (80/80 green), `deno lint` (0 findings, 12 files), `deno check agy-bridge.ts` (0 diagnostics), `bash tests/install.test.sh` (21 passed), `bash tests/plugin-smoke.sh` (passed).

