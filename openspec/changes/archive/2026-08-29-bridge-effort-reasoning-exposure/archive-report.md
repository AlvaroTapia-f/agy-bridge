# Archive Report: bridge-effort-reasoning-exposure

**Change**: bridge-effort-reasoning-exposure
**Archived to**: `openspec/changes/archive/2026-08-29-bridge-effort-reasoning-exposure/`
**Date**: 2026-08-29
**Mode**: openspec
**Execution mode**: interactive
**Delivery strategy**: ask-on-risk (400-line budget: Low)
**Review gate**: absent — no receipt-driven review was started for this candidate; archive proceeds under ordinary repository policy per Native Review Receipt Gate.

## Final State Authority

This report is the terminal record at close. It outranks intermediate snapshots per the hierarchy: reviewGate > persisted tasks artifact > explicit final-state facts (orchestrator launch prompt) > verify-report / apply-progress.

**Final-state facts (orchestrator, outranks stale snapshots):**
- `verify-report.md` is PASS — 17/17 tests, 10/10 scenarios, 5/5 requirements, 0 warnings, 0 blockers, 0 critical findings. `deno check agy-bridge.ts` pass.
- `install.sh` was patched AFTER verify to add section #7 that idempotently patches `~/.cache/opencode/packages/opencode-sdd-engram-manage@latest/dist/tui.js` `listReasoningEffortsFromModel` to accept `variants.*.reasoningEffort` even when `capabilities.reasoning` is false (workaround for `@ai-sdk/openai-compatible` overwriting capabilities). Verified: re-run shows "already patched" when patched and "Patched" when reverted. This file was NOT in original tasks but is the final end-to-end fix for agy-bridge effort in `/sdd-model`.
- Live provider verified via direct Deno import of plugin `provider.models` (14 models, capabilities true, variants correct) and via TUI debug log that showed live `hasAgy` had `capabilities false` (SDK overwrite) — hence the TUI patch was necessary.
- All 16 tasks in `apply-progress.md` are complete; `tasks.md` checkboxes were 0/16 stale in file but `apply-progress` is source of truth — archived `tasks.md` was reconciled to 16/16 at archive time (see Task Reconciliation below).
- No Deno permission change, no `agy-bridge.ts` change (deferred per design A3/A5).

**Attribution for snapshot-derived claims:**
- Per `verify-report.md` (verify time) — 5/5 requirements, 10/10 scenarios, 17/17 tests PASS, no warnings.
- Per `apply-progress.md` (apply time) — 16/16 tasks complete, TDD RED 12/5 → GREEN 17/0, design A1-A5 implemented.

## Specs Synced

| Domain | Action | Details |
|--------|--------|---------|
| opencode-provider | Updated | 1 modified, 4 added, 0 removed requirements |

**MODIFIED:**
- `Effort Variants` — enriched to require `capabilities.reasoning: true` when variants non-empty and `variants.<k> = { reasoningEffort: k }`; singleton `claude-sonnet-4-6` MUST NOT advertise reasoning; retains 3 scenarios (Picker, Editing effort on supported model is selectable, Editing effort on singleton is unsupported).

**ADDED:**
- `Reasoning Model Shape Conformance` — `buildModelMap` and `install.sh` fallback MUST conform identically to Effort Variants; 2 scenarios (buildModelMap emits enriched shape, install.sh fallback emits identical shape).
- `Reasoning Effort Persistence` — `agent.<name>.reasoningEffort` MUST survive profile re-apply when selectable; 2 scenarios (Profile sync persistence, Incompatible effort cleared MAY clear).
- `Stale Model Migration` — `./install.sh` MUST regenerate stale entries; 2 scenarios (Stale JSON migration, Verification after migration).
- `Reasoning Effort Test Coverage` — `plugins/agy-bridge.test.ts` MUST assert enriched shape and fail on regression; 1 scenario.

