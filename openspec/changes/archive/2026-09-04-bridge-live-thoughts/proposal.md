# Proposal: bridge-live-thoughts

> Alias: continues `test-delta-streaming` exploration thread. Follow-up to archived `2026-09-03-bridge-delta-messages`.

## Intent

Long `auto-*` runs still feel frozen then duplicated: intermediate agy thoughts never reach opencode live, and the final answer is dumped inside the thinking box as well as the answer. Users MUST see thinking progress live in the thinking box, with the final answer appearing once, in the answer only.

## Scope

### In Scope
- Broaden `runAgy` upstream filter beyond `agent_response` so thoughts/tool activity reach `onDelta`
- Route intermediate steps/thoughts + tool activity to `reasoning_content` live in both streaming paths
- Route `agent_response.text_delta` to `content` live; finish with `stop` and no duplicate final dump
- Keep empty-skip, 10s keepalive, final `tool_calls` parse intact

### Out of Scope
- Non-streaming JSON responses; `parseToolCalls` tag format; prompt rendering; auth/permissions
- New model ids, TUI/opencode changes, `--effort` forwarding

## Capabilities

### New Capabilities
- None

### Modified Capabilities
- `opencode-provider`: streaming chunk routing changes — intermediate deltas go to `reasoning_content` live, `agent_response` deltas to `content` live, final chunk carries `stop` without re-emitting full text

## Approach

Primary (A): stream `agent_response.text_delta` as `content` deltas live; stream all other step types (thoughts, tool activity) as `reasoning_content` deltas live; end with `stop` and no `chunk({content: r.text})` replay. Fallback (B, low-diff): keep final dump but reroute `agent_response` deltas from `reasoning_content` to `content` so at least the answer streams live.

Evidence: `agy-bridge.ts` L692-718 (filter L702-706, misroute), L918-933 (autonomous path + duplicate dump L930), L1097-1125 (tool path + `content:d` at L1131), `plugins/agy-bridge.test.ts` L208-292, `openspec/specs/opencode-provider/spec.md` L206-232.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `agy-bridge.ts:702-706` | Modified | Widen `step_update` filter; tag delta kind |
| `agy-bridge.ts:918-933` | Modified | Live `content` deltas; drop duplicate final dump |
| `agy-bridge.ts:1097-1125` | Modified | Same routing in tool-loop path |
| `plugins/agy-bridge.test.ts` | Modified | Live-timing + no-duplicate assertions |
| `openspec/specs/opencode-provider/spec.md` | Modified | Live-thoughts routing requirement |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| agy `stream-json` schema variations (new step types) | Med | Default unknown steps to `reasoning_content`; log unhandled events |
| Tool-call tag split across deltas breaks live parse | Med | Parse tags only on final text; live `content` is display-only |
| opencode renders `reasoning_content` late or not at all | Med | Keepalive retained; verify live in TUI before archive |

## Rollback Plan

Revert `agy-bridge.ts` routing to archived `bridge-delta-messages` state, `deno check agy-bridge.ts`, restart `agy-bridge.service`. No config/auth/model changes; no migration.

## Dependencies

- agy `stream-json` `step_update` contract (already consumed)
- opencode live rendering of `reasoning_content` + `content` deltas (verify in TUI)

## Success Criteria

- [ ] Live SSE shows thought deltas before answer deltas; keepalive only fires when stalled (>10s gap)
- [ ] Final answer text appears exactly once (answer channel); thinking box holds progress only
- [ ] Tool calls still parse from final text; `deno check` + `deno test` pass
