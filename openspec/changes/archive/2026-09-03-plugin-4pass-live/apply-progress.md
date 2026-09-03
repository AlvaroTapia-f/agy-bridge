# Apply Progress: plugin-4pass-live

**Change**: `plugin-4pass-live`
**Mode**: Strict TDD
**Date**: 2026-09-03

## Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command and exact result | `deno test plugins/agy-bridge.test.ts scripts/sync-models.test.ts` (36 tests passed, 0 failed, exit 0) |
| Runtime harness command/scenario and exact result | `bash -n install.sh && deno check agy-bridge.ts plugins/agy-bridge.ts plugins/agy-bridge-helpers.ts scripts/sync-models.ts && deno task sync:models --dry-run` (Clean check, dry-run emitted 16 models across 8 bases) |
| Rollback boundary | `git revert HEAD` restores 1-pass plugin and 14-model FALLBACK across 5 affected files |

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 1.1-1.4 | `scripts/sync-models.test.ts`, `plugins/agy-bridge.test.ts` | Unit | ✅ 34/34 passing | ✅ Assertions failed on 14 slugs | ✅ 17 slugs loaded across 3 TS files + Python | ✅ Dynamic resolution fallback checked | ✅ LOCKSTEP comments added |
| 2.1-2.2 | `plugins/agy-bridge.test.ts` | Unit | ✅ 34/34 passing | ✅ Missing 4-pass grouping in plugin | ✅ 4-pass mirror implemented in plugin & install.sh | ✅ Parity tested against helpers on FALLBACK and dynamic slugs | ✅ Clean, self-contained |
| 3.1-3.5 | `plugins/agy-bridge.test.ts`, `scripts/sync-models.test.ts` | Unit | ✅ 34/34 passing | ✅ 5 failures (type error & count diffs) | ✅ All 36 tests passing | ✅ 8 bases / 16 models / parity / 3.8 variants verified | ✅ Clean assertions |
| 4.1-4.3 | `install.sh`, `agy-bridge.ts`, `plugins/agy-bridge.ts`, `scripts/sync-models.ts` | Integration / System | ✅ 36/36 passing | ✅ N/A | ✅ Syntax check, deno check, dry-run, and python3 verification passed | ✅ Python 4-pass output verified (len=16) | ✅ Complete |

## Test Summary
- **Total tests written/updated**: 36
- **Total tests passing**: 36
- **Layers used**: Unit (34), Integration / Provider hook (2)
- **Approval tests**: None — tests asserted expected behavioral delta
- **Pure functions created/mirrored**: `groupBases` (4-pass in plugin, self-contained)

## Completed Tasks

### Phase 1: Foundation — FALLBACK 14→17 + LOCKSTEP
- [x] 1.1 Append `gemini-3.8-flash-high/medium/low` to `plugins/agy-bridge-helpers.ts` `FALLBACK_MODELS` (14→17) + add `// LOCKSTEP:plugin-4pass-live`
- [x] 1.2 Append same 3 slugs to `agy-bridge.ts` `FALLBACK_MODELS` (L49-64, 14→17) + add `// LOCKSTEP:plugin-4pass-live`
- [x] 1.3 Append same 3 slugs to `plugins/agy-bridge.ts` `FALLBACK_MODELS` (L8-23, 14→17) + add `// LOCKSTEP:plugin-4pass-live`
- [x] 1.4 Update `install.sh` Python `fallback` list (L285-291) 14→17 same 3 slugs + add `# LOCKSTEP:plugin-4pass-live` + change `len(existing) < 14` → `< 16`

### Phase 2: Core Implementation — 4-pass grouping
- [x] 2.1 Replace 1-pass `groupBases` in `plugins/agy-bridge.ts` (L37-45) with 4-pass mirror from `plugins/agy-bridge-helpers.ts` (passes 1-4, self-contained, no imports)
- [x] 2.2 Port 4-pass logic into `install.sh` Python fallback (L292-305): pass 1 known suffixes, pass 2 prefix-match against known bases, pass 3 multi-variant prefix detection, pass 4 singletons via `defaultdict(set)`

### Phase 3: Testing (strict TDD — RED → GREEN)
- [x] 3.1 RED: Update `plugins/agy-bridge.test.ts` — `grouped.size` 7→8, `Object.keys(map).length` 14→16, add `grouped.get("gemini-3.8-flash") === Set([high,medium,low])`
- [x] 3.2 RED: Add parity test in `plugins/agy-bridge.test.ts` — import `groupBases` from plugin + helpers, run on `FALLBACK_MODELS`, `assertEquals` serialized output identical
- [x] 3.3 RED: Update `scripts/sync-models.test.ts` — `grouped.size` 7→8, map length 14→16, `res.slugs.length` 14→17, `result.count` 14→16 (covers 17/8/16)
- [x] 3.4 GREEN: Make 3.1–3.2 pass — `deno test plugins/agy-bridge.test.ts` green; plugin offline hook returns `auto-ro/rw-gemini-3.8-flash` with variants
- [x] 3.5 GREEN: Make 3.3 pass — `deno test scripts/sync-models.test.ts` green; fallback path produces 8 bases/16 ids

### Phase 4: Verification
- [x] 4.1 Run `bash -n install.sh` + `deno check agy-bridge.ts` + `deno check plugins/agy-bridge.ts` clean
- [x] 4.2 Run `deno test` all green; verify spec scenarios: opencode-provider fallback grouped 16 ids, self-contained execution, model-sync 17/8/16 parity
- [x] 4.3 Run `deno task sync:models --dry-run` verify 16 ids (8×2 profiles) + Python fallback `len(models)==16` via manual `python3 -c` on 17-slug list

## Files Changed

| File | Action | What Was Done |
|---|---|---|
| `plugins/agy-bridge-helpers.ts` | Modified | Appended 3x `gemini-3.8-flash-{high,medium,low}` to `FALLBACK_MODELS` (14→17) + `// LOCKSTEP:plugin-4pass-live` |
| `agy-bridge.ts` | Modified | Appended 3x `gemini-3.8-flash-{high,medium,low}` to `FALLBACK_MODELS` (14→17) + `// LOCKSTEP:plugin-4pass-live` |
| `plugins/agy-bridge.ts` | Modified | Appended 3x `gemini-3.8-flash-{high,medium,low}` to `FALLBACK_MODELS` (14→17) + `// LOCKSTEP:plugin-4pass-live`, replaced 1-pass `groupBases` with self-contained 4-pass mirror |
| `install.sh` | Modified | Appended 3x `gemini-3.8-flash-{high,medium,low}` to `fallback` (14→17) + `# LOCKSTEP:plugin-4pass-live`, ported 4-pass grouping logic, updated guard to `< 16` |
| `plugins/agy-bridge.test.ts` | Modified | Updated assertions to 17 slugs / 8 bases / 16 ids, added gemini-3.8-flash tests, added plugin↔helpers parity tests |
| `scripts/sync-models.test.ts` | Modified | Updated assertions to 17 slugs / 8 bases / 16 models for fallback and dynamic scenarios |
| `openspec/changes/plugin-4pass-live/tasks.md` | Modified | Marked all 14 tasks complete (`[x]`) |

## Deviations from Design
None — implementation matches design.

## Issues Found
None.

## Workload / PR Boundary
- Mode: single PR
- Current work unit: Work Unit 1 (all FALLBACK + 4-pass + tests + verification)
- Boundary: Starts from 14-model baseline, ends with 17/8/16 parity across Deno and Python
- Estimated review budget impact: ~150 lines changed (Low risk)

## Status
14/14 tasks complete. Ready for verify.
