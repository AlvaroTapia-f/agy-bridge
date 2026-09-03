# Delta for opencode-provider

## MODIFIED Requirements

### Requirement: Auto-Prefixed Model Enumeration

The system MUST expose ONLY `auto-ro-<slug>` and `auto-rw-<slug>` per base `<slug>` derived from `agy models` TSV or `FALLBACK_MODELS`. Bare slugs MUST NOT be exposed. The plugin's provider hook (`resolveSlugs` → `groupBases` → `buildModelMap`) MUST fetch live ids and fall back to `FALLBACK_MODELS` when the bridge is unreachable. The `groupBases` logic MUST be mirrored internally in the plugin (self-contained 4-pass logic) to avoid import failures, and the fallback MUST cover 17 distinct slugs across 8 bases (yielding 16 grouped ids: 8 distinct bases × 2 profiles).
(Previously: Plugin hook grouped bases using 1-pass or external imports, and fallback covered 14 slugs/7 bases/14 ids)

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

### Requirement: Stale Model Migration

Re-running `./install.sh` MUST invoke the model sync script to regenerate `provider.agy-bridge.models` to enriched shape based on live data, overwriting stale entries with empty variants and missing `capabilities`. Verification MUST pass via `opencode models` (listing the synchronized `agy-bridge/auto-*` ids) and JSON inspection (`jq '.provider["agy-bridge"].models["auto-rw-gemini-3.7-flash"]'` shows `capabilities.reasoning` and `variants.*.reasoningEffort`).
(Previously: opencode models listed 14 ids instead of 16 ids)

#### Scenario: Stale JSON migration

- GIVEN `opencode.json` contains stale `"auto-rw-gemini-3.7-flash": { "variants": { "high": {} } }` with no `capabilities`
- WHEN `./install.sh` is re-run and opencode is restarted
- THEN the entry MUST become `{ "capabilities": { "reasoning": true }, "variants": { "high": { "reasoningEffort": "high" } } }` and `buildReasoningEditState` MUST become selectable

#### Scenario: Verification after migration

- GIVEN migration has run
- WHEN inspecting `opencode models` and `opencode.json`
- THEN `opencode models` MUST list 16 `agy-bridge/auto-*` ids and JSON MUST show `reasoningEffort == key` for every non-singleton variant
