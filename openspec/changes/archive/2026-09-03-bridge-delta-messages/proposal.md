# Proposal: bridge-delta-messages

## Intent

Long `auto-*` runs look frozen in opencode: the bridge buffers agy reasoning and emits only one final chunk (autonomous path sends just `: keepalive` comments). Forward agy `step_update text_delta` as SSE progress so users see reasoning live.

## Scope

### In Scope
- Stream `text_delta` as `choices[0].delta.reasoning_content` in autonomous streaming path
- Same forwarding in tool-loop streaming path (progress only, final parse unchanged)
- Keep final `r.text` as `content`, keep `keepalive`, graceful degradation

### Out of Scope
- Non-streaming JSON responses (unchanged single message)
- `parseToolCalls`, prompt rendering, conversation reuse, auth, permissions
- New model ids, TUI/opencode changes, `--effort` forwarding

## Capabilities

### New Capabilities
- None

### Modified Capabilities
- `opencode-provider`: streaming chunk contract gains `reasoning_content` progress deltas before final `content`/`tool_calls` chunk

## Approach

Wire existing `runAgy onDelta` (already captures `step_update text_delta`, `agy-bridge.ts:702-706`) to `chunk({ reasoning_content: d })` in both buffered paths; skip empty deltas; retain `delta_chars` logging. Add 10s `keepalive` to tool path (currently missing); final chunk stays `content: r.text` so clients ignoring `reasoning_content` still work. Effort: S (~30 lines + tests).

Alternatives: `content` deltas (rejected — pollutes final answer / breaks tool parsing); raw SSE passthrough of agy events (rejected — leaks bridge internals, breaks OpenAI contract).

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `agy-bridge.ts:918-924` | Modified | Autonomous `onDelta` forwards `reasoning_content` |
| `agy-bridge.ts:1093-1112` | Modified | Tool path emits progress + adds keepalive |
| `plugins/agy-bridge.test.ts` | Modified | Assert delta shape, final content intact |
| `openspec/specs/opencode-provider/spec.md` | Modified | Streaming `reasoning_content` requirement |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| opencode ignores `reasoning_content` (still looks frozen) | Med | Keepalive retained; verify in TUI before archive |
| Deltas ≠ final text confuse users | Low | `reasoning_content` channel stays separate from `content` |
| High-frequency chunks saturate SSE | Low | Skip empties; optional 50ms coalescing in design |

## Rollback Plan

Revert `agy-bridge.ts` `onDelta` to log-only, `deno check agy-bridge.ts`, restart `agy-bridge.service`. No config, auth, or model-list changes, so no client migration.

## Dependencies

- agy `stream-json` `step_update.text_delta` contract (already consumed)
- opencode rendering of `reasoning_content` deltas (verify in design)

## Success Criteria

- [ ] Streaming `auto-*` shows live reasoning in opencode, final answer identical to non-stream
- [ ] Tool calls still parse from final `r.text`; non-stream paths unchanged
- [ ] `deno check agy-bridge.ts` + `deno test` pass
