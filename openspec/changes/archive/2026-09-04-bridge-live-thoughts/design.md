# Design: bridge-live-thoughts

## Technical Approach

Widen the `runAgy` upstream event filter (L702-706) to classify all `step_update` events by `step_type`, passing a tagged `{kind, text}` to a new `onDelta(kind, text)` signature. Callers route `agent_response` → `content` and everything else → `reasoning_content`. The final chunk emits `stop`/`tool_calls` without re-dumping `r.text`. Maps directly to Proposal Approach A and Spec §Streaming Reasoning Content.

## Architecture Decisions

| Decision | Choice | Alternatives | Rationale |
|----------|--------|-------------|----------|
| Delta kind classification | Tag at `runAgy` filter level via `step_type` string | Classify at caller (handler) level | Single parse point; callers just switch on `kind` |
| onDelta signature change | `(kind: DeltaKind, text: string) => void` | Keep `(delta: string)`, add second callback | One callback avoids ordering bugs; `kind` enum is extensible |
| Unknown step routing | Route to `reasoning_content` + `console.error` log | Skip unknowns / route to `content` | Spec requires defensive logging; reasoning is safe display lane |
| Final chunk content | Omit `chunk({content: r.text})` at L930; rely on live deltas | Keep dump as fallback | Spec mandates no duplicate; live deltas already delivered full text |
| Tool-call tag split safety | Live `content` deltas are display-only; `parseToolCalls` on final `r.text` only | Parse tags live from stream | Split tags across deltas would corrupt JSON; final-text parse is proven |

## Data Flow

```
agy stdout → runAgy loop
  ├─ step_update.step_type=agent_response → onDelta("agent_response", text)
  ├─ step_update.step_type=thought|tool   → onDelta("thought"|"tool", text)
  ├─ step_update.step_type=???            → log + onDelta("unknown", text)
  └─ result                               → AgyResult (unchanged)

Autonomous handler (L918-933):
  onDelta(kind, d):
    kind === "agent_response" → chunk({content: d})
    else                      → chunk({reasoning_content: d})
  final: chunk({}, "stop")  ← NO chunk({content: r.text})

Tool-loop handler (L1097-1125):
  onDelta(kind, d):
    kind === "agent_response" → chunk({content: d})     # display-only
    else                      → chunk({reasoning_content: d})
  final: parseToolCalls(r.text) → chunk({tool_calls}, "tool_calls")
         or chunk({}, "stop")   ← NO content dump

Non-tool handler (L1126-1142): unchanged (already streams content live)
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `agy-bridge.ts:600` (approx) | Add type | `type DeltaKind = "agent_response" \| "thought" \| "tool" \| "unknown"` |
| `agy-bridge.ts:610-611` | Modify | `AgyStreamHandlers.onDelta` becomes `(kind: DeltaKind, text: string) => void` |
| `agy-bridge.ts:702-706` | Modify | Widen filter: match all `step_update` events; classify `step_type`; call `onDelta(kind, text_delta)`; log unknown types |
| `agy-bridge.ts:918-933` | Modify | Route by `kind`: `agent_response` → `content`, else → `reasoning_content`; remove L930 `chunk({content: r.text})` |
| `agy-bridge.ts:1097-1125` | Modify | Same kind-based routing; remove content dump from final chunk; keep `parseToolCalls(r.text)` on final text |
| `plugins/agy-bridge-helpers.ts:132-146` | Modify | Update `formatDeltaChunk`/`onDeltaHandler` to accept `kind` and return `{content}` or `{reasoning_content}` |
| `plugins/agy-bridge.test.ts:208-292` | Modify | Update tests: assert `content` for `agent_response` kind, `reasoning_content` for others; add no-duplicate-final assertion; add unknown-step logging assertion |

## Interfaces / Contracts

```typescript
type DeltaKind = "agent_response" | "thought" | "tool" | "unknown";

interface AgyStreamHandlers {
  onDelta?: (kind: DeltaKind, text: string) => void;
  log?: Record<string, unknown>;
  commit?: (agyConvId: string) => void;
  evict?: () => void;
}

// Helper (agy-bridge-helpers.ts)
export function formatDeltaChunk(
  kind: DeltaKind,
  text: string,
): Record<string, unknown> {
  return kind === "agent_response"
    ? { content: text }
    : { reasoning_content: text };
}
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `formatDeltaChunk` routes by kind | `deno test` — assert `{content}` vs `{reasoning_content}` per kind |
| Unit | `onDeltaHandler` empty-skip preserved | Existing test updated with new `kind` param |
| Unit | Unknown step type logs + routes to reasoning | Spy on `console.error`, assert `reasoning_content` output |
| Unit | No duplicate final text in autonomous path | Capture chunks, assert no `chunk({content: r.text})` after live deltas |
| Unit | Tool-loop final parse still works | Existing `parseToolCalls` test unchanged; new assertion that live deltas don't affect final parse |
| Integration | `delta_chars` logging accuracy | Assert `log.delta_chars` sums across both kinds |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary changes. The subprocess spawn in `runAgy` is unchanged; only the stdout event parsing/routing logic changes.

## Migration / Rollout

No migration required. Rollback: revert `agy-bridge.ts` + helpers to `bridge-delta-messages` archived state, `deno check agy-bridge.ts`, restart `agy-bridge.service`.

## Open Questions

- [x] None — all questions resolved by codebase read and spec.
