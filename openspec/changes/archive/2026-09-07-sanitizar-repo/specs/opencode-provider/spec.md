# Delta for opencode-provider

## MODIFIED Requirements

### Requirement: Auto-Prefixed Model Enumeration

The system MUST expose ONLY `auto-ro-<slug>` and `auto-rw-<slug>` per base `<slug>` derived from `agy models` TSV or `FALLBACK_MODELS`. Bare slugs MUST NOT be exposed. The plugin's provider hook (`resolveSlugs` → `groupBases` → `buildModelMap`) MUST fetch live ids and fall back to `FALLBACK_MODELS` when the bridge is unreachable. The plugin MUST be a generated self-contained bundle (see `plugin-packaging` spec) produced from `plugins/agy-bridge-helpers.ts` as the single source of truth for catalog, grouping, and model-map logic. The fallback MUST cover 17 distinct slugs across 8 bases (yielding 16 grouped ids: 8 distinct bases × 2 profiles). An installed-plugin smoke test MUST verify the bundle loads and produces correct output.
(Previously: the plugin embedded its own mirrored 4-pass grouping logic with a drift-guard test asserting parity against the helpers.)

#### Scenario: Live enumeration

- GIVEN `GET /v1/models` returns `gemini-3.7-flash-high`
- WHEN models are resolved
- THEN the result MUST contain `auto-ro-gemini-3.7-flash` and `auto-rw-gemini-3.7-flash` (base form; effort via variants)

#### Scenario: Fallback (grouped)

- GIVEN the bridge is unreachable
- WHEN falling back to `FALLBACK_MODELS`
- THEN the system MUST generate 16 grouped ids (8 distinct bases × 2 profiles: `auto-ro/*` + `auto-rw/*`) using the bundle's grouping logic (sourced from `agy-bridge-helpers.ts`). Grouping strips `{-high,-medium,-low,-thinking}` to deduplicate bases; singleton bases yield `variants: {}`.

#### Scenario: Bundle-based plugin execution

- GIVEN the `plugins/agy-bridge.ts` plugin is a generated self-contained bundle loaded in a sandboxed environment
- WHEN the plugin hook executes offline
- THEN it MUST NOT fail due to missing imports and MUST successfully group the 17 fallback models into 8 bases using the bundled logic
- AND the bundle output MUST be identical to the helpers source output (verified by parity test in `plugin-packaging`)

### Requirement: Reasoning Model Shape Conformance

Generated models via `buildModelMap` (`plugins/agy-bridge-helpers.ts`) and the `sync-models.ts` script MUST conform identically to Effort Variants. Both MUST emit flat `reasoning: true` at the model level (with `capabilities === undefined`) iff `variants` is non-empty, and MUST emit `variants.<k> = { reasoningEffort: k }`. The nested `capabilities: { reasoning, interleaved }` form is inert in the OpenCode config schema and MUST NOT be emitted.
(Previously: required the nested `capabilities: { reasoning: true }` form, which the code never emitted and the schema does not accept.)

#### Scenario: buildModelMap emits flat shape

- GIVEN `groupBases(FALLBACK_MODELS)` yields 8 bases
- WHEN `buildModelMap` is called
- THEN each non-singleton (e.g. `auto-ro-gemini-3.7-flash`) MUST have flat `reasoning: true` at the model level with `capabilities === undefined`, and `variants.high.reasoningEffort === "high"`
- AND singleton `auto-ro-claude-sonnet-4-6` MUST have `variants: {}` with no `reasoning` flag and `capabilities === undefined`

#### Scenario: sync script emits identical shape

- GIVEN `opencode.json` is updated by `sync-models.ts`
- WHEN the script regenerates static models
- THEN each entry MUST equal `buildModelMap` for the same id (flat `reasoning: true`, `capabilities === undefined`, `variants.<k>.reasoningEffort == k`)
