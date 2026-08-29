# Spec: custom-opencode-provider-agy-bridge

## Purpose

Global `agy-bridge` provider: ONLY `auto-ro-*`/`auto-rw-*` with `variants` for effort, per-request `Bearer AGY_TOKEN` via `auth.json` (alt `{env:AGY_TOKEN}` only), `http://127.0.0.1:7421/v1` + Host guard, validated via `modelSlugs`/`parseAutoModel`. Variant pick MUST yield suffixed wire `model`; mechanism deferred to design.

## ADDED Requirements

### Requirement: Global Provider Registration

The system MUST register `agy-bridge` in `~/.config/opencode/opencode.json` (global only) with `npm: "@ai-sdk/openai-compatible"`, `options.baseURL: "http://127.0.0.1:7421/v1"`. It MUST NOT create repo-local template and MUST appear in `opencode models` output.

#### Scenario: Provider visible

- GIVEN global `opencode.json` contains `provider.agy-bridge`
- WHEN running `opencode models`
- THEN list MUST include `agy-bridge/auto-ro-*` and `agy-bridge/auto-rw-*`

#### Scenario: No bare ids

- GIVEN provider configured
- WHEN listing models
- THEN bare `agy-bridge/gemini-*`/`claude-*` SHALL NOT appear

### Requirement: Auto-Prefixed Model Enumeration

System MUST expose ONLY `auto-ro-<slug>` and `auto-rw-<slug>` per base `<slug>` from `agy models` TSV or `FALLBACK_MODELS` (14). Bare slugs MUST NOT be exposed.

#### Scenario: Live enumeration

- GIVEN `GET /v1/models` returns `gemini-3.7-flash-high`
- WHEN models resolved
- THEN MUST contain `auto-ro-gemini-3.7-flash-high` and `auto-rw-gemini-3.7-flash-high`

#### Scenario: Fallback

- GIVEN bridge unreachable
- WHEN falling back
- THEN MUST generate 28 ids (14 × 2 profiles)

### Requirement: Effort Variants

Each model MUST expose `variants` map for effort (subset per base: `{high,medium,low}` etc.). Variants are ONLY effort UX; no flat `-high` ids.

#### Scenario: Picker

- GIVEN `auto-ro-gemini-3.7-flash` exists
- WHEN opening variant picker
- THEN MUST show `high`, `medium`, `low`

### Requirement: Variant-to-Suffix Wire Contract

Variant selection MUST produce suffixed wire `model`: `high` on `auto-ro-gemini-3.7-flash` MUST send `model: "auto-ro-gemini-3.7-flash-high"` to `POST /v1/chat/completions`. Without variant, base id MUST be sent verbatim.

#### Scenario: Suffixed wire id

- GIVEN picks `auto-ro-gemini-3.7-flash` + `high`
- WHEN posting to `/v1/chat/completions`
- THEN `model` MUST be `auto-ro-gemini-3.7-flash-high` and bridge MUST accept via `parseAutoModel`

### Requirement: Per-Request Bearer Auth

Every request MUST carry `Authorization: Bearer <AGY_TOKEN>` (`~/.config/agy-bridge/env`, 600). Primary store MUST be `~/.local/share/opencode/auth.json` via `/connect` → `Other` → `agy-bridge` (type `api`, 600). `"{env:AGY_TOKEN}"` MAY be documented as alt. No literal token in `opencode.json` or repo.

#### Scenario: Auth succeeds

- GIVEN `auth.json` has `agy-bridge` key
- WHEN sending chat completion
- THEN bridge MUST return `200`

#### Scenario: Missing auth

- GIVEN no `agy-bridge` entry and `AGY_TOKEN` set
- WHEN request sent without header
- THEN bridge MUST return `401`

### Requirement: BaseURL and Host Correctness

`baseURL` MUST be `http://127.0.0.1:7421/v1` (ends `/v1`). Requests MUST carry `Host: 127.0.0.1:7421` or `localhost:7421` for `accessGuard`.

#### Scenario: Correct routing

- GIVEN `baseURL` ends `/v1`
- WHEN posting completion
- THEN path MUST be `/v1/chat/completions` (not `404`)

#### Scenario: Spoofed host

- GIVEN `Host: evil.com`
- WHEN `accessGuard` checks
- THEN MUST return `403`

### Requirement: End-to-End Verification

Verification MUST cover: `curl -H "Authorization: Bearer $AGY_TOKEN" http://127.0.0.1:7421/v1/models` → `200`; `opencode models` lists `agy-bridge/auto-*`; variant pick yields suffixed wire id; `POST /v1/chat/completions` with `auto-ro-*` succeeds (stream + non-stream).

#### Scenario: Happy verification

- GIVEN bridge running and `auth.json` configured
- WHEN running `curl /v1/models`, `opencode models`, variant `high`, chat completion
- THEN all MUST succeed with `choices[0].message.content`

### Requirement: Rollback

Rollback MUST be: remove `provider.agy-bridge` from `opencode.json`, delete `agy-bridge` from `auth.json`, restart opencode. No bridge/systemd changes.

#### Scenario: Clean rollback

- GIVEN provider and auth entries exist
- WHEN both removed and opencode restarted
- THEN `opencode models` MUST NOT list `agy-bridge/*`

## MODIFIED Requirements

### Requirement: Install Automation — Global Provider Docs

(Extends `install-automation`; prev. only `deno`/`agy`/systemd.)

Docs MUST cover global provider setup and `curl`/`opencode models` verification.

#### Scenario: Fresh-machine restore

- GIVEN clean machine after `install.sh`
- WHEN following README steps
- THEN `opencode models` MUST show `agy-bridge/auto-*`

### Requirement: Secret Management — Opencode Token Flow

(Extends `secret-management`; prev. only `~/.config/agy-bridge/env`.)

Docs MUST describe `auth.json` flow (`/connect Other → agy-bridge`, type `api`, 600) and alt `"{env:AGY_TOKEN}"`, forbidding literal token in repo.

#### Scenario: No secret in repo

- GIVEN configured via `auth.json`
- WHEN grepping repo for token literal
- THEN result MUST be zero matches
