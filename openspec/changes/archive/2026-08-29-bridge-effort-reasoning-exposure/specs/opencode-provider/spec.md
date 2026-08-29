# Delta for opencode-provider

## MODIFIED Requirements

### Requirement: Effort Variants

Each model MUST expose a `variants` map for effort. When `variants` is non-empty the model MUST set `capabilities.reasoning` to `true` and each entry MUST be `{ reasoningEffort: "<k>" }` where `<k>` equals the variant key (e.g. `high` → `{ reasoningEffort: "high" }`). Singleton models with `variants: {}` (e.g. `claude-sonnet-4-6`) MUST NOT advertise `capabilities.reasoning`. Variants remain ONLY the effort UX; no flat `-high` model ids SHALL be exposed.
(Previously: variants were `{ high: {} }` with no `capabilities` or `reasoningEffort`.)

#### Scenario: Picker

- GIVEN `auto-ro-gemini-3.7-flash` exists
- WHEN opening the variant picker in the TUI
- THEN it MUST show `high`, `medium`, `low`

#### Scenario: Editing effort on supported model is selectable

- GIVEN `agy-bridge/auto-rw-gemini-3.7-flash` has `capabilities.reasoning: true` and `variants: { high: { reasoningEffort: "high" }, medium: { reasoningEffort: "medium" }, low: { reasoningEffort: "low" } }`
- WHEN the SDD TUI evaluates `listReasoningEffortsFromModel` / `buildReasoningEditState`
- THEN it MUST return `kind: "selectable"` with `options: ["high","low","medium"]` and MUST NOT show `does not expose reasoning effort options`

#### Scenario: Editing effort on singleton is unsupported

- GIVEN `agy-bridge/auto-ro-claude-sonnet-4-6` has `variants: {}` and no `capabilities.reasoning`
- WHEN the SDD TUI evaluates `buildReasoningEditState` for that model
- THEN it MUST return `kind: "unsupported"` with `Model agy-bridge/auto-ro-claude-sonnet-4-6 does not expose reasoning effort options`

## ADDED Requirements

### Requirement: Reasoning Model Shape Conformance

Generated models via `buildModelMap` (`plugins/agy-bridge-helpers.ts`) and `install.sh` fallback MUST conform identically to Effort Variants. Both MUST set `capabilities: { reasoning: true }` iff `variants` non-empty and MUST emit `variants.<k> = { reasoningEffort: k }`.

#### Scenario: buildModelMap emits enriched shape

- GIVEN `groupBases(FALLBACK_MODELS)` yields 7 bases
- WHEN `buildModelMap` is called
- THEN each non-singleton (e.g. `auto-ro-gemini-3.7-flash`) MUST have `capabilities.reasoning === true` and `variants.high.reasoningEffort === "high"`, and singleton `auto-ro-claude-sonnet-4-6` MUST have `variants: {}` with no `capabilities.reasoning`

#### Scenario: install.sh fallback emits identical shape

- GIVEN `opencode.json` has no or incomplete `provider.agy-bridge.models`
- WHEN `install.sh` regenerates static models
- THEN each entry MUST equal `buildModelMap` for same id (`capabilities` and `variants.<k>.reasoningEffort == k`)

### Requirement: Reasoning Effort Persistence

`agent.<name>.reasoningEffort` and `options.reasoningEffort` MUST survive profile re-apply via `opencode-sdd-engram-manage`. If model is selectable and saved effort is in `listReasoningEffortsFromModel` options, TUI MUST NOT clear it. Variant vs `reasoningEffort` precedence SHALL be deterministic; design MUST define sync rule (canonical: SDD `reasoningEffort` → variant suffix).

#### Scenario: Profile sync persistence

- GIVEN an agent has `model: "agy-bridge/auto-rw-gemini-3.7-flash"` and `reasoningEffort: "high"` (and matching `options.reasoningEffort`)
- WHEN `applyProfileReasoningEffort` re-applies the profile and `listReasoningEffortsFromModel` returns `["high","low","medium"]`
- THEN the agent config MUST retain `reasoningEffort: "high"` with no `incompatible` warning or clearing

#### Scenario: Incompatible effort cleared

- GIVEN saved `reasoningEffort: "ultra"` not in `["high","low","medium","thinking"]`
- WHEN profile sync runs
- THEN the system MAY clear the effort and emit the incompatible warning

### Requirement: Stale Model Migration

Re-running `./install.sh` MUST regenerate `provider.agy-bridge.models` to enriched shape, overwriting stale entries with empty variants and missing `capabilities`. Verification MUST pass via `opencode models` (14 `agy-bridge/auto-*` ids) and JSON inspection (`jq '.provider["agy-bridge"].models["auto-rw-gemini-3.7-flash"]'` shows `capabilities.reasoning` and `variants.*.reasoningEffort`).

#### Scenario: Stale JSON migration

- GIVEN `opencode.json` contains stale `"auto-rw-gemini-3.7-flash": { "variants": { "high": {} } }` with no `capabilities`
- WHEN `./install.sh` is re-run and opencode is restarted
- THEN the entry MUST become `{ "capabilities": { "reasoning": true }, "variants": { "high": { "reasoningEffort": "high" } } }` and `buildReasoningEditState` MUST become selectable

#### Scenario: Verification after migration

- GIVEN migration has run
- WHEN inspecting `opencode models` and `opencode.json`
- THEN `opencode models` MUST list 14 `agy-bridge/auto-*` ids and JSON MUST show `reasoningEffort == key` for every non-singleton variant

### Requirement: Reasoning Effort Test Coverage

`plugins/agy-bridge.test.ts` MUST assert enriched shape and MUST fail if `capabilities` or `reasoningEffort` regress.

#### Scenario: Tests assert enriched shape

- GIVEN `buildModelMap(groupBases(FALLBACK_MODELS))`
- WHEN `deno test` runs
- THEN tests MUST assert `variants.high.reasoningEffort === "high"` (all keys), `capabilities.reasoning === true` for non-singletons, and no `capabilities.reasoning` for singleton
