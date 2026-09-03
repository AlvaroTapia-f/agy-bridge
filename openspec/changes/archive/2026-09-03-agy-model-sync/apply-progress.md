# Apply Progress: AGY Model Sync

**Change**: agy-model-sync  
**Mode**: Strict TDD  
**Delivery Strategy**: ask-on-risk (resolved to stacked-to-main chained PRs)  
**Current PR**: PR2 (install.sh integration + verification + docs)  

## Completed Tasks

### Phase 1: Foundation
- [x] 1.1 Extend `plugins/agy-bridge-helpers.ts` `stripEffortSuffix` to infer unknown suffixes dynamically; verify `groupBases(FALLBACK_MODELS)` yields 7 bases
- [x] 1.2 Add `deno.json` task `sync:models` with `--allow-run=agy --allow-net=127.0.0.1:7421 --allow-read --allow-write --allow-env`
- [x] 1.3 Scaffold `scripts/sync-models.ts` — imports from helpers, `parseTsv`/`resolveSlugs`/`syncModels` signatures, CLI `--dry-run`/`--config-path`

### Phase 2: Core Implementation
- [x] 2.1 Implement `parseTsv` in `scripts/sync-models.ts` — split `\n`, col0 before `\t`, trim, filter empty, tolerant to malformed rows
- [x] 2.2 Implement `resolveSlugs` — spawn `agy models` (timeout 10s) → `GET /v1/models` → `FALLBACK_MODELS`; return `{slugs, source}`
- [x] 2.3 Implement dynamic effort — `groupBases(slugs)` → `buildModelMap` → `auto-ro/rw-*` with `capabilities.reasoning` iff variants non-empty; `ultra` captured
- [x] 2.4 Implement atomic RMW — read `opencode.json`, `.bak` backup, update only `provider["agy-bridge"].models`, `tmp`+`rename`, preserve others
- [x] 2.5 Implement CLI — `--dry-run` prints JSON no write; log count/source; never log token; fallback never blocks

### Phase 3: Integration
- [x] 3.1 Modify `install.sh` L189–303 — replace Python gen with `"$DENO_BIN" run scripts/sync-models.ts`; keep `python3` fallback when Deno missing; never fail install
- [x] 3.2 Verify `install.sh` handles missing `opencode.json`; `bash -n install.sh` passes

### Phase 4: Testing (Strict TDD)
- [x] 4.1 RED: `scripts/sync-models.test.ts` — `parseTsv` valid/empty/missing-tab/blank-line cases
- [x] 4.2 RED: dynamic effort — `gemini-3.8-flash-ultra` → `variants.ultra.reasoningEffort==="ultra"`; FALLBACK 7-base equivalence
- [x] 4.3 RED: fallback chain — mock spawn fail → api success; both fail → fallback; assert `source`
- [x] 4.4 RED: subprocess threat — invalid `AGY_BIN`/timeout/malformed TSV injection → falls to next tier, no blocking error, no token leak
- [x] 4.5 RED: atomic write — temp dir, `tmp+rename`, `.bak` created, other providers preserved
- [x] 4.6 RED: dry-run — flag outputs JSON stdout, zero file mutations
- [x] 4.7 GREEN: make 4.1–4.6 pass in `scripts/sync-models.ts`; `deno test` green

### Phase 5: Verification & Docs
- [x] 5.1 Run `deno check scripts/sync-models.ts && deno test && bash -n install.sh`
- [x] 5.2 E2E `deno task sync:models && opencode models | grep agy-bridge && jq '.provider["agy-bridge"].models'`
- [x] 5.3 Update `README.md` with `sync:models` usage; verify no bare `gemini-*` ids

## Work Unit Evidence

