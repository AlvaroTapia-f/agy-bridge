# Tasks: bridge-live-thoughts

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 120–180 |
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
| 1 | DeltaKind routing + streaming fixes + tests | PR 1 | `deno test plugins/agy-bridge.test.ts` | `deno check agy-bridge.ts` + TUI `auto-ro-*` SSE check | Revert `agy-bridge.ts` + `plugins/agy-bridge-helpers.ts` + `plugins/agy-bridge.test.ts` |

## Phase 1: Foundation

- [x] 1.1 Add `DeltaKind` type to `agy-bridge.ts` ~L600
- [x] 1.2 Change `AgyStreamHandlers.onDelta` in `agy-bridge.ts` to `(kind: DeltaKind, text: string) => void`
- [x] 1.3 Update `plugins/agy-bridge-helpers.ts` — `formatDeltaChunk` routes `agent_response`→`content` else `reasoning_content`
- [x] 1.4 Update `plugins/agy-bridge-helpers.ts` — `onDeltaHandler` with empty-skip + routing

## Phase 2: Core

- [x] 2.1 Widen `agy-bridge.ts:702-706` — handle all `step_update`, map `step_type`→`DeltaKind`
- [x] 2.2 Unknown `step_type` → `reasoning_content` + `console.error` log
- [x] 2.3 Preserve empty-skip before `onDelta`

## Phase 3: Integration

- [x] 3.1 Update autonomous `agy-bridge.ts:918-933` — kind routing `content`/`reasoning_content`
- [x] 3.2 Remove duplicate `agy-bridge.ts:930` `chunk({content: r.text})`, keep `stop`
- [x] 3.3 Update tool-loop `agy-bridge.ts:1097-1125` — same routing; `parseToolCalls(r.text)` final only
- [x] 3.4 Verify non-tool `agy-bridge.ts:1126-1142` compatible with new `onDelta`

## Phase 4: Testing

- [x] 4.1 Update `plugins/agy-bridge.test.ts:208-292` — kind→`content`/`reasoning_content`
- [x] 4.2 Add test `plugins/agy-bridge.test.ts` — empty `text_delta` → no chunk
- [x] 4.3 Add test `plugins/agy-bridge.test.ts` — unknown logs + routes to `reasoning_content`
- [x] 4.4 Add test `plugins/agy-bridge.test.ts` — autonomous no-duplicate final
- [x] 4.5 Add test `plugins/agy-bridge.test.ts` — tool-loop live display-only, final parse ok
- [x] 4.6 Add test `plugins/agy-bridge.test.ts` — `delta_chars` sums both kinds

## Phase 5: Verification

- [x] 5.1 Run `deno check agy-bridge.ts` passes
- [x] 5.2 Run `deno test --allow-all` passes
- [x] 5.3 Manual SSE: `auto-ro-*` reasoning→content — superseded by `/tmp/disclose-raw.txt` (read-only) live test (ACTIVE NOTE deltas t=7.8s→42.5s); optional spot-check
- [x] 5.4 Restart `agy-bridge.service` — superseded by live test (no infra change)

## Phase 6: Narration Disclosure (2026-09-04)

> Live test `/tmp/disclose-raw.txt` (read-only) 45s: NOTE instruction makes intermediate `agent_response` emit live; bridge already forwards.

- [x] 6.1 Modify `agy-bridge.ts` — append `NARRATION_SUFFIX` to `prepared.prompt` only if `body.stream===true` in `handleAutonomousChat` streaming branch; non-auto/non-streaming unchanged
- [x] 6.2 Add test `plugins/agy-bridge.test.ts` — `stream:true` prompt has `NOTE:`; `stream:false` and non-auto do not; update forecast addendum

### Addendum — Review Workload Forecast (Phase 6)

| Field | Value |
|-------|-------|
| Phase 6 delta | +10–30 lines |
| Updated total | 130–210 |
| 400-line budget risk | Low |

Addendum: Decision needed before apply: No | Chained PRs recommended: No | Chain strategy: pending | 400-line budget risk: Low
