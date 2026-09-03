# Delta for install-automation

## MODIFIED Requirements

### Requirement: Install Automation — Global Provider Docs

This extends the installation automation to cover global `opencode` provider setup and verification.

The documentation and `install.sh` MUST cover global provider setup for `agy-bridge` (`~/.config/opencode/opencode.json` with `npm: "@ai-sdk/openai-compatible"`, `baseURL: "http://127.0.0.1:7421/v1"`, flat `auto-ro`/`auto-rw` ids with `variants` per base, and plugin ref `~/.config/opencode/plugins/agy-bridge.ts`) and verification via `curl -H "Authorization: Bearer $AGY_TOKEN" http://127.0.0.1:7421/v1/models` and `opencode models` (listing the synchronized `agy-bridge/auto-*` models, no bare `gemini-*`/`claude-*`). The embedded Python fallback generator within `install.sh` MUST mirror the 17 offline slugs and implement the 4-pass grouping logic to match the Deno output exactly if Deno synchronization fails.
(Previously: Python fallback did not explicitly require 17 slugs and 4-pass logic to match Deno)

#### Scenario: Fresh-machine restore

- GIVEN a clean machine after `install.sh` and the `opencode` global config documented in README/`install.sh`
- WHEN following the README steps and running `opencode models`
- THEN it MUST show the synchronized `agy-bridge/auto-ro-*` and `agy-bridge/auto-rw-*` models (reflecting 8 bases/16 ids if offline), with `curl /v1/models` returning `200`

#### Scenario: Install script provisions provider

- GIVEN `install.sh` runs without an existing `provider.agy-bridge`
- WHEN the script completes
- THEN it MUST delegate model generation to the `model-sync` script to populate the `provider.agy-bridge` entry with live models (each with `variants` maps), copy `plugins/agy-bridge.ts` to `~/.config/opencode/plugins/agy-bridge.ts`, and echo `/connect Other → agy-bridge` + `curl` verification steps
- AND if `model-sync` script fails, the Python fallback MUST generate the exact same 16 grouped ids from 17 slugs using 4-pass logic

#### Scenario: Idempotent provider provisioning

- GIVEN `provider.agy-bridge` already exists in `opencode.json`
- WHEN `install.sh` runs again
- THEN it MUST invoke the sync script to update the models without duplicating provider entries and `bash -n install.sh` MUST remain without syntax error