| Evidence | Required value |
|---|---|
| Focused test command and exact result | `deno test && bash tests/install.test.sh && bash tests/install-remote.test.sh` → 34 unit passed (0 failed), 15 install tests passed (0 failed), 18 remote tests passed (0 failed) |
| Runtime harness command/scenario and exact result | `deno task sync:models --dry-run` → exit 0, outputs valid JSON with 14 models with reasoning capabilities/variants; `bash tests/install.test.sh` → exit 0 |
| Rollback boundary | Revert `install.sh`, `tests/install.test.sh`, `README.md` (reverts installer to static Python fallback without breaking standalone sync script) |

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 / 4.2 | `scripts/sync-models.test.ts` | Unit | ✅ 17/17 passed | ✅ Written | ✅ Passed | ✅ 3 cases (ultra, max, FALLBACK) | ✅ Clean |
| 1.2 | `deno.json` | Config | N/A (structural) | ➖ N/A | ✅ Passed | ➖ Single | ✅ Clean |
| 1.3 / 2.1 / 4.1 | `scripts/sync-models.test.ts` | Unit | ✅ 20/20 passed | ✅ Written | ✅ Passed | ✅ 5 cases (valid, whitespace, no-tab, empty, malformed) | ✅ Clean |
| 2.2 / 4.3 / 4.4 | `scripts/sync-models.test.ts` | Unit | ✅ 25/25 passed | ✅ Written | ✅ Passed | ✅ 6 cases (TSV, API, fallback, runner throw, empty, timeout) | ✅ Clean |
| 2.3 | `scripts/sync-models.test.ts` | Unit | ✅ 31/31 passed | ✅ Written | ✅ Passed | ✅ 3 cases | ✅ Clean |
| 2.4 / 4.5 | `scripts/sync-models.test.ts` | Unit | ✅ 31/31 passed | ✅ Written | ✅ Passed | ✅ 2 cases (preserve providers + .bak, missing dirs) | ✅ Clean |
| 2.5 / 4.6 | `scripts/sync-models.test.ts` | Unit | ✅ 33/33 passed | ✅ Written | ✅ Passed | ✅ 1 case (dryRun zero mutation) | ✅ Clean |
| 3.1 / 3.2 | `tests/install.test.sh` | Integration | ✅ 34/34 unit passed | ✅ Written | ✅ Passed (15/15) | ✅ 6 sections (static, missing, deno sync, idempotency, dynamic, fallback) | ✅ Clean |
| 5.1 | `scripts/sync-models.ts` / `install.sh` | Static/Check | ✅ Clean check | ➖ N/A | ✅ Passed | ➖ Suite | ✅ Clean |
| 5.2 | CLI / E2E | E2E Harness | ✅ 34/34 passed | ➖ N/A | ✅ Passed (exit 0) | ➖ N/A | ✅ Clean |
| 5.3 | `README.md` | Docs | N/A (docs) | ➖ N/A | ✅ Verified | ➖ Single | ✅ Clean |

### Test Summary
- **Total tests in suite**: 67 (34 Deno unit + 15 install integration + 18 install-remote)
- **Total tests passing**: 67
- **New tests written in PR2**: 15 (integration suite `tests/install.test.sh`)
- **Layers used**: Unit (34), Integration (33)
- **Approval tests**: None (refactoring covered by safety net and approval assertions)
- **Pure functions created**: `parseTsv`, `getDefaultConfigPath`, enhanced `stripEffortSuffix`, enhanced `groupBases`

## Files Changed

| File | Action | What Was Done |
|------|--------|---------------|
| `plugins/agy-bridge-helpers.ts` | Modified | Extended `stripEffortSuffix` with optional extra suffixes and multi-pass dynamic base grouping in `groupBases` |
| `scripts/sync-models.ts` | Created | Standalone sync script: `parseTsv`, three-tier `resolveSlugs`, atomic `syncModels` with `.bak` and tmp+rename, CLI entry |
| `scripts/sync-models.test.ts` | Created | Unit test suite covering dynamic effort, TSV parsing, fallback chain, subprocess threat matrix, atomic RMW, and dry-run |
| `deno.json` | Modified | Added `sync:models` task with scoped permissions |
| `install.sh` | Modified | Replaced inline Python model generation with Deno-first `scripts/sync-models.ts` execution, keeping Python fallback guard |
| `tests/install.test.sh` | Created | Integration test suite for `install.sh` verifying Deno-first sync, missing opencode.json, idempotency, and fallback |
| `README.md` | Modified | Documented `deno task sync:models` usage, dynamic effort capture, and live synchronization on install |
| `openspec/changes/agy-model-sync/tasks.md` | Modified | Marked all 17 tasks complete across Phase 1–5 |
| `openspec/changes/agy-model-sync/apply-progress.md` | Modified | Merged cumulative progress and test evidence for PR1 + PR2 |

## Deviations from Design
None — implementation matches `design.md` and delta specs strictly.

## Issues Found
None.

## Workload / PR Boundary
- Mode: chained PR slice (stacked-to-main)
- Current work unit: PR2 (Installer integration, verification, and documentation)
- Boundary: Starts with `install.sh` integration, adds integration test harness `tests/install.test.sh`, updates `README.md`, executes complete verification suite.
- Estimated review budget impact: ~150 lines modified/added in PR2 (well within 400-line budget).

## Status
17/17 tasks complete. Ready for verify.

