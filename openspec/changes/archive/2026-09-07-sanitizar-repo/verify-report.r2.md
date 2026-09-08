```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:4a2e320d77e61635204d118860329e104009e36175f84d546356254e519c8876
verdict: fail
blockers: 0
critical_findings: 2
requirements: 8/9
scenarios: 24/25
test_command: deno task test
test_exit_code: 0
test_output_hash: sha256:9ff41512e1940cfd21ab5df3f249e5cadeedaaef63e17b9792cfe15618f99923
build_command: deno check agy-bridge.ts
build_exit_code: 0
build_output_hash: sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

# Verification Report

**Change**: sanitizar-repo
**Version**: N/A (specs carry no version)
**Mode**: Strict TDD (runner: `deno test`, Deno 2.9.5)
**Date**: 2026-09-07
**Revision**: 2 — re-verification after post-verify remediation. Supersedes the prior FAIL report (preserved as `verify-report.r1.md`). All command evidence in this revision was re-executed from scratch; no results were carried over unverified.

## Remediation Assessment (prior findings)

| Prior finding | Remediation claimed | Confirmed? | Runtime evidence |
|---|---|---|---|
| C1 — repo-hygiene format gate scenario FAILS (`deno fmt --check` exit 1 on active tree) | Spec rescoped: fmt gate applies only to files touched by this change; baseline never fmt-clean; mass reformat non-goal | ❌ **NOT RESOLVED** | `deno fmt --check` on the touched-file set still exits 1: **13 of 14 fmt-eligible touched files fail**, including 4 files authored from scratch by this change and 1 fmt regression introduced by this change (details below) |
| C2 — Task 1.2 GREEN evidence contradicted | Task 1.2 amended; apply-progress "Corrections" section; "Task 1.2 remains `[x]` under the rescoped gate" | ❌ **NOT RESOLVED** | The rescoped claim itself is contradicted: the scoped gate fails at runtime. Additionally `apply-progress.md` L11 still carries the original overstated wording ("`deno fmt --check` clean outside archives") in the completion list |
| W1 — opencode-provider spec demands nested `capabilities` while code emits flat shape | Delta "Reasoning Model Shape Conformance" reconciled to flat `reasoning: true` + `capabilities === undefined` | ✅ RESOLVED (delta) / ⚠️ residual | Delta wording now matches code and tests exactly (both scenarios COMPLIANT). Residual: the main spec retains nested-`capabilities` wording in requirements NOT covered by the delta's MODIFIED blocks (see W1 below) |
| W2 — untasked production change in `scripts/sync-models.ts` (token resolution) | Recorded in apply-progress "Files Changed" | ⚠️ PARTIALLY | The change remains in production (`scripts/sync-models.ts:150`), is recorded in Files Changed, but was never elevated to a task or design amendment; the empty-token test still does not pin the new semantics (ambient `AGY_TOKEN` unset in this environment, so the test passes under both old and new semantics) |

## Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 25 |
| Tasks complete | 25 |
| Tasks incomplete | 0 |

All 25 tasks across 6 phases are checked in `tasks.md` and `apply-progress.md`; counts agree. Task 1.2's amended text is assessed under Remediation Assessment and Issues Found.

## Build & Tests Execution

**Build** (`deno check agy-bridge.ts`): ✅ Passed — exit 0, no diagnostics (empty output).

**Tests** (`deno task test` → `deno test --allow-net --allow-run --allow-read --allow-write --allow-env`): ✅ 80 passed / 0 failed / 0 skipped — exit 0.

```text
ok | 80 passed | 0 failed (2s)
  plugins/agy-bridge.bundle.test.ts .... 3 tests
  plugins/agy-bridge.test.ts .......... 49 tests
  scripts/sync-models.test.ts ........ 19 tests
  tests/service.test.ts ............... 9 tests
