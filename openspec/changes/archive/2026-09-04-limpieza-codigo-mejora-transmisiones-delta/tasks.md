# Tasks: Code Cleanup and Delta Transmissions as Native Thinking Blocks

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~430–520 (additions+deletions) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | Slice 1 (thinking fix) → Slice 2 (hygiene) |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

Decision needed before apply: No (resolved to stacked-to-main)
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Thinking fix: NOTE classifier + flush + flat interleaved capability + service wiring | PR 1 | `deno test plugins/agy-bridge.test.ts` then `deno test` | Live `curl` SSE on `agy-bridge.service` `auto-*` stream; confirm thinking blocks + `interleaved` in `opencode.json` (read-only, runtime) | `git revert` slice-1 commits; restart service; independent of slice 2 |
| 2 | Hygiene: dead-code removal, model-sync auth, README/comments | PR 2 | `deno test scripts/sync-models.test.ts` then `deno test` (46 baseline + new) | `deno task sync:models` rewrites `opencode.json` with Authorization forwarded; confirm via logs | `git revert` slice-2 commits; re-run `sync:models` |

## Phase 1: Classifier helper (helpers)

- [x] 1.1 RED test: NOTE line split across deltas → `reasoning_content` (`plugins/agy-bridge.test.ts`)
- [x] 1.2 RED test: NOTE→reasoning then answer→content; turn-end `flush()` residual→content
- [x] 1.3 RED test: identical chunk sequence via shared classifier across all paths
- [x] 1.4 Implement `createNoteClassifier` + `classifyLine` in `plugins/agy-bridge-helpers.ts` (line-buffer, flush, empty skip, unknown logging)
- [x] 1.5 RED test: `buildModelMap` emits flat `interleaved: { field: "reasoning_content" }` + `reasoning: true`, no nested `capabilities`
- [x] 1.6 Update `buildModelMap` (`plugins/agy-bridge-helpers.ts`): flat shape; remove nested `capabilities`; retire `onDeltaHandler`/`formatDeltaChunk`

## Phase 2: Service wiring

- [x] 2.1 RED test: autonomous path routes via shared classifier (`agy-bridge.ts`)
- [x] 2.2 Replace 3 inline `onDelta` blocks (L942-950, L1127-1135, L1156-1164) with `createNoteClassifier` calls + `flush()` at finalization
- [x] 2.3 Add `import ... from "./plugins/agy-bridge-helpers.ts"` in `agy-bridge.ts`

## Phase 3: Plugin capability shape

- [x] 3.1 Mirror flat `interleaved`/`reasoning` shape in plugin `buildModelMap` (`plugins/agy-bridge.ts`, LOCKSTEP)
- [x] 3.2 RED parity: drift-guard test — plugin `groupBases` == helpers `groupBases` on same input (`plugins/agy-bridge.test.ts`)

## Phase 4: Verification — slice 1

- [x] 4.1 `deno check agy-bridge.ts`; `deno test` (46 baseline + new); `deno lint`/`deno fmt`
- [x] 4.2 Live SSE E2E: `curl` `auto-*` stream — NOTE lines render as thinking blocks, final answer as content; confirm `interleaved` survives enrichment in `opencode.json` (read-only, runtime)

## Phase 5: model-sync auth (slice 2)

- [x] 5.1 RED test: `fetcher` receives `Authorization: Bearer` header (`scripts/sync-models.test.ts`)
- [x] 5.2 Widen `fetcher` to `(url, init?)` and call `fetcher(url, { headers })` forwarding Authorization (`scripts/sync-models.ts`)

## Phase 6: Dead state + docs hygiene (slice 2)

- [x] 6.1 Remove dead `variantBySession` map + write (`plugins/agy-bridge.ts` L158, L293)
- [x] 6.2 Remove local `FALLBACK_MODELS` + `NARRATION_SUFFIX` copies from `agy-bridge.ts` (use imported helpers)
- [x] 6.3 Update README counts 7/14 → 8/16 (`README.md` L159, L179, L294)
- [x] 6.4 Fix stale autonomous-stream one-chunk comment (`agy-bridge.ts` L908-911)

## Phase 7: Verification — slice 2

- [x] 7.1 `deno check`/`test`/`lint`/`fmt` full suite green (46 baseline + new)
- [x] 7.2 Runtime: `deno task sync:models`, restart `agy-bridge.service`, confirm auth forwarded + `opencode.json` shape (runtime; `opencode.json` not an edit target)

Note: threat matrix is N/A (data-plane only) — RED tests derive from spec scenarios, not threat rows.