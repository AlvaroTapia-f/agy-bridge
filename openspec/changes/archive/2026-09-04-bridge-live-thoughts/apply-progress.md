# Apply Progress: bridge-live-thoughts

**Mode**: Standard (no strict TDD)
**Work unit**: single-pr-deltakind-routing (single PR, low risk, no chaining)
**Updated**: 2026-09-04 (continuation run — prior apply was cancelled after editing worktree; no work redone)

## Done vs Pending (verified against `git diff`)

| Task | Status | Evidence in worktree |
|------|--------|---------------------|
| 1.1 DeltaKind type | [x] done | `agy-bridge.ts:610` |
| 1.2 onDelta signature | [x] done | `agy-bridge.ts:613` |
| 1.3 formatDeltaChunk | [x] done | `plugins/agy-bridge-helpers.ts:135-141` |
| 1.4 onDeltaHandler | [x] done | `plugins/agy-bridge-helpers.ts:143-152` |
| 2.1 Widen runAgy filter | [x] done | `agy-bridge.ts:703-719` |
| 2.2 Unknown → reasoning + log | [x] done | `agy-bridge.ts:714-716` |
| 2.3 Empty-skip | [x] done | `agy-bridge.ts:706` (`!== ""` guard) |
| 3.1 Autonomous routing | [x] done | `agy-bridge.ts:933-941` |
| 3.2 Remove duplicate dump | [x] done | final is `chunk({}, "stop")`, no `content` replay |
| 3.3 Tool-loop routing | [x] done | `agy-bridge.ts:1118-1126`, `parseToolCalls(r.text)` on final only |
| 3.4 Non-tool path compat | [x] done | `agy-bridge.ts:1148-1156` kind routing, final `chunk({}, "stop")` |
| 4.1–4.6 Tests | [x] done | `plugins/agy-bridge.test.ts:206-426`, 7 new delta-streaming tests |
| 5.1 `deno check` | [x] done | exit 0 |
| 5.2 `deno test --allow-all` | [x] done | 43 passed, 0 failed |
| 5.3 Manual SSE check | [ ] pending | requires live TUI — for sdd-verify |
| 5.4 Service restart | [ ] pending | requires runtime env — for sdd-verify |

## Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command and exact result | `deno test plugins/agy-bridge.test.ts` → ok, 26 passed, 0 failed |
| Full suite | `deno test --allow-all` → ok, 43 passed, 0 failed |
| Runtime harness command and exact result | `deno check agy-bridge.ts` → exit 0, no diagnostics |
| Rollback boundary | Revert `agy-bridge.ts` + `plugins/agy-bridge-helpers.ts` + `plugins/agy-bridge.test.ts` (+ this run's `tasks.md` checkbox marks); no other files touched by this change |

## Fix applied this run

- `plugins/agy-bridge.test.ts:4` — wrapped the lengthened import into multiline form (only new-code fmt complaint). Remaining `deno lint` (5 problems) and `deno fmt --check` complaints are pre-existing lines outside this change's hunks; deliberately left untouched to protect the review budget.

## Out-of-scope note (do NOT touch)

- `openspec/specs/opencode-provider/spec.md` (+27 in worktree) is the already-archived `bridge-delta-messages` delta merge awaiting commit — not part of this change. Left as-is.

## Deviations from Design

None — implementation matches design (kind tagged at runAgy filter, callers switch on kind, final chunks carry `stop`/`tool_calls` without `r.text` replay, tool tags parsed from final text only).

## Review budget

`git diff --stat`: 4 files, ~335 changed lines (incl. pre-existing base-spec merge) — within the 400-line budget. This change's own hunks: ~60 (`agy-bridge.ts`) + ~25 (helpers) + ~230 (tests).

## Phase 6: Narration Disclosure (2026-09-04, Strict TDD)

**Mode**: Strict TDD (`openspec/config.yaml` → `strict_tdd: true`, runner `deno test`)

| Task | Status | Evidence |
|------|--------|----------|
| 6.1 NARRATION_SUFFIX, streaming branch only | [x] done | `agy-bridge.ts:403-404` const + `~L939-940` `streamingPrompt` passed to `runAgy`; non-streaming branch (`prepared.prompt` verbatim) and `renderPrompt`/`preparePrompt` untouched |
| 6.2 Narration tests | [x] done | `plugins/agy-bridge.test.ts` — 3 new tests (`stream:true` has `NOTE:`, `stream:false` verbatim, non-auto untouched) |

### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 6.1 | `plugins/agy-bridge.test.ts` | Unit | ✅ 26/26 | ✅ type-check fail (symbols missing) | ✅ 27/27 | ✅ 3 cases | ➖ None needed (minimal const + 2-line branch) |
| 6.2 | `plugins/agy-bridge.test.ts` | Unit | ✅ 26/26 | ✅ Written first | ✅ 29/29 | ✅ happy path + 2 edge paths | ➖ None needed |

### Test Summary

- **Total tests written**: 3 (`narration: autonomous stream:true…`, `narration: stream:false…`, `narration: non-auto…`)
- **Total tests passing**: 29/29 focused (`deno test plugins/agy-bridge.test.ts`)
- **Layers used**: Unit (3)
- **Approval tests**: None — new behavior, no refactoring
- **Pure functions created**: 1 (`applyNarrationSuffix` in `plugins/agy-bridge-helpers.ts`)

### Work Unit Evidence (Phase 6)

| Evidence | Value |
|---|---|
| Focused test command and exact result | `deno test plugins/agy-bridge.test.ts` → ok, 29 passed, 0 failed |
| Runtime harness command and exact result | `deno check agy-bridge.ts` → exit 0, no diagnostics |
| Rollback boundary | Revert `NARRATION_SUFFIX` + `streamingPrompt` hunk in `agy-bridge.ts`, helper const/function in `plugins/agy-bridge-helpers.ts`, 3 tests + import in `plugins/agy-bridge.test.ts` |

### Design note (testability, no behavior change)

Root `agy-bridge.ts` must stay zero-import: the systemd unit scopes `--allow-read` to the brain dir (a static import would break the service), and top-level `Deno.serve` + `Deno.env` reads make it unimportable under flagless `deno test`. So the canonical literal lives in `agy-bridge.ts` (streaming branch use) and is mirrored with a pure, exported `applyNarrationSuffix` selector in `plugins/agy-bridge-helpers.ts` (tested); both carry keep-in-sync comments. New lines are `deno fmt`-clean; remaining fmt/lint complaints are pre-existing outside this change's hunks (verified via `git stash` baseline).
