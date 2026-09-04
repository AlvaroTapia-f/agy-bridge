# Tasks: bridge-delta-messages

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~65–90 (25 agy-bridge.ts + 40 tests + task overhead) |
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
| 1 | Stream `reasoning_content` deltas in both autonomous + tool-loop paths with empty-skip, keepalive, final-content intact | PR 1 (single) | `deno test plugins/agy-bridge.test.ts` | `deno run --allow-net --allow-run=agy agy-bridge.ts` then `curl -N POST /v1/chat/completions` with `auto-ro-gemini-3.7-flash-high stream:true` — assert SSE deltas + final content | Revert 2-file change (`agy-bridge.ts`, `plugins/agy-bridge.test.ts`), `deno check agy-bridge.ts`, restart `agy-bridge.service` |

## Phase 1: Foundation — RED Tests (strict_tdd)

- [x] 1.1 Add RED test in `plugins/agy-bridge.test.ts` for autonomous `onDelta` non-empty → emits `choices[0].delta.reasoning_content` chunk. Acceptance: test fails before impl, shape equals `chunk({reasoning_content:d})`.
- [x] 1.2 Add RED test in `plugins/agy-bridge.test.ts` for empty-skip — empty `text_delta` never calls `chunk`. Acceptance: mock chunk call count 0 for `onDelta("")`.
- [x] 1.3 Add RED test in `plugins/agy-bridge.test.ts` for tool-loop final-chunk integrity — after deltas, final SSE is `tool_calls` or `content` from `parseToolCalls(r.text)`. Acceptance: deltas + final assertion.
- [x] 1.4 Add RED test in `plugins/agy-bridge.test.ts` for tool-loop keepalive — 10s `: keepalive` comments emitted when stalled. Acceptance: interval mock asserts `sendRaw(": keepalive")` per 10s.

## Phase 2: Core Implementation

- [x] 2.1 Modify autonomous streaming `onDelta` in `agy-bridge.ts` (~L918–924): guard `if (!d) return;`, `log.delta_chars += d.length;`, emit `chunk({ reasoning_content: d })`. Keep existing `chunk({role})` open and `chunk({content:r.text})` final.
- [x] 2.2 Modify tool-loop streaming path in `agy-bridge.ts` (~L1093–1112): add `onDelta` with same empty-skip + `chunk({reasoning_content:d})` + logging, add `const ka=setInterval(()=>sendRaw(": keepalive ..."),10000)` and `clearInterval(ka)` in `finally`. Pass `log` delta_chars.

## Phase 3: Verification

- [x] 3.1 Run `deno check agy-bridge.ts`, `deno lint`, `deno fmt --check`, `deno test plugins/agy-bridge.test.ts` — all RED tests turn GREEN, no regressions. Verify Scenario: Graceful degradation — client ignoring `reasoning_content` still gets identical final `content`.
- [x] 3.2 Verify SSE contract manually/synthetic: stream `auto-*` without tools → deltas arrive as `reasoning_content` before final `content`/`stop`; stream with tools → deltas + final `tool_calls`. Confirm `deno check` gate passes.
