# Proposal: AGY Model Sync

## Intent

Provider models in `opencode.json` are hardcoded to 14 `FALLBACK_MODELS`. New `agy models` never appear in `opencode models` without manual edit. Provide sync script + installer hook that maps live `agy` models to `auto-ro/rw-<base>` with correct `variants`/`capabilities.reasoning`.

## Scope

### In Scope
- `scripts/sync-models.ts` — queries `agy`, builds provider models, atomically updates `opencode.json`
- `install.sh` invokes sync on every install; graceful fallback to 14-model generation if offline/unauthenticated
- Resolution chain `agy models` TSV → `GET /v1/models` → `FALLBACK_MODELS`; grouping via `stripEffortSuffix`/`groupBases`/`buildModelMap`
- Atomic tmp+rename, preserve other providers/plugins, dry-run flag

### Out of Scope
- Changing `agy-bridge.ts` runtime model refresh
- New Deno permissions beyond scoped `--allow-run`/`--allow-net=127.0.0.1`
- Cron/daemon auto-sync; only manual + install-triggered

## Capabilities

### New Capabilities
- `model-sync`: maps live `agy` slugs to `provider.agy-bridge.models` (`auto-ro/rw-<base>`, full variants)

### Modified Capabilities
- `opencode-provider`: models derived live via sync, not static 14; plugin fallback kept only when bridge down
- `install-automation`: `install.sh` delegates model generation to `model-sync` instead of inline Python

## Approach

Script reuses `plugins/agy-bridge-helpers.ts`. Chain: `agy models` TSV → `GET /v1/models` → `FALLBACK_MODELS` → `groupBases`/`buildModelMap` → atomic `opencode.json`. Installer execs it; on failure uses Python fallback.

Alternatives rejected: inline Python only (no standalone), plugin-only (picker needs static JSON), bash (duplicates helpers).

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `scripts/sync-models.ts` | New | Sync script + TSV/fetch/fallback |
| `plugins/agy-bridge-helpers.ts` | Modified | Shared helpers |
| `install.sh` | Modified | Invoke sync + fallback |
| `~/.config/opencode/opencode.json` | Modified | `provider.agy-bridge.models` |
| `deno.json` | Modified | `sync:models` task |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| TSV drift | Med | Tolerant parse; fallback chain; warn |
| Offline install blocks | Low | Sync failure → fallback, never fail install |
| JSON corruption | Low | tmp+rename, validate, `.bak` |
| Clobber other providers | Low | RMW `agy-bridge` key only |
| Token leak | Low | Never log token |

## Rollback Plan

Revert commit: delete script, restore inline Python in `install.sh`. Config: restore `opencode.json.bak` or remove `provider.agy-bridge.models` and re-run old installer. Plugin fallback still serves 14 models. No bridge/systemd change.

## Dependencies

- `agy` (`AGY_BIN`), `deno` 2.9.5+, `AGY_TOKEN` (`~/.config/agy-bridge/env` 600), `python3` fallback

## Success Criteria

- [ ] Script maps N slugs → 2N `auto-ro/rw-*` with `variants`/`capabilities.reasoning`
- [ ] Install offline → 14 fallback; online → full live set
- [ ] Re-run preserves other providers, valid JSON atomic
- [ ] `opencode models` parity with `curl /v1/models`

## Proposal Question Round

Optional: 1) prune stale vs additive? 2) always sync vs flag? 3) overwrite vs `--force`? Assumptions: prune, always, backup.
