# Design: bridge-delta-messages

## Technical Approach

Wire `runAgy`'s existing `onDelta` callback (L702–706) to emit `choices[0].delta.reasoning_content` SSE chunks in both the autonomous streaming path (L918–924) and the tool-loop streaming path (L1093–1112). The `chunk()` helper already builds OpenAI-shaped SSE — only the delta payload changes. Final `content`/`tool_calls` chunks stay authoritative. Add keepalive to the tool path (missing today). Empty-skip at call site. No new types, no new permissions, no migration.

## Architecture Decisions

| Decision | Alternatives | Rationale |
|----------|-------------|-----------|
| Use `reasoning_content` field for progress deltas | `content` deltas — rejected: pollutes final answer, breaks `parseToolCalls` | OpenAI contract allows `reasoning_content` as secondary channel; clients ignoring it degrade gracefully |
| Inline empty-skip at each `onDelta` call site | Central skip inside `runAgy` — rejected: `onDelta` is generic | Keeps `runAgy` caller-agnostic; 1 line per site |
| Add 10s keepalive to tool path via `setInterval` | No keepalive — rejected: long tool runs still look frozen | Identical pattern to autonomous path (L916); eliminates divergence |
| No coalescing in v1 | 50ms debounce — deferred: unproven need | Ship simple; add coalescing only if chunk frequency causes measured TUI issues |

## Data Flow

    agy stdout ──JSON──→ runAgy loop (L693)
                            │
                       step_update text_delta
                            │
                       handlers.onDelta(d)
                            │
              ┌─────────────┴──────────────┐
              │ autonomous (L920)          │ tool-loop (new, ~L1097)
              │ if (!d) return;            │ if (!d) return;
              │ log.delta_chars += d.len;  │ log.delta_chars += d.len;
              │ chunk({reasoning_content:d})│ chunk({reasoning_content:d})
              └─────────────┬──────────────┘
                            │
                       await runAgy resolves
                            │
              ┌─────────────┴──────────────┐
              │ autonomous                 │ tool-loop
              │ chunk({content: r.text})   │ parseToolCalls(r.text)
              │ chunk({}, "stop")          │ chunk(tool_calls|content)
              └────────────────────────────┘

Keepalive (`: keepalive` every 10s) runs in both paths via `setInterval`/`clearInterval` — autonomous already has it (L916/L938); tool path gets identical timer.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `agy-bridge.ts` L920–922 | Modify | Autonomous `onDelta`: add empty-skip, emit `chunk({ reasoning_content: d })`, keep `delta_chars` logging |
| `agy-bridge.ts` L1091–1112 | Modify | Tool path: add `onDelta` with `reasoning_content` + empty-skip + `delta_chars`, add 10s keepalive interval + `clearInterval` in finally |
| `plugins/agy-bridge.test.ts` | Modify | Add tests for delta shape, empty-skip, final content integrity |

~25 net new lines in `agy-bridge.ts`, ~40 net new lines in test file.

## Interfaces / Contracts

No new types. `AgyStreamHandlers.onDelta` signature unchanged (`(delta: string) => void`). Chunk shape uses existing helper:

```typescript
// Progress delta (new usage):
chunk({ reasoning_content: d });       // d is non-empty string

// Final chunk (unchanged):
chunk({ content: r.text });            // autonomous
chunk({ role: "assistant", tool_calls }, "tool_calls"); // tool path
```

No `--allow-*` permission changes.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `onDelta` with non-empty string → `chunk()` emits `reasoning_content` | Mock `chunk`, call `onDelta` closure, assert payload shape |
| Unit | Empty string delta → `chunk()` NOT called | Same mock, assert zero calls |
| Unit | Final chunk still has `content` / `tool_calls` | Assert final SSE event shape unchanged |
| Type | `deno check agy-bridge.ts` passes | CI gate |
| Lint | `deno lint` + `deno fmt` clean | CI gate |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary.

## Migration / Rollout

No migration required. Rollback: revert `onDelta` to log-only, `deno check agy-bridge.ts`, restart `agy-bridge.service`.

## Open Questions

- None — all resolved.
