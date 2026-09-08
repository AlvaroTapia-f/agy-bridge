# Plugin Packaging Specification

## Purpose

Define the generation, validation, and installation of a self-contained OpenCode plugin bundle produced from `plugins/agy-bridge-helpers.ts` as the single model source, replacing the hand-maintained duplicate plugin copy.

## Requirements

### Requirement: Bundle Generation

The system MUST produce `plugins/agy-bridge.ts` as a generated artifact via `deno bundle` from the helpers entrypoint. The generated bundle MUST be self-contained (no external helper imports at runtime). The source of truth for catalog, grouping, and model-map logic MUST be `plugins/agy-bridge-helpers.ts`. The build MUST be reproducible: same helpers source MUST produce byte-identical bundle output.

#### Scenario: Bundle produced from helpers

- GIVEN `plugins/agy-bridge-helpers.ts` as the canonical model source
- WHEN the bundle generation step runs
- THEN `plugins/agy-bridge.ts` MUST be a single self-contained file with all dependencies inlined
- AND it MUST NOT contain import specifiers that resolve outside the bundle

#### Scenario: Generated file is not hand-edited

- GIVEN the generated bundle file
- WHEN inspecting the file header or project documentation
- THEN it MUST be marked as generated and direct edits MUST be directed to the helpers source

### Requirement: Installed-Plugin Smoke Test

The system MUST include a smoke test that verifies the generated bundle loads and functions correctly in a live OpenCode instance. This smoke test MUST pass before any modification or removal of the prior hand-maintained plugin copy.

#### Scenario: Smoke test passes before consolidation

- GIVEN a generated bundle candidate
- WHEN the smoke test runs against a live OpenCode instance
- THEN the plugin MUST load without import errors
- AND `opencode models` MUST list the expected `agy-bridge/auto-*` ids
- AND the plugin hook MUST produce correct grouping output matching the helpers source

#### Scenario: Smoke test gates deletion of prior copy

- GIVEN the existing hand-maintained plugin copy is in place
- WHEN the smoke test for the generated bundle has not yet passed
- THEN the system MUST NOT delete or replace the existing plugin copy
- AND the prior copy MUST remain functional

### Requirement: Parity Check in Test Suite

The `deno test` suite MUST assert that the generated bundle output is functionally identical to the helpers source for catalog, grouping, and model-map behavior.

#### Scenario: Parity test green

- GIVEN `FALLBACK_MODELS` as input to both the bundle and the helpers
- WHEN `deno test` runs the parity check
- THEN the bundle's grouping output MUST equal the helpers' `groupBases` output
- AND the bundle's `buildModelMap` output MUST equal the helpers' `buildModelMap` output

#### Scenario: Parity test catches drift

- GIVEN the helpers source is modified to change grouping behavior
- WHEN `deno test` runs
- THEN the parity test MUST fail if the bundle was not regenerated