```

**Shell suites**:

- `bash tests/install.test.sh`: ✅ 21 passed / 0 failed — exit 0 (static checks §1, missing-config §2, Deno-first sync §3, idempotency §4, dynamic sync §5, Deno prerequisite guard §6, sync-failure exit §7).
- `bash tests/plugin-smoke.sh`: ✅ PASS — exit 0 ("PASS: CURRENT plugin verified successfully (14 models found)"; live opencode sandbox gate; 14 = machine-global live-synced listing, see S1).
- `deno lint`: ✅ 0 findings, 12 files checked — exit 0 (archives excluded; no archived findings).
- `deno task bundle:plugin`: ✅ exit 0; regeneration **byte-identical** to the committed bundle (`cmp` verified). Reproducibility re-confirmed this revision.

**Rescoped format gate** (deterministic touched-file set = `git diff --name-only` against base `3a1e387` = 18 tracked files; 14 are fmt-eligible): ❌ **exit 1 — 13 of 14 fmt-eligible touched files fail `deno fmt --check`**. Only `deno.json` passes. Per-file results:

```text
FAIL  agy-bridge.ts                                  (inherited: HEAD version also fails fmt)
FAIL  plugins/agy-bridge.ts                          (generated bundle; HEAD version also fails)
FAIL  plugins/agy-bridge.plugin.ts                   (NEW file authored by this change)
FAIL  plugins/agy-bridge.bundle.test.ts              (NEW file authored by this change)
FAIL  plugins/agy-bridge.test.ts                     (inherited: HEAD version also fails)
FAIL  scripts/bundle-plugin.ts                       (NEW file authored by this change)
FAIL  scripts/sync-models.ts                         (inherited: HEAD version also fails)
FAIL  scripts/sync-models.test.ts                    (inherited: HEAD version also fails)
FAIL  stubs/opencode-plugin.ts                       (REGRESSION: HEAD version PASSES fmt; this change broke it)
FAIL  tests/service.test.ts                          (NEW file authored by this change)
FAIL  README.md                                      (inherited: HEAD version also fails)
FAIL  openspec/specs/opencode-provider/spec.md       (main-spec edit made by this change, task 5.4)
FAIL  openspec/changes/sanitizar-repo/verify-report.md (change artifact; prior report on disk)
PASS  deno.json
```

Baseline spot-check confirms the exclude rationale: untouched `plugins/agy-bridge-helpers.ts` also fails fmt (never-clean baseline), while `stubs/opencode-sdk-v2.ts` passes — so fmt itself works and the failures are real. The failure set splits into three classes: (a) inherited baseline style in pre-existing files the change edited, (b) **four newly authored files** (`plugins/agy-bridge.plugin.ts` import ordering, `scripts/bundle-plugin.ts` line-width, `plugins/agy-bridge.bundle.test.ts`, `tests/service.test.ts`) whose formatting this change fully controlled, and (c) **one introduced regression** (`stubs/opencode-plugin.ts` was fmt-clean at HEAD and is now failing after this change's typed-stub edits).

**Coverage** (`deno task test --coverage=…`): threshold 0 (informational) — see Changed File Coverage.

## Spec Compliance Matrix

Authoritative counts from the retrieved delta specs: 9 requirements, 25 scenarios.

| Requirement | Scenario | Test / Evidence | Result |
|-------------|----------|-----------------|--------|
| PP: Bundle Generation | Bundle produced from helpers | `deno task bundle:plugin` (exit 0, byte-identical regen re-verified); `plugins/agy-bridge.bundle.test.ts` parity | ✅ COMPLIANT |
| PP: Bundle Generation | Generated file is not hand-edited | `plugins/agy-bridge.bundle.test.ts` banner assertions; bundle header L1–5 verified | ✅ COMPLIANT |
| PP: Installed-Plugin Smoke Test | Smoke test passes before consolidation | `tests/plugin-smoke.sh` live run — PASS, exit 0; asserts `agy-bridge/auto-*` ids + representative models | ✅ COMPLIANT |
| PP: Installed-Plugin Smoke Test | Smoke test gates deletion of prior copy | Process scenario: smoke script never writes the current copy (tree unchanged after run); apply-progress 3.6 documents replace-only-after-green | ✅ COMPLIANT (process evidence) |
| PP: Parity Check in Test Suite | Parity test green | `plugins/agy-bridge.bundle.test.ts` — bundle ≡ helpers on `FALLBACK_MODELS` + dynamic slugs | ✅ COMPLIANT |
| PP: Parity Check in Test Suite | Parity test catches drift | Parity tests import live `./agy-bridge-helpers.ts` vs frozen bundle — helpers change without regen ⇒ assertEquals fails | ✅ COMPLIANT |
| OP: Auto-Prefixed Model Enumeration | Live enumeration | `scripts/sync-models.test.ts` tier-2 API tests; smoke asserts `agy-bridge/auto-ro-gemini-3.7-flash` | ✅ COMPLIANT |
| OP: Auto-Prefixed Model Enumeration | Fallback (grouped) | `plugins/agy-bridge.test.ts` "provider hook fallback", "17 FALLBACK → 8 bases", "FALLBACK grouped -> 16 auto-ro/rw ids" | ✅ COMPLIANT |
| OP: Auto-Prefixed Model Enumeration | Bundle-based plugin execution | `tests/plugin-smoke.sh` (loads offline, no import errors) + bundle parity (17 → 8 bases) | ✅ COMPLIANT |
| OP: Reasoning Model Shape Conformance | buildModelMap emits flat shape | Delta reconciled to flat shape; `plugins/agy-bridge.test.ts` "enriched shape", "reasoning true iff variants non-empty", "1.5 RED test: flat interleaved and reasoning: true, no nested capabilities" (all green) | ✅ COMPLIANT (was PARTIAL in r1; W1 delta reconciliation verified) |
| OP: Reasoning Model Shape Conformance | sync script emits identical shape | `scripts/sync-models.test.ts` FALLBACK equivalence (8 bases / 16 models, flat reasoning + interleaved, `capabilities === undefined`) | ✅ COMPLIANT |
| MS: Dynamic Effort Capture | Efforts inferred from live TSV | `scripts/sync-models.test.ts` dynamic-effort tests; `tests/install.test.sh` §5 | ✅ COMPLIANT |
| MS: Dynamic Effort Capture | New effort appears dynamically | `scripts/sync-models.test.ts` `gemini-3.8-flash-ultra` (pass-2 capture); install.test.sh "ultra variant in reasoningEffort" | ✅ COMPLIANT |
| MS: Dynamic Effort Capture | Compatibility with current hardcoded FALLBACK | `plugins/agy-bridge.test.ts` "17 FALLBACK → 8 bases"; `scripts/sync-models.test.ts` FALLBACK equivalence | ✅ COMPLIANT |
| MS: Dynamic Effort Capture | Offline Fallback (Idempotency and Non-Blocking) | `scripts/sync-models.test.ts` tier-3 fallback (17 models, source `fallback`, never-blocking); atomic write + .bak | ✅ COMPLIANT |
| MS: Dynamic Effort Capture | Interleaved capability in buildModelMap output | `plugins/agy-bridge.test.ts` "1.5 RED test: flat interleaved and reasoning: true, no nested capabilities" | ✅ COMPLIANT |
| IA: Install Automation — Global Provider Docs | Fresh-machine restore | `tests/install.test.sh` §2/§3/§4 (mock HOME, `auto-ro-*` + variants, plugin copied); service test 6.2 (200 with correct Bearer); smoke listing | ✅ COMPLIANT |
| IA: Install Automation — Global Provider Docs | Install script provisions provider | `tests/install.test.sh` §3; `install.sh` echoes `/connect Other → agy-bridge` + curl verification | ✅ COMPLIANT |
| IA: Install Automation — Global Provider Docs | Idempotent provider provisioning | `tests/install.test.sh` §4 (valid JSON, no duplicates) + §1 `bash -n` | ✅ COMPLIANT |
| IA: Install Automation — Global Provider Docs | Missing Deno fails fast | `tests/install.test.sh` §6 — 5 checks (non-zero exit pre-sync, error message, no Python fallback, `deno --version` failure exit ≠ 0, no fallback generation) | ✅ COMPLIANT |
| RH: Scoped Lint and Format Gate | Archive excluded from lint | `deno lint` exit 0, 12 files, 0 findings, no archived files checked; Task 1.1 config tests green | ✅ COMPLIANT |
| RH: Scoped Lint and Format Gate | Format gate scoped to touched files | `deno fmt --check` on the touched-file set (`git diff --name-only` vs base `3a1e387`): **exit 1 — 13/14 fmt-eligible touched files fail** (incl. 4 new files authored by this change and 1 regression in `stubs/opencode-plugin.ts`); no covering automated test exists for this scenario | ❌ FAILING |
| RH: Documentation Accuracy | README counts match reality | Task 5.1 test ("8 bases × 2 perfiles = 16 ids") + `buildModelMap` 16-key assertion | ✅ COMPLIANT |
| RH: Documentation Accuracy | No stale behavior comments | Task 5.2 test (no stale one-chunk wording in `agy-bridge.ts`/README) | ✅ COMPLIANT |
| RH: Documentation Accuracy | Installer wording accuracy | Task 5.3 test + install.test.sh §6/§7 (no "14 default models", no Python fallback references) | ✅ COMPLIANT |

**Compliance summary**: 24/25 scenarios compliant (1 FAILING). Requirements fully satisfied: 8/9 (`repo-hygiene` Scoped Lint and Format Gate is incomplete — its lint scenario passes, its format scenario fails).

## Correctness (Static Evidence)

| Requirement | Status | Notes |
|------------|--------|-------|
| PP: Bundle Generation | ✅ Implemented | Entrypoint re-exports `groupBases`/`buildModelMap`/`FALLBACK_MODELS`; generated bundle self-contained, banner + atomic tmp+mv, reproducible (re-verified) |
| PP: Installed-Plugin Smoke Test | ✅ Implemented | Sandbox (temp project, never touches installed copy), calibrated on current plugin first |
| PP: Parity Check in Test Suite | ✅ Implemented | 3 parity/drift tests green |
| OP: Auto-Prefixed Model Enumeration | ✅ Implemented | Only `auto-ro-*`/`auto-rw-*` exposed; 17 slugs → 8 bases → 16 ids code-verified |
| OP: Reasoning Model Shape Conformance | ✅ Implemented (flat shape) | Code and tests emit flat `reasoning` + `interleaved` with `capabilities === undefined`; delta spec now matches (W1 reconciled in delta) |
| MS: Dynamic Effort Capture | ✅ Implemented | 4-pass solely in Deno helpers; no Python grouping anywhere; flat interleaved emitted |
| IA: Install Automation | ✅ Implemented | Hard Deno gate, Python model generator removed, sync failure exits 1, Deno-only sync |
| RH: Scoped Lint and Format Gate | ❌ Partial | Lint gate fully green; the RESCOPED format gate still fails at runtime — remediation changed spec wording but performed no formatting remediation on touched files |
| RH: Documentation Accuracy | ✅ Implemented | README/installer/tests state verified 8/16; stale claims removed |

## Coherence (Design)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| Plugin artifact = `deno bundle` entrypoint | ✅ Yes | As designed; smoke-gated replacement |
| Generated-file integrity: banner + atomic write | ✅ Yes | Header verified; regen byte-identical (re-verified) |
| Parity via re-export, existing tests keep importing `./agy-bridge.ts` | ✅ Yes | |
| Smoke harness sandbox, current-plugin-first | ✅ Yes | Ran green; note S1 on global-config leakage |
| Installer: hard Deno prerequisite, no Python model sync | ✅ Yes | Gate + exit semantics verified by 21 shell checks |
| Black-box characterization harness (spawn `deno run`, mock agy, random port, tmp `STATE_DIR`, `AGY_HARD_MARGIN_MS`, scoped `--allow-*`) | ✅ Yes | `ServiceHarness` matches design exactly |
| Lint scoping via top-level exclude | ✅ Yes (lint) / ❌ (fmt clause) | Excludes work for both tools; the rescoped fmt scenario's "touched files MUST pass" clause is unmet |
| Slice-6 file scope | ⚠️ Deviation | Untasked production change in `scripts/sync-models.ts` (token resolution, W2) — recorded in apply-progress Files Changed but not elevated to a task/design amendment |

## TDD Compliance

| Check | Result | Details |
|-------|--------|---------|
| TDD Evidence reported | ✅ | 25-row "TDD Cycle Evidence" table in apply-progress |
| All tasks have tests | ✅ | 25/25 rows list test files; all exist in the codebase |
| RED confirmed (tests exist) | ✅ | 25/25 test files present and executable |
| GREEN confirmed (tests pass) | ❌ | 24/25 claims verified at runtime (80/80 deno + 21/21 shell + smoke green); task 1.2's AMENDED claim ("`deno fmt --check` scoped to files touched by this change", "remains `[x]` under the rescoped gate") is contradicted — the scoped gate exits 1 (C2) |
| Triangulation adequate | ✅ | Multi-case rows verified; single-case rows justified |
| Safety Net for modified files | ✅ | Reported N/N per row; "new" rows match genuinely new files |

**TDD Compliance**: 5/6 checks passed.

## Test Layer Distribution

| Layer | Tests | Files | Tools |
|-------|-------|-------|-------|
| Unit | 71 | 3 (`plugins/agy-bridge.bundle.test.ts`, `plugins/agy-bridge.test.ts`, `scripts/sync-models.test.ts`) | deno test (mocked runner/fetcher) |
| Integration | 21 | 1 (`tests/install.test.sh`) + `deno task bundle:plugin` | bash, mock HOME |
| E2E | 9 | 1 (`tests/service.test.ts`) | black-box harness: real HTTP, spawned service, mock agy |
| Runtime smoke | 1 | 1 (`tests/plugin-smoke.sh`) | live `opencode models` |
| **Total** | **80 deno + 21 shell + 1 smoke** | 6+ | |

Note: `openspec/config.yaml` `testing.layers` still says integration "none" / e2e "none" and coverage "not wired" — stale versus demonstrated reality (S4).

## Changed File Coverage

| File | Branch % | Function % | Line % | Rating |
|------|----------|------------|--------|--------|
| `plugins/agy-bridge.ts` (generated bundle) | 83.3 | 66.7 | 62.0 | ⚠️ Acceptable — fetch-wrapper/hook paths exercised only by live smoke (uninstrumented) |
| `scripts/sync-models.ts` | 89.4 | 36.4 | 61.2 | ⚠️ Acceptable — CLI/main glue exercised by `install.test.sh` subprocess runs (uninstrumented) |
| `plugins/agy-bridge-helpers.ts` (unchanged, measured) | 98.4 | 100.0 | 100.0 | ✅ Excellent (not a changed file) |
| `agy-bridge.ts`, `plugins/agy-bridge.plugin.ts`, `scripts/bundle-plugin.ts`, `tests/service.test.ts` | ➖ | ➖ | ➖ | Not measured — executed as subprocesses/tasks without coverage instrumentation |

**Average changed-file line coverage (measured changed files)**: 61.6% — below the 80% informational bar (W3); threshold is 0 (informational-only). The largest unmeasured executables are covered by the uninstrumented service harness (9/9 green) and the byte-identical bundle task.

## Assertion Quality

| File | Line | Assertion | Issue | Severity |
|------|------|-----------|-------|----------|
| `scripts/sync-models.test.ts` | 235 | token `""` ⇒ no Authorization header | Does not neutralize ambient `AGY_TOKEN` (unset in this environment), so it would also pass under the old `\|\|` semantics — does not pin the new `!== undefined` semantics (S5, unresolved) | SUGGESTION |
| `plugins/agy-bridge.bundle.test.ts` | 58 | banner/source-of-truth substring checks | Named "Drift test" but detects only generated-marker absence; actual drift protection lives in the parity tests (S2) | SUGGESTION |
| `plugins/agy-bridge.test.ts` | multiple | `source.includes(...)` assertions for tasks 4.x/5.x | Source-substring assertions are appropriate for wording/documentation tasks but brittle as behavioral guarantees (S3); behavioral coverage exists in shell/E2E suites | SUGGESTION |

**Assertion quality**: 0 CRITICAL, 0 WARNING, 3 SUGGESTION. `tests/service.test.ts` re-audited: all 9 tests assert real behavior (status codes, JSON bodies, SSE frames + `[DONE]`, timing bound, transcript salvage content, retry semantics, fs cleanup) — no tautologies, ghost loops, or smoke-only assertions.

## Quality Metrics

**Linter**: ✅ No errors — `deno lint` exit 0, 12 files, 0 findings.
**Type Checker**: ✅ No errors — `deno check agy-bridge.ts` exit 0.
**Formatter**: ❌ `deno fmt --check` exit 1 on the touched-file set (C1) — 13/14 fmt-eligible touched files fail, including 4 files authored from scratch by this change and 1 regression introduced in `stubs/opencode-plugin.ts` (fmt-clean at HEAD, failing now).

## Issues Found

**CRITICAL**:

- **C1 (recurrence) — repo-hygiene "Scoped Lint and Format Gate" / scenario "Format gate scoped to touched files" FAILS at runtime under the rescoped definition.** The remediation rescoped the spec and task wording (fmt gate = touched files only) but performed no formatting remediation. Deterministic touched set (`git diff --name-only` against base `3a1e387`): 18 files, 14 fmt-eligible, **13 fail `deno fmt --check`**; only `deno.json` passes. Three failure classes: (a) inherited never-clean baseline style in pre-existing files the change edited (`agy-bridge.ts`, `README.md`, `plugins/agy-bridge.test.ts`, `scripts/sync-models*.ts` — HEAD versions also fail); (b) **four newly authored files** (`plugins/agy-bridge.plugin.ts`, `plugins/agy-bridge.bundle.test.ts`, `scripts/bundle-plugin.ts`, `tests/service.test.ts`) whose formatting this change fully controlled and could have made fmt-clean at authoring time; (c) **one introduced regression** — `stubs/opencode-plugin.ts` passes fmt at HEAD and fails after this change's typed-stub edits. No covering automated test exists for this scenario in the suite. The scenario's second clause (gate MUST NOT require the wider tree to be fmt-clean) is satisfied; the first clause (touched files MUST pass) is not.
- **C2 (recurrence) — Task 1.2 amended completion claim is still contradicted by runtime.** The corrections section asserts "Task 1.2 remains `[x]` under the rescoped gate", but the rescoped gate itself fails (C1), so the amended claim is as false as the original one. Additionally, `apply-progress.md` line 11 in the Completed Tasks list still carries the ORIGINAL overstated wording ("`deno fmt --check` clean outside archives") — the corrections section amends it narratively but the completion list was never corrected. The covering test for 1.2 still asserts only the bare `@std/assert` specifier; the fmt clause remains test-unverified. Same root cause as C1; reported separately as a TDD-evidence integrity issue.

**WARNING**:

- **W1 (residual, post-archive risk) — main spec retains nested-`capabilities` wording outside the delta's MODIFIED blocks.** The delta correctly reconciles "Reasoning Model Shape Conformance" to the flat shape, and its MODIFIED block will replace the matching main-spec block at archive. However, `openspec/specs/opencode-provider/spec.md` retains nested `capabilities: { reasoning: true }` wording in requirements this change's delta does NOT modify: "Effort Variants" (L53–74), "Stale Model Migration" (L108–118), and "Reasoning Effort Test Coverage" (L124–132). After archive, the main spec will simultaneously require flat shape (no `capabilities`) and nested `capabilities.reasoning` — an internal contradiction. Fix those main-spec requirements at or before archive.
- **W2 (residual) — untasked production change in `scripts/sync-models.ts:150` not elevated to a task or design amendment.** The token-resolution semantics change (`options.token || env` → `options.token !== undefined ? …`) remains in production. It is recorded in apply-progress "Files Changed" but the corrections section did not add a design amendment or task for it. Behavior-affecting only for explicit empty-string tokens, which no production caller passes; the covering unit test passes but does not pin the new semantics (see S5).
- **W3 — changed-file line coverage below the 80% informational bar** on the two instrumented changed files (bundle 62.0%, sync-models 61.2%); configured threshold is 0, and the gap is mostly paths exercised by uninstrumented subprocess/task runs (service harness 9/9, smoke, byte-identical bundle task).
- **W4 — fmt regression introduced in `stubs/opencode-plugin.ts`.** This file was fmt-clean at HEAD (verified by checking out the HEAD version) and fails `deno fmt --check` after this change's edits (task 2.2 typed stubs). Unlike the inherited-baseline failures, this one is unambiguously caused by this change: a previously conformant file was made non-conformant. Folded into C1 for verdict purposes; listed separately because it is the one file where the change took a fmt-clean file backwards and a targeted `deno fmt stubs/opencode-plugin.ts` fixes it without touching baseline style.

**SUGGESTION**:

- **S1 — smoke threshold depends on machine-global state.** `opencode models` in the smoke sandbox merges the machine-global `~/.config/opencode/opencode.json` (14 live-synced models = 7 live bases × 2 profiles; live catalog retired `gemini-3.5-flash`) over the plugin's 16-id fallback. The 16-id contract is fallback-shaped and code-verified; the smoke's `≥ 14` floor accommodates both shapes. Consider isolating `HOME` in the sandbox or asserting the exact expected set per shape, and documenting the 14-vs-16 accounting in the script header.
- **S2 — rename "Task 3.4 Drift test"** (banner assertions) to a generated-marker name; drift protection actually lives in the parity tests.
- **S3 — keep source-substring assertions scoped to wording tasks**; they are brittle as behavioral guarantees.
- **S4 — refresh `openspec/config.yaml` testing capabilities** (`layers.integration`/`layers.e2e` now exist; coverage is wired in practice). Still stale after this change.
- **S5 — harden the empty-token test** by explicitly unsetting/neutralizing `AGY_TOKEN` so it pins the new `!== undefined` semantics. Unresolved from r1.

## Verdict

**FAIL**

One spec scenario still fails at runtime — the RESCOPED format gate (`deno fmt --check` on the touched-file set, 13/14 fmt-eligible files failing, including 4 files authored by this change and 1 introduced regression), and task 1.2's amended completion claim is contradicted by the same runtime fact. All other runtime evidence passes (80/80 deno tests, 21/21 installer checks, live smoke green, typecheck and lint clean, bundle reproducible). The remediation updated spec/task wording but shipped no formatting remediation. Resolution options for the orchestrator: (a) run `deno fmt` on the touched files (at minimum the 4 new files + `stubs/opencode-plugin.ts` regression; a full touched-set format also reformats pre-existing baseline-style hunks in `agy-bridge.ts`/`README.md`/etc. — budget implications for the 400-line review guard), then re-verify; or (b) re-scope the fmt gate again (e.g., only files created by this change) with an owner decision recorded as a design amendment — noting that even the create-only scope currently fails (4/4 new files) and still requires formatting those files.
