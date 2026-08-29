# Tasks: bridge-effort-reasoning-exposure

---
execution_mode: interactive
artifact_store.mode: openspec
delivery_strategy: ask-on-risk
review_budget_lines: 400
---

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 60–90 (helpers ~10, plugin mirror ~10, install.sh ~15, tests ~25) |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Enriched reasoning metadata + migration + tests (single deliverable) | PR 1 | `deno test plugins/agy-bridge.test.ts` | `opencode models \| grep agy-bridge` + `jq '.provider["agy-bridge"].models["auto-rw-gemini-3.7-flash"]'` + TUI picker check | Revert 3 files + re-run `./install.sh`, restart `opencode` |

## Phase 1: Foundation / Verification Pre-check

- [x] 1.1 Verify spec delta applied: `openspec/specs/opencode-provider/spec.md` vs `openspec/changes/bridge-effort-reasoning-exposure/specs/opencode-provider/spec.md`
- [x] 1.2 Confirm current `plugins/agy-bridge-helpers.ts:44-59` stale shape (`variantMap[v]={}` no capabilities) as baseline
- [x] 1.3 Confirm `install.sh:219-253` Python generator stale shape (`vmap={v:{}}` no capabilities, `len<14` guard only)

## Phase 2: Core Implementation

- [x] 2.1 Edit `plugins/agy-bridge-helpers.ts`: type `VariantSpec={reasoningEffort:string}`, `variantMap[v]={reasoningEffort:v}`, add `capabilities: variants.size?{reasoning:true}:undefined` (A1+A2)
- [x] 2.2 Mirror `plugins/agy-bridge.ts:51-67` identically: same `buildModelMap` enrichment, keep `resolveSlugs`/`installFetchWrapper` unchanged (A3 precedence: no `agy-bridge.ts` forwarding)
- [x] 2.3 Edit `install.sh:242-254` Python: `vmap={v:{"reasoningEffort":v} for v in sorted(vars)}`, emit `**({"capabilities":{"reasoning":True}} if vars else {})`, add staleness guard (regenerate if any entry lacks `capabilities.reasoning` or `variants.*.reasoningEffort`), keep permissions `600` unchanged (A4+A5)

## Phase 3: Testing (TDD — RED before GREEN)

- [x] 3.1 Update `plugins/agy-bridge.test.ts`: assert `variants.high.reasoningEffort==="high"` for all keys, `capabilities.reasoning===true` for non-singletons, no `capabilities.reasoning` for singleton `auto-ro-claude-sonnet-4-6` (A2), cover `thinking` variant
- [x] 3.2 Run RED then GREEN: `deno test plugins/agy-bridge.test.ts` must fail before 2.1 and pass after; add regression guard that test fails if capabilities/reasoningEffort regress
- [x] 3.3 Static checks: `deno check plugins/agy-bridge-helpers.ts && deno check plugins/agy-bridge.ts` (no new `--allow-*`)

## Phase 4: Migration & E2E Verification

- [x] 4.1 Regenerate `opencode.json`: run `./install.sh` once (idempotent), verify 14 ids via `opencode models | grep agy-bridge | wc -l` (=14)
- [x] 4.2 Verify staleness healing: inject stale `{"high":{}}` into `provider.agy-bridge.models["auto-rw-gemini-3.7-flash"]`, re-run `./install.sh`, assert `jq` shows `capabilities.reasoning` and `variants.*.reasoningEffort==key`
- [x] 4.3 Verify `jq '.provider["agy-bridge"].models["auto-rw-gemini-3.7-flash"]'` has `capabilities.reasoning:true` and `variants.high.reasoningEffort=="high"` (and `medium`/`low`); singleton `auto-ro-claude-sonnet-4-6` has `variants:{}` with no capabilities
- [x] 4.4 TUI + persistence check: `listReasoningEffortsFromModel` → `selectable` for gemini-3.7-flash, `unsupported` for claude-sonnet-4-6; set `agent.*.reasoningEffort="high"` → re-apply profile → effort retained (not cleared)
- [x] 4.5 Confirm `opencode.json` regenerated via install.sh (not hand-edited), `agy-bridge.ts` unchanged (effort forwarding deferred per A3)

## Phase 5: Cleanup

- [x] 5.1 Remove any temporary stale JSON fixtures; ensure no `file://` plugin ref regression
- [x] 5.2 Final `deno check` + `deno test` pass; document rollback: revert helpers/plugin/install.sh + re-run install.sh + restart opencode