**Preserved:** All other requirements unchanged — Global Provider Registration, Auto-Prefixed Model Enumeration, Variant-to-Suffix Wire Contract, Per-Request Bearer Auth, BaseURL and Host Correctness, End-to-End Verification, Rollback, Bridge Non-Bannable Guarantee.

Main spec updated at: `openspec/specs/opencode-provider/spec.md` (200 lines, 13 requirements).

## Archive Contents

- proposal.md ✅
- exploration.md ✅
- design.md ✅
- specs/opencode-provider/spec.md (delta) ✅
- tasks.md ✅ (16/16 complete after reconciliation)
- apply-progress.md ✅
- verify-report.md ✅ (PASS)
- archive-report.md ✅ (this file, additive-only)

## Source of Truth Updated

The following specs now reflect the new behavior:
- `openspec/specs/opencode-provider/spec.md`

Delta applied verbatim from `openspec/changes/archive/2026-08-29-bridge-effort-reasoning-exposure/specs/opencode-provider/spec.md` into main spec. No destructive removal; merge preserved non-delta requirements.

## Verification

- [x] Main specs updated correctly — 13 requirements, enriched Effort Variants + 4 ADDED requirements verified via `grep "^### Requirement"`
- [x] Change folder moved to archive — `openspec/changes/bridge-effort-reasoning-exposure` no longer exists, `openspec/changes/archive/2026-08-29-bridge-effort-reasoning-exposure/` contains all artifacts
- [x] Archive contains all artifacts (proposal, specs, design, tasks, apply-progress, verify-report, archive-report)
- [x] Archived `tasks.md` has no unchecked implementation tasks — 16/16 checked after stale-checkbox reconciliation
- [x] Active changes directory no longer has this change
- [x] Verbatim `diff -r` readback output is empty (no differences) — see below

### Mechanical Copy Evidence

**Spec sync:** Not a verbatim copy (merge into existing spec) — edit applied via requirement replacement; preserved all non-delta requirements. No `diff -r` for merge; verification via requirement count and scenario preservation above.

**Archive move `diff -r` (MANDATORY readback):**
```
(empty — no differences)
```
Snapshot taken with `cp -R openspec/changes/bridge-effort-reasoning-exposure → $snapshot_root/source` before `mv` to `openspec/changes/archive/2026-08-29-bridge-effort-reasoning-exposure`; `diff -r "$snapshot_root/source" "openspec/changes/archive/2026-08-29-bridge-effort-reasoning-exposure"` returned empty. `git mv` failed (source untracked), fallback `mv` succeeded; source verified gone before diff.

## Task Reconciliation

**Gate finding:** `tasks.md` showed 0/16 checked (`- [ ]` ×16) while `apply-progress.md` proved 16/16 complete with TDD evidence and `verify-report.md` confirmed PASS.

**Orchestrator authorization:** Explicit instruction that `apply-progress.md` is source of truth and archive should sync/note the stale checkboxes. Final-state facts rank orchestrator launch prompt above intermediate snapshot claims per Final-State Authority hierarchy.

**Action taken (exceptional repair per Task Completion Gate clause 3):** Mechanical `sed -i 's/^- \[ \]/- [x]/'` on `tasks.md` before archive move. Archived `tasks.md` now 16/16 checked. Reason recorded here; no unchecked implementation tasks remain in archived audit trail.

## Post-Verify Work (Not in Original Tasks)

File `install.sh` section #7 (TUI patch) was added after verify to make the fix automatic on fresh installs:

- Location: `install.sh:426-459` — idempotently patches `~/.cache/opencode/packages/opencode-sdd-engram-manage@latest/dist/tui.js` `listReasoningEffortsFromModel` to accept `hasReasoningEffort` (any `variants.*.reasoningEffort` string) even when `capabilities.reasoning !== true`.
- Rationale: `@ai-sdk/openai-compatible` overwrites `capabilities.reasoning` to false for agy-bridge models despite correct provider metadata; TUI gate `capabilities.reasoning !== true` then blocks effort editing. Verified live via TUI debug log (`hasAgy` false) and via Deno import (`capabilities true` in provider hook).
- Verification: Re-running `install.sh` shows "already patched" when patched, "Patched" when reverted to original.
- This patch is the end-to-end fix that makes `/sdd-model` effort work for agy-bridge; delta spec's provider metadata alone is necessary but not sufficient due to SDK overwrite. Documented here for audit trail; no spec change required (spec declares provider SHOULD emit capabilities; SDK behavior is external).

