# Proposal: Code Cleanup and Delta Transmissions as Native Thinking Blocks

## Intent

(1) Redundant/dead code across service, plugin, and scripts. (2) Intermediate NOTE-narration deltas (bridge-live-thoughts Phase 6) stream as `delta.content`, rendering as regular chat text. The user wants them as native thinking blocks.

## Scope

### In Scope
- NOTE-aware incremental classifier: intermediate `agent_response` narration → `reasoning_content`; line-buffer split `NOTE:` prefixes; final answer still emitted as `content`
- Advertise interleaved reasoning (`capabilities.interleaved` = `reasoning_content`) so the SDK maps reasoning deltas to ReasoningParts; preserve reasoning-before-content ordering
- Consolidate duplicated `FALLBACK_MODELS`/grouping/`NARRATION_SUFFIX`: service imports helpers (precedent: sync-models); plugin stays self-contained
- Deduplicate the 3x inlined SSE `onDelta` routing
- Remove dead `variantBySession` map
- Forward the constructed-but-never-sent Authorization header in `sync-models.ts`
- Refresh stale README counts and stale comments (autonomous-stream one-chunk comment)

### Out of Scope
- Modifying the `agy` binary or protocol
- Splitting the single-file service; breaking plugin loader isolation
- Removing the NOTE narration prompt (classifier marker)
- Performance tuning; new endpoints

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `opencode-provider`: intermediate narration MUST route to `reasoning_content`; interleaved advertisement; ordering guarantees
- `model-sync`: buildModelMap emits interleaved capability; auth header forwarded in API-tier resolution
- `repo-hygiene`: README/comment accuracy

## Approach

**Delta-to-thinking options:**
- **A (recommended) — NOTE-aware classifier.** Line-buffered; `NOTE:`-prefixed lines → `reasoning_content`; remainder + turn-end flush → `content`. Keeps live final streaming; fragile only if a final answer starts with `NOTE:`.
- **B — position-based** (last `agent_response` step = final). Marker-independent but delays the final answer to turn end; can misroute multi-part finals.
- **C — markdown wrapper in content.** Rejected: not native thinking blocks.

**Cleanup:** service imports helpers where systemd `--allow-read` permits; plugin keeps LOCKSTEP copies plus a drift-guard test. Verify the unit allow-list first; fallback = guarded duplication.

## Affected Areas

| Area | Impact |
|------|--------|
| `agy-bridge.ts` | Modified — classifier, SSE routing dedup, stale comments |
| `plugins/agy-bridge-helpers.ts` | Modified — shared routing helpers, interleaved capability |
| `plugins/agy-bridge.ts` | Modified — remove `variantBySession`, interleaved capability |
| `scripts/sync-models.ts` | Modified — forward Authorization header |
| `README.md` | Modified — correct counts |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| SDK overwrites interleaved capability (known quirk patched in install.sh) | Med | Extend patch; verify field shape in design |
| Final answer misclassified as reasoning | Low | Turn-end flush + regression tests |
| Import consolidation breaks `--allow-read` | Med | Check allow-list; fallback to guarded duplication |
| Diff likely exceeds 400-line review budget | High | Chained PRs likely (slice 1: thinking fix; slice 2: cleanup) |

## Rollback Plan

`git revert` change commits; `deno check` + `deno test`; re-run `deno task sync:models` to rewrite `opencode.json` without the interleaved field; restart `agy-bridge.service`.

## Dependencies

- `@ai-sdk/openai-compatible` interleaved-reasoning support
- OpenCode version rendering ReasoningParts as thinking blocks

## Success Criteria

- [ ] Narration renders in thinking blocks; final answer renders as content
- [ ] `deno check`/`lint`/`fmt`/`test` green
- [ ] No unguarded duplicated logic (consolidated or drift-tested)
- [ ] README and model counts accurate
