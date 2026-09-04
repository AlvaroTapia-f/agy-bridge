# Delta for opencode-provider

## MODIFIED Requirements

### Requirement: Streaming Reasoning Content

The system MUST forward `step_update` events from the upstream API as Server-Sent Events (SSE) progress chunks in both the autonomous and tool-loop streaming paths. `agent_response.text_delta` MUST be classified incrementally using a NOTE-aware line-buffered classifier: lines prefixed `NOTE:` MUST route to `choices[0].delta.reasoning_content`; non-NOTE lines and any turn-end buffer flush MUST route to `choices[0].delta.content`. All other step types (intermediate thoughts, tool activity, and unknown steps) MUST be routed to `choices[0].delta.reasoning_content` live. Unknown step types SHOULD be logged. Empty deltas MUST be skipped. Both paths MUST maintain a 10s `: keepalive` comment interval. The final chunk MUST carry `stop` (or parsed `tool_calls`) and MUST NOT duplicate or re-emit the full response text. All streaming paths MUST use a single shared routing helper to guarantee identical behavior. Models advertised by the provider MUST include the flat model-level key `interleaved: { field: "reasoning_content" }` (and flat `reasoning: true`) so the SDK maps reasoning deltas to ReasoningParts. `reasoning_content` deltas MUST precede `content` deltas within each turn.
(Previously: all `agent_response.text_delta` routed to `content` unconditionally; no interleaved advertisement; three independent inline routing blocks)

#### Scenario: NOTE narration routes to thinking

- GIVEN a streaming request where the model emits `agent_response.text_delta` containing lines prefixed `NOTE:`
- WHEN the classifier processes each completed line
- THEN those NOTE-prefixed lines MUST appear as `reasoning_content` deltas
- AND subsequent non-NOTE lines MUST appear as `content` deltas

#### Scenario: Turn-end flush

- GIVEN a partial line buffered in the classifier at turn end
- WHEN the upstream stream completes
- THEN any remaining buffer MUST flush to `content`

#### Scenario: Interleaved ordering

- GIVEN a turn with both NOTE narration and a final answer
- WHEN SSE chunks are emitted
- THEN all `reasoning_content` deltas for that turn MUST precede `content` deltas

#### Scenario: Autonomous streaming path

- GIVEN an `auto-*` streaming request without tool calls
- WHEN the upstream model emits thought or tool `step_update` events
- THEN the bridge MUST forward them as `reasoning_content` deltas
- AND WHEN the model emits `agent_response.text_delta` events
- THEN the bridge MUST forward them through the NOTE-aware classifier
- AND the final chunk MUST carry `stop` without duplicating the final text

#### Scenario: Tool-loop streaming path

- GIVEN an `auto-*` streaming request involving a tool loop
- WHEN tool-call tags are split across live deltas
- THEN they MUST be streamed as display-only `content` deltas
- AND the final chunk MUST contain the correctly parsed `tool_calls` without a duplicate full text dump

#### Scenario: Graceful degradation (empty skip & keepalive)

- GIVEN a streaming request with periods of inactivity or empty deltas
- WHEN empty `text_delta` events are emitted
- THEN the bridge MUST skip empty string deltas
- AND IF no other chunks are sent for 10 seconds
- THEN the bridge MUST emit `: keepalive` comments

#### Scenario: Defensive routing for unknown steps

- GIVEN a streaming request
- WHEN the upstream model emits an unknown `step_update` type
- THEN the bridge MUST log the event
- AND route it to `reasoning_content` deltas

#### Scenario: Identical routing across all paths

- GIVEN the same sequence of upstream events
- WHEN processed through autonomous, tool-loop, or plain streaming paths
- THEN the SSE output MUST be byte-identical (single shared classifier)

### Requirement: Auto-Prefixed Model Enumeration