**Other final facts:** No Deno `--allow-*` change; `agy-bridge.ts` unchanged (effort forwarding deferred); live provider verified via `deno import` (14 models) and `opencode models | grep agy-bridge` (14 ids), `jq` shows `capabilities.reasoning:true` + `variants.*.reasoningEffort==key` for non-singletons.

## Risks and Follow-ups

- **TUI patch volatility:** `~/.cache/opencode/packages/.../tui.js` is cache-managed and re-downloaded on `opencode` upgrades; `install.sh` must be re-run after upgrades to re-apply patch until upstream `@ai-sdk/openai-compatible` or `opencode-sdd-engram-manage` fixes the overwrite. Mitigated by idempotent section #7.
- **Upstream fix pending:** Ideal fix is in `@ai-sdk/openai-compatible` to not overwrite provider `capabilities` or in `opencode-sdd-engram-manage` to gate on `variants.*.reasoningEffort` alone. Current workaround is intentional.
- **Singleton correctness:** `claude-sonnet-4-6` intentionally remains `variants:{}` with no capabilities → TUI `unsupported` is correct; no effort UX for singleton.
- **Variant vocabulary drift:** If agy adds new effort suffixes outside `{high,medium,low,thinking}`, `EFFORT_SUFFIXES` and `FALLBACK_MODELS` must be updated together (1:1 mapping assumed).
- **Second problem scope:** Exploration noted title "dos problemas" but only first (effort) was described; proposal scoped to effort only. Second problem remains out-of-scope and needs separate SDD cycle if specified.

## Implementation Summary

- `plugins/agy-bridge-helpers.ts` — `VariantSpec` type, `variantMap[v]={reasoningEffort:v}`, conditional `capabilities: {reasoning:true}`.
- `plugins/agy-bridge.ts` — mirrored helpers identically; `resolveSlugs`/`installFetchWrapper` unchanged.
- `install.sh` — Python enriched `vmap`, conditional capabilities, `_is_stale` guard healing even when `len==14`, plus section #7 TUI patch.
- `plugins/agy-bridge.test.ts` — 5 new TDD tests (enriched shape, capabilities iff non-empty, thinking, gpt-oss regression, triangulation); 17/17 pass.
- `opencode.json` — regenerated via `./install.sh` (14 ids, healed stale).

## SDD Cycle Complete

The change has been fully planned (proposal, exploration, spec, design), implemented (16/16 tasks, TDD RED→GREEN), verified (PASS 17/17, 10/10 scenarios, 5/5 requirements), and archived with post-verify TUI patch. Ready for the next change.

## Traceability

- Change: `bridge-effort-reasoning-exposure`
- Delta spec: `openspec/changes/archive/2026-08-29-bridge-effort-reasoning-exposure/specs/opencode-provider/spec.md`
- Main spec: `openspec/specs/opencode-provider/spec.md`
- Verify: `openspec/changes/archive/2026-08-29-bridge-effort-reasoning-exposure/verify-report.md` — evidence_revision sha256:02fe5bf8339c2c154319a45c473ff010f2bf8cadda40d0e91e4f9e7a045c24b4, test_output_hash sha256:31a8e0e334cfa92303e8842f15045cee546847b44fa64409936032a445d6518f, build_output_hash sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
- Files changed: `plugins/agy-bridge-helpers.ts`, `plugins/agy-bridge.ts`, `install.sh`, `plugins/agy-bridge.test.ts`
