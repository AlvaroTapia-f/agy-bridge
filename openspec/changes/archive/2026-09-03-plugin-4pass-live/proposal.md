# Proposal: plugin-4pass-live

## Intent

Make plugin live without manual sync: port 4-pass `groupBases` from helpers into self-contained plugin, refresh `FALLBACK_MODELS` 14→17 (+`gemini-3.8-flash-high/medium/low`). Fixes stale offline fallback and 1-pass vs 4-pass divergence.

## Scope

### In Scope
- 4-pass `groupBases` mirror in `plugins/agy-bridge.ts` (self-contained; loader forbids imports)
- `FALLBACK_MODELS` 14→17 in plugin, helpers, `agy-bridge.ts` (17 slugs→8 bases→16 ids)
- `install.sh` Python fallback sync (same 17 + 4-pass)
- Tests: 14/7/14→17/8/16, 3.8 cases, parity plugin≡helpers

### Out of Scope
- Shared module (blocked by loader)
- `EFFORT_SUFFIXES` / wire contract / `agy` TSV changes
- Extra 3.8 variants beyond high/medium/low

## Capabilities

### New Capabilities
- None

### Modified Capabilities
- `opencode-provider`: hook uses 4-pass; fallback 14→17
- `model-sync`: `FALLBACK` + `groupBases` parity (Deno & Python)
- `install-automation`: Python fallback 17 + 4-pass

## Approach

**Option A — Self-contained + lockstep + parity.**

1. Copy 4-pass `groupBases` into `plugins/agy-bridge.ts` (~+54 lines), keep FALLBACK inlined
2. Append 3× `gemini-3.8-flash-*` to 3 FALLBACK arrays
3. Update `install.sh` Python block (passes 1-4)
4. Update `plugins/agy-bridge.test.ts` counts + parity test
5. `deno check` + `deno test` strict TDD

*Rejected:* B shared module (needs loader change). C re-export `import "./helpers"` (sandbox fails).

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `plugins/agy-bridge.ts` | Modified | 1-pass→4-pass; FALLBACK 14→17 |
| `plugins/agy-bridge-helpers.ts` | Modified | FALLBACK 14→17 |
| `agy-bridge.ts` | Modified | FALLBACK 14→17 |
| `install.sh` | Modified | Python fallback 17 + 4-pass |
| `plugins/agy-bridge.test.ts` | Modified | 17/8/16 + 3.8 + parity |

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Test breakage (14/7/14) | High | Update counts now; `deno test` gate |
| Python skew | Med | Fixture `EXPECTED_FALLBACK` |
| Triple drift | Med | Parity test + `// LOCKSTEP` |
| Loader import fail | Low | No imports |
| New variant (ultra) | Low | Pass 2-3 handles unknowns |

## Rollback Plan

`git revert <sha>` restores 1-pass plugin + 14 models. No migration. Re-run `./install.sh` or `sync-models.ts`; `.bak` restores `opencode.json`.

## Dependencies

- Deno 2.9.5, `deno test`/`deno check` (strict_tdd)
- OpenCode loader: self-contained (verified)
- `agy` for live `GET /v1/models` (fallback covers offline)

## Success Criteria

- [ ] Plugin groups FALLBACK to 8 bases/16 ids, equals helpers
- [ ] `deno test` passes (17/8/16 + parity)
- [ ] Offline hook returns `auto-ro/rw-gemini-3.8-flash` with high/medium/low
- [ ] Python fallback equals Deno map
- [ ] `deno check` clean for both entry points

## Proposal question round

1. 3.8 scope: high/medium/low complete? Add `thinking` later?
2. Accept lockstep duplication (A) vs file issue for shared module (B)?
3. Exact `17/8/16` asserts vs `>=` for future churn?
