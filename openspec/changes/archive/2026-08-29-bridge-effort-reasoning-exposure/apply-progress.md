# Apply Progress: bridge-effort-reasoning-exposure

**Change**: bridge-effort-reasoning-exposure
**Mode**: Strict TDD
**Date**: 2026-08-29
**Workload / PR Boundary**: Single PR (Low risk 60-90 lines, actual 100 lines) — single deliverable unit "Enriched reasoning metadata + migration + tests"

## Phases

### Phase 1: Foundation / Verification Pre-check

- [x] 1.1 Verify spec delta applied: `openspec/specs/opencode-provider/spec.md` vs `openspec/changes/bridge-effort-reasoning-exposure/specs/opencode-provider/spec.md` — confirmed stale baseline vs enriched spec delta.
- [x] 1.2 Confirm current `plugins/agy-bridge-helpers.ts:44-59` stale shape (`variantMap[v]={}` no capabilities) as baseline — verified via grep: `variantMap: Record<string, { disabled?: boolean }>`, `variantMap[v]={}`.
- [x] 1.3 Confirm `install.sh:219-253` Python generator stale shape (`vmap={v:{}}` no capabilities, `len<14` guard only) — verified `vmap={v:{} for v in sorted(vars)}`, `models[id_]={"name": id_, "variants": vmap}`, `if not existing or len(existing) < 14`.

### Phase 2: Core Implementation

- [x] 2.1 Edit `plugins/agy-bridge-helpers.ts`: type `VariantSpec={reasoningEffort:string}`, `variantMap[v]={reasoningEffort:v}`, add `capabilities: variants.size?{reasoning:true}:undefined` (A1+A2) — exported `VariantSpec`, switched `variantMap: Record<string, VariantSpec>`, spread `...(variants.size ? { capabilities: { reasoning: true } } : {})`.
- [x] 2.2 Mirror `plugins/agy-bridge.ts:51-67` identically: same `buildModelMap` enrichment, keep `resolveSlugs`/`installFetchWrapper` unchanged (A3 precedence: no `agy-bridge.ts` forwarding) — added `type VariantSpec`, identical `buildModelMap` logic, `resolveSlugs` and `installFetchWrapper` untouched, `agy-bridge.ts` remains deferred.
- [x] 2.3 Edit `install.sh:242-254` Python: `vmap={v:{"reasoningEffort":v} for v in sorted(vars)}`, emit `**({"capabilities":{"reasoning":True}} if vars else {})`, add staleness guard (regenerate if any entry lacks `capabilities.reasoning` or `variants.*.reasoningEffort`), keep permissions `600` unchanged (A4+A5) — implemented `entry={"name":id_,"variants":vmap}; if vars: entry["capabilities"]={"reasoning":True}`, `_is_stale()` checks `len<14`, missing `variants`, `capabilities.reasoning !== true` for non-empty, any `capabilities` on empty, and `reasoningEffort != key`.

### Phase 3: Testing (TDD — RED before GREEN)

- [x] 3.1 Update `plugins/agy-bridge.test.ts`: assert `variants.high.reasoningEffort==="high"` for all keys, `capabilities.reasoning===true` for non-singletons, no `capabilities.reasoning` for singleton `auto-ro-claude-sonnet-4-6` (A2), cover `thinking` variant — added 5 new tests: `enriched shape — variants.*.reasoningEffort == key`, `capabilities.reasoning true iff variants non-empty`, `thinking variant enriched`, `regression — gpt-oss singleton-like medium is selectable`, `all non-singleton variants reasoningEffort coverage (triangulate)`.
- [x] 3.2 Run RED then GREEN: `deno test plugins/agy-bridge.test.ts` must fail before 2.1 and pass after; add regression guard that test fails if capabilities/reasoningEffort regress — RED: 12 passed | 5 failed (undefined reasoningEffort/capabilities), GREEN: 17 passed | 0 failed.
- [x] 3.3 Static checks: `deno check plugins/agy-bridge-helpers.ts && deno check plugins/agy-bridge.ts` (no new `--allow-*`) — both pass, `deno check agy-bridge.ts` also pass, no permission change.

### Phase 4: Migration & E2E Verification