The system MUST expose ONLY `auto-ro-<slug>` and `auto-rw-<slug>` per base `<slug>` derived from `agy models` TSV or `FALLBACK_MODELS`. Bare slugs MUST NOT be exposed. The plugin's provider hook (`resolveSlugs` → `groupBases` → `buildModelMap`) MUST fetch live ids and fall back to `FALLBACK_MODELS` when the bridge is unreachable. The `groupBases` logic MUST be mirrored internally in the plugin (self-contained 4-pass logic) to avoid import failures, and the fallback MUST cover 17 distinct slugs across 8 bases (yielding 16 grouped ids: 8 distinct bases × 2 profiles). A drift-guard test MUST assert that the plugin-embedded grouping produces output identical to the shared `groupBases` helper on the same input.
(Previously: self-contained plugin logic without an explicit drift-guard parity test)

#### Scenario: Live enumeration

- GIVEN `GET /v1/models` returns `gemini-3.7-flash-high`
- WHEN models are resolved
- THEN the result MUST contain `auto-ro-gemini-3.7-flash` and `auto-rw-gemini-3.7-flash` (base form; effort via variants)

#### Scenario: Fallback (grouped)

- GIVEN the bridge is unreachable
- WHEN falling back to `FALLBACK_MODELS`
- THEN the system MUST generate 16 grouped ids (8 distinct bases × 2 profiles: `auto-ro/*` + `auto-rw/*`) using the self-contained 4-pass grouping logic. Grouping strips `{-high,-medium,-low,-thinking}` to deduplicate bases; singleton bases yield `variants: {}`.

#### Scenario: Self-contained plugin execution

- GIVEN the `plugins/agy-bridge.ts` plugin is loaded in a sandboxed environment
- WHEN the plugin hook executes offline
- THEN it MUST NOT fail due to missing `helpers` imports and MUST successfully group the 17 fallback models into 8 bases using its own embedded 4-pass logic

#### Scenario: Drift-guard parity

- GIVEN `FALLBACK_MODELS` as input to both the shared `groupBases` and the plugin-embedded grouping
- WHEN `deno test` runs the drift-guard test
- THEN both MUST produce identical base-to-variant maps

## ADDED Requirements

### Requirement: Interleaved Reasoning Capability Advertisement

Every model emitted by the provider (plugin hook `buildModelMap` and sync script `buildModelMap`) with `reasoning: true` MUST also set the flat model-level key `interleaved: { field: "reasoning_content" }`. The nested form `capabilities: { reasoning, interleaved }` is inert in the OpenCode config schema and MUST NOT be emitted. This flat shape enables the SDK to map `reasoning_content` SSE deltas to native ReasoningParts (thinking blocks).

#### Scenario: Flat capability shape in plugin hook output

- GIVEN a non-singleton model (e.g. `auto-ro-gemini-3.7-flash`) emitted by the plugin hook `buildModelMap`
- WHEN the provider advertises it
- THEN the model entry MUST contain flat `reasoning: true` AND flat `interleaved: { field: "reasoning_content" }` at the model level
- AND MUST NOT contain a nested `capabilities` wrapper

#### Scenario: Flat capability shape in sync script output

- GIVEN `sync-models.ts` writes `opencode.json` via `buildModelMap`
- WHEN a non-singleton model is persisted
- THEN the persisted entry MUST contain flat `reasoning: true` AND flat `interleaved: { field: "reasoning_content" }`
- AND MUST NOT contain a nested `capabilities` wrapper

#### Scenario: Enrichment survival

- GIVEN a model entry emitted with flat `reasoning: true` and `interleaved: { field: "reasoning_content" }`
- WHEN the opencode runtime loads and enriches the provider config
- THEN the flat keys MUST survive enrichment and be readable by the SDK (runtime-verified during apply; fallback: extend install.sh TUI patch if enrichment strips them)

#### Scenario: SDK maps reasoning to thinking blocks

- GIVEN a model with flat `interleaved: { field: "reasoning_content" }`
- WHEN the SDK receives `reasoning_content` SSE deltas
- THEN it MUST emit ReasoningParts rendered as native thinking blocks
