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

The documentation and `install.sh` MUST cover global provider setup for `agy-bridge` (`~/.config/opencode/opencode.json` with `npm: "@ai-sdk/openai-compatible"`, `baseURL: "http://127.0.0.1:7421/v1"`, flat `auto-ro`/`auto-rw` ids with `variants` per base, and plugin ref `~/.config/opencode/plugins/agy-bridge.ts`) and verification via `curl -H "Authorization: Bearer $AGY_TOKEN" http://127.0.0.1:7421/v1/models` and `opencode models` (listing the synchronized `agy-bridge/auto-*` models, no bare `gemini-*`/`claude-*`). The embedded Python fallback generator within `install.sh` MUST mirror the 17 offline slugs and implement the 4-pass grouping logic to match the Deno output exactly if Deno synchronization fails.

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


### Requirement: Remote Bootstrap Script Presence and Safety

The system MUST provide `install-remote.sh` at repo root. It MUST use `bash` with `set -euo pipefail`, MUST be <150 lines, MUST pass `bash -n`, MUST NOT contain `sudo` or literal `AGY_TOKEN`, and MUST be auditable via `curl|less`.

#### Scenario: Auditable one-liner

- GIVEN repo is public
- WHEN user runs `curl -fsSL .../install-remote.sh | bash`
- THEN wrapper MUST execute with no `sudo` and no embedded `AGY_TOKEN`

#### Scenario: Static safety

- GIVEN `install-remote.sh` at root
- WHEN running `bash -n` and `wc -l`
- THEN syntax MUST pass and lines MUST be <150

### Requirement: Clone Target and Fetch Strategy

Wrapper MUST resolve `AGY_BRIDGE_DIR` default `~/.local/share/agy-bridge` (XDG, env-overridable) and `AGY_BRIDGE_REF` default `main` (tag/branch/commit allowed). It MUST prefer `git clone --depth 1 --branch $REF` and on failure MUST fallback to `curl .../archive/${REF}.tar.gz | tar xz --strip-components=1`.

#### Scenario: Defaults

- GIVEN env vars unset
- WHEN wrapper resolves targets
- THEN dir MUST be `~/.local/share/agy-bridge` and ref MUST be `main`

#### Scenario: Git preferred with tarball fallback

- GIVEN `git` available and dir absent
- WHEN fetching `main`
- THEN it MUST run `git clone --depth 1 --branch main` and on failure MUST use tarball fallback with `--strip-components=1`

#### Scenario: Custom pin

- GIVEN `AGY_BRIDGE_REF=v0.2.0` and `AGY_BRIDGE_DIR=/tmp/custom-agy`
- WHEN wrapper runs
- THEN it MUST clone or extract that ref into that dir

### Requirement: Idempotent Update and Delegation

Wrapper MUST be idempotent: if dir exists with git metadata it MUST try `git -C pull --ff-only`; on divergence it MUST fail with guidance unless `--force` triggers re-clone, MUST preserve `~/.config/agy-bridge/env`, and MUST `exec bash "$DIR/install.sh" "$@"` forwarding `--with-auth`/`--force`/`-h`.

#### Scenario: Idempotent re-run

- GIVEN dir already contains clone on `main`
- WHEN wrapper runs again without `--force`
- THEN it MUST fast-forward pull and exec `install.sh`

#### Scenario: Force re-clone

- GIVEN dir diverged and `pull --ff-only` fails
- WHEN wrapper runs with `--force`
- THEN it MUST re-clone `AGY_BRIDGE_REF` into dir

#### Scenario: Arg passthrough

- GIVEN wrapper invoked with `--with-auth --force`
- WHEN delegating
- THEN it MUST exec `install.sh` with same args

### Requirement: Verification and Fail-Fast

After delegation the system MUST verify `systemctl --user is-active agy-bridge` is `active`, `GET /healthz` returns `{"ok":true}`, and `GET /v1/models` with `Bearer $AGY_TOKEN` returns 200. It MUST fail fast if `agy` or `deno` missing (no auto-install) and if `systemd --user` unavailable MUST print `deno run` fallback.

#### Scenario: Successful verification

- GIVEN install completed and `AGY_TOKEN` set
- WHEN checking `is-active`, `curl /healthz`, and `curl /v1/models`
- THEN results MUST be `active`, `{"ok":true}`, and HTTP 200

#### Scenario: Missing agy fails fast

- GIVEN `agy` not on `PATH`
- WHEN wrapper runs
- THEN it MUST exit non-zero before clone with prerequisite message

#### Scenario: Missing systemd fallback

- GIVEN `systemd --user` unavailable
- WHEN verification runs
- THEN it MUST print manual `deno run` command

### Requirement: README One-Liner Documentation

`README.md` MUST document the one-liner, `bash -s -- --with-auth` variant, `AGY_BRIDGE_REF`/`AGY_BRIDGE_DIR` overrides, `curl|less` audit step, no-`sudo` guarantee, and state `deno`/`agy` prerequisites with `install.sh` canonical.

#### Scenario: README covers install

- GIVEN new user reads `README.md`
- WHEN locating install section
- THEN it MUST show one-liner, env-var examples, `curl|less` audit, and no `sudo`
