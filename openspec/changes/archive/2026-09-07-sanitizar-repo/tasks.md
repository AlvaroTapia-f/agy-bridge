# Tasks: Repository Sanitation

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~800–1100 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | 6 chained PRs (one per slice) |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No (resolved: chained PRs, stacked-to-main)
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Hygiene scoping | PR 1 | `deno lint && deno fmt --check` | local deno only | revert `deno.json` |
| 2 | Dead-code cleanup | PR 2 | `deno test` (≥56) + `deno check` | local deno only | revert cleanup commit |
| 3 | Bundle consolidation | PR 3 | `deno task bundle:plugin` + parity test | `tests/plugin-smoke.sh` (live opencode, sandbox, current plugin first) | restore prior `plugins/agy-bridge.ts` commit + re-run smoke |
| 4 | Installer hardening | PR 4 | `tests/install.test.sh` (mock HOME) | `bash tests/install.test.sh` with PATH lacking deno | revert `install.sh` |
| 5 | 8/16 reconciliation | PR 5 | `deno test` + `bash -n install.sh` | local deno only | revert wording |
| 6 | Service characterization | PR 6 | `deno test tests/service.test.ts` | harness: mock `agy`, random port, tmp `STATE_DIR`, `AGY_HARD_MARGIN_MS` | remove `tests/service.test.ts` |

## Phase 1: Hygiene Scoping (PR 1)

- [x] 1.1 Add `lint.exclude` + `fmt.exclude` incl. `openspec/changes/archive/**` to `deno.json`
- [x] 1.2 `deno lint` zero findings on active code (TRUE); `deno fmt --check` scoped to files touched by this change (original claim of tree-wide fmt-clean overstated — baseline was never fmt-clean; mass reformat is a non-goal)

## Phase 2: Dead-Code Cleanup (PR 2)

- [x] 2.1 Remove unused imports in `plugins/`, `scripts/`, `agy-bridge.ts`, `stubs/`
- [x] 2.2 Replace empty catches and `any` stubs with typed handling
- [x] 2.3 `deno check agy-bridge.ts` + `deno test` ≥56 green

## Phase 3: Bundle Consolidation (PR 3)

- [x] 3.1 Create `plugins/agy-bridge.plugin.ts` re-exporting `groupBases`/`buildModelMap`/`FALLBACK_MODELS` + plugin logic
- [x] 3.2 Add `bundle:plugin` task: `deno bundle` entrypoint → `plugins/agy-bridge.ts`, prepend `// @ts-nocheck` + GENERATED banner, tmp + `mv`
- [x] 3.3 RED: write `plugins/agy-bridge.bundle.test.ts` parity test — bundle ≡ helpers on `FALLBACK_MODELS` (`groupBases`, `buildModelMap`)
- [x] 3.4 RED: drift test fails if helpers grouping changes without regenerating bundle
- [x] 3.5 Create `tests/plugin-smoke.sh`: sandbox project + candidate bundle → `opencode models` asserts `agy-bridge/auto-*`; calibrate on current plugin first
- [x] 3.6 After smoke green, `deno task bundle:plugin` replaces hand `plugins/agy-bridge.ts`; prior copy kept until green

## Phase 4: Installer Deno Hardening (PR 4)

- [x] 4.1 RED: `tests/install.test.sh` §6 — PATH without deno exits 1 pre-sync, no Python fallback
- [x] 4.2 Add `command -v deno` + `deno --version` gate in `install.sh`, exit 1 with prerequisite message before any sync
- [x] 4.3 Remove inline Python 4-pass generator + dead vars from `install.sh`
- [x] 4.4 `install.sh` sync failure exits 1 (owner-confirmed); never-blocking stays inside `sync-models.ts` tiers
- [x] 4.5 `bash -n install.sh` clean; idempotent re-run passes install.test.sh

## Phase 5: 8/16 Reconciliation (PR 5)

- [x] 5.1 `README.md`: Python wording → Deno prerequisite; bundle workflow; 8 bases/16 ids
- [x] 5.2 Update stale streaming comment at `agy-bridge.ts` L908-911
- [x] 5.3 Remove "14 default models" from `install.sh`/tests; state verified 8/16 contract
- [x] 5.4 `deno test` green; active code matches `opencode-provider`/`model-sync` specs

## Phase 6: Service Characterization (PR 6)

- [x] 6.1 Create `tests/service.test.ts` black-box harness: spawn `deno run`, mock `agy`, random port, tmp `STATE_DIR`, `AGY_HARD_MARGIN_MS`, scoped `--allow-*`
- [x] 6.2 RED: 403 host / 401 auth / healthz cases
- [x] 6.3 RED: 400 routing, SSE + `[DONE]` + keepalive, deadline kill, salvage, retry
- [x] 6.4 Harness hermetic: tmp paths only, kill child on abort
- [x] 6.5 `deno test` ≥56 with characterization green