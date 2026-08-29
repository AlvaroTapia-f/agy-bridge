# OpenCode Provider Specification

## Purpose

Define the `agy-bridge` OpenAI-compatible provider for `opencode`: global registration, auto-prefixed model enumeration with `auto-ro`/`auto-rw` profiles, effort variants, variant-to-suffix wire contract, per-request bearer auth, loopback Host guard, E2E verification, and clean rollback.

## Requirements

### Requirement: Global Provider Registration

The system MUST register `agy-bridge` in `~/.config/opencode/opencode.json` (global only) with `npm: "@ai-sdk/openai-compatible"`, `options.baseURL: "http://127.0.0.1:7421/v1"`. It MUST NOT create a repo-local `opencode.json` template and the provider MUST appear in `opencode models` output.

#### Scenario: Provider visible

- GIVEN global `opencode.json` contains `provider.agy-bridge`
- WHEN running `opencode models`
- THEN the list MUST include `agy-bridge/auto-ro-*` and `agy-bridge/auto-rw-*`

#### Scenario: No bare ids

- GIVEN the provider is configured
- WHEN listing models
- THEN bare `agy-bridge/gemini-*` / `claude-*` SHALL NOT appear

### Requirement: Auto-Prefixed Model Enumeration

The system MUST expose ONLY `auto-ro-<slug>` and `auto-rw-<slug>` per base `<slug>` derived from `agy models` TSV or `FALLBACK_MODELS`. Bare slugs MUST NOT be exposed. The plugin's provider hook (`resolveSlugs` → `groupBases` → `buildModelMap`) MUST fetch live ids and fall back to `FALLBACK_MODELS` when the bridge is unreachable.

#### Scenario: Live enumeration

- GIVEN `GET /v1/models` returns `gemini-3.7-flash-high`
- WHEN models are resolved
- THEN the result MUST contain `auto-ro-gemini-3.7-flash` and `auto-rw-gemini-3.7-flash` (base form; effort via variants)

#### Scenario: Fallback (grouped)

- GIVEN the bridge is unreachable
- WHEN falling back to `FALLBACK_MODELS`
- THEN the system MUST generate 14 grouped ids (7 distinct bases × 2 profiles: `auto-ro/*` + `auto-rw/*`) with `variants` maps — NOT 28 flat suffixed ids. Grouping strips `{-high,-medium,-low,-thinking}` to deduplicate bases; singleton bases yield `variants: {}`.

> **Deviation note (accepted):** The change delta originally stated 28 flat ids (14 × 2). Implementation correctly groups 14 suffixed FALLBACK entries into 7 distinct bases, yielding 14 ids with variant maps. Flat 28 would duplicate variant ids and violate the `variants` requirement. Verified by `plugins/agy-bridge.test.ts` (FALLBACK 14 → 7 bases → 14 ids) and `opencode models` (14 `agy-bridge/auto-*`).

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

### Requirement: Variant-to-Suffix Wire Contract

Variant selection MUST produce a suffixed wire `model`: selecting `high` on `auto-ro-gemini-3.7-flash` MUST send `model: "auto-ro-gemini-3.7-flash-high"` to `POST /v1/chat/completions`. Without a variant, the base id MUST be sent verbatim. If no variant is selected on a base that has effort suffixes, the plugin MUST apply a default variant (`medium` → `high` → `low` → `thinking` priority). The mechanism is the `fetch` wrapper scoped to `7421/v1/chat/completions` combined with the `chat.message` hook (`variantByModel` map) — opencode does NOT send `variant` in the `POST` body.

#### Scenario: Suffixed wire id (explicit variant)

- GIVEN the user picks `auto-ro-gemini-3.7-flash` + `high` via the variant picker
- WHEN posting to `/v1/chat/completions`
- THEN `model` MUST be `auto-ro-gemini-3.7-flash-high` and the bridge MUST accept it via `parseAutoModel`

#### Scenario: Default variant fallback

- GIVEN the user picks `auto-ro-gemini-3.7-flash` with no explicit variant
- WHEN posting to `/v1/chat/completions`
- THEN `model` MUST be rewritten to `auto-ro-gemini-3.7-flash-medium` (default) and succeed

### Requirement: Per-Request Bearer Auth

Every request to `agy-bridge` MUST carry `Authorization: Bearer <AGY_TOKEN>` (source `~/.config/agy-bridge/env`, `600`). The primary opencode store MUST be `~/.local/share/opencode/auth.json` via `/connect` → `Other` → `agy-bridge` (type `api`, `600`). `"{env:AGY_TOKEN}"` MAY be documented as an alternative. No literal token in `opencode.json` or the repository.

#### Scenario: Auth succeeds

- GIVEN `auth.json` has an `agy-bridge` entry
- WHEN sending a chat completion
- THEN the bridge MUST return `200`

#### Scenario: Missing auth

- GIVEN no `agy-bridge` entry and a token is configured on the bridge
- WHEN a request is sent without an `Authorization` header
- THEN the bridge MUST return `401`

### Requirement: BaseURL and Host Correctness

`baseURL` MUST be `http://127.0.0.1:7421/v1` (MUST end with `/v1` so the SDK appends `/chat/completions`). Requests MUST carry `Host: 127.0.0.1:7421` or `localhost:7421` for `accessGuard` (loopback-only).

#### Scenario: Correct routing

- GIVEN `baseURL` ends with `/v1`
- WHEN posting a completion
- THEN the path MUST be `/v1/chat/completions` (not `404`)

#### Scenario: Spoofed host

- GIVEN `Host: evil.com`
- WHEN `accessGuard` checks
- THEN it MUST return `403`

### Requirement: End-to-End Verification

Verification MUST cover: `curl -H "Authorization: Bearer $AGY_TOKEN" http://127.0.0.1:7421/v1/models` → `200`; `opencode models` lists `agy-bridge/auto-*`; variant pick yields suffixed wire id; `POST /v1/chat/completions` with `auto-ro-*` succeeds (stream and non-stream).

#### Scenario: Happy verification

- GIVEN the bridge is running and `auth.json` is configured
- WHEN running `curl /v1/models`, `opencode models`, variant `high`, and a chat completion
- THEN all MUST succeed with `choices[0].message.content`

### Requirement: Rollback

Rollback MUST be: remove `provider.agy-bridge` from `opencode.json`, delete `agy-bridge` from `auth.json`, delete `~/.config/opencode/plugins/agy-bridge.ts`, restart `opencode`. No bridge or systemd changes.

#### Scenario: Clean rollback

- GIVEN provider and auth entries exist
- WHEN both are removed and `opencode` is restarted
- THEN `opencode models` MUST NOT list `agy-bridge/*`

### Requirement: Bridge Non-Bannable Guarantee

The bridge MUST continue to spawn the official `agy` binary per request (loopback `accessGuard` with `Host` check and `Bearer AGY_TOKEN`), with no direct Google API calls and no expansion of Deno permissions (`--allow-net=127.0.0.1 --allow-run --allow-env` only).

#### Scenario: Binary delegation

- GIVEN a chat completion request
- WHEN the bridge handles it
- THEN it MUST delegate to `agy` via `stream-json` NDJSON on stdin, not via external Google endpoints
