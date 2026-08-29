# Install Automation Specification

## Purpose

Define the requirements for automated and manual setup of the service to ensure consistent and reproducible deployments across Linux environments.

## Requirements

### Requirement: Installation Script Workflow

The installation script (`install.sh`) MUST automate the detection of dependencies, environment setup, and service registration.

#### Scenario: Automated installation on a clean machine

- GIVEN a machine with `deno` and `agy` binaries installed
- WHEN the user executes `install.sh`
- THEN the script MUST detect the paths for `deno` and `agy`
- AND it MUST generate an appropriate env file for the user to edit
- AND it MUST copy the example agent configurations to the system agent directory
- AND it MUST install and enable the systemd service template

#### Scenario: Script is idempotent and safe

- GIVEN existing agent configs in `~/.gemini/config/agents/`
- WHEN `install.sh` runs without --force
- THEN it MUST NOT overwrite existing configs (skip-if-exists)
- AND with --force it MUST overwrite

### Requirement: Manual Installation Fallback

The project MUST provide complete documentation for manual installation to support environments without systemd or standard layouts.

#### Scenario: User installs manually

- GIVEN the user's environment does not support `install.sh`
- WHEN the user follows the README manual setup instructions
- THEN they MUST be able to successfully configure the environment variables, agent files, and service startup without the script

### Requirement: Install Automation — Global Provider Docs

This extends the installation automation to cover global `opencode` provider setup and verification.

The documentation and `install.sh` MUST cover global provider setup for `agy-bridge` (`~/.config/opencode/opencode.json` with `npm: "@ai-sdk/openai-compatible"`, `baseURL: "http://127.0.0.1:7421/v1"`, flat `auto-ro`/`auto-rw` ids with `variants` per base, and plugin ref `~/.config/opencode/plugins/agy-bridge.ts`) and verification via `curl -H "Authorization: Bearer $AGY_TOKEN" http://127.0.0.1:7421/v1/models` and `opencode models` (14 `agy-bridge/auto-*`, no bare `gemini-*`/`claude-*`).

#### Scenario: Fresh-machine restore

- GIVEN a clean machine after `install.sh` and the `opencode` global config documented in README/`install.sh`
- WHEN following the README steps and running `opencode models`
- THEN it MUST show `agy-bridge/auto-ro-*` and `agy-bridge/auto-rw-*` (14 ids), with `curl /v1/models` returning `200`

#### Scenario: Install script provisions provider

- GIVEN `install.sh` runs without an existing `provider.agy-bridge`
- WHEN the script completes
- THEN it MUST generate the `provider.agy-bridge` entry with 14 models (each with `variants` maps), copy `plugins/agy-bridge.ts` to `~/.config/opencode/plugins/agy-bridge.ts`, and echo `/connect Other → agy-bridge` + `curl` verification steps

#### Scenario: Idempotent provider provisioning

- GIVEN `provider.agy-bridge` already exists in `opencode.json`
- WHEN `install.sh` runs again
- THEN it MUST NOT duplicate provider entries and `bash -n install.sh` MUST remain without syntax error
