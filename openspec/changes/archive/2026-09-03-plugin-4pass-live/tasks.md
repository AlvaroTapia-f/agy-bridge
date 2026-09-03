# Tasks: plugin-4pass-live

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 140–180 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR — all FALLBACK + 4-pass + tests + verification |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: stacked-to-main
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | FALLBACK 14→17 + 4-pass self-contained plugin + Python fallback + parity tests + verification | PR 1 | `deno test plugins/agy-bridge.test.ts scripts/sync-models.test.ts` | `bash -n install.sh && deno check agy-bridge.ts plugins/agy-bridge.ts && deno task sync:models --dry-run \| grep -q '"auto-ro-gemini-3.8-flash"'` | `git revert HEAD` restores 1-pass plugin + 14-model FALLBACK across 5 files |

## Phase 1: Foundation — FALLBACK 14→17 + LOCKSTEP

- [x] 1.1 Append `gemini-3.8-flash-high/medium/low` to `plugins/agy-bridge-helpers.ts` `FALLBACK_MODELS` (14→17) + add `// LOCKSTEP:plugin-4pass-live`
- [x] 1.2 Append same 3 slugs to `agy-bridge.ts` `FALLBACK_MODELS` (L49-64, 14→17) + add `// LOCKSTEP:plugin-4pass-live`
- [x] 1.3 Append same 3 slugs to `plugins/agy-bridge.ts` `FALLBACK_MODELS` (L8-23, 14→17) + add `// LOCKSTEP:plugin-4pass-live`
- [x] 1.4 Update `install.sh` Python `fallback` list (L285-291) 14→17 same 3 slugs + add `# LOCKSTEP:plugin-4pass-live` + change `len(existing) < 14` → `< 16`

## Phase 2: Core Implementation — 4-pass grouping

- [x] 2.1 Replace 1-pass `groupBases` in `plugins/agy-bridge.ts` (L37-45) with 4-pass mirror from `plugins/agy-bridge-helpers.ts` (passes 1-4, ~+54 lines, self-contained, no imports)
- [x] 2.2 Port 4-pass logic into `install.sh` Python fallback (L292-305): pass 1 known suffixes, pass 2 prefix-match against known bases, pass 3 multi-variant prefix detection, pass 4 singletons via `defaultdict(set)`

## Phase 3: Testing (strict TDD — RED → GREEN)

- [x] 3.1 RED: Update `plugins/agy-bridge.test.ts` — `grouped.size` 7→8, `Object.keys(map).length` 14→16, add `grouped.get("gemini-3.8-flash") === Set([high,medium,low])`
- [x] 3.2 RED: Add parity test in `plugins/agy-bridge.test.ts` — import `groupBases` from plugin + helpers, run on `FALLBACK_MODELS`, `assertEquals` serialized output identical
- [x] 3.3 RED: Update `scripts/sync-models.test.ts` — `grouped.size` 7→8, map length 14→16, `res.slugs.length` 14→17, `result.count` 14→16 (covers 17/8/16)
- [x] 3.4 GREEN: Make 3.1–3.2 pass — `deno test plugins/agy-bridge.test.ts` green; plugin offline hook returns `auto-ro/rw-gemini-3.8-flash` with variants
- [x] 3.5 GREEN: Make 3.3 pass — `deno test scripts/sync-models.test.ts` green; fallback path produces 8 bases/16 ids

## Phase 4: Verification

- [x] 4.1 Run `bash -n install.sh` + `deno check agy-bridge.ts` + `deno check plugins/agy-bridge.ts` clean
- [x] 4.2 Run `deno test` all green; verify spec scenarios: opencode-provider fallback grouped 16 ids, self-contained execution, model-sync 17/8/16 parity
- [x] 4.3 Run `deno task sync:models --dry-run` verify 16 ids (8×2 profiles) + Python fallback `len(models)==16` via manual `python3 -c` on 17-slug list
