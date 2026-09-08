```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:1d96cad03cf656d637c1aa875ba15fa20220f2468359e551a247dc0f75fe90a8
verdict: fail
blockers: 0
critical_findings: 2
requirements: 7/9
scenarios: 23/25
test_command: deno task test
test_exit_code: 0
test_output_hash: sha256:abd64078335faf0b9b5f3d5312046d4ab8b38b40aa25ec9e53e50711acac207e
build_command: deno check agy-bridge.ts
build_exit_code: 0
build_output_hash: sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

# Verification Report

**Change**: sanitizar-repo
**Version**: N/A (specs carry no version)
**Mode**: Strict TDD (runner: `deno test`, Deno 2.9.5)
**Date**: 2026-09-07

## Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 25 |
| Tasks complete | 25 |
| Tasks incomplete | 0 |

All 25 tasks across 6 phases are checked in `tasks.md` and `apply-progress.md` (counts agree; no "31 tasks" text exists anywhere in the change — see Watch Items).

## Build & Tests Execution

**Build** (`deno check agy-bridge.ts`): ✅ Passed — exit 0, no diagnostics.

**Tests** (`deno task test` → `deno test --allow-net --allow-run --allow-read --allow-write --allow-env`): ✅ 80 passed / 0 failed / 0 skipped — exit 0.

```text
ok | 80 passed | 0 failed (2s)
  plugins/agy-bridge.bundle.test.ts .... 3 tests
  plugins/agy-bridge.test.ts .......... 49 tests
  scripts/sync-models.test.ts ........ 19 tests
  tests/service.test.ts ............... 9 tests
