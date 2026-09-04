# Design: Cleanup + Delta Transmissions as Native Thinking Blocks

## Technical Approach

NOTE-aware line-buffered classifier in `plugins/agy-bridge-helpers.ts`, imported statically by `agy-bridge.ts` and used by all three streaming paths; interleaved capability emitted as **`interleaved: { field: "reasoning_content" }`** (verified against OpenCode source); cleanup sequenced as slice 1 (thinking fix) + slice 2 (hygiene) to respect the 400-line review budget.

## Architecture Decisions

### Decision: Verified interleaved field shape

**Choice**: Emit model-level `interleaved: { field: "reasoning_content" }` (object form), alongside a *flat* `reasoning: true` at the same model level — in BOTH emitters (plugin hook + sync script).
**Alternatives**: array form `capabilities.interleaved: ["reasoning_content"]` (mandated by spec wording); boolean `interleaved: true`.
**Rationale**: OpenCode source (`packages/opencode/src/config/provider.ts`) and docs define `interleaved: true | { field: "reasoning_content" | "reasoning_details" }` as a **flat model-level config key** — there is no `capabilities` key in the config schema; the internal `capabilities.interleaved` is derived from the flat config key by opencode itself. Catalog evidence (`~/.cache/opencode/models.json`) and maintainer guidance confirm the object form. Nested `capabilities.*` in config is inert (likely the root cause of the existing `capabilities.reasoning=false` quirk patched in install.sh). This diverges from the spec's literal `capabilities.interleaved` wording — needs user decision (see Open Questions).

### Decision: Classifier as per-request stateful router in helpers

