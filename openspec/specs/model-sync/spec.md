# model-sync Specification

## Purpose

Defines the behavior of the standalone model synchronization script used to dynamically populate `opencode.json` with the current set of available models from the `agy` CLI.

## Requirements

### Requirement: Script Execution and Resolution Chain

The synchronization script (`scripts/sync-models.ts`) MUST resolve available models through a specific fallback chain and atomically update the global `opencode.json` configuration.

#### Scenario: Successful TSV resolution

- GIVEN the user is authenticated and online
- WHEN `sync-models.ts` executes
- THEN it MUST attempt to query models via `agy models` TSV output
- AND it MUST group the bases via `stripEffortSuffix` and `groupBases`
- AND it MUST build the final model map using `buildModelMap` (yielding `auto-ro/rw-*` and effort variants)
- AND it MUST atomically update `provider.agy-bridge.models` in `~/.config/opencode/opencode.json`

### Requirement: Dynamic Effort Capture

Effort variants (e.g. `high`, `medium`, `low`, `thinking`) MUST be derived dynamically from the slugs actually exposed by `agy` at sync time, not from a static hardcoded list. The behavior MUST remain identical to the current hardcoded flow for existing models, and the internal fallback list MUST maintain parity (17 slugs, 8 bases) across both Deno and Python implementations using a 4-pass algorithm.

#### Scenario: Efforts inferred from live TSV

- GIVEN `agy models` returns `gemini-3.7-flash-high`, `gemini-3.7-flash-medium`, `gemini-3.7-flash-low`
- WHEN `sync-models.ts` groups bases
- THEN it MUST infer `base = gemini-3.7-flash` with `variants = {high, medium, low}` directly from the observed suffixes
- AND `buildModelMap` MUST emit `auto-ro-gemini-3.7-flash` with `capabilities: { reasoning: true }` and `variants.high/medium/low` each with `reasoningEffort` equal to the key

#### Scenario: New effort appears dynamically

- GIVEN a future `agy models` returns `gemini-3.8-flash-ultra` (new effort `ultra` not in the old `EFFORT_SUFFIXES` constant)
- WHEN `sync-models.ts` executes
- THEN it MUST capture `ultra` as a variant for base `gemini-3.8-flash` and expose `auto-ro-gemini-3.8-flash` with `variants.ultra.reasoningEffort === "ultra"`
- AND it MUST NOT require a code change to `EFFORT_SUFFIXES` or `FALLBACK_MODELS` to expose the new effort

#### Scenario: Compatibility with current hardcoded FALLBACK

- GIVEN offline fallback uses `FALLBACK_MODELS` (which encodes known suffixes)
- WHEN `groupBases(FALLBACK_MODELS)` is used
- THEN it MUST produce the 8 bases and variant sets as today (e.g. `gemini-3.8-flash -> {high,medium,low}`, `claude-sonnet-4-6 -> {}` singleton) covering 17 slugs
- AND the live dynamic path MUST be behaviorally equivalent for those inputs

#### Scenario: Bridge API Fallback

- GIVEN `agy models` TSV fails or is unavailable
- WHEN `sync-models.ts` executes
- THEN it MUST attempt to fetch models via `GET /v1/models`
- AND upon success, proceed to group bases and build the model map

#### Scenario: Offline Fallback (Idempotency and Non-Blocking)

- GIVEN both TSV and Bridge API fetches fail (e.g., offline or unauthenticated)
- WHEN `sync-models.ts` executes
- THEN it MUST fall back to generating models using `FALLBACK_MODELS`
- AND it MUST NOT exit with an error that blocks installation (never-blocking)
- AND it MUST group bases and build the model map to ensure fallback models are produced

### Requirement: Atomic Configuration Update

The script MUST safely update `opencode.json` without corrupting the file or removing other providers/plugins.

#### Scenario: Preserving existing configuration

- GIVEN `opencode.json` contains other providers (e.g., Anthropic, OpenAI)
- WHEN `sync-models.ts` updates `provider.agy-bridge.models`
- THEN it MUST perform a read-modify-write operation specifically on the `agy-bridge` key
- AND it MUST preserve all other providers and plugins
- AND it MUST use an atomic temporary-file-and-rename pattern to prevent corruption
- AND it MUST create a `.bak` backup before modifying

#### Scenario: Dry-run mode

- GIVEN the script is invoked with a dry-run flag
- WHEN it executes
- THEN it MUST output the generated JSON model map to stdout without modifying `opencode.json`
