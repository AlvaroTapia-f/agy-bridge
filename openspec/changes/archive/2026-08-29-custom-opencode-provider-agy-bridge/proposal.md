# Proposal: custom-opencode-provider-agy-bridge

## Intent

Make `agy-bridge` a first-class `opencode` provider after clean reinstall: models + efforts visible, API key per request. Today no provider in `opencode.json` and no credential in `auth.json` — lost on reinstall.

## Scope

### In Scope
- Static `provider.agy-bridge` in `~/.config/opencode/opencode.json` (`npm: "@ai-sdk/openai-compatible"`, `baseURL: "http://127.0.0.1:7421/v1"`, flat `models` map with `-high`/`-medium`/`-low`, 14 `FALLBACK_MODELS` entries).
- Auth: `/connect Other` -> `agy-bridge` -> `AGY_TOKEN` to `auth.json` (type `api`); alt `"{env:AGY_TOKEN}"` documented.
- Docs: README/install.sh + verify (`curl /v1/models`, `opencode models`, completion).

### Out of Scope
- `variants` grouping + rewrite plugin; dynamic plugin discovery.
- Repo-local `opencode.json` or `agy-bridge.ts` changes; bridge `Host` guard changes.

## Capabilities

### New Capabilities
- `opencode-provider`: OpenAI-compatible agy-bridge provider, flat effort ids, per-request Bearer auth.

### Modified Capabilities
- `install-automation`: configure/document provider post-install.
- `secret-management`: token flow for opencode (auth.json 600 vs env), no literals.

## Approach

**Approach 1 — static + `/connect Other` flat ids** (REC.). Official pattern, secret in `auth.json` (600), `baseURL` ends `/v1` (SDK appends `/chat/completions`), Bearer auto. Flat ids avoid `variant` gap (bridge reads only `model`).

Rejected: A2 `variants` — needs plugin/patch, 400. A3 dynamic plugin — extra surface, defer.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `~/.config/opencode/opencode.json` | Modified | Add `provider.agy-bridge` |
| `~/.local/share/opencode/auth.json` | Modified | Add api key |
| `install.sh` / README | Modified | Document + verify |
| `agy-bridge.ts` | None | No change |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Token in git | Med | auth.json/{env:}, 600, never literal |
| Model drift | Med | Doc `curl /v1/models` refresh |
| Wrong baseURL | Low | Enforce `/v1` |
| Env not in TUI | Med | Prefer auth.json; doc `source env` |
| MAX_CONCURRENT=1 | Low | Doc 2-7s latency |

## Rollback Plan

Remove `provider.agy-bridge` from `opencode.json`; delete `auth.json` entry; restart opencode. No bridge/systemd revert.

## Dependencies

Bridge `127.0.0.1:7421`, `AGY_TOKEN` in `~/.config/agy-bridge/env` (600), opencode >=1.18.23, `@ai-sdk/openai-compatible`, no proxy mutating `Host`.

## Success Criteria

- [ ] `curl -H "Bearer $TOKEN" :7421/v1/models` OK
- [ ] `opencode models` lists `agy-bridge/*` (14)
- [ ] Chat completion via agy-bridge succeeds
- [ ] No secret in repo
- [ ] Fresh config + docs restores provider

## Proposal question round

Interactive (ask-on-risk) — answer/skip/second round:
1. Flat suffix now, variants later — OK?
2. 14 only or +28 `auto-ro/rw-*`?
3. auth.json primary vs `{env:}` — shared-machine need?
4. Global only or repo-local template too?

Assumptions if silent: flat, 14, auth.json, global only.