**Choice**: `createNoteClassifier(opts)` returns `{ onDelta(kind, text), flush() }`. `thought`/`tool`/`unknown` kinds pass through to `reasoning_content` live; `agent_response` is line-buffered — complete lines whose trimmed prefix is `NOTE:` emit `reasoning_content`, others emit `content` (lines keep their `\n`). `flush()` (called at turn end in each stream's finalization) emits any residual buffer to `content`. One instance per HTTP request in each path.

| Option | Tradeoff | Decision |
|---|---|---|
| Kind stateless (existing `onDeltaHandler`) | Cannot classify NOTE lines split across deltas | Replaced (kept temporarily for parity) |
| Line-buffered classifier | Latency ≤ one line; slight text re-chunking | **Chosen** |
| Position-based (last step = final) | Marker-free but delays final answer to turn end | Rejected (proposal option B) |

**Alternatives considered**: position-based routing (delays final answer, misroutes multi-part finals); markdown wrapper in content (not native thinking blocks).
**Rationale**: keeps live final streaming; spec-aligned (NOTE → reasoning; non-NOTE + turn-end flush → content).

### Decision: Service statically imports helpers; plugin stays self-contained

**Choice**: `agy-bridge.ts` adds `import ... from "./plugins/agy-bridge-helpers.ts"` and deletes its local `FALLBACK_MODELS` (L50-68) and `NARRATION_SUFFIX` (L403-404) copies. The plugin keeps its LOCKSTEP copies + parity tests (already passing).
**Alternatives considered**: extending the systemd `--allow-read` scope; guarded duplication (proposal fallback).
**Rationale**: empirically verified on the exact unit flag set — Deno's module loader does not require `--allow-read` for local module imports (static and dynamic both passed). `INSTALL_DIR` is `$SCRIPT_DIR` (full checkout), so `plugins/` resolves; precedent: `sync-models.ts` already imports helpers.

### Decision: install.sh reasoning patch NOT extended

**Choice**: Keep patch as-is; fix the emitter shape instead (flat `reasoning` + `interleaved` in config makes `capabilities.reasoning` derive correctly; variants-based effort detection stays patched).
**Alternatives considered**: extending the TUI patch to preserve `interleaved`.
**Rationale**: the quirk's likely root cause is the inert nested `capabilities` object; with the flat keys the enrichment path reads them directly. Runtime verification during apply confirms (fallback: extend patch then).

## Data Flow

    agy (step_update events) ──> runAgy filter (kind classification, unchanged)
        │
        ├─ thought/tool/unknown ──────────────> reasoning_content (live passthrough)
        │
        └─ agent_response ──> NOTE classifier ──> complete NOTE: lines -> reasoning_content
                                             ├─ complete other lines -> content
                                             └─ turn end: flush() residual -> content
        │
        v
    SSE chunk() ──> @ai-sdk/openai-compatible ──(interleaved: {field:"reasoning_content"})──> ReasoningParts (thinking blocks)

Ordering: NOTE lines precede each tool call; the final answer follows, so `reasoning_content` precedes `content` within each generation turn. Tool-loop display `<tool_call>` chunks interleave after earlier reasoning — enabled by the interleaved capability; ordering requirement is per-turn, not per-request.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `plugins/agy-bridge-helpers.ts` | Modify | Add `createNoteClassifier` (+ `classifyLine`); update `buildModelMap` to emit flat `reasoning`/`interleaved` shape; retire `onDeltaHandler`/`formatDeltaChunk` |
| `agy-bridge.ts` | Modify | Import helpers; replace 3 inline `onDelta` blocks (L942-950, L1127-1135, L1156-1164) with classifier calls + `flush()`; remove local `FALLBACK_MODELS`/`NARRATION_SUFFIX`; fix stale comment L908-911 |
| `plugins/agy-bridge.ts` | Modify | Mirror capability shape (LOCKSTEP); remove dead `variantBySession` (L158, write L293) |
| `scripts/sync-models.ts` | Modify | Widen `fetcher` to `(url, init?)`; forward `{ headers }` |
| `plugins/agy-bridge.test.ts`, `scripts/sync-models.test.ts` | Modify | RED tests first; update mock fetchers |
| `README.md` | Modify | 7/14 → 8/16 (L159, L179, L294) |

## Interfaces / Contracts

```ts
type NoteClassifierOptions = {
  chunk: (delta: Record<string, unknown>) => void;
  log?: { delta_chars: number };
};
function createNoteClassifier(opts): {
  onDelta(kind: DeltaKind, text: string): void;  // empty text skipped
  flush(): void;                                  // residual -> content
};
// buildModelMap entry (both emitters, opencode.json config shape):
// { id, name, provider, reasoning: true, interleaved: { field: "reasoning_content" }, variants }
// (flat keys for config consumers; plugin hook wraps equivalently per ModelV2)
// ResolveSlugsOptions.fetcher: (url: string, init?: RequestInit) => Promise<Response>
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit (RED first) | NOTE split across deltas; NOTE→reasoning then answer→content; flush residual→content; interleaved ordering per turn; empty skip; unknown-step logging; identical routing via shared helper (same input → identical chunk sequences) | `plugins/agy-bridge.test.ts`, mirroring existing strict-TDD pattern |
| Unit | `buildModelMap` flat capability shape; fetcher receives Authorization header | `scripts/sync-models.test.ts` + plugin tests |
| Integration | `deno check agy-bridge.ts plugins/*.ts scripts/*.ts`; `deno test`; `deno lint`/`fmt` | Full suite (46 baseline tests + new) |
| E2E | Live `auto-*` stream: NOTE lines render as thinking blocks, final answer as content; effective model shows `interleaved` after enrichment | `curl` SSE + `opencode` runtime check during apply |

## Threat Matrix

N/A — no request/command routing, shell-command composition, subprocess invocation surface, VCS/PR automation, or executable-file classification is changed. SSE delta routing is data-plane only; install.sh patch deliberately untouched; systemd unit unchanged.

## Migration / Rollout

`deno task sync:models` rewrites `opencode.json` with the new shape; restart `agy-bridge.service`; re-deploy plugin copy (install.sh or manual `cp`). No data migration beyond the config rewrite (idempotent, atomic).

## Rollback

`git revert`; re-run `deno task sync:models` to restore prior `opencode.json` (`.bak` kept); restart service; re-copy prior plugin. `deno check` + `deno test` to confirm.

## Open Questions

- [ ] Spec wording says `capabilities.interleaved` (nested); verified OpenCode config shape is flat `interleaved: { field: "reasoning_content" }` at model level — needs user decision (spec amendment vs. keep spec wording for internal ModelV2 only)
- [ ] Does `capabilities.interleaved` survive opencode's model enrichment in the installed version? Runtime-verify during apply; fallback = extend install.sh TUI patch
- [ ] Turn-end flush routes a trailing NOTE-prefixed partial line to `content` (spec-literal) — accepted edge case, same family as the documented NOTE-final-answer fragility