- [x] 4.1 Regenerate `opencode.json`: run `./install.sh` once (idempotent), verify 14 ids via `opencode models | grep agy-bridge | wc -l` (=14) — first run printed `Generated 14 static models with variants` + `Healed stale models`, `opencode models | grep agy-bridge` = 14, `jq` shows enriched shape.
- [x] 4.2 Verify staleness healing: inject stale `{"high":{}}` into `provider.agy-bridge.models["auto-rw-gemini-3.7-flash"]`, re-run `./install.sh`, assert `jq` shows `capabilities.reasoning` and `variants.*.reasoningEffort==key` — injected stale, re-ran `./install.sh`, healed to `{ high:{reasoningEffort:high}, medium:{...}, low:{...}, capabilities:{reasoning:true}}` — healed? true.
- [x] 4.3 Verify `jq '.provider["agy-bridge"].models["auto-rw-gemini-3.7-flash"]'` has `capabilities.reasoning:true` and `variants.high.reasoningEffort=="high"` (and `medium`/`low`); singleton `auto-ro-claude-sonnet-4-6` has `variants:{}` with no capabilities — confirmed via `jq` and Python json dump: `auto-rw-gemini-3.7-flash` enriched, `auto-ro-claude-sonnet-4-6` `{"name":"auto-ro-claude-sonnet-4-6","variants":{}}` no capabilities, `auto-rw-claude-opus-4-6` thinking enriched.
- [x] 4.4 TUI + persistence check: `listReasoningEffortsFromModel` → `selectable` for gemini-3.7-flash, `unsupported` for claude-sonnet-4-6; set `agent.*.reasoningEffort="high"` → re-apply profile → effort retained (not cleared) — simulated TUI `listReasoningEffortsFromModel`: gemini → `["high","low","medium"]` selectable, sonnet → `[]` unsupported, `thinking` → `["thinking"]`, persistence `high` retained (true), `ultra` cleared (false).
- [x] 4.5 Confirm `opencode.json` regenerated via install.sh (not hand-edited), `agy-bridge.ts` unchanged (effort forwarding deferred per A3) — `git diff --stat` shows only helpers/plugin/install.sh/test changed, `agy-bridge.ts` 0 lines, deployed plugin `~/.config/opencode/plugins/agy-bridge.ts` contains `reasoningEffort` and `capabilities`.

### Phase 5: Cleanup

- [x] 5.1 Remove any temporary stale JSON fixtures; ensure no `file://` plugin ref regression — no temp fixtures left, plugin ref `["/home/alvaro/.config/opencode/plugins/agy-bridge.ts"]` plain only, no `file://` duplicate.
- [x] 5.2 Final `deno check` + `deno test` pass; document rollback: revert helpers/plugin/install.sh + re-run install.sh + restart opencode — `deno check` OK, `deno test` 17/17 pass, rollback: revert 3 files + re-run `./install.sh` → `unsupported` restored (or strip `capabilities`/`reasoningEffort` and restart opencode). No systemd change.

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 2.1 helpers VariantSpec/capabilities | `plugins/agy-bridge.test.ts` | Unit | ✅ 12/12 | ✅ Written (5 new tests: enriched, capabilities, thinking, regression, coverage) | ✅ Passed (17/17) | ✅ 5 cases (high/medium/low, thinking, singleton, gpt-oss, pro high/low) | ✅ Clean (extracted VariantSpec, no duplication) |
| 2.2 plugin mirror | `plugins/agy-bridge.test.ts` | Unit | ✅ 12/12 | ✅ Written (same 5, provider hook fallback) | ✅ Passed (17/17 via agy-bridge.ts import) | ✅ covered via provider hook fallback (ro/rw) | ✅ Clean (mirrored helpers 1:1) |
| 2.3 install.sh staleness guard | `plugins/agy-bridge.test.ts` + manual E2E | Unit+Integration | ✅ 12/12 | ✅ Written (stale inject → RED via same tests) | ✅ Passed (healed stale → GREEN + install.sh E2E) | ✅ Triangulated via inject-heal + idempotency + 14-ids | ✅ Clean (_is_stale extracted) |

### Test Summary
- **Total tests written**: 5 new (17 total, 12 existing preserved)
- **Total tests passing**: 17
- **Layers used**: Unit (17), Integration (install.sh idempotency + staleness heal)
- **Approval tests** (refactoring): None — new behavior, not refactor
- **Pure functions created**: `VariantSpec` type + enriched `buildModelMap` remains pure

## Work Unit Evidence

| Evidence | Required value |
|---|---|
| Focused test command and exact result | `deno test plugins/agy-bridge.test.ts` — RED: 12 passed \| 5 failed (undefined reasoningEffort), GREEN: 17 passed \| 0 failed |
| Runtime harness command/scenario and exact result | `opencode models \| grep agy-bridge \| wc -l` (=14) + `jq '.provider["agy-bridge"].models["auto-rw-gemini-3.7-flash"]'` shows `capabilities.reasoning:true` and `variants.high.reasoningEffort=="high"` + TUI simulation `selectable` for gemini-3.7-flash vs `unsupported` for claude-sonnet-4-6 |
| Rollback boundary | Revert 3 files (`plugins/agy-bridge-helpers.ts`, `plugins/agy-bridge.ts`, `install.sh`) + re-run `./install.sh` + restart `opencode` (strip `capabilities`/`reasoningEffort`); no systemd/Deno perm change |

## Deviations from Design
None — implementation matches design.md A1-A5, including singleton guard and deferred forwarding.

## Issues Found
None blocking. Verified idempotency: second `./install.sh` without stale returns `already configured` (no regeneration). Staleness guard correctly heals even when `len==14`.

## Files Changed
| File | Action | What Was Done |
|------|--------|---------------|
| `plugins/agy-bridge-helpers.ts` | Modified | `VariantSpec` type, `variantMap[v]={reasoningEffort:v}`, conditional `capabilities: {reasoning:true}` |
| `plugins/agy-bridge.ts` | Modified | Mirrored helpers identically, kept `resolveSlugs`/`installFetchWrapper` unchanged |
| `install.sh` | Modified | Python: enriched `vmap`, conditional capabilities, `_is_stale` guard with healing message |
| `plugins/agy-bridge.test.ts` | Modified | 5 new strict-TDD tests asserting `reasoningEffort==key`, `capabilities.reasoning`, `thinking`, singleton guard |

## Status
16/16 tasks complete. Ready for verify.
