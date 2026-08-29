# Secret Management Specification

## Purpose

Define the requirements for managing sensitive credentials securely outside the source code, preventing leaks in version control.

## Requirements

### Requirement: Token Externalization

The system MUST load the application token from an external environment variable configuration file rather than hardcoded service definitions.

#### Scenario: Service reads token from environment file

- GIVEN the service is configured to use `EnvironmentFile`
- WHEN the service starts up
- THEN it MUST read the `AGY_TOKEN` from the specified environment file
- AND the service MUST authenticate successfully using the externalized token

### Requirement: Secret Documentation

The system MUST provide a template for environment configuration to guide users during installation.

#### Scenario: User copies environment template

- GIVEN the repository contains a `.env.example` file documenting required variables
- WHEN a user sets up the project
- THEN they CAN copy `.env.example` to `.env` and fill in their actual token

### Requirement: Token Leak Prevention

The repository MUST NOT contain the bearer token in its commit history or active tracking.

#### Scenario: Verification script execution

- GIVEN the repository is prepared for publishing
- WHEN a verification tool runs `grep` for the leaked token string
- THEN it MUST return zero matches across all tracked files

#### Scenario: Git history is clean

- GIVEN a new clean repository without old history
- WHEN running `git log --all -p | grep -c '7144bf7b'`
- THEN it MUST return 0

### Requirement: Secret Management — Opencode Token Flow

This extends secret management to cover the `opencode` per-request `AGY_TOKEN` flow.

`AGY_TOKEN` (source `~/.config/agy-bridge/env`, `600`) MUST be delivered to `opencode` via `~/.local/share/opencode/auth.json` (`type: "api"`, key `agy-bridge`, `600`) created through the TUI `/connect` → `Other` → `agy-bridge` (paste token). The alternative `"{env:AGY_TOKEN}"` reference in `opencode.json` MAY be documented. No literal token in `opencode.json` or the repository. The plugin `auth.loader` returns `{apiKey: key}` for `type: api`; the bridge `accessGuard` enforces `Authorization: Bearer <token>` (→ `401` without, `403` on `Host` spoof).

#### Scenario: Auth via auth.json

- GIVEN `auth.json` contains `agy-bridge: {type:"api", key:"<AGY_TOKEN>"}` with `600` perms
- WHEN sending a chat completion via `opencode`
- THEN the bridge MUST return `200` and `grep -r AGY_TOKEN` in the repo MUST show only placeholders (`{env:AGY_TOKEN}`) and docs

#### Scenario: No secret in repo

- GIVEN the project is configured via `auth.json`
- WHEN grepping the repository for the literal `AGY_TOKEN` value
- THEN the result MUST be zero matches and `opencode.json` MUST NOT contain a literal token

#### Scenario: Alternative env reference

- GIVEN the docs describe `"{env:AGY_TOKEN}"` as an alternative
- WHEN the user exports `AGY_TOKEN` from `~/.config/agy-bridge/env` in the shell before launching `opencode`
- THEN `opencode` MUST still authenticate with `Bearer $AGY_TOKEN` (documented fallback, primary remains `auth.json`)