```

**Shell suites**:
- `bash tests/install.test.sh`: ✅ 21 passed / 0 failed — exit 0 (covers static checks, Deno prerequisite guard §6, sync-failure exit §7, idempotency).
- `bash tests/plugin-smoke.sh`: ✅ PASS — exit 0 ("CURRENT plugin verified successfully (14 models found)"); live opencode sandbox gate.
- `deno lint`: ✅ 0 findings, 12 files checked — exit 0 (archives excluded, no archived findings).
- `deno fmt --check`: ❌ **exit 1 — "Found 31 not formatted files in 34 files"** (active TS sources and markdown; no archived file is checked, so the exclude works, but active files fail — see CRITICAL C1).
- `deno task bundle:plugin`: ✅ exit 0; regeneration is **byte-identical** to the committed bundle (reproducibility verified by `cmp`).

**Coverage** (`deno task test --coverage=…`): measured 3 instrumented files; threshold 0 (informational) — see Changed File Coverage.

## Spec Compliance Matrix

Authoritative counts from the retrieved delta specs: 9 requirements, 25 scenarios.

| Requirement | Scenario | Test / Evidence | Result |
|-------------|----------|-----------------|--------|
| PP: Bundle Generation | Bundle produced from helpers | `deno task bundle:plugin` (exit 0, byte-identical regen); `plugins/agy-bridge.bundle.test.ts` parity | ✅ COMPLIANT |
| PP: Bundle Generation | Generated file is not hand-edited | `plugins/agy-bridge.bundle.test.ts` banner assertions; bundle header L1–5 (`@ts-nocheck`, GENERATED, source-of-truth) verified | ✅ COMPLIANT |
| PP: Installed-Plugin Smoke Test | Smoke test passes before consolidation | `tests/plugin-smoke.sh` live run — PASS, exit 0; asserts `agy-bridge/auto-*` ids + 3 representative models | ✅ COMPLIANT |
| PP: Installed-Plugin Smoke Test | Smoke test gates deletion of prior copy | Process scenario: smoke script never writes the current copy (verified — tree unchanged after run); apply-progress 3.6 documents replace-only-after-green | ✅ COMPLIANT (process evidence) |
| PP: Parity Check in Test Suite | Parity test green | `plugins/agy-bridge.bundle.test.ts` — bundle ≡ helpers on FALLBACK_MODELS (`groupBases`, `buildModelMap`) | ✅ COMPLIANT |
| PP: Parity Check in Test Suite | Parity test catches drift | Parity tests import live `./agy-bridge-helpers.ts` vs frozen bundle (FALLBACK + multi-pass dynamic slugs) — helpers change without regen ⇒ assertEquals fails | ✅ COMPLIANT |
| OP: Auto-Prefixed Model Enumeration | Live enumeration | `scripts/sync-models.test.ts` tier-2 API + dynamic-effort tests; smoke asserts `agy-bridge/auto-ro-gemini-3.7-flash` | ✅ COMPLIANT |
| OP: Auto-Prefixed Model Enumeration | Fallback (grouped) | `plugins/agy-bridge.test.ts` "provider hook fallback", "17 FALLBACK → 8 bases", "FALLBACK grouped -> 16 auto-ro/rw ids" | ✅ COMPLIANT |
| OP: Auto-Prefixed Model Enumeration | Bundle-based plugin execution | `tests/plugin-smoke.sh` (loads, no import errors, offline) + bundle parity (17 → 8 bases) | ✅ COMPLIANT |
| OP: Reasoning Model Shape Conformance | buildModelMap emits enriched shape | `plugins/agy-bridge.test.ts` flat-shape tests pass (reasoning iff variants; `variants.*.reasoningEffort == key`; singleton `variants: {}`), **but scenario text demands `capabilities.reasoning === true` while code/tests emit flat `reasoning: true` with `capabilities === undefined`** (nested form forbidden by model-sync delta) | ⚠️ PARTIAL |
| OP: Reasoning Model Shape Conformance | sync script emits identical shape | `scripts/sync-models.test.ts` FALLBACK equivalence (8 bases / 16 models, flat reasoning + interleaved) + atomic-write tests | ✅ COMPLIANT |
| MS: Dynamic Effort Capture | Efforts inferred from live TSV | `scripts/sync-models.test.ts` dynamic-effort tests (flat `reasoning`, flat `interleaved`, `reasoningEffort` per key); `tests/install.test.sh` §5 | ✅ COMPLIANT |
| MS: Dynamic Effort Capture | New effort appears dynamically | `scripts/sync-models.test.ts` `gemini-3.8-flash-ultra` (pass-2 capture, no `EFFORT_SUFFIXES` change); install.test.sh "ultra variant in reasoningEffort" | ✅ COMPLIANT |
| MS: Dynamic Effort Capture | Compatibility with current hardcoded FALLBACK | `plugins/agy-bridge.test.ts` "17 FALLBACK → 8 bases"; `scripts/sync-models.test.ts` FALLBACK equivalence | ✅ COMPLIANT |
| MS: Dynamic Effort Capture | Offline Fallback (Idempotency and Non-Blocking) | `scripts/sync-models.test.ts` tier-3 fallback (17 models, source `fallback`, never-blocking); syncModels atomic write + .bak | ✅ COMPLIANT |
| MS: Dynamic Effort Capture | Interleaved capability in buildModelMap output | `plugins/agy-bridge.test.ts` "1.5 RED test: flat interleaved and reasoning: true, no nested capabilities" | ✅ COMPLIANT |
| IA: Install Automation — Global Provider Docs | Fresh-machine restore | `tests/install.test.sh` §2/§3/§4 (mock HOME, provider populated with `auto-ro-*` + variants, plugin copied); service test 6.2 (200 with correct Bearer); smoke (`opencode models` listing) | ✅ COMPLIANT |
| IA: Install Automation — Global Provider Docs | Install script provisions provider | `tests/install.test.sh` §3; `install.sh` echoes `/connect Other → agy-bridge` + curl verification (L275–277, L431–432) | ✅ COMPLIANT |
| IA: Install Automation — Global Provider Docs | Idempotent provider provisioning | `tests/install.test.sh` §4 (valid JSON, no duplicate entries) + §1 `bash -n` | ✅ COMPLIANT |
| IA: Install Automation — Global Provider Docs | Missing Deno fails fast | `tests/install.test.sh` §6 — 5 checks: PATH-without-deno exit ≠ 0 pre-sync, error message, no Python fallback, `deno --version` failure exit ≠ 0, no fallback generation | ✅ COMPLIANT |
| RH: Scoped Lint and Format Gate | Archive excluded from lint | `deno lint` exit 0, no archived findings; `Task 1.1` config tests | ✅ COMPLIANT |
| RH: Scoped Lint and Format Gate | Archive excluded from format | `fmt.exclude` present and honored (no archived file checked), **but active source files FAIL `deno fmt --check` (exit 1, 31/34 files — incl. `plugins/agy-bridge-helpers.ts` byte-identical to HEAD)** | ❌ FAILING |
| RH: Documentation Accuracy | README counts match reality | `Task 5.1` test ("8 bases × 2 perfiles = 16 ids") + `buildModelMap` 16-key assertion | ✅ COMPLIANT |
| RH: Documentation Accuracy | No stale behavior comments | `Task 5.2` test (no stale one-chunk wording in `agy-bridge.ts`/README) | ✅ COMPLIANT |
| RH: Documentation Accuracy | Installer wording accuracy | `Task 5.3` test + install.test.sh §6/§7 (no "14 default models", no Python fallback references) | ✅ COMPLIANT |

**Compliance summary**: 23/25 scenarios compliant (1 PARTIAL, 1 FAILING). Requirements fully satisfied: 7/9 (`opencode-provider` Reasoning Model Shape Conformance and `repo-hygiene` Scoped Lint and Format Gate are incomplete).

## Correctness (Static Evidence)

| Requirement | Status | Notes |
|------------|--------|-------|
| PP: Bundle Generation | ✅ Implemented | Entrypoint `plugins/agy-bridge.plugin.ts` re-exports `groupBases`/`buildModelMap`/`FALLBACK_MODELS`; generated bundle self-contained, banner + atomic tmp+mv, reproducible |
| PP: Installed-Plugin Smoke Test | ✅ Implemented | `tests/plugin-smoke.sh` sandbox (temp project, never touches installed copy), calibrated on current plugin first |
| PP: Parity Check in Test Suite | ✅ Implemented | 3 parity/drift tests green |
| OP: Auto-Prefixed Model Enumeration | ✅ Implemented | Only `auto-ro-*`/`auto-rw-*` exposed; 17 slugs → 8 bases → 16 ids code-verified |
| OP: Reasoning Model Shape Conformance | ⚠️ Implemented (flat shape) | Code and tests emit flat `reasoning` + `interleaved`; spec wording still says nested `capabilities` (W1) |
| MS: Dynamic Effort Capture | ✅ Implemented | 4-pass solely in Deno helpers; no Python grouping anywhere; flat interleaved emitted |
| IA: Install Automation | ✅ Implemented | Hard Deno gate, Python generator removed, sync failure exits 1, Deno-only sync |
| RH: Scoped Lint and Format Gate | ⚠️ Partial | Lint gate fully green; format gate fails on active code (C1) |
| RH: Documentation Accuracy | ✅ Implemented | README/installer/tests state verified 8/16; stale claims removed |

## Coherence (Design)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| Plugin artifact = `deno bundle` entrypoint | ✅ Yes | As designed; smoke-gated replacement |
| Generated-file integrity: banner + atomic write | ✅ Yes | Header verified; regen byte-identical |
| Parity via re-export, existing tests keep importing `./agy-bridge.ts` | ✅ Yes | |
| Smoke harness sandbox, current-plugin-first | ✅ Yes | Ran green; note S1 on global-config leakage |
| Installer: hard Deno prerequisite, no Python model sync | ✅ Yes | Gate + exit semantics verified by 21 shell checks |
| Black-box characterization harness (spawn `deno run`, mock agy, random port, tmp `STATE_DIR`, `AGY_HARD_MARGIN_MS`, scoped `--allow-*`) | ✅ Yes | `ServiceHarness` matches design exactly |
| Lint scoping via top-level exclude | ✅ Yes (lint) / ❌ (fmt clause) | Excludes work for both tools; fmt scenario's "active files pass" unmet (C1) |
| Slice-6 file scope | ⚠️ Deviation | Untasked production change in `scripts/sync-models.ts` (token resolution, W2) |

## TDD Compliance

| Check | Result | Details |
|-------|--------|---------|
| TDD Evidence reported | ✅ | 25-row "TDD Cycle Evidence" table in apply-progress |
| All tasks have tests | ✅ | 25/25 rows list test files; all exist in the codebase |
| RED confirmed (tests exist) | ✅ | 25/25 test files present and executable |
| GREEN confirmed (tests pass) | ❌ | 24/25 claims verified at runtime (80/80 deno + 21/21 shell + smoke green); task 1.2's "deno fmt --check clean outside archives" claim is contradicted — `deno fmt --check` exits 1 (C2) |
| Triangulation adequate | ✅ | Multi-case rows verified; single-case rows justified (e.g. smoke scenario) |
| Safety Net for modified files | ✅ | Reported N/N per row; "new" rows match genuinely new files in git status |

**TDD Compliance**: 5/6 checks passed.

## Test Layer Distribution

| Layer | Tests | Files | Tools |
|-------|-------|-------|-------|
| Unit | 71 | 3 (`plugins/agy-bridge.bundle.test.ts`, `plugins/agy-bridge.test.ts`, `scripts/sync-models.test.ts`) | deno test (mocked runner/fetcher) |
| Integration | 21 | 1 (`tests/install.test.sh`) + `deno task bundle:plugin` | bash, mock HOME |
| E2E | 9 | 1 (`tests/service.test.ts`) | black-box harness: real HTTP, spawned service, mock agy |
| Runtime smoke | 1 | 1 (`tests/plugin-smoke.sh`) | live `opencode models` |
| **Total** | **80 deno + 21 shell + 1 smoke** | 6+ | |

Note: `openspec/config.yaml` `testing.layers` still says integration "none" / e2e "none" — stale versus reality (S4).

## Changed File Coverage

| File | Line % | Branch % | Uncovered Lines | Rating |
|------|--------|----------|-----------------|--------|
| `plugins/agy-bridge-helpers.ts` (unchanged, measured) | 100% | n/a | — | ✅ Excellent |
| `plugins/agy-bridge.ts` (generated bundle) | 62% | n/a | fetch-wrapper/hook paths exercised only by live smoke (uninstrumented) | ⚠️ Acceptable |
| `scripts/sync-models.ts` | 61% | n/a | CLI/main glue exercised by `install.test.sh` subprocess runs (uninstrumented) | ⚠️ Acceptable |
| `agy-bridge.ts`, `plugins/agy-bridge.plugin.ts`, `scripts/bundle-plugin.ts` | ➖ | ➖ | executed as subprocesses/tasks without coverage instrumentation | ➖ Not measured |

**Average changed-file coverage (measured files)**: 74% — below the 80% informational bar (W3), with the caveat that the largest changed file (`agy-bridge.ts`, 2-line comment change) is only exercisable via the uninstrumented service harness, which passes 9/9.

## Assertion Quality

| File | Line | Assertion | Issue | Severity |
|------|------|-----------|-------|----------|
| `scripts/sync-models.test.ts` | 235 | token `""` ⇒ no Authorization header | Does not neutralize ambient `AGY_TOKEN`, so it would also pass under the old `\|\|` semantics when the env var is unset — does not pin the new semantics | SUGGESTION |
| `plugins/agy-bridge.bundle.test.ts` | 58 | banner/source-of-truth substring checks | Named "Drift test" but detects only generated-marker absence; actual drift protection comes from the parity tests (live helpers import vs frozen bundle) | SUGGESTION |
| `plugins/agy-bridge.test.ts` | multiple | `source.includes(...)` assertions for tasks 4.x/5.x | Source-substring assertions are appropriate for wording/documentation tasks but brittle as behavioral guarantees; behavioral coverage exists in shell/E2E suites | SUGGESTION |

**Assertion quality**: 0 CRITICAL, 0 WARNING, 3 SUGGESTION. `tests/service.test.ts` (471 lines) audited in full: all 9 tests assert real behavior (status codes, JSON bodies, SSE frames + `[DONE]`, timing bound, transcript salvage content, retry semantics, fs cleanup) — no tautologies, ghost loops, or smoke-only assertions.

## Quality Metrics

**Linter**: ✅ No errors — `deno lint` exit 0, 12 files, 0 findings.
**Type Checker**: ✅ No errors — `deno check agy-bridge.ts` exit 0.
**Formatter**: ❌ `deno fmt --check` exit 1 (C1).

## Watch Items Resolution

1. **Smoke asserts 14 auto-* vs 16-id contract** — RESOLVED, no violation. The sandbox plugin gets 401 from the live bridge (auth on) and produces the 16-id fallback, but `opencode models` lists the machine-global `~/.config/opencode/opencode.json` static models: currently **14 models = 7 live bases × 2 profiles** (live `agy` catalog has retired `gemini-3.5-flash`; verified by direct inspection). The "14 auto + 2 base = 16" hypothesis is **not** the mechanism. The 16-id contract is fallback-shaped and code-verified (`buildModelMap` 16-key test green); the smoke's `≥ 14` floor accommodates both live-shape (14) and fallback-shape (16) listings. See S1.
2. **`scripts/sync-models.ts` token-resolution tweak (slice 6)** — NOT strictly behavior-neutral: `options.token || safeEnvGet("AGY_TOKEN")` → `options.token !== undefined ? …` changes behavior for an explicit empty-string token (previously fell back to env; now honored as empty ⇒ no Authorization header). Neutral on all current production call paths (install.sh invokes the script without `--token`; CLI default is `undefined`). Untasked production change bundled into the characterization slice — W2.
3. **471-line test-only file** — confirmed: `tests/service.test.ts` is 100% test code (harness + 9 tests), no production changes; accepted `size:exception`; rollback = delete the file. Informational.
4. **tasks.md count text (25 vs 31)** — no inconsistency found: `tasks.md` and `apply-progress.md` both list exactly 25 tasks, all `[x]`. No "31" text exists in the change folder; `31` appears only in immutable archived artifacts (old 31/31 test counts) — out of scope by convention.
5. **Active spec `opencode-provider` edited pre-archive** — reconciliation is sound: the main-spec edit is a single line (`yields 7 bases` → `yields 8 bases`) consistent with the delta's MODIFIED text (which also states 8); archive merge applies the delta's full requirement block without conflict. However, both the delta and the main spec retain the stale nested-`capabilities` wording (W1) — fix at or before archive.

## Issues Found

**CRITICAL**:
- **C1 — repo-hygiene "Scoped Lint and Format Gate" / scenario "Archive excluded from format" FAILS at runtime.** `deno fmt --check` exits 1 with 31/34 files needing formatting, including active TS sources (`agy-bridge.ts`, `plugins/agy-bridge-helpers.ts`, `plugins/agy-bridge.plugin.ts`, `scripts/*.ts`, `tests/service.test.ts`, …) and markdown. The exclude itself works (no archived file is checked), but the scenario's second clause — "active source files MUST pass formatting" — is false. `plugins/agy-bridge-helpers.ts` is byte-identical to HEAD (sha256 verified) and still fails, so the pre-change baseline was already non-conformant: the scenario was not achievable without a mass reformat of active code or a fmt-config/scope change. Proposal success criterion "fmt clean outside archives" is unmet.
- **C2 — Task 1.2 GREEN evidence contradicted.** apply-progress claims "deno fmt --check clean outside archives" as passed evidence; runtime shows exit 1. The covering test for task 1.2 asserts only the bare `@std/assert` import and `deno lint` exit 0 — the fmt clause was never test-verified. Same root cause as C1; reported separately because it is a TDD-evidence integrity issue (false completion claim), not just a spec failure.

**WARNING**:
- **W1 — Spec wording contradiction (opencode-provider vs model-sync).** The opencode-provider delta (and the pre-edited main spec) still require `capabilities: { reasoning: true }` / `capabilities.reasoning === true` in "Reasoning Model Shape Conformance", while the model-sync delta (same change) mandates the flat form (`reasoning: true` + `interleaved`) and forbids the nested `capabilities` wrapper — which is what the code emits and the tests assert (`capabilities === undefined`). Scenario marked PARTIAL. Reconcile the opencode-provider wording to the flat shape at or before archive.
- **W2 — Untasked production change in slice 6.** `scripts/sync-models.ts:150` token-resolution semantics change (see Watch Items #2). Behavior-affecting only for explicit empty-string tokens, which no production caller passes; covered by a passing but weakly-isolated unit test. Should have been its own task or explicitly recorded as a design amendment.
- **W3 — Changed-file coverage below 80%** on the two instrumented changed files (`plugins/agy-bridge.ts` 62%, `scripts/sync-models.ts` 61%); threshold is 0 so this is informational-only, and the gap is mostly paths exercised by uninstrumented subprocess/task runs (service harness 9/9, smoke, bundle task) — but recorded per strict rules.

**SUGGESTION**:
- **S1 — Smoke threshold depends on machine-global state.** `opencode models` in the smoke sandbox merges `~/.config/opencode/opencode.json` (14 live-synced models today) over the plugin's 16-id fallback. Consider isolating `HOME` in the smoke sandbox or asserting the exact expected set per shape, and document the 14-vs-16 accounting in the script header.
- **S2 — Rename "Task 3.4 Drift test"** (banner assertions) to a generated-marker name; drift protection actually lives in the parity tests.
- **S3 — Keep source-substring assertions scoped to wording tasks**; they are brittle as behavioral guarantees (behavioral coverage exists in shell/E2E suites).
- **S4 — Refresh `openspec/config.yaml` testing capabilities** (`layers.integration`/`layers.e2e` now exist; `coverage` is wired in practice via `deno test --coverage`).
- **S5 — Harden the empty-token test** by explicitly unsetting `AGY_TOKEN` so it pins the new `!== undefined` semantics.

## Verdict

**FAIL**

One spec scenario fails at runtime (`deno fmt --check` on active code — repo-hygiene format gate) and one task's GREEN evidence (1.2) is contradicted by the same runtime fact; all other runtime evidence passes (80/80 deno tests, 21/21 installer checks, live smoke green, typecheck and lint clean, bundle reproducible). Resolution options for the orchestrator: (a) mass `deno fmt` on active files (behavior-neutral but large diff — budget implications), (b) re-scope the scenario or adjust fmt config (e.g. line-width, exclude the generated bundle), or (c) amend task 1.2 and the spec to match delivered reality — then re-run verification.
